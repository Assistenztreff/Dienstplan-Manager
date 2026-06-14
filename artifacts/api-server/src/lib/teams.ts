import { db } from "@workspace/db";
import { teamsTable, teamMembersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import type { Request } from "express";

/**
 * Liefert das Standard-Team-Kontext eines Nutzers für neu erstellte Datensätze.
 * Bevorzugt ein vom Nutzer besessenes Team (Admin), sonst die erste
 * Mitgliedschaft. In Stufe 1 existiert pro Account genau ein Team.
 */
export async function resolveTeamId(userId: number): Promise<number | null> {
  const [owned] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, userId))
    .orderBy(asc(teamsTable.id))
    .limit(1);
  if (owned) return owned.id;

  const [member] = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId))
    .orderBy(asc(teamMembersTable.teamId))
    .limit(1);
  return member?.id ?? null;
}

/**
 * Alle Team-IDs, auf die ein Nutzer zugreifen darf: Teams, die er besitzt
 * (Dienstleister/Admin) vereinigt mit Teams, in denen er Mitglied ist
 * (Assistenten, ggf. mehrfach zugewiesen). Basis jeder Datentrennung.
 */
export async function getAllowedTeamIds(userId: number): Promise<number[]> {
  const owned = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, userId));
  const memberships = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId));
  const ids = new Set<number>();
  for (const o of owned) ids.add(o.id);
  for (const m of memberships) ids.add(m.id);
  return [...ids].sort((a, b) => a - b);
}

/**
 * Bestimmt die Team-IDs, auf die ein Lesezugriff eingeschränkt wird.
 * - requestedTeamId gesetzt & erlaubt → genau dieses Team (Team-Wechsler).
 * - requestedTeamId gesetzt & NICHT erlaubt → null (fremdes Team, 403).
 * - requestedTeamId leer → alle erlaubten Teams.
 * Leeres Array bedeutet: erlaubt, aber kein Team → keine Daten.
 */
export async function resolveReadTeamScope(
  userId: number,
  requestedTeamId?: number,
): Promise<number[] | null> {
  const allowed = await getAllowedTeamIds(userId);
  if (requestedTeamId != null) {
    return allowed.includes(requestedTeamId) ? [requestedTeamId] : null;
  }
  return allowed;
}

export type WriteTeamResult =
  | { ok: true; teamId: number }
  | { ok: false; reason: "forbidden" | "none" };

/**
 * Bestimmt das Ziel-Team für einen Schreibzugriff.
 * - requestedTeamId gesetzt: muss erlaubt sein, sonst "forbidden".
 * - sonst: Standard-Team via resolveTeamId; fehlt es → "none".
 */
export async function resolveWriteTeamId(
  userId: number,
  requestedTeamId?: number,
): Promise<WriteTeamResult> {
  if (requestedTeamId != null) {
    const allowed = await getAllowedTeamIds(userId);
    if (!allowed.includes(requestedTeamId)) return { ok: false, reason: "forbidden" };
    return { ok: true, teamId: requestedTeamId };
  }
  const def = await resolveTeamId(userId);
  if (def == null) return { ok: false, reason: "none" };
  return { ok: true, teamId: def };
}

/** Liest den optionalen ?teamId Query-Parameter (mit NaN-Schutz). */
export function parseTeamIdParam(req: Request): number | undefined {
  const raw = req.query["teamId"];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
