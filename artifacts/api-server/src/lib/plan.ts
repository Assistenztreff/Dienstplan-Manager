import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
