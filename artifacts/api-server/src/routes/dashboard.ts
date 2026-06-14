import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, shiftsTable, timeTrackingTable, contractsTable, allowanceSettingsTable, teamMembersTable } from "@workspace/db";
import { eq, and, sql, count, or, isNull, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { resolveReadTeamScope, parseTeamIdParam } from "../lib/teams";
import {
  LOW_VACATION_THRESHOLD,
  HORIZON_DAYS,
  computeUncoveredDays,
  computeLowVacationAssistants,
  type VacationCandidate,
} from "../lib/dashboard-warnings";

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
  const isAdmin = req.session.role === "admin";
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
          sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
          sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
        )
      );
    const monthlyPlannedHours = monthShifts.reduce(
      (acc, s) => acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000,
      0
    );

    const monthTimeEntries = await db
      .select({ actualHours: timeTrackingTable.actualHours })
      .from(timeTrackingTable)
      .where(
        and(
          inArray(timeTrackingTable.teamId, teamScope),
          sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
          sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
          eq(timeTrackingTable.status, "confirmed"),
        )
      );
    const monthlyActualHours = monthTimeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);

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
    for (const assistant of assistants) {
      const contract = await activeContractFor(assistant.id, todayStart);
      if (!contract) continue;
      vacationCandidates.push({
        userId: assistant.id,
        userName: assistant.name,
        vacationDays: contract.vacationDays,
        vacationDaysUsed: contract.vacationDaysUsed,
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
      upcomingShifts,
      recentTimeEntries,
      warnings: {
        pendingTimeEntries: Number(pendingTimeEntries),
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
        sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
      )
    );
  const monthlyPlannedHours = monthShifts.reduce(
    (acc, s) => acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000,
    0
  );

  const monthTimeEntries = await db
    .select({ actualHours: timeTrackingTable.actualHours })
    .from(timeTrackingTable)
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
        eq(timeTrackingTable.status, "confirmed"),
      )
    );
  const monthlyActualHours = monthTimeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);

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
    upcomingShifts,
    recentTimeEntries,
  });
});

router.get("/dashboard/hours-balance", requireAdmin, async (req, res): Promise<void> => {
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  const teamMemberIds = teamScope.length
    ? (
        await db
          .selectDistinct({ userId: teamMembersTable.userId })
          .from(teamMembersTable)
          .where(inArray(teamMembersTable.teamId, teamScope))
      ).map((r) => r.userId)
    : [];

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
  // Schicht) angewandt, damit Änderungen rückwirkend greifen.
  const [allowance] = await db
    .select()
    .from(allowanceSettingsTable)
    .where(eq(allowanceSettingsTable.id, 1));
  const nightPercent = allowance?.nightPercent ?? 25;
  const sundayPercent = allowance?.sundayPercent ?? 50;
  const holidayPercent = allowance?.holidayPercent ?? 100;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const result = await Promise.all(
    assistants.map(async (assistant) => {
      const shifts = await db
        .select()
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.userId, assistant.id),
            inArray(shiftsTable.teamId, teamScope),
            sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
            sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
          )
        );

      const workShifts = shifts.filter(s => s.type !== "vacation" && s.type !== "sick");

      const plannedHours = workShifts.reduce((acc, s) => {
        return acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
      }, 0);

      // Roh-Kennzahlen aus den Schichten summieren; Zuschläge erst danach anwenden.
      const valuedHours = workShifts.reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
      const nightHours = workShifts.reduce((acc, s) => acc + (s.nightHours ?? 0), 0);
      const sundayHours = workShifts.reduce((acc, s) => acc + (s.sundayHours ?? 0), 0);
      const holidayHours = workShifts.reduce((acc, s) => acc + (s.holidayHours ?? 0), 0);
      const nightSurchargeHours = (nightHours * nightPercent) / 100;
      const sundaySurchargeHours = (sundayHours * sundayPercent) / 100;
      const holidaySurchargeHours = (holidayHours * holidayPercent) / 100;

      // Urlaub/Krank: gespeicherte gewertete Stunden = volle geplante Tagesstunden,
      // die als erfüllt zählen.
      const vacationShifts = shifts.filter(s => s.type === "vacation");
      const vacationFulfilledHours = vacationShifts.reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
      // Genommene Urlaubstage des gewählten Monats = Anzahl der Urlaubs-Schichten
      // dieses Monats (eine Urlaubs-Schicht = ein Tag), nicht der Jahres-Zähler
      // aus dem Vertrag.
      const vacationDaysTaken = vacationShifts.length;
      const sickFulfilledHours = shifts
        .filter(s => s.type === "sick")
        .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
      // Gesamt erfüllte (gewertete) Stunden inkl. Urlaub und Krankheit.
      const totalFulfilledHours = valuedHours + vacationFulfilledHours + sickFulfilledHours;

      const timeEntriesWithShift = await db
        .select({
          actualHours: timeTrackingTable.actualHours,
          shiftType: shiftsTable.type,
        })
        .from(timeTrackingTable)
        .leftJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
        .where(
          and(
            eq(timeTrackingTable.userId, assistant.id),
            inArray(timeTrackingTable.teamId, teamScope),
            sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
            sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
            eq(timeTrackingTable.status, "confirmed"),
          )
        );

      // Tatsächlich erfasste Arbeitsstunden aus der Zeiterfassung (optional, falls
      // Assistenten Ist-Zeiten bestätigen). Krank-Stunden werden plan-basiert
      // (gewertete Stunden der Schicht) gezählt, daher hier nur Arbeitseinträge.
      let trackedHours = 0;
      for (const entry of timeEntriesWithShift) {
        const hours = entry.actualHours ?? 0;
        if (entry.shiftType !== "sick" && entry.shiftType !== "vacation") {
          trackedHours += hours;
        }
      }

      const sickHours = sickFulfilledHours;
      const contract = await activeContractFor(assistant.id, referenceDate);
      const vacationDays = contract?.vacationDays ?? 30;
      const vacationDaysUsed = contract?.vacationDaysUsed ?? 0;

      return {
        userId: assistant.id,
        userName: assistant.name,
        plannedHours: Math.round(plannedHours * 100) / 100,
        actualHours: round2(totalFulfilledHours),
        balance: round2(totalFulfilledHours - plannedHours),
        workedHours: round2(trackedHours),
        sickHours: round2(sickHours),
        vacationDaysTaken,
        vacationDaysUsed,
        vacationDaysRemaining: vacationDays - vacationDaysUsed,
        valuedHours: round2(valuedHours),
        vacationFulfilledHours: round2(vacationFulfilledHours),
        totalFulfilledHours: round2(totalFulfilledHours),
        nightHours: round2(nightHours),
        nightSurchargeHours: round2(nightSurchargeHours),
        sundayHours: round2(sundayHours),
        sundaySurchargeHours: round2(sundaySurchargeHours),
        holidayHours: round2(holidayHours),
        holidaySurchargeHours: round2(holidaySurchargeHours),
        nightPercent,
        sundayPercent,
        holidayPercent,
      };
    })
  );

  res.json(result);
});

export default router;
