import { Router } from "express";
import { db } from "@workspace/db";
import { allowanceSettingsTable, teamsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { UpdateAllowanceSettingsBody } from "@workspace/api-zod";
import { requireAdmin } from "../middleware/auth";
import { parseTeamIdParam } from "../lib/teams";
import { userHasFeature } from "../lib/plan";
import type { Request, Response } from "express";

const router = Router();

const DEFAULTS = {
  nightPercent: 25,
  nightStart: "23:00",
  nightEnd: "06:00",
  sundayPercent: 50,
  holidayPercent: 100,
};

// Zuschlags-Einstellungen sind PRO KONTO gespeichert (owner_id = Admin-Konto,
// team_id NULL). Jeder Admin liest/ändert ausschließlich die eigene Zeile —
// die Einstellungen anderer Konten sind unerreichbar (Multi-Tenant-Trennung).
// Zeile wird beim ersten Zugriff lazy mit Defaults angelegt.
// Zusätzlich kann PRO TEAM ein Override existieren (team_id gesetzt);
// Fallback-Kette beim Lesen: Team-Override → Konto-Zeile → Defaults.
async function ensureAccountSettings(ownerId: number) {
  await db
    .insert(allowanceSettingsTable)
    .values({ ownerId, ...DEFAULTS })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(allowanceSettingsTable)
    .where(
      and(eq(allowanceSettingsTable.ownerId, ownerId), isNull(allowanceSettingsTable.teamId))
    );
  return row;
}

// Team-Overrides darf nur der EIGENTÜMER des Teams verwalten — Mitgliedschaft
// reicht nicht, sonst könnte ein fremder Admin die Lohn-Parameter eines
// anderen Kontos ändern. Gibt das Team zurück oder antwortet selbst mit 403.
async function assertOwnTeam(req: Request, res: Response, teamId: number) {
  const [team] = await db
    .select({ id: teamsTable.id, ownerId: teamsTable.ownerId })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  if (!team || team.ownerId !== req.session.userId) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return null;
  }
  return team;
}

router.get("/allowance-settings", requireAdmin, async (req, res): Promise<void> => {
  const teamId = parseTeamIdParam(req);
  const userId = req.session.userId!;
  if (teamId !== undefined) {
    const team = await assertOwnTeam(req, res, teamId);
    if (!team) return;
    const [override] = await db
      .select()
      .from(allowanceSettingsTable)
      .where(eq(allowanceSettingsTable.teamId, teamId));
    if (override) {
      // timeTrackingEnabled + teamMeeting* sind KONTO-GLOBAL — die Override-
      // Zeile trägt die Felder nur mit DB-Default. Immer die Konto-Werte
      // ausliefern.
      const account = await ensureAccountSettings(userId);
      res.json({
        ...override,
        timeTrackingEnabled: account.timeTrackingEnabled,
        vacationForecastEnabled: account.vacationForecastEnabled,
        teamMeetingEnabled: account.teamMeetingEnabled,
        teamMeetingHours: account.teamMeetingHours,
        pauseAutoEnabled: account.pauseAutoEnabled,
        pauseThreshold1Hours: account.pauseThreshold1Hours,
        pauseMinutes1: account.pauseMinutes1,
        pauseThreshold2Hours: account.pauseThreshold2Hours,
        pauseMinutes2: account.pauseMinutes2,
        deductPausesEnabled: account.deductPausesEnabled,
        isOverride: true,
      });
      return;
    }
    const account = await ensureAccountSettings(userId);
    res.json({ ...account, teamId: null, isOverride: false });
    return;
  }
  const settings = await ensureAccountSettings(userId);
  res.json({ ...settings, isOverride: false });
});

router.put("/allowance-settings", requireAdmin, async (req, res): Promise<void> => {
  const body = UpdateAllowanceSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const ownerId = req.session.userId!;
  const teamId = parseTeamIdParam(req);
  if (teamId !== undefined) {
    const team = await assertOwnTeam(req, res, teamId);
    if (!team) return;
    // Nur Zuschläge/Bundesland/Abrechnungsart sind Team-Overrides. Konto-weite
    // Regeln (Auto-Genehmigung, Urlaubsberechnung, Ersatzruhetag-Konto) gelten
    // global und werden hier bewusst NICHT übernommen — sonst könnte ein Client
    // sie pro Team abweichend setzen.
    const teamOverridable = {
      nightPercent: body.data.nightPercent,
      nightStart: body.data.nightStart,
      nightEnd: body.data.nightEnd,
      sundayPercent: body.data.sundayPercent,
      holidayPercent: body.data.holidayPercent,
      state: body.data.state,
      billingMethod: body.data.billingMethod,
      vertretungCompensationMode: body.data.vertretungCompensationMode,
      vertretungCompensationValue: body.data.vertretungCompensationValue,
    };
    // Upsert des Team-Overrides (UNIQUE team_id).
    const [saved] = await db
      .insert(allowanceSettingsTable)
      .values({ ownerId, teamId, ...teamOverridable })
      .onConflictDoUpdate({
        target: allowanceSettingsTable.teamId,
        set: { ...teamOverridable, updatedAt: new Date() },
      })
      .returning();
    // Konto-globale Felder auch in der Team-Antwort ausliefern.
    const account = await ensureAccountSettings(ownerId);
    res.json({
      ...saved,
      timeTrackingEnabled: account.timeTrackingEnabled,
      vacationForecastEnabled: account.vacationForecastEnabled,
      teamMeetingEnabled: account.teamMeetingEnabled,
      teamMeetingHours: account.teamMeetingHours,
      pauseAutoEnabled: account.pauseAutoEnabled,
      pauseThreshold1Hours: account.pauseThreshold1Hours,
      pauseMinutes1: account.pauseMinutes1,
      pauseThreshold2Hours: account.pauseThreshold2Hours,
      pauseMinutes2: account.pauseMinutes2,
      deductPausesEnabled: account.deductPausesEnabled,
      isOverride: true,
    });
    return;
  }
  const current = await ensureAccountSettings(ownerId);

  // Plan-Gate (Premium-Feature "timeTrackingSettings"): Die drei Schalter
  // Zeiterfassung aktivieren / Pausen vorbefüllen / Pausen abziehen duerfen im
  // Free-Tarif nicht geaendert werden. Bestandsschutz: Der Client sendet immer
  // das volle Formular — abgelehnt wird nur, wenn sich ein Wert TATSAECHLICH
  // aendert; bereits aktive Werte bleiben wirksam und Speichern anderer
  // Einstellungen (z. B. Bundesland) funktioniert weiterhin.
  if (!(await userHasFeature(ownerId, "timeTrackingSettings"))) {
    const gatedChange =
      (body.data.timeTrackingEnabled !== undefined &&
        body.data.timeTrackingEnabled !== current.timeTrackingEnabled) ||
      (body.data.pauseAutoEnabled !== undefined &&
        body.data.pauseAutoEnabled !== current.pauseAutoEnabled) ||
      (body.data.deductPausesEnabled !== undefined &&
        body.data.deductPausesEnabled !== current.deductPausesEnabled);
    if (gatedChange) {
      res.status(403).json({
        error: "Diese Funktion ist im Premium-Tarif enthalten.",
        code: "plan_feature_required",
        feature: "timeTrackingSettings",
      });
      return;
    }
  }

  const [updated] = await db
    .update(allowanceSettingsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(
      and(eq(allowanceSettingsTable.ownerId, ownerId), isNull(allowanceSettingsTable.teamId))
    )
    .returning();
  res.json({ ...updated, isOverride: false });
});

router.delete("/allowance-settings", requireAdmin, async (req, res): Promise<void> => {
  const teamId = parseTeamIdParam(req);
  if (teamId === undefined) {
    res.status(400).json({ error: "teamId ist erforderlich" });
    return;
  }
  const team = await assertOwnTeam(req, res, teamId);
  if (!team) return;
  await db.delete(allowanceSettingsTable).where(eq(allowanceSettingsTable.teamId, teamId));
  res.status(204).end();
});

export default router;
