import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable, contractsTable, timeTrackingTable } from "@workspace/db";
import { eq, and, sql, or, isNull } from "drizzle-orm";
import {
  ListShiftsQueryParams,
  CreateShiftBody,
  GetShiftParams,
  UpdateShiftParams,
  UpdateShiftBody,
  DeleteShiftParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

const SHIFT_SELECT = {
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
};

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

router.get("/shifts", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    type: req.query.type,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const effectiveUserId =
    req.session.role === "assistant" ? req.session.userId! : query.data.userId;

  const conditions = [];
  if (effectiveUserId) conditions.push(eq(shiftsTable.userId, effectiveUserId));
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day" | "vacation" | "sick"));
  if (query.data.month && query.data.year) {
    conditions.push(sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${query.data.month}`);
    conditions.push(sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${query.data.year}`);
  }

  const rows = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(rows);
});

router.post("/shifts", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateShiftBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const [shift] = await db.insert(shiftsTable).values(body.data).returning();

  if (shift.type === "vacation" || shift.type === "sick") {
    const contract = await activeContractFor(shift.userId, new Date(shift.startTime));
    const dailyHours = contract ? Math.round((contract.weeklyHours / 5) * 100) / 100 : 8;

    await db.insert(timeTrackingTable).values({
      userId: shift.userId,
      shiftId: shift.id,
      actualStart: shift.startTime,
      actualEnd: shift.endTime,
      actualHours: dailyHours,
      status: "confirmed",
    });

    if (shift.type === "vacation" && contract) {
      await db
        .update(contractsTable)
        .set({ vacationDaysUsed: contract.vacationDaysUsed + 1 })
        .where(eq(contractsTable.id, contract.id));
    }
  }

  const [withUser] = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(eq(shiftsTable.id, shift.id));
  res.status(201).json(withUser);
});

router.get("/shifts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetShiftParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(eq(shiftsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.session.role === "assistant" && row.userId !== req.session.userId!) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  res.json(row);
});

router.patch("/shifts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateShiftParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateShiftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [oldShift] = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id))
    .limit(1);
  if (!oldShift) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [updated] = await db
    .update(shiftsTable)
    .set(body.data)
    .where(eq(shiftsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const newType = updated.type;
  const oldType = oldShift.type;
  const typeChanged = body.data.type !== undefined && newType !== oldType;

  if (typeChanged) {
    const shiftDate = new Date(updated.startTime);
    const wasAbsence = oldType === "vacation" || oldType === "sick";
    const isAbsence = newType === "vacation" || newType === "sick";

    if (wasAbsence && !isAbsence) {
      await db.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, updated.id));
      if (oldType === "vacation") {
        const contract = await activeContractFor(updated.userId, shiftDate);
        if (contract && contract.vacationDaysUsed > 0) {
          await db
            .update(contractsTable)
            .set({ vacationDaysUsed: contract.vacationDaysUsed - 1 })
            .where(eq(contractsTable.id, contract.id));
        }
      }
    } else if (!wasAbsence && isAbsence) {
      const contract = await activeContractFor(updated.userId, shiftDate);
      const dailyHours = contract ? Math.round((contract.weeklyHours / 5) * 100) / 100 : 8;
      await db.insert(timeTrackingTable).values({
        userId: updated.userId,
        shiftId: updated.id,
        actualStart: updated.startTime,
        actualEnd: updated.endTime,
        actualHours: dailyHours,
        status: "confirmed",
      });
      if (newType === "vacation" && contract) {
        await db
          .update(contractsTable)
          .set({ vacationDaysUsed: contract.vacationDaysUsed + 1 })
          .where(eq(contractsTable.id, contract.id));
      }
    } else if (wasAbsence && isAbsence && oldType !== newType) {
      const contract = await activeContractFor(updated.userId, shiftDate);
      const dailyHours = contract ? Math.round((contract.weeklyHours / 5) * 100) / 100 : 8;
      await db
        .update(timeTrackingTable)
        .set({ actualHours: dailyHours, actualStart: updated.startTime, actualEnd: updated.endTime })
        .where(eq(timeTrackingTable.shiftId, updated.id));
      if (oldType === "vacation" && contract && contract.vacationDaysUsed > 0) {
        await db
          .update(contractsTable)
          .set({ vacationDaysUsed: contract.vacationDaysUsed - 1 })
          .where(eq(contractsTable.id, contract.id));
      }
      if (newType === "vacation" && contract) {
        const refreshed = await activeContractFor(updated.userId, shiftDate);
        if (refreshed) {
          await db
            .update(contractsTable)
            .set({ vacationDaysUsed: refreshed.vacationDaysUsed + 1 })
            .where(eq(contractsTable.id, refreshed.id));
        }
      }
    }
  }

  const [withUser] = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(eq(shiftsTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/shifts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteShiftParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
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

  if (shift.type === "vacation" || shift.type === "sick") {
    await db.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, shift.id));
  }

  if (shift.type === "vacation") {
    const contract = await activeContractFor(shift.userId, new Date(shift.startTime));
    if (contract && contract.vacationDaysUsed > 0) {
      await db
        .update(contractsTable)
        .set({ vacationDaysUsed: contract.vacationDaysUsed - 1 })
        .where(eq(contractsTable.id, contract.id));
    }
  }

  await db.delete(shiftsTable).where(eq(shiftsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
