import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, teamMembersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  ListUsersQueryParams,
  CreateUserBody,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
  GetUserParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  getAllowedTeamIds,
  parseTeamIdParam,
  resolveWriteTeamId,
  isUserInAllowedTeams,
} from "../lib/teams";

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
  // Strikte Datentrennung: Nutzer werden auf die erlaubten Teams des Anfragers
  // gescoped. Mit teamId = genau dieses (erlaubte) Team; ohne teamId = Vereinigung
  // aller erlaubten Teams (eigene + Mitgliedschaften). Mehrfach-Mitgliedschaften
  // werden dedupliziert.
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const teamId = parseTeamIdParam(req);
  if (teamId != null && !allowedTeams.includes(teamId)) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  const teamScope = teamId != null ? [teamId] : allowedTeams;
  const joined =
    teamScope.length > 0
      ? await db
          .select(SAFE_USER_SELECT)
          .from(usersTable)
          .innerJoin(teamMembersTable, eq(teamMembersTable.userId, usersTable.id))
          .where(inArray(teamMembersTable.teamId, teamScope))
      : [];
  // Mehrfach-Mitgliedschaften (Nutzer in mehreren erlaubten Teams) deduplizieren.
  const byId = new Map<number, (typeof joined)[number]>();
  for (const u of joined) byId.set(u.id, u);
  let rows = Array.from(byId.values());
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
  // teamId steuert nur die Team-Mitgliedschaft, ist keine Spalte auf users.
  const { teamId: requestedTeamId, ...userValues } = body.data;
  const target = await resolveWriteTeamId(req.session.userId!, requestedTeamId ?? undefined);
  if (!target.ok && target.reason === "forbidden") {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values(userValues)
    .returning(SAFE_USER_SELECT);
  // Neuen Nutzer dem Ziel-Team zuordnen, damit er in gescopten Listen erscheint.
  // Wenn der Ersteller (noch) kein Team hat (reason "none"), bleibt der Nutzer
  // ohne Mitgliedschaft – er taucht dann erst nach Team-Zuordnung in Listen auf.
  if (target.ok && user) {
    await db
      .insert(teamMembersTable)
      .values({ teamId: target.teamId, userId: user.id })
      .onConflictDoNothing();
  }
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
  // IDOR-Schutz: ein Admin darf fremde Nutzer nur lesen, wenn sie Mitglied
  // eines seiner erlaubten Teams sind. Eigener Datensatz immer erlaubt.
  if (req.session.userId !== requestedId) {
    const allowed = await isUserInAllowedTeams(req.session.userId!, requestedId);
    if (!allowed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
  // IDOR-Schutz: fremde Nutzer nur ändern, wenn sie in einem erlaubten Team sind.
  if (req.session.userId !== params.data.id) {
    const allowed = await isUserInAllowedTeams(req.session.userId!, params.data.id);
    if (!allowed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
  // IDOR-Schutz: fremde Nutzer nur löschen, wenn sie in einem erlaubten Team sind.
  if (req.session.userId !== params.data.id) {
    const allowed = await isUserInAllowedTeams(req.session.userId!, params.data.id);
    if (!allowed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.status(204).send();
});

export default router;
