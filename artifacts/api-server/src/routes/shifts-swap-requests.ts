// ---------------------------------------------------------------------------
// Tauschwunsch: "Kann dieser Dienst getauscht werden?"
// Siehe lib/db/src/schema/shift_swap_requests.ts fuer das Regelwerk.
// ---------------------------------------------------------------------------
// Bewusst OHNE Eingriff in den Dienst: Keine dieser Routen aendert
// planningStatus, Zeiten oder die zugewiesene Person. Das Umbesetzen laeuft
// wie immer ueber PATCH /shifts/:id — so bleibt der Dienst-Statusfluss an
// einer Stelle, statt sich auf zwei Wege zu verteilen (genau daran wurde der
// zurueckgebaute Widerspruch zu komplex).
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, shiftSwapRequestsTable, usersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  ListShiftSwapRequestsQueryParams,
  RequestShiftSwapParams,
  RequestShiftSwapBody,
  ResolveShiftSwapRequestParams,
  ResolveShiftSwapRequestBody,
} from "@workspace/api-zod";
import { requireAuth, requireTeamPlanningOrAdmin, isAdminLikeRole } from "../middleware/auth";
import {
  getEffectiveAdminTeamIds,
  getTeamIdsWithCapability,
  resolveReadTeamScope,
  parseTeamIdParam,
} from "../lib/teams";
import { isAbsenceType } from "../lib/shift-metrics-resolve";

const router = Router();

const SWAP_SELECT = {
  id: shiftSwapRequestsTable.id,
  shiftId: shiftSwapRequestsTable.shiftId,
  userId: shiftSwapRequestsTable.userId,
  userName: usersTable.name,
  teamId: shiftSwapRequestsTable.teamId,
  status: shiftSwapRequestsTable.status,
  reason: shiftSwapRequestsTable.reason,
  requestedAt: shiftSwapRequestsTable.requestedAt,
  resolution: shiftSwapRequestsTable.resolution,
  resolutionNote: shiftSwapRequestsTable.resolutionNote,
  resolvedBy: shiftSwapRequestsTable.resolvedBy,
  resolvedAt: shiftSwapRequestsTable.resolvedAt,
};

// Muss VOR /shifts/:id/swap-request stehen — sonst matcht Express
// "swap-requests" als :id-Parameter.
router.get("/shifts/swap-requests", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftSwapRequestsQueryParams.safeParse({
    teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const userId = req.session.userId!;
  const role = req.session.role!;
  const teamScope = await resolveReadTeamScope(userId, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  // Eine Assistenzkraft sieht ausschliesslich ihre EIGENEN Wuensche: Der Grund
  // ist oft privat ("Arzttermin"), er geht Kolleginnen nichts an. Planende
  // sehen alle Wuensche ihrer Teams — sie muessen ja darauf reagieren.
  const darfAlleSehen =
    isAdminLikeRole(role) || (await getTeamIdsWithCapability(userId, "plan")).length > 0;

  const rows = await db
    .select(SWAP_SELECT)
    .from(shiftSwapRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, shiftSwapRequestsTable.userId))
    .where(
      darfAlleSehen
        ? inArray(shiftSwapRequestsTable.teamId, teamScope)
        : and(
            inArray(shiftSwapRequestsTable.teamId, teamScope),
            eq(shiftSwapRequestsTable.userId, userId),
          ),
    );
  res.json(rows);
});

router.post("/shifts/:id/swap-request", requireAuth, async (req, res): Promise<void> => {
  const params = RequestShiftSwapParams.safeParse({ id: Number(req.params["id"]) });
  const body = RequestShiftSwapBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [shift] = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id))
    .limit(1);
  if (!shift) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Nur der eigene Dienst — 404 statt 403, damit fremde Dienst-IDs nicht
  // ausspaehbar sind (Muster wie bei der Abweichungsmeldung).
  if (shift.userId !== req.session.userId!) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Abwesenheiten und Teamsitzungen sind keine tauschbaren Dienste.
  if (shift.type === "team" || isAbsenceType(shift.type)) {
    res.status(400).json({
      error: "Nur Arbeitsdienste lassen sich tauschen.",
      code: "swap_invalid_shift",
    });
    return;
  }

  // Ein vergangener Dienst laesst sich nicht mehr tauschen — dafuer gibt es
  // die Abweichungsmeldung. Massgeblich ist das ENDE: ein laufender Dienst
  // ist noch nicht vorbei.
  if (shift.endTime.getTime() <= Date.now()) {
    res.status(400).json({
      error:
        "Dieser Dienst liegt bereits in der Vergangenheit. Melde stattdessen eine Abweichung.",
      code: "swap_shift_past",
    });
    return;
  }

  // Ein Entwurf ist der Assistenzkraft noch gar nicht zugesagt worden — es
  // gibt nichts zu tauschen, der Planer plant ohnehin noch.
  if ((shift.planningStatus ?? "FIX") === "VORLAEUFIG") {
    res.status(400).json({
      error: "Dieser Dienst ist noch ein Entwurf und wurde dir noch nicht vorgeschlagen.",
      code: "swap_shift_draft",
    });
    return;
  }

  try {
    const [inserted] = await db
      .insert(shiftSwapRequestsTable)
      .values({
        shiftId: shift.id,
        teamId: shift.teamId,
        userId: shift.userId,
        reason: body.data.reason.trim(),
      })
      .returning();
    const [withName] = await db
      .select(SWAP_SELECT)
      .from(shiftSwapRequestsTable)
      .leftJoin(usersTable, eq(usersTable.id, shiftSwapRequestsTable.userId))
      .where(eq(shiftSwapRequestsTable.id, inserted!.id))
      .limit(1);
    res.status(201).json(withName);
  } catch (err) {
    // Sicherheitsnetz gegen ein Wettrennen zweier Anfragen: der partielle
    // Unique-Index laesst nur EINEN offenen Wunsch je Dienst zu.
    const pgCode =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23505") {
      res
        .status(409)
        .json({ error: "Für diesen Dienst liegt bereits ein Tauschwunsch vor." });
      return;
    }
    throw err;
  }
});

router.post(
  "/shifts/:id/swap-request/resolve",
  requireTeamPlanningOrAdmin,
  async (req, res): Promise<void> => {
    const params = ResolveShiftSwapRequestParams.safeParse({ id: Number(req.params["id"]) });
    const body = ResolveShiftSwapRequestBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const [shift] = await db
      .select()
      .from(shiftsTable)
      .where(eq(shiftsTable.id, params.data.id))
      .limit(1);
    if (!shift) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    if (shift.teamId == null || !allowedTeams.includes(shift.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Nur den OFFENEN Wunsch schliessen. Ein bereits erledigter bleibt, wie
    // er ist — sonst koennte ein zweiter Klick eine alte Entscheidung
    // ueberschreiben.
    const [updated] = await db
      .update(shiftSwapRequestsTable)
      .set({
        status: "RESOLVED",
        resolution: body.data.resolution,
        resolutionNote: body.data.note?.trim() || null,
        resolvedBy: req.session.userId!,
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(shiftSwapRequestsTable.shiftId, shift.id),
          eq(shiftSwapRequestsTable.status, "OPEN"),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Kein offener Tauschwunsch für diesen Dienst." });
      return;
    }

    const [withName] = await db
      .select(SWAP_SELECT)
      .from(shiftSwapRequestsTable)
      .leftJoin(usersTable, eq(usersTable.id, shiftSwapRequestsTable.userId))
      .where(eq(shiftSwapRequestsTable.id, updated.id))
      .limit(1);
    res.json(withName);
  },
);

export default router;
