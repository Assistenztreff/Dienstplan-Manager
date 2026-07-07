import { Router } from "express";
import { db } from "@workspace/db";
import { brandingSettingsTable, teamBrandingSettingsTable, teamsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateBrandingSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { resolveTeamId, parseTeamIdParam } from "../lib/teams";
import type { Request, Response } from "express";

const router = Router();

/**
 * Branding-Einstellungen sind PRO KONTO (Team-Eigentümer) gespeichert. Zeile
 * wird beim ersten Zugriff lazy mit Defaults (kein Logo) angelegt.
 */
async function ensureAccountSettings(ownerId: number) {
  await db
    .insert(brandingSettingsTable)
    .values({ ownerId })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(brandingSettingsTable)
    .where(eq(brandingSettingsTable.ownerId, ownerId));
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

/**
 * Team-Overrides darf nur der EIGENTÜMER des Teams verwalten — Mitgliedschaft
 * (z.B. ein fremder Admin, der via /teams/:id/members angehängt wurde) reicht
 * nicht, sonst könnte ein fremdes Konto das Team-Logo eines anderen Kontos
 * überschreiben oder lesen. Analog zu allowance_settings.
 */
async function assertOwnTeam(req: Request, res: Response, teamId: number): Promise<boolean> {
  const [team] = await db
    .select({ id: teamsTable.id, ownerId: teamsTable.ownerId })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  if (!team || team.ownerId !== req.session.userId) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return false;
  }
  return true;
}

/**
 * Bestimmt das Konto, dessen Branding ohne teamId angezeigt wird:
 * - Eigentümer eines Teams (Admin) -> die eigene Konto-Zeile.
 * - Mitglied ohne eigenes Team (Assistent) -> die Konto-Zeile des
 *   Arbeitgebers (Team-Eigentümer), damit Exporte das Logo des Arbeitgebers
 *   zeigen, ohne dass der Assistent es lesen/ändern könnte (Schreiben bleibt
 *   requireAdmin).
 * - Kein Team -> null (kein Konto-Kontext, kein eigenes Logo möglich).
 */
async function resolveAccountOwnerId(userId: number): Promise<number | null> {
  const teamId = await resolveTeamId(userId);
  if (teamId == null) return null;
  const [team] = await db
    .select({ ownerId: teamsTable.ownerId })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  return team?.ownerId ?? null;
}

router.get("/branding-settings", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseTeamIdParam(req);
  if (teamId != null) {
    if (!(await assertOwnTeam(req, res, teamId))) return;
    const settings = await ensureTeamSettings(teamId);
    res.json(settings);
    return;
  }
  const ownerId = await resolveAccountOwnerId(req.session.userId!);
  if (ownerId == null) {
    res.json({ ownerId: null, logoPath: null, updatedAt: null });
    return;
  }
  const settings = await ensureAccountSettings(ownerId);
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
    if (!(await assertOwnTeam(req, res, teamId))) return;
    await ensureTeamSettings(teamId);
    const [updated] = await db
      .update(teamBrandingSettingsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(teamBrandingSettingsTable.teamId, teamId))
      .returning();
    res.json(updated);
    return;
  }

  // Ohne teamId schreibt der Aufrufer IMMER nur die eigene Konto-Zeile — nie
  // die eines anderen Kontos, damit Tenants sich nicht gegenseitig das
  // Fallback-Logo überschreiben können.
  const ownerId = req.session.userId!;
  await ensureAccountSettings(ownerId);
  const [updated] = await db
    .update(brandingSettingsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(brandingSettingsTable.ownerId, ownerId))
    .returning();
  res.json(updated);
});

export default router;
