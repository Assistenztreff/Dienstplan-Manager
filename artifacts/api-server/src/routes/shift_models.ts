import { Router } from "express";
import { db } from "@workspace/db";
import { shiftModelsTable } from "@workspace/db";
import { eq, asc, and, inArray, count } from "drizzle-orm";
import {
  ListShiftModelsQueryParams,
  CreateShiftModelBody,
  UpdateShiftModelParams,
  UpdateShiftModelBody,
  DeleteShiftModelParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  parseTeamIdParam,
} from "../lib/teams";
import { userWithinLimit, getUserLimit } from "../lib/plan";

const router = Router();

router.get("/shift-models", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftModelsQueryParams.safeParse({
    activeOnly: req.query.activeOnly === "true" ? true : req.query.activeOnly === "false" ? false : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const conditions = [inArray(shiftModelsTable.teamId, teamScope)];
  if (query.data.activeOnly) conditions.push(eq(shiftModelsTable.isActive, true));

  const rows = await db
    .select()
    .from(shiftModelsTable)
    .where(and(...conditions))
    .orderBy(asc(shiftModelsTable.sortOrder), asc(shiftModelsTable.id));
  res.json(rows);
});

router.post("/shift-models", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateShiftModelBody.safeParse(req.body);
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

  // Free-Limit (maxShiftModels) autoritativ durchsetzen: nur das Anlegen eines
  // WEITEREN Modells ueber dem Limit sperren (Bestandsschutz — vorhandene
  // Modelle bleiben unberuehrt und editierbar/loeschbar). Gezaehlt wird pro
  // Ziel-Team, da Schichtmodelle team-scoped sind.
  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(shiftModelsTable)
    .where(eq(shiftModelsTable.teamId, write.teamId));
  if (!(await userWithinLimit(req.session.userId!, "maxShiftModels", existingCount))) {
    const max = await getUserLimit(req.session.userId!, "maxShiftModels");
    res.status(403).json({
      error: `Im Free-Tarif sind maximal ${max} Dienste moeglich. Bitte upgrade auf Premium fuer unbegrenzte Dienste.`,
      code: "plan_limit_reached",
      limit: "maxShiftModels",
    });
    return;
  }

  const [model] = await db.insert(shiftModelsTable).values({ ...body.data, teamId: write.teamId }).returning();
  res.status(201).json(model);
});

router.patch("/shift-models/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateShiftModelParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateShiftModelBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [updated] = await db
    .update(shiftModelsTable)
    .set(body.data)
    .where(and(eq(shiftModelsTable.id, params.data.id), inArray(shiftModelsTable.teamId, allowedTeams)))
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
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const [deleted] = await db
    .delete(shiftModelsTable)
    .where(and(eq(shiftModelsTable.id, params.data.id), inArray(shiftModelsTable.teamId, allowedTeams)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

export default router;
