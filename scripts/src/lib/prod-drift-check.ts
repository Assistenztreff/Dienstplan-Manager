import {
  normalizeDatabaseUrl,
  applyRotatedDbPassword,
} from "@workspace/db/database-url";
import { hostAndDb, urlsCollide } from "./migrate-prod-guards.js";

/**
 * Kernlogik des Publish-Schema-Guards (check-prod-schema-drift), als reine,
 * injizierbare Funktion — damit die Sicherheitsnetze per Vitest eingefroren
 * sind (fehlende URL, Kollision, Drift, Verbindungsfehler, Bypass,
 * rotiertes Passwort).
 */

export interface DriftCheckEnv {
  PROD_DATABASE_URL?: string;
  DATABASE_URL?: string;
  APP_DATABASE_URL?: string;
  SCALEWAY_DB_PASSWORD?: string;
  SKIP_PROD_SCHEMA_CHECK?: string;
}

export type DriftCheckResult =
  | { kind: "skipped" }
  | { kind: "missing-url" }
  | { kind: "unparseable" }
  | { kind: "collision"; envName: "DATABASE_URL" | "APP_DATABASE_URL" }
  | { kind: "connect-failed"; message: string }
  | { kind: "drift"; target: string; problems: string[] }
  | { kind: "ok"; target: string };

export async function runProdDriftCheck(
  env: DriftCheckEnv,
  findMissing: (databaseUrl: string) => Promise<string[]>,
): Promise<DriftCheckResult> {
  if (env.SKIP_PROD_SCHEMA_CHECK === "1") return { kind: "skipped" };

  const raw = env.PROD_DATABASE_URL;
  if (!raw) return { kind: "missing-url" };

  // Gleiche effektive Credentials wie die laufende App (resolveDatabaseUrl):
  // Normalisierung + rotiertes Passwort (SCALEWAY_DB_PASSWORD hat Vorrang
  // vor dem in der URL eingebetteten Passwort).
  const prodUrl = applyRotatedDbPassword(
    normalizeDatabaseUrl(raw),
    env.SCALEWAY_DB_PASSWORD,
  );

  let target: string;
  try {
    target = hostAndDb(prodUrl);
  } catch {
    return { kind: "unparseable" };
  }

  // Sicherheitsnetz: Wenn PROD_DATABASE_URL versehentlich auf die Dev-/
  // Staging-DB zeigt, wuerde der Check die falsche DB pruefen und still
  // gruen sein. Das ist ein Konfigurationsfehler → sichtbar abbrechen.
  for (const envName of ["DATABASE_URL", "APP_DATABASE_URL"] as const) {
    const envRaw = env[envName];
    if (!envRaw) continue;
    if (urlsCollide(prodUrl, normalizeDatabaseUrl(envRaw))) {
      return { kind: "collision", envName };
    }
  }

  let problems: string[];
  try {
    problems = await findMissing(prodUrl);
  } catch (err) {
    return { kind: "connect-failed", message: String(err) };
  }

  if (problems.length > 0) return { kind: "drift", target, problems };
  return { kind: "ok", target };
}
