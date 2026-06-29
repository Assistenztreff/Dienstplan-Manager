import { Router } from "express";
import { db } from "@workspace/db";
import { shiftTemplatesTable } from "@workspace/db";
import { eq, asc, and, inArray } from "drizzle-orm";
import {
  CreateShiftTemplateBody,
  UpdateShiftTemplateParams,
  UpdateShiftTemplateBody,
  DeleteShiftTemplateParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  parseTeamIdParam,
} from "../lib/teams";

const router = Router();

router.get("/shift-templates", requireAuth, async (req, res): Promise<void> => {
  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const rows = await db
    .select()
    .from(shiftTemplatesTable)
    .where(inArray(shiftTemplatesTable.teamId, teamScope))
    .orderBy(asc(shiftTemplatesTable.name), asc(shiftTemplatesTable.id));
  res.json(rows);
});

router.post("/shift-templates", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateShiftTemplateBody.safeParse(req.body);
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
  const { teamId: _ignored, ...values } = body.data;
  const [template] = await db
    .insert(shiftTemplatesTable)
    .values({ ...values, weekdays: values.weekdays ?? [], teamId: write.teamId })
    .returning();
  res.status(201).json(template);
});

router.patch("/shift-templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateShiftTemplateParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateShiftTemplateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [updated] = await db
    .update(shiftTemplatesTable)
    .set(body.data)
    .where(and(eq(shiftTemplatesTable.id, params.data.id), inArray(shiftTemplatesTable.teamId, allowedTeams)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/shift-templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteShiftTemplateParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [deleted] = await db
    .delete(shiftTemplatesTable)
    .where(and(eq(shiftTemplatesTable.id, params.data.id), inArray(shiftTemplatesTable.teamId, allowedTeams)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

export default router;
