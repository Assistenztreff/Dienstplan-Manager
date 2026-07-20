import { db } from "@workspace/db";
import {
  allowanceSettingsTable,
  teamsTable,
  teamMembersTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Response } from "express";

// ---------------------------------------------------------------------------
// Konto-weiter Schalter „Zeiterfassung aktivieren" (Standard AUS).
//
// Maßgeblich ist AUSSCHLIESSLICH die KONTO-Zeile der allowance_settings des
// Team-Eigentümers (team_id NULL) — bewusst KEIN Team-Override und KEINE
// resolveAllowanceOps-Fallback-Kette, damit ein Override-Datensatz (der das
// Feld nur mit DB-Default false trägt) den Konto-Schalter nicht aushebeln
// kann. Ohne Konto-Zeile gilt der sichere Default: AUS.
//
// Bei AUS blocken die Zeiterfassungs-SCHREIBROUTEN mit 403
// (code `time_tracking_disabled`); GET-Routen und Bestandsdaten bleiben
// unangetastet.
// ---------------------------------------------------------------------------

/** Fehlercode, auf den das Frontend reagieren kann. */
export const TIME_TRACKING_DISABLED_CODE = "time_tracking_disabled";

/** Einheitliche 403-Antwort für Schreibzugriffe bei deaktivierter Zeiterfassung. */
export function respondTimeTrackingDisabled(res: Response): void {
  res.status(403).json({
    error:
      "Die Zeiterfassung ist für dieses Konto deaktiviert. Sie kann in den Einstellungen unter „Zuschläge & Abrechnung“ aktiviert werden.",
    code: TIME_TRACKING_DISABLED_CODE,
  });
}

/**
 * Liest den Zeiterfassungs-Schalter aus der KONTO-Zeile eines Admin-Kontos
 * (team_id NULL). Keine Zeile = Default AUS.
 */
export async function isTimeTrackingEnabledForOwner(
  ownerId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: allowanceSettingsTable.timeTrackingEnabled })
    .from(allowanceSettingsTable)
    .where(
      and(
        eq(allowanceSettingsTable.ownerId, ownerId),
        isNull(allowanceSettingsTable.teamId),
      ),
    )
    .limit(1);
  return row?.enabled ?? false;
}

/** Zeiterfassung eines Teams = Konto-Schalter des TEAM-EIGENTÜMERS. */
export async function isTimeTrackingEnabledForTeam(
  teamId: number,
): Promise<boolean> {
  const [team] = await db
    .select({ ownerId: teamsTable.ownerId })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId))
    .limit(1);
  if (!team) return false;
  return isTimeTrackingEnabledForOwner(team.ownerId);
}

/**
 * Teilmenge der übergebenen Teams, deren Eigentümer die Zeiterfassung
 * aktiviert hat (für die Sammelbestätigung über mehrere Teams).
 */
export async function getTimeTrackingEnabledTeamIds(
  teamIds: number[],
): Promise<number[]> {
  if (teamIds.length === 0) return [];
  const rows = await db
    .select({
      teamId: teamsTable.id,
      enabled: allowanceSettingsTable.timeTrackingEnabled,
    })
    .from(teamsTable)
    .leftJoin(
      allowanceSettingsTable,
      and(
        eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
        isNull(allowanceSettingsTable.teamId),
      ),
    )
    .where(inArray(teamsTable.id, teamIds));
  return rows.filter((r) => r.enabled === true).map((r) => r.teamId);
}

/**
 * Effektiver Zustand für den ANGEMELDETEN Nutzer (GET /time-tracking-status):
 * Admin-artige Rollen = eigene Konto-Einstellung; Assistenzkräfte = Zustand
 * des ARBEITGEBERS (aktiv, sobald der Eigentümer EINES ihrer Teams die
 * Zeiterfassung eingeschaltet hat — analog userHasFeatureViaTeamOwner).
 */
export async function isTimeTrackingEnabledForUser(
  userId: number,
): Promise<boolean> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return false;
  if (user.role !== "assistant") {
    return isTimeTrackingEnabledForOwner(userId);
  }
  const owners = await db
    .select({ enabled: allowanceSettingsTable.timeTrackingEnabled })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamMembersTable.teamId, teamsTable.id))
    .leftJoin(
      allowanceSettingsTable,
      and(
        eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
        isNull(allowanceSettingsTable.teamId),
      ),
    )
    .where(eq(teamMembersTable.userId, userId));
  return owners.some((o) => o.enabled === true);
}
