import { db } from "@workspace/db";
import { usersTable, teamsTable, teamMembersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import {
  hasAccess,
  isWithinLimit,
  getLimit,
  type Plan,
  type PlanFeature,
  type PlanLimit,
} from "@workspace/entitlements";

// ---------------------------------------------------------------------------
// Serverseitige (autoritative) Durchsetzung der Free/Premium-Entitlements.
// ---------------------------------------------------------------------------
// Der Client ist nicht vertrauenswuerdig: Die Frontend-Gates sperren nur die
// Sicht (Buttons, Hinweise). Hier wird DIESELBE Config aus @workspace/entitlements
// verbindlich durchgesetzt. Der Plan wird IMMER frisch aus der DB gelesen
// (nicht aus der Session), damit eine manuelle Premium-Freischaltung sofort
// wirkt (analog zu requireDienstleister).

/** Liest den Abo-Plan eines Nutzers frisch aus der DB. Default sicher "free". */
export async function getUserPlan(userId: number): Promise<Plan> {
  const [row] = await db
    .select({ plan: usersTable.plan })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row?.plan === "premium" ? "premium" : "free";
}

/** Prueft serverseitig, ob der Plan eines Nutzers ein Feature freischaltet. */
export async function userHasFeature(
  userId: number,
  feature: PlanFeature,
): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return hasAccess({ plan }, feature);
}

/**
 * Prueft serverseitig, ob bei `currentCount` vorhandenen Eintraegen noch ein
 * WEITERER unter dem Limit erlaubt ist (Bestandsschutz: begrenzt nur das
 * Anlegen von Neuem, filtert nie Bestehendes).
 */
export async function userWithinLimit(
  userId: number,
  limit: PlanLimit,
  currentCount: number,
): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return isWithinLimit({ plan }, limit, currentCount);
}

/**
 * Liefert den (frisch aus der DB gelesenen) numerischen Limit-Wert des Nutzers
 * (`null` = unbegrenzt). Fuer Limits, deren Grenze selbst gebraucht wird
 * (z.B. historyMonths: wie viele Monate Vorausplanung erlaubt sind).
 */
export async function getUserLimit(
  userId: number,
  limit: PlanLimit,
): Promise<number | null> {
  const plan = await getUserPlan(userId);
  return getLimit({ plan }, limit);
}

/**
 * Liefert die Teilmenge der uebergebenen Teams, deren EIGENTUEMER das
 * Premium-Feature "strictTimeTracking" NICHT hat (Free-Plan). In diesen Teams
 * gibt es keinen Freigabe-Workflow — Ist-Zeiten bleiben dauerhaft "offen".
 * Auswertungen (dashboard/summary) zaehlen dort deshalb auch offene Eintraege
 * als Ist-Stunden, sonst waeren erfasste Stunden fuer Free-Konten unsichtbar.
 * Massgeblich ist der Plan des Team-Eigentuemers (frisch aus der DB), analog
 * zu den uebrigen Limits. Premium-Teams bleiben strikt: nur bestaetigte
 * Stunden zaehlen.
 */
export async function getLenientTimeTrackingTeamIds(
  teamIds: number[],
): Promise<number[]> {
  if (teamIds.length === 0) return [];
  const rows = await db
    .select({ teamId: teamsTable.id, ownerPlan: usersTable.plan })
    .from(teamsTable)
    .leftJoin(usersTable, eq(teamsTable.ownerId, usersTable.id))
    .where(inArray(teamsTable.id, teamIds));
  return rows
    .filter((r) => {
      const plan: Plan = r.ownerPlan === "premium" ? "premium" : "free";
      return !hasAccess({ plan }, "strictTimeTracking");
    })
    .map((r) => r.teamId);
}

/**
 * Prueft ein Premium-Feature mit ARBEITGEBER-Fallback: Der eigene Plan des
 * Nutzers zaehlt zuerst; ist er "free" UND ist der Nutzer ein Assistent, wird
 * zusaetzlich der Plan der EIGENTUEMER seiner Teams geprueft (analog zu
 * strictTimeTracking, wo der Owner-Plan massgeblich ist). Hintergrund:
 * Assistenten-Konten sind praktisch immer "free" (nur Admin-Konten sind
 * zahlende Konten) — Features wie calendarSync sollen fuer Assistenten am
 * Premium des Arbeitgebers haengen, sonst waeren sie fuer Assistenten
 * faktisch nie nutzbar. Es genuegt EIN Premium-Arbeitgeber (bei mehreren
 * Teams). Fuer Admins bleibt ausschliesslich der eigene Plan massgeblich.
 */
export async function userHasFeatureViaTeamOwner(
  userId: number,
  feature: PlanFeature,
): Promise<boolean> {
  if (await userHasFeature(userId, feature)) return true;

  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (user?.role !== "assistant") return false;

  const owners = await db
    .select({ ownerPlan: usersTable.plan })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamMembersTable.teamId, teamsTable.id))
    .innerJoin(usersTable, eq(teamsTable.ownerId, usersTable.id))
    .where(eq(teamMembersTable.userId, userId));
  return owners.some((o) => {
    const plan: Plan = o.ownerPlan === "premium" ? "premium" : "free";
    return hasAccess({ plan }, feature);
  });
}

/**
 * Middleware: erlaubt die Route nur, wenn der Plan des angemeldeten Nutzers das
 * Premium-Feature freischaltet. Liefert 401 ohne Session, 403 ohne Berechtigung
 * (Code `plan_feature_required` fuer das Frontend).
 */
export function requirePlanFeature(feature: PlanFeature) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (!(await userHasFeature(req.session.userId, feature))) {
      res.status(403).json({
        error: "Diese Funktion ist im Premium-Tarif enthalten.",
        code: "plan_feature_required",
        feature,
      });
      return;
    }
    next();
  };
}

/**
 * Wie `requirePlanFeature`, aber mit Arbeitgeber-Fallback fuer Assistenten
 * (siehe `userHasFeatureViaTeamOwner`): Ein Assistent bekommt das Feature,
 * wenn der Eigentuemer eines seiner Teams Premium hat.
 */
export function requirePlanFeatureViaTeamOwner(feature: PlanFeature) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    if (!(await userHasFeatureViaTeamOwner(req.session.userId, feature))) {
      res.status(403).json({
        error: "Diese Funktion ist im Premium-Tarif enthalten.",
        code: "plan_feature_required",
        feature,
      });
      return;
    }
    next();
  };
}
