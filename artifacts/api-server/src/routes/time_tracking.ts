import { Router } from "express";
import { db } from "@workspace/db";
import { timeTrackingTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  ListTimeEntriesQueryParams,
  CreateTimeEntryBody,
  GetTimeEntryParams,
  UpdateTimeEntryParams,
  UpdateTimeEntryBody,
  DeleteTimeEntryParams,
  ConfirmTimeEntryParams,
  ConfirmTimeEntryBody,
} from "@workspace/api-zod";

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

router.get("/time-tracking", async (req, res) => {
  const query = ListTimeEntriesQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    status: req.query.status,
  });
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }

  const conditions = [];
  if (query.data.userId) conditions.push(eq(timeTrackingTable.userId, query.data.userId));
  if (query.data.status) conditions.push(eq(timeTrackingTable.status, query.data.status as "pending" | "confirmed" | "rejected"));
  if (query.data.month && query.data.year) {
    conditions.push(sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${query.data.month}`);
    conditions.push(sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${query.data.year}`);
  }

  const rows = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(rows);
});

router.post("/time-tracking", async (req, res) => {
  const body = CreateTimeEntryBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const actualStart = new Date(body.data.actualStart);
  const actualEnd = new Date(body.data.actualEnd);
  const actualHours = calcHours(actualStart, actualEnd);
  const [entry] = await db
    .insert(timeTrackingTable)
    .values({ ...body.data, actualHours })
    .returning();
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, entry.id));
  res.status(201).json(withUser);
});

router.get("/time-tracking/:id", async (req, res) => {
  const params = GetTimeEntryParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.patch("/time-tracking/:id", async (req, res) => {
  const params = UpdateTimeEntryParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const updateData: Record<string, unknown> = { ...body.data };
  if (body.data.actualStart && body.data.actualEnd) {
    updateData.actualHours = calcHours(new Date(body.data.actualStart), new Date(body.data.actualEnd));
  }
  const [updated] = await db
    .update(timeTrackingTable)
    .set(updateData)
    .where(eq(timeTrackingTable.id, params.data.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/time-tracking/:id", async (req, res) => {
  const params = DeleteTimeEntryParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(timeTrackingTable).where(eq(timeTrackingTable.id, params.data.id));
  res.status(204).send();
});

router.patch("/time-tracking/:id/confirm", async (req, res) => {
  const params = ConfirmTimeEntryParams.safeParse({ id: Number(req.params.id) });
  const body = ConfirmTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const [updated] = await db
    .update(timeTrackingTable)
    .set({
      status: body.data.status,
      confirmedBy: body.data.confirmedBy,
      confirmedAt: new Date(),
    })
    .where(eq(timeTrackingTable.id, params.data.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  res.json(withUser);
});

export default router;
