import { Router } from "express";
import { db } from "@workspace/db";
import { shiftModelsTable, shiftsTable } from "@workspace/db";
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
  // Nur AKTIVE Modelle zaehlen gegen das Free-Limit. Soft-geloeschte Modelle
  // (isActive=false, s. DELETE-Route) belegen keinen Slot mehr, damit das
  // Loeschen eines historisch verknuepften Dienstes wieder Platz schafft.
  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(shiftModelsTable)
    .where(and(eq(shiftModelsTable.teamId, write.teamId), eq(shiftModelsTable.isActive, true)));
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

  // Existenz + Team-Scope pruefen (404 bei fremdem/unbekanntem Modell, kein IDOR).
  const [existing] = await db
    .select({ id: shiftModelsTable.id })
    .from(shiftModelsTable)
    .where(and(eq(shiftModelsTable.id, params.data.id), inArray(shiftModelsTable.teamId, allowedTeams)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Ist das Modell noch mit (auch vergangenen) Schichten verknuepft, wuerde ein
  // Hard-Delete deren Bezug kappen (shifts.shift_model_id ON DELETE SET NULL) und
  // damit die historische Lohnauswertung verfaelschen (Verguetungs-/Bewertungs-
  // daten stammen aus dem Modell). Deshalb Soft-Delete: isActive=false. Das
  // Modell verschwindet aus den Auswahllisten, bleibt aber fuer die Historie
  // erhalten. Nur ein nie genutztes Modell wird echt geloescht (kein Datenmuell).
  const [{ value: linkedShifts }] = await db
    .select({ value: count() })
    .from(shiftsTable)
    .where(eq(shiftsTable.shiftModelId, params.data.id));

  if (linkedShifts > 0) {
    await db
      .update(shiftModelsTable)
      .set({ isActive: false })
      .where(and(eq(shiftModelsTable.id, params.data.id), inArray(shiftModelsTable.teamId, allowedTeams)));
  } else {
    await db
      .delete(shiftModelsTable)
      .where(and(eq(shiftModelsTable.id, params.data.id), inArray(shiftModelsTable.teamId, allowedTeams)));
  }
  res.status(204).send();
});

export default router;
