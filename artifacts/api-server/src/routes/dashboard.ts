import { Router, type NextFunction, type RequestHandler } from "express";
import { db } from "@workspace/db";
import { usersTable, shiftsTable, timeTrackingTable, contractsTable, allowanceSettingsTable, teamMembersTable, teamsTable, shiftModelsTable } from "@workspace/db";
import { computeShiftMetrics, type GermanState } from "@workspace/db";
import { eq, and, sql, count, or, isNull, inArray, gte, lt, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, requireAdmin, requireTeamPlanningOrAdmin, isAdminLikeRole } from "../middleware/auth";
import { requirePlanFeatureViaTeamOwner, userHasFeatureViaTeamOwner, getLenientTimeTrackingTeamIds } from "../lib/plan";
import { resolveAllowanceOps, type ResolvedAllowanceOps } from "../lib/allowance-resolve";
import { resolveReadTeamScope, parseTeamIdParam, getAllowedTeamIds, getEffectiveAdminTeamIds, getTeamIdsWithCapability, canViewPayrollInTeam } from "../lib/teams";
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
import {
  computeHoursBalances,
  readHoursBalanceDatabaseVersion,
} from "../lib/hours-balance-service";
import {
  getTimeTrackingEnabledTeamIds,
  isTimeTrackingEnabledForOwner,
  isTimeTrackingEnabledForUser,
} from "../lib/time-tracking-enabled";
import { logger } from "../lib/logger";

const router = Router();

function instrumentHoursBalanceGuard(
  name: string,
  guard: RequestHandler,
  loadDatabaseVersion = false,
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const startedAt = performance.now();
    const guardResultPromise = new Promise<{
      continued: boolean;
      error?: unknown;
    }>((resolve, reject) => {
      let settled = false;
      const measuredNext: NextFunction = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        resolve({ continued: true, error });
      };
      Promise.resolve(guard(req, res, measuredNext))
        .then(() => {
          if (settled) return;
          settled = true;
          resolve({ continued: false });
        })
        .catch(reject);
    });
    const databaseVersionStartedAt = performance.now();
    const databaseVersionPromise = loadDatabaseVersion
      ? readHoursBalanceDatabaseVersion()
      : Promise.resolve(undefined);
    const teamScopePromise =
      loadDatabaseVersion &&
      req.session.userId != null &&
      isAdminLikeRole(req.session.role)
        ? resolveReadTeamScope(
            req.session.userId,
            parseTeamIdParam(req),
          )
        : Promise.resolve(undefined);

    const [guardResult, databaseVersion, teamScope] = await Promise.all([
      guardResultPromise,
      databaseVersionPromise,
      teamScopePromise,
    ]);
    if (databaseVersion != null) {
      res.locals["hoursBalanceDatabaseVersion"] = databaseVersion;
    }
    if (loadDatabaseVersion && isAdminLikeRole(req.session.role)) {
      res.locals["hoursBalanceTeamScopeResolved"] = true;
      res.locals["hoursBalanceTeamScope"] = teamScope;
    }

    logger.debug(
      {
        guard: name,
        outcome: guardResult.continued
          ? guardResult.error == null
            ? "passed"
            : "error"
          : "rejected",
        statusCode: res.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        ...(loadDatabaseVersion
          ? {
              databaseVersionMs:
                Math.round((performance.now() - databaseVersionStartedAt) * 10) / 10,
            }
          : {}),
      },
      "hours-balance authorization timing",
    );

    if (guardResult.continued) next(guardResult.error);
  };
}

const requireHoursBalancePlanning = instrumentHoursBalanceGuard(
  "team-planning",
  requireTeamPlanningOrAdmin,
  true,
);
const requireHoursBalanceFeature = instrumentHoursBalanceGuard(
  "advanced-analytics",
  requirePlanFeatureViaTeamOwner("advancedAnalytics"),
);

// Validierte month/year-Query-Parameter (Default: aktueller Monat/aktuelles
// Jahr). Ungültige Werte (NaN, z. B. "month=2026-07", oder außerhalb des
// Wertebereichs) liefern null — die Route antwortet dann 400 statt später mit
// einem unbehandelten RangeError ("Invalid time value") im Fehler-Tracking.
function parseMonthYearParams(req: {
  query: Record<string, unknown>;
}): { month: number; year: number } | null {
  const now = new Date();
  const rawMonth = req.query["month"];
  const rawYear = req.query["year"];
  const month = rawMonth != null && rawMonth !== "" ? Number(rawMonth) : now.getMonth() + 1;
  const year = rawYear != null && rawYear !== "" ? Number(rawYear) : now.getFullYear();
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return { month, year };
}

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

/**
 * Batch-Variante: lädt den jeweils aktiven Vertrag für mehrere Nutzer in
 * einer einzigen DB-Abfrage (statt N Abfragen in einer Schleife).
 * Gibt für jeden userId höchstens einen Eintrag zurück (neuester Vertrag,
 * der das Datum abdeckt).
 */
async function activeContractsForUsers(userIds: number[], date: Date) {
  if (!userIds.length) return [];
  const dateStr = date.toISOString().split("T")[0];
  const all = await db
    .select()
    .from(contractsTable)
    .where(
      and(
        inArray(contractsTable.userId, userIds),
        sql`${contractsTable.startDate} <= ${dateStr}`,
        or(isNull(contractsTable.endDate), sql`${contractsTable.endDate} >= ${dateStr}`)
      )
    )
    .orderBy(sql`${contractsTable.startDate} DESC`);
  // Ersten Treffer pro userId behalten (bereits absteigend nach startDate sortiert).
  const seen = new Set<number>();
  return all.filter((c) => {
    if (seen.has(c.userId)) return false;
    seen.add(c.userId);
    return true;
  });
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
  const monthYear = parseMonthYearParams(req);
  if (!monthYear) {
    res.status(400).json({ error: "Ungültiger month-/year-Parameter" });
    return;
  }
  const { month, year } = monthYear;
  // Sargable Monatsgrenzen (halboffenes Intervall): ermöglichen Indexnutzung auf
  // start_time/actual_start — EXTRACT(MONTH/YEAR FROM col) zerstört Indexnutzung.
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
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

    const horizonEnd = new Date(todayStart);
    horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

    // ── Gruppe 1: alle Abfragen, die nur teamScope brauchen, parallel ────────
    const [
      teamMemberRows,
      activeShiftsTodayRow,
      enabledTeamIds,
      monthShifts,
      upcomingShifts,
      horizonShifts,
      lenientTeamIds,
    ] = await Promise.all([
      // Mitglieds-IDs für Zähler & Warnungen
      teamScope.length
        ? db
            .selectDistinct({ userId: teamMembersTable.userId })
            .from(teamMembersTable)
            .where(inArray(teamMembersTable.teamId, teamScope))
        : Promise.resolve([] as { userId: number }[]),

      // KPI: heutige FIX-Schichten
      db
        .select({ activeShiftsToday: count() })
        .from(shiftsTable)
        .where(
          and(
            inArray(shiftsTable.teamId, teamScope),
            eq(shiftsTable.planningStatus, "FIX"),
            sql`${shiftsTable.startTime} >= ${todayStart}`,
            sql`${shiftsTable.startTime} < ${todayEnd}`,
          )
        ),

      // Konto-Schalter „Zeiterfassung aktivieren"
      teamScope.length
        ? getTimeTrackingEnabledTeamIds(teamScope)
        : isTimeTrackingEnabledForOwner(userId).then((v) => (v ? [1] : [])),

      // Monatliche FIX-Schichten (Soll-Stunden) — SQL-Aggregat statt JS-reduce.
      // Sargable Bereichsprädikat aktiviert den (team_id, start_time)-Index.
      db
        .select({
          plannedHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${shiftsTable.endTime} - ${shiftsTable.startTime})) / 3600), 0)`.mapWith(Number),
        })
        .from(shiftsTable)
        .where(
          and(
            inArray(shiftsTable.teamId, teamScope),
            eq(shiftsTable.planningStatus, "FIX"),
            gte(shiftsTable.startTime, monthStart),
            lt(shiftsTable.startTime, monthEnd),
          )
        ),

      // Nächste 5 Schichten (für die Kachel)
      db
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
        .orderBy(asc(shiftsTable.startTime))
        .limit(5),

      // Horizon-Schichten für Abdeckungs-Warnung
      db
        .select({ startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
        .from(shiftsTable)
        .where(
          and(
            inArray(shiftsTable.teamId, teamScope),
            sql`${shiftsTable.startTime} < ${horizonEnd}`,
            sql`${shiftsTable.endTime} > ${todayStart}`,
          )
        ),

      // Lenient-Teams (Free-Eigentümer ohne Freigabe-Workflow)
      getLenientTimeTrackingTeamIds(teamScope),
    ]);

    const teamMemberIds = teamMemberRows.map((r) => r.userId);
    const timeTrackingEnabled = enabledTeamIds.length > 0;
    const strictTeamIds = teamScope.filter((id) => !lenientTeamIds.includes(id));

    // ── Gruppe 2: abhängig von teamMemberIds und timeTrackingEnabled ─────────
    const statusCondition = lenientTeamIds.length
      ? or(
          eq(timeTrackingTable.status, "confirmed"),
          and(
            eq(timeTrackingTable.status, "pending"),
            inArray(timeTrackingTable.teamId, lenientTeamIds),
          ),
        )
      : eq(timeTrackingTable.status, "confirmed");

    const [
      totalAssistantsRow,
      assistants,
      pendingTimeEntriesRow,
      monthTimeEntries,
      uncountedEntries,
      recentTimeEntries,
    ] = await Promise.all([
      // KPI: Anzahl aktiver Assistenzkräfte
      db
        .select({ totalAssistants: count() })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "assistant"),
            teamMemberIds.length ? inArray(usersTable.id, teamMemberIds) : sql`false`,
          )
        ),

      // Assistenten-Liste für Urlaubs-Warnhinweise
      teamMemberIds.length
        ? db
            .select({ id: usersTable.id, name: usersTable.name })
            .from(usersTable)
            .where(
              and(
                eq(usersTable.role, "assistant"),
                eq(usersTable.isActive, true),
                inArray(usersTable.id, teamMemberIds),
              )
            )
        : Promise.resolve([] as { id: number; name: string }[]),

      // KPI: offene Zeiteinträge
      timeTrackingEnabled
        ? db
            .select({ pendingTimeEntries: count() })
            .from(timeTrackingTable)
            .where(and(inArray(timeTrackingTable.teamId, teamScope), eq(timeTrackingTable.status, "pending")))
        : Promise.resolve([{ pendingTimeEntries: 0 }] as { pendingTimeEntries: number | bigint }[]),

      // Ist-Stunden des Monats (bestätigt + ggf. offen in lenient-Teams).
      // Sargable Bereichsprädikat aktiviert den (team_id, actual_start)-Index.
      timeTrackingEnabled
        ? db
            .select({ actualHours: timeTrackingTable.actualHours })
            .from(timeTrackingTable)
            .where(
              and(
                inArray(timeTrackingTable.teamId, teamScope),
                gte(timeTrackingTable.actualStart, monthStart),
                lt(timeTrackingTable.actualStart, monthEnd),
                statusCondition,
              )
            )
        : Promise.resolve([] as { actualHours: number | null }[]),

      // Offene Stunden in strikten Teams (Premium-Upgrade-Hinweis).
      // Sargable Bereichsprädikat aktiviert den (team_id, actual_start)-Index.
      timeTrackingEnabled && strictTeamIds.length
        ? db
            .select({ actualHours: timeTrackingTable.actualHours })
            .from(timeTrackingTable)
            .where(
              and(
                inArray(timeTrackingTable.teamId, strictTeamIds),
                eq(timeTrackingTable.status, "pending"),
                gte(timeTrackingTable.actualStart, monthStart),
                lt(timeTrackingTable.actualStart, monthEnd),
              )
            )
        : Promise.resolve([] as { actualHours: number | null }[]),

      // Letzte 5 Zeiteinträge
      timeTrackingEnabled
        ? db
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
            .orderBy(desc(timeTrackingTable.createdAt))
            .limit(5)
        : Promise.resolve([] as never[]),
    ]);

    // ── Gruppe 3: Verträge aller Assistenten in einer Abfrage (kein N+1) ─────
    // Ersetzt: for (assistant of assistants) { await activeContractFor(...) }
    const activeContracts = await activeContractsForUsers(
      assistants.map((a) => a.id),
      todayStart,
    );
    const contractByUserId = new Map(activeContracts.map((c) => [c.userId, c]));

    // ── Berechnungen ──────────────────────────────────────────────────────────
    // SQL-Aggregat direkt verwenden (monthShifts liefert eine Zeile mit plannedHours).
    const monthlyPlannedHours = monthShifts[0]!.plannedHours;
    const monthlyActualHours = timeTrackingEnabled
      ? monthTimeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0)
      : monthlyPlannedHours;
    const uncountedPendingHours = uncountedEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);
    const uncountedPendingEntries = uncountedEntries.length;
    const { pendingTimeEntries } = pendingTimeEntriesRow[0];
    const { totalAssistants } = totalAssistantsRow[0];

    const vacationCandidates: VacationCandidate[] = [];
    const opsByTeam = new Map<number, ResolvedAllowanceOps>();
    for (const assistant of assistants) {
      const contract = contractByUserId.get(assistant.id);
      if (!contract) continue;
      let ops = opsByTeam.get(contract.teamId);
      if (!ops) {
        // resolveAllowanceOps pro Team nur einmal (bereits gecacht via Map)
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
    const uncoveredDays = computeUncoveredDays(horizonShifts, todayStart, HORIZON_DAYS);

    res.json({
      totalAssistants: Number(totalAssistants),
      activeShiftsToday: Number(activeShiftsTodayRow[0].activeShiftsToday),
      pendingTimeEntries: Number(pendingTimeEntries),
      monthlyPlannedHours: Math.round(monthlyPlannedHours * 100) / 100,
      monthlyActualHours: Math.round(monthlyActualHours * 100) / 100,
      hoursBalance: Math.round((monthlyActualHours - monthlyPlannedHours) * 100) / 100,
      uncountedPendingHours: Math.round(uncountedPendingHours * 100) / 100,
      uncountedPendingEntries,
      timeTrackingEnabled,
      upcomingShifts,
      recentTimeEntries,
      warnings: {
        pendingTimeEntries: Number(pendingTimeEntries),
        timeTrackingConfirmable:
          timeTrackingEnabled &&
          (teamScope.length === 0 || lenientTeamIds.length < teamScope.length),
        lowVacationAssistants,
        uncoveredDays,
        lowVacationThreshold: LOW_VACATION_THRESHOLD,
        horizonDays: HORIZON_DAYS,
      },
    });
    return;
  }

  // ── Gruppe 1: unabhängige Abfragen (weder von timeTrackingEnabled noch von
  // assistantTeamIds abhängig) — parallel statt seriell, analog zum
  // Admin-Branch oben.
  const [activeShiftsTodayRow, timeTrackingEnabled, monthShifts, assistantTeamIds, upcomingShifts] =
    await Promise.all([
      db
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
        ),

      // Effektiver Zeiterfassungs-Zustand des Assistenten = Zustand des
      // Arbeitgebers (Konto-Schalter des Team-Eigentümers, Standard AUS). Bei
      // AUS liefert das Dashboard keine Zeiterfassungs-Kennzahlen.
      isTimeTrackingEnabledForUser(userId),

      db
        .select({ startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.userId, userId),
            // Geplante Soll-Stunden zählen nur verbindlich bestätigte (FIX)
            // Schichten; Entwürfe/Vorschläge verfälschen die Zahl nicht.
            eq(shiftsTable.planningStatus, "FIX"),
            // Sargable Bereichsprädikat aktiviert den (user_id, start_time)-Index.
            gte(shiftsTable.startTime, monthStart),
            lt(shiftsTable.startTime, monthEnd),
          )
        ),

      // Ist-Stunden des Assistenten: bestätigte Einträge zählen immer. In
      // Teams von Free-Eigentümern (kein Freigabe-Workflow) zählen auch
      // "offene" Einträge, damit erfasste Stunden nicht dauerhaft bei 0
      // stehen. Maßgeblich ist der Plan des jeweiligen Team-Eigentümers,
      // nicht des Assistenten.
      getAllowedTeamIds(userId),

      db
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
        .orderBy(asc(shiftsTable.startTime))
        .limit(5),
    ]);
  const activeShiftsToday = activeShiftsTodayRow[0]!.activeShiftsToday;
  const monthlyPlannedHours = monthShifts.reduce(
    (acc, s) => acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000,
    0
  );

  // ── Gruppe 2: abhängig von assistantTeamIds bzw. timeTrackingEnabled ─────
  const [lenientTeamIds, pendingTimeEntriesRow, recentTimeEntries] = await Promise.all([
    getLenientTimeTrackingTeamIds(assistantTeamIds),

    timeTrackingEnabled
      ? db
          .select({ pendingTimeEntries: count() })
          .from(timeTrackingTable)
          .where(
            and(
              eq(timeTrackingTable.userId, userId),
              eq(timeTrackingTable.status, "pending")
            )
          )
      : Promise.resolve([{ pendingTimeEntries: 0 }] as { pendingTimeEntries: number | bigint }[]),

    timeTrackingEnabled
      ? db
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
          .orderBy(desc(timeTrackingTable.createdAt))
          .limit(5)
      : Promise.resolve([] as never[]),
  ]);
  const { pendingTimeEntries } = pendingTimeEntriesRow[0]!;
  const statusCondition = lenientTeamIds.length
    ? or(
        eq(timeTrackingTable.status, "confirmed"),
        and(
          eq(timeTrackingTable.status, "pending"),
          inArray(timeTrackingTable.teamId, lenientTeamIds),
        ),
      )
    : eq(timeTrackingTable.status, "confirmed");
  // Analog zum Admin-Branch: offene Einträge des Assistenten in strikten
  // (Premium-)Teams zählen nicht — die Summe wird ausgewiesen, damit der
  // Stundenstand nach einem Upgrade nicht kommentarlos schrumpft.
  const strictTeamIds = assistantTeamIds.filter((id) => !lenientTeamIds.includes(id));

  // ── Gruppe 3: abhängig von lenientTeamIds/strictTeamIds ──────────────────
  const [monthTimeEntries, uncounted] = await Promise.all([
    timeTrackingEnabled
      ? db
          .select({ actualHours: timeTrackingTable.actualHours })
          .from(timeTrackingTable)
          .where(
            and(
              eq(timeTrackingTable.userId, userId),
              // Sargable Bereichsprädikat aktiviert den (user_id, actual_start)-Index.
              gte(timeTrackingTable.actualStart, monthStart),
              lt(timeTrackingTable.actualStart, monthEnd),
              statusCondition,
            )
          )
      : Promise.resolve([] as { actualHours: number | null }[]),

    timeTrackingEnabled && strictTeamIds.length
      ? db
          .select({ actualHours: timeTrackingTable.actualHours })
          .from(timeTrackingTable)
          .where(
            and(
              eq(timeTrackingTable.userId, userId),
              inArray(timeTrackingTable.teamId, strictTeamIds),
              eq(timeTrackingTable.status, "pending"),
              // Sargable Bereichsprädikat aktiviert den (user_id, actual_start)-Index.
              gte(timeTrackingTable.actualStart, monthStart),
              lt(timeTrackingTable.actualStart, monthEnd),
            )
          )
      : Promise.resolve([] as { actualHours: number | null }[]),
  ]);
  // Bei deaktivierter Zeiterfassung: planbasierte Anzeige (FIX-Plan-Stunden)
  // statt leerer Ist-Stunden — analog zum Admin-Branch.
  const monthlyActualHours = timeTrackingEnabled
    ? monthTimeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0)
    : monthlyPlannedHours;
  const uncountedPendingEntries = uncounted.length;
  const uncountedPendingHours = uncounted.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);

  res.json({
    totalAssistants: null,
    activeShiftsToday: Number(activeShiftsToday),
    pendingTimeEntries: Number(pendingTimeEntries),
    monthlyPlannedHours: Math.round(monthlyPlannedHours * 100) / 100,
    monthlyActualHours: Math.round(monthlyActualHours * 100) / 100,
    hoursBalance: Math.round((monthlyActualHours - monthlyPlannedHours) * 100) / 100,
    uncountedPendingHours: Math.round(uncountedPendingHours * 100) / 100,
    uncountedPendingEntries,
    timeTrackingEnabled,
    upcomingShifts,
    recentTimeEntries,
  });
});

// Eigene Stunden-Übersicht für Assistenten: analog zu /api/contracts gibt der
// Server nur die Daten des angemeldeten Nutzers zurück. Kein Premium-Gate auf
// Seiten des Assistenten — Wage-Felder werden server-seitig auf null gesetzt,
// wenn der Arbeitgeber-Plan das Feature nicht freischaltet.
router.get("/dashboard/my-hours-balance", requireAuth, async (req, res): Promise<void> => {
  if (isAdminLikeRole(req.session.role)) {
    res.status(403).json({ error: "Admins verwenden GET /dashboard/hours-balance" });
    return;
  }
  const monthYear = parseMonthYearParams(req);
  if (!monthYear) {
    res.status(400).json({ error: "Ungültiger month-/year-Parameter" });
    return;
  }
  const { month, year } = monthYear;
  const userId = req.session.userId!;

  // computeHoursBalances scopt intern über getAllowedTeamIds(userId) auf die
  // Teams des Assistenten und gibt alle Assistenten dieser Teams zurück.
  // Wir filtern anschließend auf die eigene userId.
  const rows = await computeHoursBalances(userId, month, year);
  if (rows === null) {
    res.json(null);
    return;
  }
  const myRow = rows.find((r) => r.userId === userId) ?? null;

  // Wage-Felder: nur anzeigen, wenn der Arbeitgeber Premium hat
  // (requirePlanFeatureViaTeamOwner-Logik ohne Hard-403, stattdessen null).
  // Assistenten können selbst nicht upgraden — daher kein Fehler, nur null.
  const showWage = await userHasFeatureViaTeamOwner(userId, "payrollExport").catch(() => false);
  if (myRow && !showWage) {
    myRow.hourlyWage = null;
    myRow.basePay = null;
    myRow.nightSurchargePay = null;
    myRow.sundaySurchargePay = null;
    myRow.holidaySurchargePay = null;
    myRow.totalPay = null;
    myRow.absenceNightSurchargePay = null;
    myRow.absenceSundaySurchargePay = null;
    myRow.absenceHolidaySurchargePay = null;
  }

  res.json(myRow);
});

// Soll/Ist-Berechnung inkl. Zuschlags-Aufschlüsselung (Nacht/Sonntag/Feiertag).
// Das ist das Premium-Feature "advancedAnalytics" — und zugleich die Datenquelle
// für den (clientseitig erzeugten) Lohn-/Stundennachweis-PDF-Export
// ("payrollExport"). Free-Konten erhalten 403 plan_feature_required. Bestandsschutz
// bleibt gewahrt: die ROHDATEN (Schichten, Zeiterfassung, Verträge) bleiben über
// ihre regulären Listen-Endpunkte sichtbar — gesperrt wird nur diese abgeleitete
// Premium-Auswertung.
router.get("/dashboard/hours-balance", requireHoursBalancePlanning, requireHoursBalanceFeature, async (req, res): Promise<void> => {
  const monthYear = parseMonthYearParams(req);
  if (!monthYear) {
    res.status(400).json({ error: "Ungültiger month-/year-Parameter" });
    return;
  }
  const { month, year } = monthYear;

  // Teamleiter dürfen nur Auswertungen für ihre Teamleiter-Teams abrufen.
  // Für Nicht-Admins wird eine explizite Team-ID verlangt (kein globaler Dump).
  const userId = req.session.userId!;
  const role = req.session.role!;
  let requestedTeamId = parseTeamIdParam(req);
  let authorizedTeamScope = res.locals["hoursBalanceTeamScope"] as
    | number[]
    | null
    | undefined;
  if (
    isAdminLikeRole(role) &&
    res.locals["hoursBalanceTeamScopeResolved"] === true &&
    authorizedTeamScope === null
  ) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (!isAdminLikeRole(role)) {
    const tlTeamIds = await getTeamIdsWithCapability(userId, "plan");
    if (tlTeamIds.length === 0) {
      res.status(403).json({ error: "Keine Berechtigung" });
      return;
    }
    if (requestedTeamId == null) {
      // Kein teamId: Default auf erstes Teamleiter-Team.
      requestedTeamId = tlTeamIds[0];
    } else if (!tlTeamIds.includes(requestedTeamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    authorizedTeamScope = [requestedTeamId];
  }

  // Berechnung lebt in lib/hours-balance-service.ts, damit der Monatsabschluss
  // (month_closings) exakt dieselben Zahlen einfriert und vergleicht.
  const result = await computeHoursBalances(
    userId,
    month,
    year,
    requestedTeamId,
    {
      databaseVersion: res.locals["hoursBalanceDatabaseVersion"] as
        | string
        | undefined,
      teamScope: authorizedTeamScope ?? undefined,
    },
  );
  if (result === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }

  // Teamleiter ohne canViewPayroll: alle Geld-/Lohnfelder aus jeder Zeile
  // entfernen. Reine Stundenwerte bleiben erhalten (Dienstplanung braucht sie).
  if (!isAdminLikeRole(role) && requestedTeamId != null) {
    const hasPayroll = await canViewPayrollInTeam(userId, requestedTeamId);
    if (!hasPayroll) {
      const stripped = result.map((row) => ({
        ...row,
        hourlyWage: null,
        basePay: null,
        nightSurchargePay: null,
        sundaySurchargePay: null,
        holidaySurchargePay: null,
        totalPay: null,
        teamsitzungEuro: 0,
        urlaubsabgeltungEuro: 0,
        absenceNightSurchargePay: null,
        absenceSundaySurchargePay: null,
        absenceHolidaySurchargePay: null,
      }));
      res.json(stripped);
      return;
    }
  }

  res.json(result);
});

export default router;
