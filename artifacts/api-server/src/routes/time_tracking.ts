import { Router } from "express";
import { db } from "@workspace/db";
import { timeTrackingTable, usersTable, shiftsTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
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
import {
  resolveTeamId,
  resolveReadTeamScope,
  getAllowedTeamIds,
  parseTeamIdParam,
} from "../lib/teams";

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

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const conditions = [inArray(timeTrackingTable.teamId, teamScope)];
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
    .where(and(...conditions));
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

  let teamId: number | null = null;
  if (body.data.shiftId != null) {
    // Zugehörigkeit prüfen: die verknüpfte Schicht muss dem Benutzer gehören,
    // für den die Ist-Zeit erfasst wird. Sonst könnte eine fremde Schicht
    // verknüpft und (durch den 409-Guard) für den Berechtigten blockiert werden.
    const [shift] = await db
      .select({ id: shiftsTable.id, userId: shiftsTable.userId, teamId: shiftsTable.teamId })
      .from(shiftsTable)
      .where(eq(shiftsTable.id, body.data.shiftId))
      .limit(1);
    if (!shift) {
      res.status(404).json({ error: "Schicht nicht gefunden." });
      return;
    }
    if (shift.userId !== userId) {
      res.status(403).json({
        error: "Die Schicht gehört nicht zu diesem Benutzer.",
        code: "shift_not_owned",
      });
      return;
    }
    teamId = shift.teamId;

    // Doppelbuchung verhindern: pro geplanter Schicht darf nur eine Ist-Zeit
    // erfasst werden. Serverseitiger Schutz, unabhängig von der UI-Filterung.
    const [existing] = await db
      .select({ id: timeTrackingTable.id })
      .from(timeTrackingTable)
      .where(eq(timeTrackingTable.shiftId, body.data.shiftId))
      .limit(1);
    if (existing) {
      res.status(409).json({
        error: "Für diese Schicht wurde bereits eine Zeit erfasst.",
        code: "shift_already_booked",
      });
      return;
    }
  }

  if (teamId == null) {
    teamId = body.data.teamId ?? (await resolveTeamId(userId));
  }
  if (teamId == null) {
    res.status(400).json({ error: "Kein Team zugeordnet" });
    return;
  }
  // Sicherstellen, dass das (ggf. angeforderte oder von der Schicht geerbte)
  // Team im Berechtigungsumfang des erfassenden Nutzers liegt.
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  if (!allowedTeams.includes(teamId)) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }

  const actualStart = new Date(body.data.actualStart as unknown as string);
  const actualEnd = new Date(body.data.actualEnd as unknown as string);
  const actualHours = calcHours(actualStart, actualEnd);
  const [entry] = await db
    .insert(timeTrackingTable)
    .values({ ...body.data, userId, teamId, actualHours })
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
    .select({ ...withUserSelect, teamId: timeTrackingTable.teamId })
    .from(timeTrackingTable)
    .leftJoin(usersTable, eq(timeTrackingTable.userId, usersTable.id))
    .where(eq(timeTrackingTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.session.role === "assistant") {
    if (row.userId !== req.session.userId!) {
      res.status(403).json({ error: "Keine Berechtigung" });
      return;
    }
  } else {
    const allowedTeams = await getAllowedTeamIds(req.session.userId!);
    if (row.teamId == null || !allowedTeams.includes(row.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const { teamId: _teamId, ...rowOut } = row;
  res.json(rowOut);
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
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [updated] = await db
    .update(timeTrackingTable)
    .set(updateData)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
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
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const deleted = await db
    .delete(timeTrackingTable)
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
    .returning({ id: timeTrackingTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/time-tracking/:id/confirm", requireAdmin, async (req, res): Promise<void> => {
  const params = ConfirmTimeEntryParams.safeParse({ id: Number(req.params["id"]) });
  const body = ConfirmTimeEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [updated] = await db
    .update(timeTrackingTable)
    .set({
      status: body.data.status,
      confirmedBy: body.data.confirmedBy,
      confirmedAt: new Date(),
    })
    .where(and(eq(timeTrackingTable.id, params.data.id), inArray(timeTrackingTable.teamId, allowedTeams)))
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
