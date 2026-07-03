import { Router } from "express";
import { db } from "@workspace/db";
import {
  teamsTable,
  teamMembersTable,
  usersTable,
  shiftsTable,
  contractsTable,
  shiftModelsTable,
  timeTrackingTable,
} from "@workspace/db";
import { eq, and, asc, sql, count } from "drizzle-orm";
import type { Response } from "express";
import {
  CreateTeamBody,
  UpdateTeamParams,
  UpdateTeamBody,
  DeleteTeamParams,
  AddTeamMemberBody,
} from "@workspace/api-zod";
import { requireDienstleister } from "../middleware/auth";
import { userWithinLimit, getUserLimit } from "../lib/plan";

const router = Router();

const TEAM_SELECT = {
  id: teamsTable.id,
  name: teamsTable.name,
  ownerId: teamsTable.ownerId,
  createdAt: teamsTable.createdAt,
};

/**
 * Prüft, ob das Team dem Aufrufer gehört. Antwortet bei Misserfolg mit 404 und
 * gibt false zurück; bei Erfolg true. So verhindern wir IDOR auf fremde Teams.
 */
async function assertTeamOwnership(
  teamId: number,
  ownerId: number,
  res: Response,
): Promise<boolean> {
  const [team] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(and(eq(teamsTable.id, teamId), eq(teamsTable.ownerId, ownerId)));
  if (!team) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

/**
 * Liefert Mitglieder als TeamMember-DTOs inkl. teamCount (Anzahl Teams DIESES
 * Dienstleisters, in denen der Nutzer Mitglied ist), damit Mehrfachzuweisung im
 * Frontend erkennbar ist. `where` filtert die einbezogenen Mitgliedschaften.
 */
function selectMembers(
  ownerId: number,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
) {
  const teamCount = sql<number>`(
    SELECT count(*)::int FROM team_members tm2
    JOIN teams t2 ON t2.id = tm2.team_id
    WHERE tm2.user_id = ${usersTable.id} AND t2.owner_id = ${ownerId}
  )`;
  return db
    .select({
      id: teamMembersTable.id,
      teamId: teamMembersTable.teamId,
      userId: teamMembersTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      teamCount,
      createdAt: teamMembersTable.createdAt,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
    .where(where)
    .orderBy(asc(usersTable.name));
}

router.get("/teams", requireDienstleister, async (req, res): Promise<void> => {
  const rows = await db
    .select(TEAM_SELECT)
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, req.session.userId!))
    .orderBy(asc(teamsTable.id));
  res.json(rows);
});

router.post("/teams", requireDienstleister, async (req, res): Promise<void> => {
  const body = CreateTeamBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Free-Limit (maxTeams) autoritativ durchsetzen: nur das Anlegen eines
  // WEITEREN Teams ueber dem Limit sperren (Bestandsschutz — vorhandene Teams
  // bleiben unberuehrt). Gezaehlt werden die Teams im Besitz des Nutzers; die
  // Registrierung legt bereits ein Standard-Team an, daher startet ein Free-
  // Dienstleister bei 1 und kann ohne Premium kein zweites Team eroeffnen.
  const ownerId = req.session.userId!;
  const [{ value: ownedTeams }] = await db
    .select({ value: count() })
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, ownerId));
  if (!(await userWithinLimit(ownerId, "maxTeams", ownedTeams))) {
    const max = await getUserLimit(ownerId, "maxTeams");
    res.status(403).json({
      error: `Im Free-Tarif ist maximal ${max} Team moeglich. Bitte upgrade auf Premium fuer mehrere Teams.`,
      code: "plan_limit_reached",
      limit: "maxTeams",
    });
    return;
  }

  const [team] = await db
    .insert(teamsTable)
    .values({ name: body.data.name, ownerId })
    .returning(TEAM_SELECT);
  res.status(201).json(team);
});

router.patch("/teams/:id", requireDienstleister, async (req, res): Promise<void> => {
  const params = UpdateTeamParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateTeamBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [team] = await db
    .update(teamsTable)
    .set({ name: body.data.name })
    .where(and(eq(teamsTable.id, params.data.id), eq(teamsTable.ownerId, req.session.userId!)))
    .returning(TEAM_SELECT);
  if (!team) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(team);
});

router.delete("/teams/:id", requireDienstleister, async (req, res): Promise<void> => {
  const params = DeleteTeamParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [team] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(and(eq(teamsTable.id, params.data.id), eq(teamsTable.ownerId, req.session.userId!)));
  if (!team) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Löschen blockieren, solange noch Daten oder Mitglieder am Team hängen, damit
  // keine Dienstpläne/Verträge verwaist zurückbleiben (FK ohne Cascade).
  const teamId = params.data.id;
  for (const table of [shiftsTable, contractsTable, shiftModelsTable, timeTrackingTable, teamMembersTable]) {
    const [used] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.teamId, teamId))
      .limit(1);
    if (used) {
      res.status(409).json({
        error: "Team kann nicht gelöscht werden, solange noch Daten oder Mitglieder zugeordnet sind.",
      });
      return;
    }
  }

  await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
  res.status(204).send();
});

router.get("/teams/:id/members", requireDienstleister, async (req, res): Promise<void> => {
  const teamId = Number(req.params["id"]);
  if (!Number.isInteger(teamId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const ownerId = req.session.userId!;
  if (!(await assertTeamOwnership(teamId, ownerId, res))) return;

  const rows = await selectMembers(ownerId, eq(teamMembersTable.teamId, teamId));
  res.json(rows);
});

router.post("/teams/:id/members", requireDienstleister, async (req, res): Promise<void> => {
  const teamId = Number(req.params["id"]);
  const body = AddTeamMemberBody.safeParse(req.body);
  if (!Number.isInteger(teamId) || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const ownerId = req.session.userId!;
  if (!(await assertTeamOwnership(teamId, ownerId, res))) return;

  // Nur Nutzer annehmen, die bereits Mitglied EINES Teams DIESES Eigentümers
  // sind (Mehrfachzuweisung innerhalb des eigenen Kontos). Ohne diese Prüfung
  // ließe sich jeder existierende Nutzer-ID auf der Plattform (auch aus
  // fremden Mandanten) per Enumeration in das eigene Team annektieren und
  // dessen Daten über die Team-Scoping-Helfer auslesen/ändern.
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .innerJoin(teamMembersTable, eq(teamMembersTable.userId, usersTable.id))
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .where(and(eq(usersTable.id, body.data.userId), eq(teamsTable.ownerId, ownerId)));
  if (!user) {
    res.status(404).json({ error: "Benutzer nicht gefunden" });
    return;
  }

  const [existing] = await db
    .select({ id: teamMembersTable.id })
    .from(teamMembersTable)
    .where(
      and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, body.data.userId)),
    );
  if (existing) {
    res.status(409).json({ error: "Benutzer ist bereits Mitglied dieses Teams." });
    return;
  }

  const [inserted] = await db
    .insert(teamMembersTable)
    .values({ teamId, userId: body.data.userId })
    .returning({ id: teamMembersTable.id });

  const [member] = await selectMembers(ownerId, eq(teamMembersTable.id, inserted!.id));
  res.status(201).json(member);
});

router.delete(
  "/teams/:id/members/:userId",
  requireDienstleister,
  async (req, res): Promise<void> => {
    const teamId = Number(req.params["id"]);
    const userId = Number(req.params["userId"]);
    if (!Number.isInteger(teamId) || !Number.isInteger(userId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const ownerId = req.session.userId!;
    if (!(await assertTeamOwnership(teamId, ownerId, res))) return;

    const deleted = await db
      .delete(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)))
      .returning({ id: teamMembersTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  },
);

export default router;
