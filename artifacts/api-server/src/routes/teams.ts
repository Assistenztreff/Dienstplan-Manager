import { Router } from "express";
import { db } from "@workspace/db";
import {
  teamsTable,
  teamMembersTable,
  shiftsTable,
  contractsTable,
  shiftModelsTable,
  timeTrackingTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import {
  CreateTeamBody,
  UpdateTeamParams,
  UpdateTeamBody,
  DeleteTeamParams,
} from "@workspace/api-zod";
import { requireDienstleister } from "../middleware/auth";

const router = Router();

const TEAM_SELECT = {
  id: teamsTable.id,
  name: teamsTable.name,
  ownerId: teamsTable.ownerId,
  createdAt: teamsTable.createdAt,
};

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
  const [team] = await db
    .insert(teamsTable)
    .values({ name: body.data.name, ownerId: req.session.userId! })
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

export default router;
