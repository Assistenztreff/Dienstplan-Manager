import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, shiftsTable, timeTrackingTable, contractsTable, allowanceSettingsTable } from "@workspace/db";
import { eq, and, sql, count, or, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";

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
    const [{ totalAssistants }] = await db
      .select({ totalAssistants: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "assistant"));

    const [{ activeShiftsToday }] = await db
      .select({ activeShiftsToday: count() })
      .from(shiftsTable)
      .where(
        and(
          sql`${shiftsTable.startTime} >= ${todayStart}`,
          sql`${shiftsTable.startTime} < ${todayEnd}`,
        )
      );

    const [{ pendingTimeEntries }] = await db
      .select({ pendingTimeEntries: count() })
      .from(timeTrackingTable)
      .where(eq(timeTrackingTable.status, "pending"));

    const monthShifts = await db
      .select({ startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
      .from(shiftsTable)
      .where(
        and(
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
      .where(sql`${shiftsTable.startTime} >= ${today}`)
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
      .limit(5);

    res.json({
      totalAssistants: Number(totalAssistants),
      activeShiftsToday: Number(activeShiftsToday),
      pendingTimeEntries: Number(pendingTimeEntries),
      monthlyPlannedHours: Math.round(monthlyPlannedHours * 100) / 100,
      monthlyActualHours: Math.round(monthlyActualHours * 100) / 100,
      hoursBalance: Math.round((monthlyActualHours - monthlyPlannedHours) * 100) / 100,
      upcomingShifts,
      recentTimeEntries,
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

  const assistants = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.role, "assistant"), eq(usersTable.isActive, true)));

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
      const vacationFulfilledHours = shifts
        .filter(s => s.type === "vacation")
        .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
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
        vacationDaysTaken: vacationDaysUsed,
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
