/**
 * Single source of truth fuer die Test-Marker, unter denen E2E-/Seed-Zeilen in
 * `platform_errors` landen. Diese Konstanten binden die drei Stellen aneinander,
 * die sonst leicht auseinanderlaufen:
 *   - die Dev-Boom-Route (`artifacts/api-server/src/routes/health.ts`),
 *   - das Retention-Seed-Skript (`scripts/src/seed-platform-errors.ts`),
 *   - der Test-DB-Cleanup (`scripts/src/cleanup-test-platform-errors.ts`).
 *
 * Aendert jemand einen Marker hier, ziehen alle Referenzen mit — der Cleanup
 * kann nicht mehr stillschweigend „nichts mehr" loeschen, weil Route/Seed und
 * Cleanup nie wieder getrennt driften koennen.
 */

/**
 * Routen-Pfad der Dev-only „Boom"-Route (unter `/api` gemountet), die absichtlich
 * einen unbehandelten Fehler wirft. Wird von `health.ts` direkt als Routen-Pfad
 * verwendet, damit der abgeleitete Fehler-Kontext unten garantiert passt.
 */
export const DEV_BOOM_ROUTE_PATH = "/dev/boom" as const;

/**
 * Kontext-String, unter dem der zentrale Error-Handler den Dev-Boom-Fehler in
 * `platform_errors` ablegt: `${METHOD} ${originalUrl-ohne-Query}`. Der Boom ist
 * ein GET unter `/api` + Routen-Pfad, daher hier aus `DEV_BOOM_ROUTE_PATH`
 * abgeleitet (aendert sich der Pfad, aendert sich dieser Kontext automatisch).
 */
export const DEV_BOOM_ERROR_CONTEXT = `GET /api${DEV_BOOM_ROUTE_PATH}` as const;

/**
 * Kontext-Marker fuer die kuenstlichen Retention-Seed-Zeilen
 * (`scripts/src/seed-platform-errors.ts`).
 */
export const RETENTION_SEED_CONTEXT = "e2e/retention-seed" as const;

/**
 * Alle Kontexte, unter denen E2E-/Seed-Zeilen in `platform_errors` auftauchen.
 * Der Test-DB-Cleanup loescht AUSSCHLIESSLICH Zeilen mit diesen Kontexten.
 * Neue Test-Kontexte NUR hier ergaenzen, nie anderswo hartcodieren.
 */
export const TEST_ERROR_CONTEXTS = [
  DEV_BOOM_ERROR_CONTEXT,
  RETENTION_SEED_CONTEXT,
] as const;

export {
  TEAM_BOUND_TABLES,
  deleteAccountTrees,
  type AccountTreeDbClient,
  type DeleteAccountTreesResult,
} from "./account-tree.js";
