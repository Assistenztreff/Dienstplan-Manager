import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, teamMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListUsersQueryParams,
  CreateUserBody,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
  GetUserParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getAllowedTeamIds, parseTeamIdParam } from "../lib/teams";

const router = Router();

const SAFE_USER_SELECT = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  accountType: usersTable.accountType,
  phone: usersTable.phone,
  address: usersTable.address,
  birthDate: usersTable.birthDate,
  socialSecurityNumber: usersTable.socialSecurityNumber,
  taxId: usersTable.taxId,
  taxClass: usersTable.taxClass,
  healthInsurance: usersTable.healthInsurance,
  iban: usersTable.iban,
  isActive: usersTable.isActive,
  createdAt: usersTable.createdAt,
};

router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  // Optionaler teamId-Filter: nur Mitglieder dieses Teams (Dienstleister-Kontext).
  // Ohne teamId bleibt das Legacy-Verhalten (globaler Nutzer-Pool) erhalten.
  const teamId = parseTeamIdParam(req);
  let rows;
  if (teamId != null) {
    const allowedTeams = await getAllowedTeamIds(req.session.userId!);
    if (!allowedTeams.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    rows = await db
      .select(SAFE_USER_SELECT)
      .from(usersTable)
      .innerJoin(teamMembersTable, eq(teamMembersTable.userId, usersTable.id))
      .where(eq(teamMembersTable.teamId, teamId));
  } else {
    rows = await db.select(SAFE_USER_SELECT).from(usersTable);
  }
  if (query.data.role) {
    rows = rows.filter((u) => u.role === query.data.role);
  }
  res.json(rows);
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values(body.data)
    .returning(SAFE_USER_SELECT);
  res.status(201).json(user);
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const requestedId = params.data.id;
  if (req.session.role !== "admin" && req.session.userId !== requestedId) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  const [user] = await db
    .select(SAFE_USER_SELECT)
    .from(usersTable)
    .where(eq(usersTable.id, requestedId));
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(body.data)
    .where(eq(usersTable.id, params.data.id))
    .returning(SAFE_USER_SELECT);
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.status(204).send();
});

export default router;
