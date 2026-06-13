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
  shiftModelId: shiftsTable.shiftModelId,
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

// Urlaub und Krankheit sind Abwesenheiten: sie referenzieren kein Schichtmodell
// und lösen keine Zuschlagsberechnung aus.
function isAbsenceType(type: string): boolean {
  return type === "vacation" || type === "sick";
}

type AbsenceShift = {
  id: number;
  userId: number;
  startTime: Date;
  endTime: Date;
};

// Vertragliche Soll-Stunden des Tages (Wochenstunden / 5). Fallback 8h ohne Vertrag.
async function dailyTargetHours(userId: number, date: Date): Promise<number> {
  const contract = await activeContractFor(userId, date);
  return contract ? Math.round((contract.weeklyHours / 5) * 100) / 100 : 8;
}

// Bucht die Soll-Stunden des Tages als bestätigte Zeiterfassung (Lohnfortzahlung,
// keine Zuschläge), da Abwesenheiten kein Arbeits-Schichtmodell sind.
async function bookAbsenceTimeTracking(shift: AbsenceShift): Promise<void> {
  const dailyHours = await dailyTargetHours(shift.userId, new Date(shift.startTime));
  await db.insert(timeTrackingTable).values({
    userId: shift.userId,
    shiftId: shift.id,
    actualStart: shift.startTime,
    actualEnd: shift.endTime,
    actualHours: dailyHours,
    status: "confirmed",
  });
}

// Hält die gebuchte Zeiterfassung einer Abwesenheit synchron, wenn sich Datum,
// Zeiten oder der zugrundeliegende Vertrag geändert haben.
async function syncAbsenceTimeTracking(shift: AbsenceShift): Promise<void> {
  const dailyHours = await dailyTargetHours(shift.userId, new Date(shift.startTime));
  await db
    .update(timeTrackingTable)
    .set({ actualHours: dailyHours, actualStart: shift.startTime, actualEnd: shift.endTime })
    .where(eq(timeTrackingTable.shiftId, shift.id));
}

async function removeAbsenceTimeTracking(shiftId: number): Promise<void> {
  await db.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, shiftId));
}

// Schreibt den genommenen Urlaub auf einem konkreten Vertrag fort. Geht nie unter null.
async function applyVacationDelta(
  contract: { id: number; vacationDaysUsed: number },
  delta: number
): Promise<void> {
  const next = contract.vacationDaysUsed + delta;
  await db
    .update(contractsTable)
    .set({ vacationDaysUsed: next < 0 ? 0 : next })
    .where(eq(contractsTable.id, contract.id));
}

// Bucht +1/-1 auf den Vertrag, der für (userId, Datum) gilt.
async function adjustVacationDaysUsed(userId: number, date: Date, delta: number): Promise<void> {
  const contract = await activeContractFor(userId, date);
  if (!contract) return;
  await applyVacationDelta(contract, delta);
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
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day" | "vacation" | "sick" | "work"));
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

  if (isAbsenceType(shift.type)) {
    await bookAbsenceTimeTracking(shift);
    if (shift.type === "vacation") {
      await adjustVacationDaysUsed(shift.userId, new Date(shift.startTime), 1);
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
  const wasAbsence = isAbsenceType(oldType);
  const isAbsence = isAbsenceType(newType);

  // Zeiterfassung an den Typ-Übergang anpassen.
  if (wasAbsence && !isAbsence) {
    await removeAbsenceTimeTracking(updated.id);
  } else if (!wasAbsence && isAbsence) {
    await bookAbsenceTimeTracking(updated);
  } else if (wasAbsence && isAbsence) {
    // Bleibt Abwesenheit: Buchung mit Datum/Zeiten/Vertrag synchron halten.
    await syncAbsenceTimeTracking(updated);
  }

  // Urlaubsanspruch rebalancieren: Ein Urlaubstag bucht genau 1 Tag auf den Vertrag,
  // der für (userId, Datum) gilt — vor und nach dem Update. Ändert sich der gültige
  // Vertrag (z.B. durch Datumswechsel über Vertragsgrenzen) oder der Typ, umbuchen.
  const oldVacationContract =
    oldType === "vacation"
      ? await activeContractFor(oldShift.userId, new Date(oldShift.startTime))
      : null;
  const newVacationContract =
    newType === "vacation"
      ? await activeContractFor(updated.userId, new Date(updated.startTime))
      : null;
  if (oldVacationContract?.id !== newVacationContract?.id) {
    if (oldVacationContract) await applyVacationDelta(oldVacationContract, -1);
    if (newVacationContract) await applyVacationDelta(newVacationContract, 1);
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

  if (isAbsenceType(shift.type)) {
    await removeAbsenceTimeTracking(shift.id);
    if (shift.type === "vacation") {
      await adjustVacationDaysUsed(shift.userId, new Date(shift.startTime), -1);
    }
  }

  await db.delete(shiftsTable).where(eq(shiftsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
