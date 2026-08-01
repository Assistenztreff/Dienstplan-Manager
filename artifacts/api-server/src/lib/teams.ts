import { db } from "@workspace/db";
import { teamsTable, teamMembersTable, shiftModelsTable } from "@workspace/db";
import { eq, asc, and, inArray } from "drizzle-orm";
import type { Request } from "express";

/** Intern – vermeidet zirkulären Import zu middleware/auth.ts. */
function isAdminLikeRole(role: string): boolean {
  return role === "admin" || role === "superadmin";
}

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
 *
 * `overrideAllowedIds` überschreibt die DB-Abfrage — wird von Teamleitern
 * genutzt, um den Lesezugriff auf ihre Teamleiter-Teams zu beschränken.
 */
export async function resolveReadTeamScope(
  userId: number,
  requestedTeamId?: number,
  overrideAllowedIds?: number[],
): Promise<number[] | null> {
  const allowed = overrideAllowedIds ?? await getAllowedTeamIds(userId);
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
 *
 * `overrideAllowedIds` überschreibt die DB-Abfrage — Teamleiter übergeben
 * hier ihre Teamleiter-Teams, damit der Schreibzugriff auf diese beschränkt
 * bleibt und nicht auf alle Mitglied-Teams ausgeweitet wird.
 */
export async function resolveWriteTeamId(
  userId: number,
  requestedTeamId?: number,
  overrideAllowedIds?: number[],
): Promise<WriteTeamResult> {
  const allowed = overrideAllowedIds ?? await getAllowedTeamIds(userId);
  if (requestedTeamId != null) {
    if (!allowed.includes(requestedTeamId)) return { ok: false, reason: "forbidden" };
    return { ok: true, teamId: requestedTeamId };
  }
  // Kein requestedTeamId: erstes erlaubtes Team (oder Standard via resolveTeamId).
  if (overrideAllowedIds != null) {
    const def = overrideAllowedIds[0] ?? null;
    if (def == null) return { ok: false, reason: "none" };
    return { ok: true, teamId: def };
  }
  const def = await resolveTeamId(userId);
  if (def == null) return { ok: false, reason: "none" };
  return { ok: true, teamId: def };
}

/**
 * Prüft, ob ein Ziel-Nutzer Mitglied eines der erlaubten Teams des Anfragers ist.
 * Basis für IDOR-Schutz auf /users/:id (GET/PATCH/DELETE): ein Admin darf fremde
 * Nutzer nur sehen/ändern/löschen, wenn sie in einem seiner Teams sind.
 */
export async function isUserInAllowedTeams(
  requesterId: number,
  targetUserId: number,
): Promise<boolean> {
  const allowed = await getAllowedTeamIds(requesterId);
  if (allowed.length === 0) return false;
  const [row] = await db
    .select({ userId: teamMembersTable.userId })
    .from(teamMembersTable)
    .where(
      and(eq(teamMembersTable.userId, targetUserId), inArray(teamMembersTable.teamId, allowed)),
    )
    .limit(1);
  return !!row;
}

/**
 * Prüft, ob ein Nutzer Mitglied eines bestimmten Teams ist.
 * Basis für die Validierung von Schreiboperationen: ein Datensatz (Schicht,
 * Vertrag, Zeiteintrag) darf nur einem Nutzer zugeordnet werden, der tatsächlich
 * Mitglied des Ziel-Teams ist — sonst ließe sich ein fremder userId in ein
 * erlaubtes Team verknüpfen und dessen PII über gescopte Listen auslesen.
 */
export async function isUserMemberOfTeam(userId: number, teamId: number): Promise<boolean> {
  const [row] = await db
    .select({ userId: teamMembersTable.userId })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.teamId, teamId)))
    .limit(1);
  return !!row;
}

/**
 * Prüft, ob ein Schichtmodell zu einem bestimmten Team gehört.
 * Basis für die Validierung von Schicht-Schreiboperationen: eine Schicht darf nur
 * mit einem Schichtmodell desselben Teams verknüpft werden — sonst flössen die
 * Wertungs-/Zuschlagsparameter eines fremden Teams in die Auswertung ein.
 * Liefert false, wenn das Modell nicht existiert oder zu einem anderen Team gehört.
 */
export async function isShiftModelInTeam(
  shiftModelId: number,
  teamId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shiftModelsTable.id })
    .from(shiftModelsTable)
    .where(and(eq(shiftModelsTable.id, shiftModelId), eq(shiftModelsTable.teamId, teamId)))
    .limit(1);
  return !!row;
}

/**
 * Teams, in denen der Nutzer explizit als Teamleiter eingetragen ist.
 * Basis für den team-beschränkten Admin-Zugriff.
 */
export async function getTeamleiterTeamIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.isTeamleiter, true)));
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

/**
 * Gibt zurück, ob der Nutzer in mindestens einem Team als Teamleiter
 * eingetragen ist. Wird für Middleware-Checks und isTeamleiter im AuthUser
 * verwendet.
 */
export async function hasAnyTeamleiterRole(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.isTeamleiter, true)))
    .limit(1);
  return !!row;
}

/**
 * Gibt zurück, ob der Nutzer im angegebenen Team als Teamleiter eingetragen
 * ist. Basis für IDOR-Schutz auf Team-Operationen durch Teamleiter.
 */
export async function isTeamleiterOfTeam(userId: number, teamId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembersTable.id })
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.userId, userId),
        eq(teamMembersTable.teamId, teamId),
        eq(teamMembersTable.isTeamleiter, true),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Gibt zurück, ob der Nutzer im angegebenen Team can_view_payroll=true hat.
 * Wird für die serverseitige Filterung sensibler Personalfelder verwendet.
 */
export async function canViewPayrollInTeam(userId: number, teamId: number): Promise<boolean> {
  const [row] = await db
    .select({ canViewPayroll: teamMembersTable.canViewPayroll })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.teamId, teamId)))
    .limit(1);
  return row?.canViewPayroll ?? false;
}

/**
 * Gibt die effektiven Admin-Level-Teams zurück:
 * - Für Admin-artige Rollen: alle erlaubten Teams (besessene + Mitgliedschaften).
 * - Für Teamleiter (nicht Admin-Rolle): nur Teams mit is_teamleiter=true.
 * Basis aller Datenzugriffe auf Admin-Ebene.
 */
export async function getEffectiveAdminTeamIds(
  userId: number,
  role: string,
): Promise<number[]> {
  if (isAdminLikeRole(role)) {
    return getAllowedTeamIds(userId);
  }
  return getTeamleiterTeamIds(userId);
}

/**
 * Prüft, ob ein Team dem Aufrufer gehört ODER der Aufrufer dort Teamleiter ist.
 * Basis für IDOR-Schutz auf Team-Mitgliederverwaltung durch Teamleiter.
 */
export async function hasTeamAdminAccess(
  teamId: number,
  userId: number,
  role: string,
): Promise<boolean> {
  if (isAdminLikeRole(role)) {
    // Admin: muss Eigentümer sein
    const [team] = await db
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .where(and(eq(teamsTable.id, teamId), eq(teamsTable.ownerId, userId)));
    return !!team;
  }
  // Teamleiter: muss is_teamleiter=true haben
  return isTeamleiterOfTeam(userId, teamId);
}

/** Liest den optionalen ?teamId Query-Parameter (mit NaN-Schutz). */
export function parseTeamIdParam(req: Request): number | undefined {
  const raw = req.query["teamId"];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
