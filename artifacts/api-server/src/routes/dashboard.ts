import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, shiftsTable, timeTrackingTable, contractsTable, allowanceSettingsTable, teamMembersTable, teamsTable, shiftModelsTable } from "@workspace/db";
import { computeShiftMetrics, type GermanState } from "@workspace/db";
import { eq, and, sql, count, or, isNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, requireAdmin, isAdminLikeRole } from "../middleware/auth";
import { requirePlanFeature, getLenientTimeTrackingTeamIds } from "../lib/plan";
import { resolveAllowanceOps, type ResolvedAllowanceOps } from "../lib/allowance-resolve";
import { resolveReadTeamScope, parseTeamIdParam, getAllowedTeamIds } from "../lib/teams";
import {
  LOW_VACATION_THRESHOLD,
  HORIZON_DAYS,
  computeUncoveredDays,
  computeLowVacationAssistants,
  type VacationCandidate,
} from "../lib/dashboard-warnings";
import {
  computeHoursBalanceRow,
  DEFAULT_NIGHT_PERCENT,
  DEFAULT_SUNDAY_PERCENT,
  DEFAULT_HOLIDAY_PERCENT,
} from "../lib/dashboard-hours-balance";

const router = Router();

async function activeContractFor(userId: number, date: Date) {
  const dateStr = date.toISOString().split("T")[0];
  const contracts = await db
    .select()
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.userId, userId),
        sql`${contractsTable.startDate} <= ${dateStr}`,
        or(
          isNull(contractsTable.endDate),
          sql`${contractsTable.endDate} >= ${dateStr}`
        )
      )
    )
    .orderBy(sql`${contractsTable.startDate} DESC`)
    .limit(1);
  return contracts[0] ?? null;
}

const SAFE_SHIFT_USER = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  phone: usersTable.phone,
  address: usersTable.address,
  isActive: usersTable.isActive,
  createdAt: usersTable.createdAt,
};

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  // Superadmin (Betreiber) nutzt das Dashboard wie ein Admin — nur mit den
  // eigenen Teams (Team-Scoping-Helfer arbeiten rein über die userId).
  const isAdmin = isAdminLikeRole(req.session.role);
  const userId = req.session.userId!;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  if (isAdmin) {
    const teamScope = await resolveReadTeamScope(userId, parseTeamIdParam(req));
    if (teamScope === null) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    // Liste der Assistenten-IDs innerhalb des Team-Scopes (für Zähler & Warnungen).
    const teamMemberIds = teamScope.length
      ? (
          await db
            .selectDistinct({ userId: teamMembersTable.userId })
            .from(teamMembersTable)
            .where(inArray(teamMembersTable.teamId, teamScope))
        ).map((r) => r.userId)
      : [];

    const [{ totalAssistants }] = await db
      .select({ totalAssistants: count() })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "assistant"),
          teamMemberIds.length ? inArray(usersTable.id, teamMemberIds) : sql`false`,
        )
      );

    const [{ activeShiftsToday }] = await db
      .select({ activeShiftsToday: count() })
      .from(shiftsTable)
      .where(
        and(
          inArray(shiftsTable.teamId, teamScope),
          // Nur verbindlich bestätigte (FIX) Schichten zählen; Entwürfe
          // (VORLAEUFIG) und Angebote (ANGEBOTEN) verfälschen den KPI nicht.
          eq(shiftsTable.planningStatus, "FIX"),
          sql`${shiftsTable.startTime} >= ${todayStart}`,
          sql`${shiftsTable.startTime} < ${todayEnd}`,
        )
      );

    const [{ pendingTimeEntries }] = await db
      .select({ pendingTimeEntries: count() })
      .from(timeTrackingTable)
      .where(and(inArray(timeTrackingTable.teamId, teamScope), eq(timeTrackingTable.status, "pending")));

    const monthShifts = await db
      .select({ startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
      .from(shiftsTable)
      .where(
        and(
          inArray(shiftsTable.teamId, teamScope),
          // Geplante Soll-Stunden zählen nur verbindlich bestätigte (FIX)
          // Schichten; Entwürfe/Vorschläge verfälschen die Zahl nicht.
          eq(shiftsTable.planningStatus, "FIX"),
          sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
          sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
        )
      );
    const monthlyPlannedHours = monthShifts.reduce(
      (acc, s) => acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000,
      0
    );

    // Ist-Stunden: bestätigte Einträge zählen immer. In Teams von
    // Free-Eigentümern (kein strictTimeTracking → kein Freigabe-Workflow)
    // zählen auch "offene" Einträge — sonst blieben erfasste Stunden für
    // Free-Konten dauerhaft unsichtbar. Abgelehnte zählen nie.
    const lenientTeamIds = await getLenientTimeTrackingTeamIds(teamScope);
    const statusCondition = lenientTeamIds.length
      ? or(
          eq(timeTrackingTable.status, "confirmed"),
          and(
            eq(timeTrackingTable.status, "pending"),
            inArray(timeTrackingTable.teamId, lenientTeamIds),
          ),
        )
      : eq(timeTrackingTable.status, "confirmed");
    const monthTimeEntries = await db
      .select({ actualHours: timeTrackingTable.actualHours })
      .from(timeTrackingTable)
      .where(
        and(
          inArray(timeTrackingTable.teamId, teamScope),
          sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
          sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
          statusCondition,
        )
      );
    const monthlyActualHours = monthTimeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);

    // Offene Einträge in STRIKTEN Teams (Premium-Eigentümer) fließen nicht in
    // monthlyActualHours ein. Nach einem Upgrade Free→Premium würden zuvor
    // gezählte "offene" Stunden sonst kommentarlos verschwinden — deshalb wird
    // die nicht gezählte Summe explizit ausgewiesen, damit das Frontend einen
    // Hinweis mit geführtem Weg zum Nachbestätigen zeigen kann.
    const strictTeamIds = teamScope.filter((id) => !lenientTeamIds.includes(id));
    let uncountedPendingHours = 0;
    let uncountedPendingEntries = 0;
    if (strictTeamIds.length) {
      const uncounted = await db
        .select({ actualHours: timeTrackingTable.actualHours })
        .from(timeTrackingTable)
        .where(
          and(
            inArray(timeTrackingTable.teamId, strictTeamIds),
            eq(timeTrackingTable.status, "pending"),
            sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
            sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
          )
        );
      uncountedPendingEntries = uncounted.length;
      uncountedPendingHours = uncounted.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);
    }

    const upcomingShifts = await db
      .select({
        id: shiftsTable.id,
        userId: shiftsTable.userId,
        startTime: shiftsTable.startTime,
        endTime: shiftsTable.endTime,
        type: shiftsTable.type,
        notes: shiftsTable.notes,
        createdAt: shiftsTable.createdAt,
        user: SAFE_SHIFT_USER,
      })
      .from(shiftsTable)
      .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
      .where(and(inArray(shiftsTable.teamId, teamScope), sql`${shiftsTable.startTime} >= ${today}`))
      .limit(5);

    const recentTimeEntries = await db
      .select({
        id: timeTrackingTable.id,
        userId: timeTrackingTable.userId,
        shiftId: timeTrackingTable.shiftId,
        actualStart: timeTrackingTable.actualStart,
        actualEnd: timeTrackingTable.actualEnd,
        actualHours: timeTrackingTable.actualHours,
        status: timeTrackingTable.status,
        notes: timeTrackingTable.notes,
        confirmedBy: timeTrackingTable.confirmedBy,
        confirmedAt: timeTrackingTable.confirmedAt,
        createdAt: timeTrackingTable.createdAt,
        user: SAFE_SHIFT_USER,
      })
      .from(timeTrackingTable)
      .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
      .where(inArray(timeTrackingTable.teamId, teamScope))
      .limit(5);

    // --- Warnhinweise (nur Admin) ---
    const assistants = teamMemberIds.length
      ? await db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.role, "assistant"),
              eq(usersTable.isActive, true),
              inArray(usersTable.id, teamMemberIds),
            )
          )
      : [];

    const vacationCandidates: VacationCandidate[] = [];
    // Umrechnungsfaktor (vacationHoursPerDay) je Vertrags-Team einmalig
    // auflösen — die Resttage werden aus der stundengenauen Buchhaltung
    // abgeleitet (vacation_days_used existiert nicht mehr).
    const opsByTeam = new Map<number, ResolvedAllowanceOps>();
    for (const assistant of assistants) {
      const contract = await activeContractFor(assistant.id, todayStart);
      if (!contract) continue;
      let ops = opsByTeam.get(contract.teamId);
      if (!ops) {
        ops = await resolveAllowanceOps(contract.teamId);
        opsByTeam.set(contract.teamId, ops);
      }
      vacationCandidates.push({
        userId: assistant.id,
        userName: assistant.name,
        vacationDays: contract.vacationDays,
        vacationHoursUsed: contract.vacationHoursUsed,
        hoursPerDay: ops.vacationHoursPerDay,
      });
    }
    const lowVacationAssistants = computeLowVacationAssistants(vacationCandidates);

    const horizonEnd = new Date(todayStart);
    horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);
    // Eine Schicht deckt jeden Tag ab, den sie überlappt (auch über Mitternacht
    // laufende Nachtdienste), nicht nur ihren Starttag.
    const horizonShifts = await db
      .select({ startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
      .from(shiftsTable)
      .where(
        and(
          inArray(shiftsTable.teamId, teamScope),
          sql`${shiftsTable.startTime} < ${horizonEnd}`,
          sql`${shiftsTable.endTime} > ${todayStart}`,
        )
      );
    const uncoveredDays = computeUncoveredDays(horizonShifts, todayStart, HORIZON_DAYS);

    res.json({
      totalAssistants: Number(totalAssistants),
      activeShiftsToday: Number(activeShiftsToday),
      pendingTimeEntries: Number(pendingTimeEntries),
      monthlyPlannedHours: Math.round(monthlyPlannedHours * 100) / 100,
      monthlyActualHours: Math.round(monthlyActualHours * 100) / 100,
      hoursBalance: Math.round((monthlyActualHours - monthlyPlannedHours) * 100) / 100,
      uncountedPendingHours: Math.round(uncountedPendingHours * 100) / 100,
      uncountedPendingEntries,
      upcomingShifts,
      recentTimeEntries,
      warnings: {
        pendingTimeEntries: Number(pendingTimeEntries),
        // "Offen" ist nur dann ein To-do, wenn im Scope mindestens ein Team
        // mit Freigabe-Workflow (strictTimeTracking, Premium-Eigentümer)
        // existiert. Sind ALLE Teams lenient (Free), ist "offen" der
        // Normalzustand — das Frontend blendet die Warnung dann aus.
        timeTrackingConfirmable:
          teamScope.length === 0 || lenientTeamIds.length < teamScope.length,
        lowVacationAssistants,
        uncoveredDays,
        lowVacationThreshold: LOW_VACATION_THRESHOLD,
        horizonDays: HORIZON_DAYS,
      },
    });
    return;
  }

  const [{ activeShiftsToday }] = await db
    .select({ activeShiftsToday: count() })
    .from(shiftsTable)
    .where(
      and(
        eq(shiftsTable.userId, userId),
        // Nur verbindlich bestätigte (FIX) Schichten zählen (siehe Admin-Branch).
        eq(shiftsTable.planningStatus, "FIX"),
        sql`${shiftsTable.startTime} >= ${todayStart}`,
        sql`${shiftsTable.startTime} < ${todayEnd}`,
      )
    );

  const [{ pendingTimeEntries }] = await db
    .select({ pendingTimeEntries: count() })
    .from(timeTrackingTable)
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        eq(timeTrackingTable.status, "pending")
      )
    );

  const monthShifts = await db
    .select({ startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
    .from(shiftsTable)
    .where(
      and(
        eq(shiftsTable.userId, userId),
        // Geplante Soll-Stunden zählen nur verbindlich bestätigte (FIX)
        // Schichten; Entwürfe/Vorschläge verfälschen die Zahl nicht.
        eq(shiftsTable.planningStatus, "FIX"),
        sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
      )
    );
  const monthlyPlannedHours = monthShifts.reduce(
    (acc, s) => acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000,
    0
  );

  // Ist-Stunden des Assistenten: bestätigte Einträge zählen immer. In Teams
  // von Free-Eigentümern (kein Freigabe-Workflow) zählen auch "offene"
  // Einträge, damit erfasste Stunden nicht dauerhaft bei 0 stehen. Maßgeblich
  // ist der Plan des jeweiligen Team-Eigentümers, nicht des Assistenten.
  const assistantTeamIds = await getAllowedTeamIds(userId);
  const lenientTeamIds = await getLenientTimeTrackingTeamIds(assistantTeamIds);
  const statusCondition = lenientTeamIds.length
    ? or(
        eq(timeTrackingTable.status, "confirmed"),
        and(
          eq(timeTrackingTable.status, "pending"),
          inArray(timeTrackingTable.teamId, lenientTeamIds),
        ),
      )
    : eq(timeTrackingTable.status, "confirmed");
  const monthTimeEntries = await db
    .select({ actualHours: timeTrackingTable.actualHours })
    .from(timeTrackingTable)
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
        statusCondition,
      )
    );
  const monthlyActualHours = monthTimeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);

  // Analog zum Admin-Branch: offene Einträge des Assistenten in strikten
  // (Premium-)Teams zählen nicht — die Summe wird ausgewiesen, damit der
  // Stundenstand nach einem Upgrade nicht kommentarlos schrumpft.
  const strictTeamIds = assistantTeamIds.filter((id) => !lenientTeamIds.includes(id));
  let uncountedPendingHours = 0;
  let uncountedPendingEntries = 0;
  if (strictTeamIds.length) {
    const uncounted = await db
      .select({ actualHours: timeTrackingTable.actualHours })
      .from(timeTrackingTable)
      .where(
        and(
          eq(timeTrackingTable.userId, userId),
          inArray(timeTrackingTable.teamId, strictTeamIds),
          eq(timeTrackingTable.status, "pending"),
          sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
          sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
        )
      );
    uncountedPendingEntries = uncounted.length;
    uncountedPendingHours = uncounted.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);
  }

  const upcomingShifts = await db
    .select({
      id: shiftsTable.id,
      userId: shiftsTable.userId,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      type: shiftsTable.type,
      notes: shiftsTable.notes,
      createdAt: shiftsTable.createdAt,
      user: SAFE_SHIFT_USER,
    })
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(and(eq(shiftsTable.userId, userId), sql`${shiftsTable.startTime} >= ${today}`))
    .limit(5);

  const recentTimeEntries = await db
    .select({
      id: timeTrackingTable.id,
      userId: timeTrackingTable.userId,
      shiftId: timeTrackingTable.shiftId,
      actualStart: timeTrackingTable.actualStart,
      actualEnd: timeTrackingTable.actualEnd,
      actualHours: timeTrackingTable.actualHours,
      status: timeTrackingTable.status,
      notes: timeTrackingTable.notes,
      confirmedBy: timeTrackingTable.confirmedBy,
      confirmedAt: timeTrackingTable.confirmedAt,
      createdAt: timeTrackingTable.createdAt,
      user: SAFE_SHIFT_USER,
    })
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.userId, userId))
    .limit(5);

  res.json({
    totalAssistants: null,
    activeShiftsToday: Number(activeShiftsToday),
    pendingTimeEntries: Number(pendingTimeEntries),
    monthlyPlannedHours: Math.round(monthlyPlannedHours * 100) / 100,
    monthlyActualHours: Math.round(monthlyActualHours * 100) / 100,
    hoursBalance: Math.round((monthlyActualHours - monthlyPlannedHours) * 100) / 100,
    uncountedPendingHours: Math.round(uncountedPendingHours * 100) / 100,
    uncountedPendingEntries,
    upcomingShifts,
    recentTimeEntries,
  });
});

// Soll/Ist-Berechnung inkl. Zuschlags-Aufschlüsselung (Nacht/Sonntag/Feiertag).
// Das ist das Premium-Feature "advancedAnalytics" — und zugleich die Datenquelle
// für den (clientseitig erzeugten) Lohn-/Stundennachweis-PDF-Export
// ("payrollExport"). Free-Konten erhalten 403 plan_feature_required. Bestandsschutz
// bleibt gewahrt: die ROHDATEN (Schichten, Zeiterfassung, Verträge) bleiben über
// ihre regulären Listen-Endpunkte sichtbar — gesperrt wird nur diese abgeleitete
// Premium-Auswertung.
router.get("/dashboard/hours-balance", requireAdmin, requirePlanFeature("advancedAnalytics"), async (req, res): Promise<void> => {
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const requestedTeamId = parseTeamIdParam(req);
  const teamScope = await resolveReadTeamScope(req.session.userId!, requestedTeamId);
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  // Aushilfen-Regel: Die Stunden einer Kraft zählen IMMER zu ihrem STAMMTEAM,
  // nicht zum Team der Schicht. Stammteam = früheste Mitgliedschaft (kleinste
  // team_members.id) innerhalb der erlaubten Teams des Anfragers —
  // deterministisch, damit jede Stunde genau EINEM Team zugerechnet wird.
  // Beim Team-Filter erscheinen daher nur Kräfte mit Stammteam im Scope,
  // deren Schichten/Ist-Zeiten aber aus ALLEN eigenen Teams gezogen werden
  // (Aushilfe-Dienst in Team A zählt zur Auswertung von Stammteam B).
  const allTeamIds = await getAllowedTeamIds(req.session.userId!);
  const memberships = allTeamIds.length
    ? await db
        .select({
          id: teamMembersTable.id,
          userId: teamMembersTable.userId,
          teamId: teamMembersTable.teamId,
        })
        .from(teamMembersTable)
        .where(inArray(teamMembersTable.teamId, allTeamIds))
        .orderBy(teamMembersTable.id)
    : [];
  const homeTeamByUser = new Map<number, number>();
  for (const m of memberships) {
    if (!homeTeamByUser.has(m.userId)) homeTeamByUser.set(m.userId, m.teamId);
  }
  const teamMemberIds = [...homeTeamByUser.entries()]
    .filter(([, homeTeamId]) => teamScope.includes(homeTeamId))
    .map(([memberId]) => memberId);

  const assistants = teamMemberIds.length
    ? await db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "assistant"),
            eq(usersTable.isActive, true),
            inArray(usersTable.id, teamMemberIds),
          )
        )
    : [];

  const referenceDate = new Date(year, month - 1, 1);

  // Aktuelle Zuschlags-Prozentsätze: werden erst hier (nicht beim Speichern der
  // Schicht) angewandt, damit Änderungen rückwirkend greifen. Fallback-Kette
  // je Team im Scope: TEAM-OVERRIDE (team_id gesetzt) → Konto-Zeile des
  // Team-EIGENTÜMERS (team_id NULL) → Defaults. Nie die Prozente eines
  // fremden Kontos.
  // Über ALLE eigenen Teams aufbauen (nicht nur den Filter-Scope): auch ein
  // Aushilfe-Dienst in einem anderen eigenen Team braucht die dort geltenden
  // Zuschlags-Sätze/Nachtfenster.
  const overrideSettings = alias(allowanceSettingsTable, "override_settings");
  const teamAllowanceRows = allTeamIds.length
    ? await db
        .select({
          teamId: teamsTable.id,
          overrideNightPercent: overrideSettings.nightPercent,
          overrideSundayPercent: overrideSettings.sundayPercent,
          overrideHolidayPercent: overrideSettings.holidayPercent,
          overrideNightStart: overrideSettings.nightStart,
          overrideNightEnd: overrideSettings.nightEnd,
          overrideState: overrideSettings.state,
          overrideBillingMethod: overrideSettings.billingMethod,
          nightPercent: allowanceSettingsTable.nightPercent,
          sundayPercent: allowanceSettingsTable.sundayPercent,
          holidayPercent: allowanceSettingsTable.holidayPercent,
          nightStart: allowanceSettingsTable.nightStart,
          nightEnd: allowanceSettingsTable.nightEnd,
          state: allowanceSettingsTable.state,
          billingMethod: allowanceSettingsTable.billingMethod,
        })
        .from(teamsTable)
        // LEFT JOINs: Hat ein Team weder Override noch der Eigentümer eine
        // Settings-Zeile (lazy angelegt), gelten die Defaults — NIEMALS die
        // Prozente des anfragenden Admins (sonst Fremdeinfluss über
        // Konto-Grenzen).
        .leftJoin(overrideSettings, eq(overrideSettings.teamId, teamsTable.id))
        .leftJoin(
          allowanceSettingsTable,
          and(
            eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
            isNull(allowanceSettingsTable.teamId)
          )
        )
        .where(inArray(teamsTable.id, allTeamIds))
    : [];
  const allowanceByTeam = new Map(
    teamAllowanceRows.map((r) => [
      r.teamId,
      {
        nightPercent: r.overrideNightPercent ?? r.nightPercent ?? DEFAULT_NIGHT_PERCENT,
        sundayPercent: r.overrideSundayPercent ?? r.sundayPercent ?? DEFAULT_SUNDAY_PERCENT,
        holidayPercent: r.overrideHolidayPercent ?? r.holidayPercent ?? DEFAULT_HOLIDAY_PERCENT,
      },
    ])
  );
  // Nachtfenster, Bundesland und Abrechnungsart je Team — nötig, um im IST-Modus
  // die Zuschlagsstunden aus den erfassten Ist-Zeiten neu zu berechnen. Fallback
  // je Feld: Team-Override → Konto des Team-Eigentümers → Default.
  const DEFAULT_NIGHT_START = "23:00";
  const DEFAULT_NIGHT_END = "06:00";
  const teamMetaByTeam = new Map(
    teamAllowanceRows.map((r) => [
      r.teamId,
      {
        nightStart: r.overrideNightStart ?? r.nightStart ?? DEFAULT_NIGHT_START,
        nightEnd: r.overrideNightEnd ?? r.nightEnd ?? DEFAULT_NIGHT_END,
        state: (r.overrideState ?? r.state ?? null) as GermanState | null,
        billingMethod: (r.overrideBillingMethod ?? r.billingMethod ?? null) as
          | "SOLL"
          | "IST"
          | null,
      },
    ])
  );
  // Fallback/Anzeige-Prozente der Zeile: eigene Einstellungen des anfragenden
  // Admins (identisch mit dem Team-Eigentümer im Normalfall, dass ein Admin
  // seine eigenen Teams auswertet); ohne eigene Zeile die Defaults.
  const [ownAllowance] = await db
    .select()
    .from(allowanceSettingsTable)
    .where(
      and(
        eq(allowanceSettingsTable.ownerId, req.session.userId!),
        isNull(allowanceSettingsTable.teamId)
      )
    );
  // Ist ein KONKRETES Team angefragt, zeigen die Zeilen-Prozente die für dieses
  // Team tatsächlich angewandte Kette (Override → Eigentümer → Default) — sonst
  // stünde im PDF/der Tabelle z. B. "Sonntag (50%)", obwohl mit dem
  // Team-Override von 77% gerechnet wurde.
  const allowancePercents = (requestedTeamId != null
    ? allowanceByTeam.get(requestedTeamId)
    : undefined) ?? {
    nightPercent: ownAllowance?.nightPercent ?? DEFAULT_NIGHT_PERCENT,
    sundayPercent: ownAllowance?.sundayPercent ?? DEFAULT_SUNDAY_PERCENT,
    holidayPercent: ownAllowance?.holidayPercent ?? DEFAULT_HOLIDAY_PERCENT,
  };

  // Umrechnungsfaktor Stunden je Urlaubstag (vacationHoursPerDay) je
  // Vertrags-Team — die Urlaubstage-Spalten der Auswertung sind aus der
  // stundengenauen Buchhaltung abgeleitet (vacation_days_used existiert
  // nicht mehr). Cache je Team, um N+1-Lookups zu vermeiden.
  const vacationOpsByTeam = new Map<number, ResolvedAllowanceOps>();
  const vacationOpsForTeam = async (teamId: number): Promise<ResolvedAllowanceOps> => {
    let ops = vacationOpsByTeam.get(teamId);
    if (!ops) {
      ops = await resolveAllowanceOps(teamId);
      vacationOpsByTeam.set(teamId, ops);
    }
    return ops;
  };

  const result = await Promise.all(
    assistants.map(async (assistant) => {
      const shifts = await db
        .select()
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.userId, assistant.id),
            // ALLE eigenen Teams: Aushilfe-Dienste in fremden eigenen Teams
            // zählen zum Stammteam der Kraft (genau einmal, s. o.).
            inArray(shiftsTable.teamId, allTeamIds),
            // Nur verbindlich bestätigte Schichten fließen in den offiziellen
            // Soll/Ist-Nachweis ein; Entwürfe/Vorschläge bleiben unverbindlich.
            eq(shiftsTable.planningStatus, "FIX"),
            sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
            sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
          )
        );

      const timeEntriesWithShift = await db
        .select({
          actualHours: timeTrackingTable.actualHours,
          actualStart: timeTrackingTable.actualStart,
          actualEnd: timeTrackingTable.actualEnd,
          teamId: timeTrackingTable.teamId,
          shiftType: shiftsTable.type,
          compensationType: shiftModelsTable.compensationType,
          compensationPercent: shiftModelsTable.compensationPercent,
          compensationFlatCents: shiftModelsTable.compensationFlatCents,
        })
        .from(timeTrackingTable)
        .leftJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
        .leftJoin(shiftModelsTable, eq(shiftsTable.shiftModelId, shiftModelsTable.id))
        .where(
          and(
            eq(timeTrackingTable.userId, assistant.id),
            inArray(timeTrackingTable.teamId, allTeamIds),
            sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
            sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
            eq(timeTrackingTable.status, "confirmed"),
          )
        );

      const contract = await activeContractFor(assistant.id, referenceDate);

      // Abrechnungsart-Kette: Assistent (Vertrag) → Team-Override/Konto des
      // Team-Eigentümers → SOLL (Bestandsschutz-Default). teamMetaByTeam faltet
      // Override und Team-Eigentümer-Konto bereits zusammen.
      // Für die Team-Ebene brauchen wir ein Team IM aktuellen Scope: bevorzugt
      // das Vertrags-Team (nur wenn es im Scope liegt — activeContractFor ist
      // nicht team-gescoped und könnte bei Multi-Team-Assistenten ein fremdes
      // Team liefern), sonst das explizit angefragte Team, sonst — wenn der
      // Scope eindeutig ein einziges Team umfasst — dieses. Ohne eindeutiges
      // Team greift der SOLL-Default (auch wenn gar kein Vertrag existiert).
      const contractTeamId =
        contract?.teamId != null && teamMetaByTeam.has(contract.teamId)
          ? contract.teamId
          : undefined;
      const fallbackTeamId =
        contractTeamId ?? requestedTeamId ?? (teamScope.length === 1 ? teamScope[0] : undefined);
      const teamBilling =
        fallbackTeamId != null ? teamMetaByTeam.get(fallbackTeamId)?.billingMethod : null;
      const billingMethod: "SOLL" | "IST" =
        contract?.billingMethod ?? teamBilling ?? "SOLL";

      // Im IST-Modus werden gewertete Stunden UND Zuschläge aus den tatsächlich
      // erfassten Zeiten je Eintrag berechnet (Nachtfenster/Bundesland des
      // jeweiligen Team-Kontos). Im SOLL-Modus bleiben die Roh-Kennzahlen der
      // Schicht maßgeblich — die Ist-Metriken werden dann nicht angesetzt.
      // Ist-Metriken je Eintrag werden IMMER berechnet: die Stunden-Spalten
      // nutzen sie nur im IST-Modus, aber die Premium-Geldrechnung (Point 6) ist
      // stets IST-basiert und braucht valuedHours/Zuschlagsstunden unabhängig von
      // der Abrechnungsart. Ohne erfasste Ist-Zeiten bleibt es bei actualHours.
      const timeEntries = timeEntriesWithShift.map((e) => {
        const comp = {
          compensationType: e.compensationType,
          compensationPercent: e.compensationPercent,
          compensationFlatCents: e.compensationFlatCents,
        };
        if (!e.actualStart || !e.actualEnd) {
          return { actualHours: e.actualHours, shiftType: e.shiftType, teamId: e.teamId, ...comp };
        }
        const meta = e.teamId != null ? teamMetaByTeam.get(e.teamId) : undefined;
        const metrics = computeShiftMetrics(
          {
            startTime: new Date(e.actualStart),
            endTime: new Date(e.actualEnd),
            isAbsence: false,
            valuationPercent: 100,
          },
          {
            nightStart: meta?.nightStart ?? DEFAULT_NIGHT_START,
            nightEnd: meta?.nightEnd ?? DEFAULT_NIGHT_END,
          },
          meta?.state ?? null,
        );
        return {
          actualHours: e.actualHours,
          shiftType: e.shiftType,
          teamId: e.teamId,
          valuedHours: metrics.valuedHours,
          nightHours: metrics.nightHours,
          sundayHours: metrics.sundayHours,
          holidayHours: metrics.holidayHours,
          ...comp,
        };
      });

      const vacationOps = contract ? await vacationOpsForTeam(contract.teamId) : null;

      return computeHoursBalanceRow({
        userId: assistant.id,
        userName: assistant.name,
        shifts,
        timeEntries,
        allowance: allowancePercents,
        allowanceByTeam,
        contract,
        billingMethod,
        hourlyWage: assistant.hourlyWage,
        vacationHoursPerDay: vacationOps?.vacationHoursPerDay,
      });
    })
  );

  res.json(result);
});

export default router;
