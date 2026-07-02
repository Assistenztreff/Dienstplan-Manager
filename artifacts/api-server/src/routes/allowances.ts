import { Router } from "express";
import { db } from "@workspace/db";
import { allowanceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateAllowanceSettingsBody } from "@workspace/api-zod";
import { requireAdmin } from "../middleware/auth";

const router = Router();

const DEFAULTS = {
  nightPercent: 25,
  nightStart: "23:00",
  nightEnd: "06:00",
  sundayPercent: 50,
  holidayPercent: 100,
};

// Zuschlags-Einstellungen sind PRO KONTO gespeichert (owner_id = Admin-Konto).
// Jeder Admin liest/ändert ausschließlich die eigene Zeile — die Einstellungen
// anderer Konten sind unerreichbar (Multi-Tenant-Trennung). Zeile wird beim
// ersten Zugriff lazy mit Defaults angelegt (neue Konten brauchen kein Seeding).
async function ensureSettings(ownerId: number) {
  await db
    .insert(allowanceSettingsTable)
    .values({ ownerId, ...DEFAULTS })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(allowanceSettingsTable)
    .where(eq(allowanceSettingsTable.ownerId, ownerId));
  return row;
}

router.get("/allowance-settings", requireAdmin, async (req, res): Promise<void> => {
  const settings = await ensureSettings(req.session.userId!);
  res.json(settings);
});

router.put("/allowance-settings", requireAdmin, async (req, res): Promise<void> => {
  const body = UpdateAllowanceSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const ownerId = req.session.userId!;
  await ensureSettings(ownerId);
  const [updated] = await db
    .update(allowanceSettingsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(allowanceSettingsTable.ownerId, ownerId))
    .returning();
  res.json(updated);
});

export default router;
