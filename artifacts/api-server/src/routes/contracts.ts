import { Router } from "express";
import { db } from "@workspace/db";
import { contractsTable, usersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  ListContractsQueryParams,
  CreateContractBody,
  GetContractParams,
  UpdateContractParams,
  UpdateContractBody,
  DeleteContractParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  parseTeamIdParam,
} from "../lib/teams";

const router = Router();

const CONTRACT_SELECT = {
  id: contractsTable.id,
  userId: contractsTable.userId,
  weeklyHours: contractsTable.weeklyHours,
  vacationDays: contractsTable.vacationDays,
  vacationDaysUsed: contractsTable.vacationDaysUsed,
  startDate: contractsTable.startDate,
  endDate: contractsTable.endDate,
  notes: contractsTable.notes,
  createdAt: contractsTable.createdAt,
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

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

router.get("/contracts", requireAuth, async (req, res): Promise<void> => {
  const query = ListContractsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  // Nicht-Admins (Assistenten) dürfen ausschließlich ihren eigenen Vertrag
  // lesen — der userId-Filter wird zwingend auf die eigene Session gesetzt.
  const filterUserId =
    req.session.role === "admin" ? query.data.userId : req.session.userId;

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const conditions = [inArray(contractsTable.teamId, teamScope)];
  if (filterUserId) conditions.push(eq(contractsTable.userId, filterUserId));
  const rows = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(and(...conditions));
  res.json(rows);
});

router.post("/contracts", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateContractBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const write = await resolveWriteTeamId(req.session.userId!, body.data.teamId ?? undefined);
  if (!write.ok) {
    if (write.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team zugeordnet" });
    }
    return;
  }
  const [contract] = await db
    .insert(contractsTable)
    .values({
      ...body.data,
      teamId: write.teamId,
      startDate: toDateString(body.data.startDate),
      endDate: body.data.endDate ? toDateString(body.data.endDate) : undefined,
    })
    .returning();
  const [withUser] = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, contract.id));
  res.status(201).json(withUser);
});

router.get("/contracts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetContractParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [row] = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.patch("/contracts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateContractParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateContractBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const updateValues: Record<string, unknown> = { ...body.data };

  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [updated] = await db
    .update(contractsTable)
    .set(updateValues)
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [withUser] = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/contracts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteContractParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const deleted = await db
    .delete(contractsTable)
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)))
    .returning({ id: contractsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

router.get("/contracts/:id/vacation-balance", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [contract] = await db
    .select()
    .from(contractsTable)
    .where(and(eq(contractsTable.id, id), inArray(contractsTable.teamId, allowedTeams)))
    .limit(1);
  if (!contract) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    contractId: contract.id,
    userId: contract.userId,
    vacationDays: contract.vacationDays,
    vacationDaysUsed: contract.vacationDaysUsed,
    vacationDaysRemaining: contract.vacationDays - contract.vacationDaysUsed,
  });
});

export default router;
