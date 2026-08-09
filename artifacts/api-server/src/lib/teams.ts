import { db } from "@workspace/db";
import { teamsTable, teamMembersTable, shiftModelsTable, usersTable } from "@workspace/db";
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
 * Prüft, ob ein Nutzer ein Teamkoordinator ist. Koordinatoren sind reine
 * Verwaltungspersonen und nie Personal: Personal-Datensätze (Verträge,
 * Dienste, Ist-Zeiten) und generische Mitglieder-Operationen müssen sie
 * ablehnen — ihre Mitgliedschaften verwaltet ausschließlich der
 * Zuweisungsbereich (PUT /koordinatoren/:id/teams).
 */
export async function isKoordinatorUser(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row?.role === "koordinator";
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

// ---------------------------------------------------------------------------
// Gestufte Team-Rechte (Assistenznehmer beim Dienstleister)
//
// Eine Mitgliedschaft kann NEBEN is_teamleiter eine ausdrücklich vergebene
// Stufe tragen (team_members.access_level). Die Stufen sind aufsteigend:
//   keine  → gar keine Team-Rechte (Standard, normale Assistenzkraft)
//   basis  → team-weite Leseübersicht
//   stufe1 → zusätzlich planen (Dienste, Abwesenheiten, Assistenzkräfte, PDF)
//   stufe2 → zusätzlich Team-Verwaltung und Zeiterfassung
//
// Ein Unternehmens-Teamleiter (is_teamleiter=true) hat in SEINEM Team immer
// mindestens stufe2. Lohndaten hängen NIE an einer Stufe.
// ---------------------------------------------------------------------------

export const TEAM_ACCESS_LEVELS = ["keine", "basis", "stufe1", "stufe2"] as const;
export type TeamAccessLevel = (typeof TEAM_ACCESS_LEVELS)[number];

/** Kleinste Stufe, die für eine Fähigkeit nötig ist. */
export type TeamCapability = "read" | "plan" | "manage";

const LEVEL_RANK: Record<TeamAccessLevel, number> = {
  keine: 0,
  basis: 1,
  stufe1: 2,
  stufe2: 3,
};

const CAPABILITY_MIN_RANK: Record<TeamCapability, number> = {
  read: LEVEL_RANK.basis,
  plan: LEVEL_RANK.stufe1,
  manage: LEVEL_RANK.stufe2,
};

/** Effektive Stufe einer Mitgliedschaft: Teamleiter zählt immer als stufe2. */
function effectiveRank(row: { isTeamleiter: boolean; accessLevel: string }): number {
  if (row.isTeamleiter) return LEVEL_RANK.stufe2;
  return LEVEL_RANK[(row.accessLevel as TeamAccessLevel) ?? "keine"] ?? 0;
}

/**
 * Alle Teams, in denen der Nutzer mindestens die geforderte Fähigkeit besitzt —
 * über is_teamleiter ODER über eine ausdrücklich vergebene Stufe. Wird bei
 * JEDEM Request frisch gelesen, damit ein Rechteentzug sofort greift.
 */
export async function getTeamIdsWithCapability(
  userId: number,
  capability: TeamCapability,
): Promise<number[]> {
  const rows = await db
    .select({
      teamId: teamMembersTable.teamId,
      isTeamleiter: teamMembersTable.isTeamleiter,
      accessLevel: teamMembersTable.accessLevel,
    })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId));
  const min = CAPABILITY_MIN_RANK[capability];
  return rows
    .filter((r) => effectiveRank(r) >= min)
    .map((r) => r.teamId)
    .sort((a, b) => a - b);
}

/** Prüft eine Fähigkeit für genau ein Team (IDOR-Schutz auf Einzelressourcen). */
export async function hasTeamCapability(
  userId: number,
  teamId: number,
  capability: TeamCapability,
): Promise<boolean> {
  const [row] = await db
    .select({
      isTeamleiter: teamMembersTable.isTeamleiter,
      accessLevel: teamMembersTable.accessLevel,
    })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.teamId, teamId)))
    .limit(1);
  if (!row) return false;
  return effectiveRank(row) >= CAPABILITY_MIN_RANK[capability];
}

/** Höchste Stufe über alle Mitgliedschaften — nur für die Frontend-Sichtbarkeit. */
export async function getHighestTeamAccessLevel(userId: number): Promise<TeamAccessLevel> {
  const rows = await db
    .select({
      isTeamleiter: teamMembersTable.isTeamleiter,
      accessLevel: teamMembersTable.accessLevel,
    })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId));
  let best = 0;
  for (const r of rows) best = Math.max(best, effectiveRank(r));
  return (TEAM_ACCESS_LEVELS.find((l) => LEVEL_RANK[l] === best) ?? "keine") as TeamAccessLevel;
}

/**
 * Gibt zurück, ob der Nutzer im angegebenen Team Lohn-/SV-Daten sehen darf.
 *
 * Lohndaten sind AUSSCHLIESSLICH Unternehmens-Teamleitern eines
 * Dienstleister-Kontos vorbehalten. Weder eine gestufte Freischaltung
 * (Assistenznehmer) noch ein Teamleiter in einem Privat-Konto bekommt sie.
 * Die drei Bedingungen werden hier zusammen geprüft, damit kein Aufrufer sie
 * einzeln vergessen kann.
 */
export async function canViewPayrollInTeam(userId: number, teamId: number): Promise<boolean> {
  const [row] = await db
    .select({
      canViewPayroll: teamMembersTable.canViewPayroll,
      isTeamleiter: teamMembersTable.isTeamleiter,
      ownerAccountType: usersTable.accountType,
    })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .innerJoin(usersTable, eq(usersTable.id, teamsTable.ownerId))
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.teamId, teamId)))
    .limit(1);
  if (!row) return false;
  return row.canViewPayroll && row.isTeamleiter && row.ownerAccountType === "dienstleister";
}

/**
 * Prüft, ob eine Lohndaten-Freigabe für eine Mitgliedschaft überhaupt zulässig
 * ist: nur in einem Dienstleister-Konto und nur für einen Teamleiter.
 * Wird beim Setzen der Flags serverseitig durchgesetzt (403 statt stiller
 * Speicherung).
 */
export async function mayGrantPayrollAccess(
  teamId: number,
  targetUserId: number,
  nextIsTeamleiter: boolean,
): Promise<boolean> {
  if (!nextIsTeamleiter) return false;
  const [row] = await db
    .select({ ownerAccountType: usersTable.accountType })
    .from(teamsTable)
    .innerJoin(usersTable, eq(usersTable.id, teamsTable.ownerId))
    .where(eq(teamsTable.id, teamId))
    .limit(1);
  if (row?.ownerAccountType !== "dienstleister") return false;
  // Nur echtes Personal des Dienstleisters — der Ziel-Nutzer muss Mitglied sein.
  const [membership] = await db
    .select({ id: teamMembersTable.id })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUserId)))
    .limit(1);
  return !!membership;
}

/**
 * Teams mit team-weitem LESEZUGRIFF für Nicht-Konto-Admins (Basis-Stufe und
 * höher, inkl. Teamleiter). Basis für gescopte Listen (Dienstplan, Dashboard).
 */
export async function getTeamReadTeamIds(userId: number): Promise<number[]> {
  return getTeamIdsWithCapability(userId, "read");
}

/**
 * Gibt die effektiven Admin-Level-Teams zurück:
 * - Für Admin-artige Rollen: alle erlaubten Teams (besessene + Mitgliedschaften).
 * - Sonst: Teams mit Planungsrecht (Teamleiter oder Stufe 1/2).
 * Basis aller SCHREIB-Zugriffe auf Dienste, Verträge und Assistenzkräfte.
 */
export async function getEffectiveAdminTeamIds(
  userId: number,
  role: string,
): Promise<number[]> {
  if (isAdminLikeRole(role)) {
    return getAllowedTeamIds(userId);
  }
  return getTeamIdsWithCapability(userId, "plan");
}

/**
 * Wie getEffectiveAdminTeamIds, aber für Verwaltungs-Zugriffe (Zeiterfassung,
 * Team-Verwaltung): Nicht-Admins brauchen dafür Stufe 2 bzw. Teamleiter.
 */
export async function getEffectiveManageTeamIds(
  userId: number,
  role: string,
): Promise<number[]> {
  if (isAdminLikeRole(role)) {
    return getAllowedTeamIds(userId);
  }
  return getTeamIdsWithCapability(userId, "manage");
}

/**
 * Prüft, ob ein Team dem Aufrufer gehört ODER der Aufrufer dort Verwaltungs-
 * rechte hat (Teamleiter oder Stufe 2).
 * Basis für IDOR-Schutz auf Team-Mitgliederverwaltung.
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
  return hasTeamCapability(userId, teamId, "manage");
}

/** Liest den optionalen ?teamId Query-Parameter (mit NaN-Schutz). */
export function parseTeamIdParam(req: Request): number | undefined {
  const raw = req.query["teamId"];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
