// ---------------------------------------------------------------------------
// Widerspruch gegen eine Planer-Korrektur ("Weg A", Kay-Entscheidung
// 28.08.2026). Siehe lib/db/src/schema/shift_correction_objections.ts fuer
// das Regelwerk.
// ---------------------------------------------------------------------------
// Drei Routen:
//   GET  /shifts/correction-objections     Liste im Team-Scope (beide Seiten)
//   POST /shifts/:id/correction/object     Assistenzkraft widerspricht
//   POST /shifts/:id/correction/withdraw   Planer nimmt die Korrektur zurueck
//
// Das NACHBEARBEITEN braucht keine eigene Route: der Planer aendert die Zeit
// wie immer ueber PATCH /shifts/:id; ein offener Widerspruch wird dort
// automatisch als REWORKED erledigt (s. shifts-crud.ts).
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "@workspace/db";
import {
  shiftsTable,
  shiftChangesTable,
  shiftCorrectionObjectionsTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  ListShiftCorrectionObjectionsQueryParams,
  ObjectShiftCorrectionParams,
  ObjectShiftCorrectionBody,
  WithdrawShiftCorrectionParams,
} from "@workspace/api-zod";
import { requireAuth, requireTeamPlanningOrAdmin } from "../middleware/auth";
import {
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  resolveReadTeamScope,
  parseTeamIdParam,
} from "../lib/teams";
import { isAbsenceType } from "../lib/shift-metrics-resolve";
import { storeShiftMetrics } from "./shifts";

const router = Router();

/** Offene Korrektur = vergangener Arbeitsdienst, der auf ANGEBOTEN zurueckfiel. */
function istOffeneKorrektur(shift: {
  planningStatus: string;
  type: string;
  endTime: Date;
}): boolean {
  return (
    shift.planningStatus === "ANGEBOTEN" &&
    !isAbsenceType(shift.type) &&
    shift.type !== "team" &&
    shift.endTime.getTime() < Date.now()
  );
}

// Muss VOR /shifts/:id stehen (s. Reihenfolgen-Hinweis in routes/index.ts).
router.get("/shifts/correction-objections", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftCorrectionObjectionsQueryParams.safeParse({
    teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const rows = await db
    .select()
    .from(shiftCorrectionObjectionsTable)
    .where(inArray(shiftCorrectionObjectionsTable.teamId, teamScope));
  res.json(rows);
});

router.post("/shifts/:id/correction/object", requireAuth, async (req, res): Promise<void> => {
  const params = ObjectShiftCorrectionParams.safeParse({ id: Number(req.params["id"]) });
  const body = ObjectShiftCorrectionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [shift] = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id))
    .limit(1);
  // Nur der eigene Dienst — 404 statt 403, damit fremde IDs nicht ausspaehbar
  // sind (Muster wie beim Abweichungs-Melden).
  if (
    !shift ||
    shift.userId !== req.session.userId ||
    shift.teamId == null ||
    !(await getAllowedTeamIds(req.session.userId!)).includes(shift.teamId)
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!istOffeneKorrektur(shift)) {
    res.status(400).json({
      error: "Es liegt keine offene Korrektur zu diesem Dienst vor.",
      code: "objection_no_open_correction",
    });
    return;
  }

  try {
    const [inserted] = await db
      .insert(shiftCorrectionObjectionsTable)
      .values({
        shiftId: shift.id,
        teamId: shift.teamId,
        userId: shift.userId,
        reason: body.data.reason,
        // Festhalten, wogegen widersprochen wurde — der Planer darf die Zeit
        // danach aendern, sonst waere der Streitstand nicht mehr belegbar.
        disputedStartTime: shift.startTime,
        disputedEndTime: shift.endTime,
      })
      .returning();
    res.status(201).json(inserted);
  } catch (err) {
    const pgCode =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    // Partieller Unique-Index: hoechstens EIN offener Widerspruch je Dienst.
    if (pgCode === "23505") {
      res.status(409).json({ error: "Zu diesem Dienst steht bereits ein Widerspruch offen." });
      return;
    }
    throw err;
  }
});

router.post(
  "/shifts/:id/correction/withdraw",
  requireTeamPlanningOrAdmin,
  async (req, res): Promise<void> => {
    const params = WithdrawShiftCorrectionParams.safeParse({ id: Number(req.params["id"]) });
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [shift] = await db
      .select()
      .from(shiftsTable)
      .where(eq(shiftsTable.id, params.data.id))
      .limit(1);
    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    if (!shift || shift.teamId == null || !allowedTeams.includes(shift.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [objection] = await db
      .select()
      .from(shiftCorrectionObjectionsTable)
      .where(
        and(
          eq(shiftCorrectionObjectionsTable.shiftId, shift.id),
          eq(shiftCorrectionObjectionsTable.status, "OPEN"),
        ),
      )
      .limit(1);
    if (!objection) {
      res.status(404).json({ error: "Kein offener Widerspruch zu diesem Dienst." });
      return;
    }

    // Der Wert VOR der Korrektur steht in der Aenderungshistorie — sie ist die
    // einzige Quelle dafuer, die Schicht selbst traegt nur den aktuellen Wert.
    const [letzteAenderung] = await db
      .select()
      .from(shiftChangesTable)
      .where(eq(shiftChangesTable.shiftId, shift.id))
      .orderBy(desc(shiftChangesTable.id))
      .limit(1);
    if (!letzteAenderung) {
      res.status(409).json({
        error:
          "Der Stand vor der Korrektur ist nicht mehr auffindbar. Bitte die Zeit von Hand nachbearbeiten.",
        code: "objection_no_history",
      });
      return;
    }

    const vorher = letzteAenderung.before;
    const result = await db.transaction(async (tx) => {
      const [restored] = await tx
        .update(shiftsTable)
        .set({
          startTime: new Date(vorher.startTime),
          endTime: new Date(vorher.endTime),
          pauseMinutes: vorher.pauseMinutes,
          // Zuruecknehmen stellt den zuvor EINVERNEHMLICHEN Stand wieder her —
          // eine erneute Bestaetigung waere sinnlos, deshalb direkt FIX.
          planningStatus: "FIX" as const,
        })
        .where(eq(shiftsTable.id, shift.id))
        .returning();

      // Auch die Ruecknahme ist eine Aenderung an einem bereits gearbeiteten
      // Dienst und gehoert lueckenlos in die Aufzeichnung (§ 3 Abs. 2 Nr. 1
      // ArbSchG) — sonst endete die Spur beim strittigen Zwischenwert.
      await tx.insert(shiftChangesTable).values({
        shiftId: shift.id,
        teamId: shift.teamId!,
        userId: shift.userId,
        changedBy: req.session.userId!,
        changeSource: "correction_withdrawn",
        before: {
          startTime: shift.startTime.toISOString(),
          endTime: shift.endTime.toISOString(),
          pauseMinutes: shift.pauseMinutes,
          userId: shift.userId,
        },
        after: {
          startTime: restored.startTime.toISOString(),
          endTime: restored.endTime.toISOString(),
          pauseMinutes: restored.pauseMinutes,
          userId: restored.userId,
        },
      });

      await storeShiftMetrics(restored, tx);

      const [resolved] = await tx
        .update(shiftCorrectionObjectionsTable)
        .set({
          status: "RESOLVED",
          resolution: "WITHDRAWN",
          resolvedBy: req.session.userId!,
          resolvedAt: new Date(),
        })
        .where(eq(shiftCorrectionObjectionsTable.id, objection.id))
        .returning();
      return resolved;
    });

    res.json(result);
  },
);

export default router;
