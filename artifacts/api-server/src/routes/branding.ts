import { Router } from "express";
import { db } from "@workspace/db";
import { brandingSettingsTable, teamBrandingSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateBrandingSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getAllowedTeamIds, parseTeamIdParam } from "../lib/teams";

const router = Router();

const SETTINGS_ID = 1;

async function ensureSettings() {
  await db
    .insert(brandingSettingsTable)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(brandingSettingsTable)
    .where(eq(brandingSettingsTable.id, SETTINGS_ID));
  return row;
}

async function ensureTeamSettings(teamId: number) {
  await db
    .insert(teamBrandingSettingsTable)
    .values({ teamId })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(teamBrandingSettingsTable)
    .where(eq(teamBrandingSettingsTable.teamId, teamId));
  return row;
}

router.get("/branding-settings", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseTeamIdParam(req);
  if (teamId != null) {
    const allowed = await getAllowedTeamIds(req.session.userId!);
    if (!allowed.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    const settings = await ensureTeamSettings(teamId);
    res.json(settings);
    return;
  }
  const settings = await ensureSettings();
  res.json(settings);
});

router.put("/branding-settings", requireAdmin, async (req, res): Promise<void> => {
  const body = UpdateBrandingSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { teamId, ...data } = body.data;

  if (teamId != null) {
    const allowed = await getAllowedTeamIds(req.session.userId!);
    if (!allowed.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    await ensureTeamSettings(teamId);
    const [updated] = await db
      .update(teamBrandingSettingsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(teamBrandingSettingsTable.teamId, teamId))
      .returning();
    res.json(updated);
    return;
  }

  await ensureSettings();
  const [updated] = await db
    .update(brandingSettingsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(brandingSettingsTable.id, SETTINGS_ID))
    .returning();
  res.json(updated);
});

export default router;
