import type { NextFunction, Request, Response } from "express";
import { invalidateHoursBalanceCache } from "../lib/hours-balance-service";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RELEVANT_PATH_PREFIXES = [
  "/shifts",
  "/time-tracking",
  "/contracts",
  "/allowance-settings",
  "/users",
  "/teams",
  "/shift-models",
  "/koordinatoren",
] as const;
const RELEVANT_EXACT_REQUESTS = new Set([
  // Ändert den in Bilanzzeilen angezeigten Namen des angemeldeten Nutzers.
  "POST /auth/update-profile",
  // Dev-only: GET legt fehlende Test-Nutzer, Mitgliedschaften und Modelle an.
  "GET /auth/dev-users",
]);

export function canChangeHoursBalance(req: Request): boolean {
  if (RELEVANT_EXACT_REQUESTS.has(`${req.method} ${req.path}`)) return true;
  if (!MUTATING_METHODS.has(req.method)) return false;
  return RELEVANT_PATH_PREFIXES.some(
    (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
  );
}

/**
 * Verzögert ausschließlich erfolgreiche Antworten relevanter Mutationen, bis
 * die gemeinsame Cache-Generation hochgezählt wurde. Die eigentliche Route
 * hat ihre DB-Transaktion zu diesem Zeitpunkt bereits abgeschlossen.
 *
 * res.end statt res.json wird umschlossen, damit auch 204-Antworten von
 * DELETE-Routen erfasst werden. Fehlerantworten invalidieren bewusst nicht.
 */
export function invalidateHoursBalanceAfterSuccessfulWrite(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!canChangeHoursBalance(req)) {
    next();
    return;
  }

  const originalEnd = res.end;
  let invalidationStarted = false;

  res.end = function (this: Response, ...args: unknown[]) {
    const sendResponse = () =>
      Reflect.apply(originalEnd, this, args) as Response;

    if (
      !invalidationStarted &&
      res.statusCode >= 200 &&
      res.statusCode < 300
    ) {
      invalidationStarted = true;
      void invalidateHoursBalanceCache().then(sendResponse).catch(next);
      return res;
    }

    return sendResponse();
  } as typeof res.end;

  next();
}