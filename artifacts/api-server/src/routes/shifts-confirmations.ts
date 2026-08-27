import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable } from "@workspace/db";
import { eq, and, lt, gte, inArray } from "drizzle-orm";
import {
  SendShiftProposalsBody,
  BulkConfirmOwnShiftsBody,
  BulkConfirmShiftsBody,
} from "@workspace/api-zod";
import { sendProposalEmail } from "../lib/mailer";
import { getBaseUrl } from "../lib/base-url";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getAllowedTeamIds, getEffectiveAdminTeamIds } from "../lib/teams";

const router = Router();

// POST /shifts/send-proposals — setzt VORLAEUFIG→ANGEBOTEN und versendet
// pro Assistenzkraft eine E-Mail mit allen vorgeschlagenen Diensten des Monats.
// Falls userId angegeben ist, werden nur diese Person's Dienste versendet.
router.post("/shifts/send-proposals", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const body = SendShiftProposalsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { month, year, teamId, userId, userIds } = body.data;

  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);

  let teamScope: number[];
  if (teamId != null) {
    if (!allowedTeams.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    teamScope = [teamId];
  } else {
    teamScope = allowedTeams;
  }

  if (teamScope.length === 0) {
    res.json({ updated: 0, emailsSent: 0, emailsFailed: 0 });
    return;
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const conditions = [
    inArray(shiftsTable.teamId, teamScope),
    eq(shiftsTable.planningStatus, "VORLAEUFIG"),
    gte(shiftsTable.startTime, monthStart),
    lt(shiftsTable.startTime, monthEnd),
    // Keine Abwesenheiten — nur buchbare Arbeitsdienste senden
    // (Abwesenheiten sind serveitig immer FIX und landen nie als Entwurf)
  ] as ReturnType<typeof and>[];
  if (userIds != null && userIds.length > 0) {
    conditions.push(inArray(shiftsTable.userId, userIds));
  } else if (userId != null) {
    conditions.push(eq(shiftsTable.userId, userId));
  }

  const shifts = await db
    .select({
      id: shiftsTable.id,
      userId: shiftsTable.userId,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      type: shiftsTable.type,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(and(...conditions));

  if (shifts.length === 0) {
    res.json({ updated: 0, emailsSent: 0, emailsFailed: 0 });
    return;
  }

  // Alle gefundenen Dienste auf ANGEBOTEN setzen
  const shiftIds = shifts.map((s) => s.id);
  await db
    .update(shiftsTable)
    .set({ planningStatus: "ANGEBOTEN" })
    .where(inArray(shiftsTable.id, shiftIds));

  // Pro Assistenzkraft eine E-Mail versenden
  const byUser = new Map<number, { name: string; email: string; shifts: typeof shifts }>();
  for (const s of shifts) {
    if (!s.userEmail || !s.userName) continue;
    const existing = byUser.get(s.userId) ?? { name: s.userName, email: s.userEmail, shifts: [] };
    existing.shifts.push(s);
    byUser.set(s.userId, existing);
  }

  // Die Status-Änderung (VORLAEUFIG→ANGEBOTEN) ist bereits gespeichert — das
  // ist das für die Nutzer sichtbare Ergebnis. Der Mailversand ist reine
  // Benachrichtigung und muss die Antwort nicht blockieren: die Anfrage
  // antwortet sofort, die Mails gehen fire-and-forget danach raus (analog zur
  // Krankmeldungs-Benachrichtigung oben). Da vorab nicht mehr auf den
  // tatsächlichen Sendeerfolg gewartet wird, meldet die Antwort nur noch die
  // Anzahl der Empfänger, an die versendet wird — nicht mehr sent/failed.
  const loginUrl = `${getBaseUrl()}/dienstplan`;
  const recipients = [...byUser.values()];

  res.json({ updated: shifts.length, emailsSent: recipients.length, emailsFailed: 0 });

  void (async () => {
    const results = await Promise.allSettled(
      recipients.map(({ name, email, shifts: userShifts }) =>
        sendProposalEmail(
          email,
          name,
          userShifts.map((s) => ({
            startTime: new Date(s.startTime),
            endTime: new Date(s.endTime),
            type: s.type,
          })),
          loginUrl,
        ),
      ),
    );
    const failed = results.filter(
      (r) => r.status === "rejected" || r.value !== true,
    ).length;
    if (failed > 0) {
      console.warn(
        `Vorschlag-Versand: ${failed}/${recipients.length} E-Mail(s) fehlgeschlagen.`,
      );
    }
  })();
});

// POST /shifts/bulk-confirm-own — Assistenzkraft bestätigt alle ihre
// ANGEBOTEN-Dienste eines Monats auf einmal (→ FIX).
router.post("/shifts/bulk-confirm-own", requireAuth, async (req, res): Promise<void> => {
  const body = BulkConfirmOwnShiftsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { month, year, teamId } = body.data;
  const userId = req.session.userId!;

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const conditions = [
    eq(shiftsTable.userId, userId),
    eq(shiftsTable.planningStatus, "ANGEBOTEN"),
    gte(shiftsTable.startTime, monthStart),
    lt(shiftsTable.startTime, monthEnd),
  ] as ReturnType<typeof and>[];

  if (teamId != null) {
    const memberTeams = await getAllowedTeamIds(userId);
    if (!memberTeams.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    conditions.push(eq(shiftsTable.teamId, teamId));
  }

  const updated = await db
    .update(shiftsTable)
    .set({ planningStatus: "FIX" })
    .where(and(...conditions))
    .returning({ id: shiftsTable.id });

  res.json({ confirmed: updated.length });
});

// POST /shifts/bulk-confirm — Admin/Teamleiter bestätigt alle ANGEBOTEN-
// Dienste eines Monats im eigenen Scope auf einmal (→ FIX). Pendant zu
// bulk-confirm-own, aber über den Admin-/Teamleiter-Scope statt nur die
// eigenen Dienste.
router.post(
  "/shifts/bulk-confirm",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = BulkConfirmShiftsBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { month, year, teamId } = body.data;

    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    let teamScope: number[];
    if (teamId != null) {
      if (!allowedTeams.includes(teamId)) {
        res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
        return;
      }
      teamScope = [teamId];
    } else {
      teamScope = allowedTeams;
    }
    if (teamScope.length === 0) {
      res.json({ confirmed: 0 });
      return;
    }

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const updated = await db
      .update(shiftsTable)
      .set({ planningStatus: "FIX" })
      .where(
        and(
          inArray(shiftsTable.teamId, teamScope),
          eq(shiftsTable.planningStatus, "ANGEBOTEN"),
          gte(shiftsTable.startTime, monthStart),
          lt(shiftsTable.startTime, monthEnd)
        )
      )
      .returning({ id: shiftsTable.id });

    res.json({ confirmed: updated.length });
  }
);

export default router;
