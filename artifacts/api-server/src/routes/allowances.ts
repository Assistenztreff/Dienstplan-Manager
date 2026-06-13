import { Router } from "express";
import { db } from "@workspace/db";
import { allowanceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateAllowanceSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

const SETTINGS_ID = 1;

const DEFAULTS = {
  nightPercent: 25,
  nightStart: "23:00",
  nightEnd: "06:00",
  sundayPercent: 50,
  holidayPercent: 100,
};

async function ensureSettings() {
  await db
    .insert(allowanceSettingsTable)
    .values({ id: SETTINGS_ID, ...DEFAULTS })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(allowanceSettingsTable)
    .where(eq(allowanceSettingsTable.id, SETTINGS_ID));
  return row;
}

router.get("/allowance-settings", requireAuth, async (_req, res): Promise<void> => {
  const settings = await ensureSettings();
  res.json(settings);
});

router.put("/allowance-settings", requireAdmin, async (req, res): Promise<void> => {
  const body = UpdateAllowanceSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await ensureSettings();
  const [updated] = await db
    .update(allowanceSettingsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(allowanceSettingsTable.id, SETTINGS_ID))
    .returning();
  res.json(updated);
});

export default router;
