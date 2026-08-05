import { Router } from "express";
import { db } from "@workspace/db";
import { timeTrackingTable, usersTable, shiftsTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  ListTimeEntriesQueryParams,
  CreateTimeEntryBody,
  GetTimeEntryParams,
  UpdateTimeEntryParams,
  UpdateTimeEntryBody,
  DeleteTimeEntryParams,
  ConfirmTimeEntryParams,
  ConfirmTimeEntryBody,
  ConfirmTimeEntriesBatchBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin, requireTeamleiterOrAdmin, isAdminLikeRole } from "../middleware/auth";
import { requirePlanFeature } from "../lib/plan";
import {
  resolveTeamId,
  resolveReadTeamScope,
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  getTeamleiterTeamIds,
  parseTeamIdParam,
  isUserMemberOfTeam,
} from "../lib/teams";
import { resolveAllowanceOps } from "../lib/allowance-resolve";
import {
  isTimeTrackingEnabledForTeam,
  isTimeTrackingEnabledForUser,
  getTimeTrackingEnabledTeamIds,
  respondTimeTrackingDisabled,
  getPauseRuleForUser,
} from "../lib/time-tracking-enabled";

const router = Router();

function calcHours(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
}

const withUserSelect = {
  id: timeTrackingTable.id,
  userId: timeTrackingTable.userId,
  shiftId: timeTrackingTable.shiftId,
  actualStart: timeTrackingTable.actualStart,
  actualEnd: timeTrackingTable.actualEnd,
  actualHours: timeTrackingTable.actualHours,
  pauseMinutes: timeTrackingTable.pauseMinutes,
  status: timeTrackingTable.status,
  notes: timeTrackingTable.notes,
  confirmedBy: timeTrackingTable.confirmedBy,
  confirmedAt: timeTrackingTable.confirmedAt,
  createdAt: timeTrackingTable.createdAt,
  user: {
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    address: usersTable.address,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  },
};

router.get("/time-tracking", requireAuth, async (req, res): Promise<void> => {
  const query = ListTimeEntriesQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    status: req.query.status,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  // Teamleiter (assistant-Rolle, aber is_teamleiter=true) sehen alle Einträge
  // ihrer Teamleiter-Teams — nicht nur eigene.
  const tlTeamIds = isAdminLikeRole(req.session.role!)
    ? null
    : await getTeamleiterTeamIds(req.session.userId!);
  const isTeamleiterUser = tlTeamIds != null && tlTeamIds.length > 0;

  const effectiveUserId =
    req.session.role === "assistant" && !isTeamleiterUser ? req.session.userId! : query.data.userId;

  const teamScope = await resolveReadTeamScope(
    req.session.userId!,
    parseTeamIdParam(req),
    isTeamleiterUser ? tlTeamIds! : undefined,
  );
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const conditions = [inArray(timeTrackingTable.teamId, teamScope)];
  if (effectiveUserId) conditions.push(eq(timeTrackingTable.userId, effectiveUserId));
  if (query.data.status) conditions.push(eq(timeTrackingTable.status, query.data.status as "pending" | "confirmed" | "rejected"));
  if (query.data.month && query.data.year) {
    conditions.push(sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${query.data.month}`);
    conditions.push(sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${query.data.year}`);
  }

  const rows = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(and(...conditions));
  res.json(rows);
});

router.post("/time-tracking", requireAuth, async (req, res): Promise<void> => {
  const body = CreateTimeEntryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const userId =
    req.session.role === "assistant" ? req.session.userId! : body.data.userId;

  // Team-Scope des Aufrufers VOR allen inhaltlichen Prüfungen auflösen: die
  // Ownership- (403) und Duplikats-Antworten (409) unten dürfen keine
  // Rückschlüsse auf teamfremde Schichten/Ist-Zeiten erlauben (Fehler-Oracle).
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);

  let teamId: number | null = null;
  if (body.data.shiftId != null) {
    const [shift] = await db
      .select({ id: shiftsTable.id, userId: shiftsTable.userId, teamId: shiftsTable.teamId })
      .from(shiftsTable)
      .where(eq(shiftsTable.id, body.data.shiftId))
      .limit(1);
    // Teamfremde Schichten antworten identisch zu nicht existierenden (404) —
    // BEVOR Ownership (403) oder Doppelbuchung (409) geprüft werden, damit ein
    // fremder Admin per Statuscode weder Existenz noch Zuordnung noch
    // Buchungsstand teamfremder Schichten ausspähen kann.
    if (!shift || !allowedTeams.includes(shift.teamId)) {
      res.status(404).json({ error: "Schicht nicht gefunden." });
      return;
    }
    // Zugehörigkeit prüfen: die verknüpfte Schicht muss dem Benutzer gehören,
    // für den die Ist-Zeit erfasst wird. Sonst könnte eine fremde Schicht
    // verknüpft und (durch den 409-Guard) für den Berechtigten blockiert werden.
    if (shift.userId !== userId) {
      res.status(403).json({
        error: "Die Schicht gehört nicht zu diesem Benutzer.",
        code: "shift_not_owned",
      });
      return;
    }
    teamId = shift.teamId;

    // Doppelbuchung verhindern: pro geplanter Schicht darf nur eine Ist-Zeit
    // erfasst werden. Serverseitiger Schutz, unabhängig von der UI-Filterung.
    const [existing] = await db
      .select({ id: timeTrackingTable.id })
      .from(timeTrackingTable)
      .where(eq(timeTrackingTable.shiftId, body.data.shiftId))
      .limit(1);
    if (existing) {
      res.status(409).json({
        error: "Für diese Schicht wurde bereits eine Zeit erfasst.",
        code: "shift_already_booked",
      });
      return;
    }
  }

  if (teamId == null) {
    teamId = body.data.teamId ?? (await resolveTeamId(userId));
  }
  if (teamId == null) {
    res.status(400).json({ error: "Kein Team zugeordnet" });
    return;
  }
  // Sicherstellen, dass das (ggf. angeforderte oder von der Schicht geerbte)
  // Team im Berechtigungsumfang des erfassenden Nutzers liegt.
  if (!allowedTeams.includes(teamId)) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  // Der erfasste Nutzer muss Mitglied des Ziel-Teams sein, sonst ließe sich ein
  // fremder userId ins Team verknüpfen (Cross-Team-PII-Leak).
  if (!(await isUserMemberOfTeam(userId, teamId))) {
    res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
    return;
  }
  // Konto-Schalter „Zeiterfassung aktivieren" (Standard AUS): neue Ist-Zeiten
  // nur, wenn der Eigentümer des Ziel-Teams die Zeiterfassung aktiviert hat.
  if (!(await isTimeTrackingEnabledForTeam(teamId))) {
    respondTimeTrackingDisabled(res);
    return;
  }

  const actualStart = new Date(body.data.actualStart as unknown as string);
  const actualEnd = new Date(body.data.actualEnd as unknown as string);
  const actualHours = calcHours(actualStart, actualEnd);

  // Globaler Schalter „Stundenzettel automatisch genehmigen" (Fallback-Kette
  // Team-Override → Konto des Team-Eigentümers → Default false): eingereichte
  // Ist-Zeiten werden dann sofort als bestätigt gebucht (mit Prüfer = Ersteller).
  const ops = await resolveAllowanceOps(teamId);
  const autoConfirm = ops.autoApproveTimesheets
    ? {
        status: "confirmed" as const,
        confirmedBy: req.session.userId!,
        confirmedAt: new Date(),
      }
    : {};
  const [entry] = await db
    .insert(timeTrackingTable)
    .values({ ...body.data, userId, teamId, actualHours, ...autoConfirm })
    .returning();
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, entry.id));
  res.status(201).json(withUser);
});

router.get("/time-tracking/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select({ ...withUserSelect, teamId: timeTrackingTable.teamId })
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.session.role === "assistant") {
    if (row.userId !== req.session.userId!) {
      res.status(403).json({ error: "Keine Berechtigung" });
      return;
    }
  } else {
    const allowedTeams = await getAllowedTeamIds(req.session.userId!);
    if (row.teamId == null || !allowedTeams.includes(row.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const { teamId: _teamId, ...rowOut } = row;
  res.json(rowOut);
});

router.patch("/time-tracking/:id", requireTeamleiterOrAdmin, async (req, res): Promise<void> => {
  const params = UpdateTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const updateData: Record<string, unknown> = { ...body.data };
  if (body.data.actualStart && body.data.actualEnd) {
    updateData.actualHours = calcHours(
      new Date(body.data.actualStart as unknown as string),
      new Date(body.data.actualEnd as unknown as string)
    );
  }
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  // Zeile zuerst team-gescoped laden (404 bei fremd/fehlend), dann den
  // Konto-Schalter des Team-Eigentümers prüfen (403 bei deaktivierter
  // Zeiterfassung) — Bestandsdaten bleiben sichtbar, nur Änderungen blocken.
  const [existingRow] = await db
    .select({ teamId: timeTrackingTable.teamId })
    .from(timeTrackingTable)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .limit(1);
  if (!existingRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!(await isTimeTrackingEnabledForTeam(existingRow.teamId))) {
    respondTimeTrackingDisabled(res);
    return;
  }
  const [updated] = await db
    .update(timeTrackingTable)
    .set(updateData)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/time-tracking/:id", requireTeamleiterOrAdmin, async (req, res): Promise<void> => {
  const params = DeleteTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  // Erst team-gescoped laden (404), dann Konto-Schalter prüfen (403).
  const [existingRow] = await db
    .select({ teamId: timeTrackingTable.teamId })
    .from(timeTrackingTable)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .limit(1);
  if (!existingRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!(await isTimeTrackingEnabledForTeam(existingRow.teamId))) {
    respondTimeTrackingDisabled(res);
    return;
  }
  const deleted = await db
    .delete(timeTrackingTable)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .returning({ id: timeTrackingTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

// Premium-Feature "strictTimeTracking": der strikte Freigabe-Workflow
// (Bestätigen/Ablehnen erfasster Ist-Zeiten) ist Premium. Das ERFASSEN von
// Ist-Zeiten (POST) bleibt im Free-Tarif uneingeschränkt möglich; Einträge
// behalten dort den Status "offen". Bestandsschutz: bereits bestätigte/
// abgelehnte Einträge bleiben unverändert sichtbar — gegated wird nur die
// NEUE Freigabe-Aktion.
router.patch("/time-tracking/:id/confirm", requireTeamleiterOrAdmin, requirePlanFeature("strictTimeTracking"), async (req, res): Promise<void> => {
  const params = ConfirmTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  const body = ConfirmTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  // Erst team-gescoped laden (404), dann Konto-Schalter prüfen (403) —
  // die Freigabe ist eine Schreibaktion und bei deaktivierter Zeiterfassung
  // gesperrt; bereits bestätigte Bestandsdaten bleiben unangetastet.
  const [existingRow] = await db
    .select({ teamId: timeTrackingTable.teamId })
    .from(timeTrackingTable)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .limit(1);
  if (!existingRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!(await isTimeTrackingEnabledForTeam(existingRow.teamId))) {
    respondTimeTrackingDisabled(res);
    return;
  }
  const [updated] = await db
    .update(timeTrackingTable)
    .set({
      status: body.data.status,
      confirmedBy: req.session.userId!,
      confirmedAt: new Date(),
    })
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  res.json(withUser);
});

// Sammelbestätigung nach einem Premium-Upgrade: bestätigt mehrere OFFENE
// Einträge in einem Schritt. Gleiche Absicherung wie die Einzelbestätigung
// (requireAdmin + strictTimeTracking + Team-Scope); zusätzlich werden nur
// Einträge mit Status "pending" angefasst — bereits bestätigte/abgelehnte
// bleiben unverändert. IDs außerhalb des erlaubten Team-Scopes werden still
// übersprungen (kein Leak, welcher fremde Eintrag existiert); der Client
// erfährt über confirmedCount, wie viele tatsächlich bestätigt wurden.
router.post("/time-tracking/confirm-batch", requireTeamleiterOrAdmin, requirePlanFeature("strictTimeTracking"), async (req, res): Promise<void> => {
  const body = ConfirmTimeEntriesBatchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  if (allowedTeams.length === 0) {
    res.json({ confirmedCount: 0 });
    return;
  }
  // Konto-Schalter: nur Teams, deren Eigentümer die Zeiterfassung aktiviert
  // hat, dürfen bestätigt werden. Ist sie nirgends aktiv → 403; Teams mit
  // deaktivierter Zeiterfassung werden (wie fremde IDs) still übersprungen.
  const enabledTeams = await getTimeTrackingEnabledTeamIds(allowedTeams);
  if (enabledTeams.length === 0) {
    respondTimeTrackingDisabled(res);
    return;
  }
  const updated = await db
    .update(timeTrackingTable)
    .set({
      status: "confirmed",
      confirmedBy: req.session.userId!,
      confirmedAt: new Date(),
    })
    .where(
      and(
        inArray(timeTrackingTable.id, body.data.ids),
        inArray(timeTrackingTable.teamId, enabledTeams),
        eq(timeTrackingTable.status, "pending"),
      ),
    )
    .returning({ id: timeTrackingTable.id });
  res.json({ confirmedCount: updated.length });
});

// Effektiver Zeiterfassungs-Zustand für den ANGEMELDETEN Nutzer: Admin-artige
// Rollen sehen die eigene Konto-Einstellung, Assistenzkräfte den Zustand ihres
// Arbeitgebers (aktiv, sobald EIN Team-Eigentümer eingeschaltet hat). Bewusst
// requireAuth — Assistenten haben keinen Zugriff auf /allowance-settings.
router.get("/time-tracking-status", requireAuth, async (req, res): Promise<void> => {
  const [enabled, pauseRule] = await Promise.all([
    isTimeTrackingEnabledForUser(req.session.userId!),
    // Effektive Pausenregelung für die Vorbefüllung des Pausenfelds im
    // Zeiterfassungs-Dialog (Assistenten haben keinen Zugriff auf
    // /allowance-settings, daher hier mitgeliefert).
    getPauseRuleForUser(req.session.userId!),
  ]);
  res.json({ enabled, pauseRule });
});

export default router;
