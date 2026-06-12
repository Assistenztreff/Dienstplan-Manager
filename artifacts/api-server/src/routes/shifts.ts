import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  ListShiftsQueryParams,
  CreateShiftBody,
  GetShiftParams,
  UpdateShiftParams,
  UpdateShiftBody,
  DeleteShiftParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/shifts", async (req, res) => {
  const query = ListShiftsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    type: req.query.type,
  });
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }

  const conditions = [];
  if (query.data.userId) conditions.push(eq(shiftsTable.userId, query.data.userId));
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day"));
  if (query.data.month && query.data.year) {
    conditions.push(sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${query.data.month}`);
    conditions.push(sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${query.data.year}`);
  }

  const rows = await db
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
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(rows);
});

router.post("/shifts", async (req, res) => {
  const body = CreateShiftBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const [shift] = await db.insert(shiftsTable).values(body.data).returning();
  const [withUser] = await db
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
    .where(eq(shiftsTable.id, shift.id));
  res.status(201).json(withUser);
});

router.get("/shifts/:id", async (req, res) => {
  const params = GetShiftParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db
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
    .where(eq(shiftsTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.patch("/shifts/:id", async (req, res) => {
  const params = UpdateShiftParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateShiftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const [updated] = await db
    .update(shiftsTable)
    .set(body.data)
    .where(eq(shiftsTable.id, params.data.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  const [withUser] = await db
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
    .where(eq(shiftsTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/shifts/:id", async (req, res) => {
  const params = DeleteShiftParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(shiftsTable).where(eq(shiftsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
