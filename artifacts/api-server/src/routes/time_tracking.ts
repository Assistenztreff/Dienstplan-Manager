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
import { requireAuth, requireAdmin } from "../middleware/auth";

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

router.get("/time-tracking", requireAuth, async (req, res): Promise<void> => {
  const query = ListTimeEntriesQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    status: req.query.status,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const effectiveUserId =
    req.session.role === "assistant" ? req.session.userId! : query.data.userId;

  const conditions = [];
  if (effectiveUserId) conditions.push(eq(timeTrackingTable.userId, effectiveUserId));
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

router.post("/time-tracking", requireAuth, async (req, res): Promise<void> => {
  const body = CreateTimeEntryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const userId =
    req.session.role === "assistant" ? req.session.userId! : body.data.userId;

  const actualStart = new Date(body.data.actualStart as unknown as string);
  const actualEnd = new Date(body.data.actualEnd as unknown as string);
  const actualHours = calcHours(actualStart, actualEnd);
  const [entry] = await db
    .insert(timeTrackingTable)
    .values({ ...body.data, userId, actualHours })
    .returning();
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, entry.id));
  res.status(201).json(withUser);
});

router.get("/time-tracking/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
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

router.patch("/time-tracking/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const updateData: Record<string, unknown> = { ...body.data };
  if (body.data.actualStart && body.data.actualEnd) {
    updateData.actualHours = calcHours(
      new Date(body.data.actualStart as unknown as string),
      new Date(body.data.actualEnd as unknown as string)
    );
  }
  const [updated] = await db
    .update(timeTrackingTable)
    .set(updateData)
    .where(eq(timeTrackingTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/time-tracking/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(timeTrackingTable).where(eq(timeTrackingTable.id, params.data.id));
  res.status(204).send();
});

router.patch("/time-tracking/:id/confirm", requireAdmin, async (req, res): Promise<void> => {
  const params = ConfirmTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  const body = ConfirmTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
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
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [withUser] = await db
    .select(withUserSelect)
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  res.json(withUser);
});

export default router;
