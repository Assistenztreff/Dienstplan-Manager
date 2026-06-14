import { Router } from "express";
import { db } from "@workspace/db";
import { shiftModelsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  ListShiftModelsQueryParams,
  CreateShiftModelBody,
  UpdateShiftModelParams,
  UpdateShiftModelBody,
  DeleteShiftModelParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { resolveTeamId } from "../lib/teams";

const router = Router();

router.get("/shift-models", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftModelsQueryParams.safeParse({
    activeOnly: req.query.activeOnly === "true" ? true : req.query.activeOnly === "false" ? false : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const rows = await db
    .select()
    .from(shiftModelsTable)
    .where(query.data.activeOnly ? eq(shiftModelsTable.isActive, true) : undefined)
    .orderBy(asc(shiftModelsTable.sortOrder), asc(shiftModelsTable.id));
  res.json(rows);
});

router.post("/shift-models", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateShiftModelBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const teamId = await resolveTeamId(req.session.userId!);
  if (teamId == null) {
    res.status(400).json({ error: "Kein Team zugeordnet" });
    return;
  }
  const [model] = await db.insert(shiftModelsTable).values({ ...body.data, teamId }).returning();
  res.status(201).json(model);
});

router.patch("/shift-models/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateShiftModelParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateShiftModelBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [updated] = await db
    .update(shiftModelsTable)
    .set(body.data)
    .where(eq(shiftModelsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/shift-models/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteShiftModelParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(shiftModelsTable)
    .where(eq(shiftModelsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

export default router;
