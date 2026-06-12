import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, shiftsTable, timeTrackingTable, contractsTable } from "@workspace/db";
import { eq, and, sql, count, sum } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const [{ totalAssistants }] = await db
    .select({ totalAssistants: count() })
    .from(usersTable)
    .where(eq(usersTable.role, "assistant"));

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
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
    .select({ actualHours: shiftsTable.endTime, startTime: shiftsTable.startTime, endTime: shiftsTable.endTime })
    .from(shiftsTable)
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${year}`,
      )
    );
  const monthlyPlannedHours = monthShifts.reduce((acc, s) => {
    return acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
  }, 0);

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
});

router.get("/dashboard/hours-balance", async (req, res) => {
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const assistants = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.role, "assistant"), eq(usersTable.isActive, true)));

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
      const plannedHours = shifts.reduce((acc, s) => {
        return acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
      }, 0);

      const timeEntries = await db
        .select()
        .from(timeTrackingTable)
        .where(
          and(
            eq(timeTrackingTable.userId, assistant.id),
            sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${month}`,
            sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${year}`,
            eq(timeTrackingTable.status, "confirmed"),
          )
        );
      const actualHours = timeEntries.reduce((acc, e) => acc + (e.actualHours ?? 0), 0);

      const contract = await db
        .select()
        .from(contractsTable)
        .where(eq(contractsTable.userId, assistant.id))
        .limit(1);
      const vacationDays = contract[0]?.vacationDays ?? 30;

      return {
        userId: assistant.id,
        userName: assistant.name,
        plannedHours: Math.round(plannedHours * 100) / 100,
        actualHours: Math.round(actualHours * 100) / 100,
        balance: Math.round((actualHours - plannedHours) * 100) / 100,
        vacationDaysUsed: 0,
        vacationDaysRemaining: vacationDays,
      };
    })
  );

  res.json(result);
});

export default router;
