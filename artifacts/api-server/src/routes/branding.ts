import { Router } from "express";
import { db } from "@workspace/db";
import { brandingSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateBrandingSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";

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

router.get("/branding-settings", requireAuth, async (_req, res): Promise<void> => {
  const settings = await ensureSettings();
  res.json(settings);
});

router.put("/branding-settings", requireAdmin, async (req, res): Promise<void> => {
  const body = UpdateBrandingSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await ensureSettings();
  const [updated] = await db
    .update(brandingSettingsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(brandingSettingsTable.id, SETTINGS_ID))
    .returning();
  res.json(updated);
});

export default router;
