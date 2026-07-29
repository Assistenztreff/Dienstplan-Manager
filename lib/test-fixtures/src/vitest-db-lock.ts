/**
 * Cross-Run-Lock fuer die Vitest-DB-Suiten (test:db).
 *
 * Die DB-gebundenen Vitest-Suiten (api-server platform_errors-Retention,
 * scripts migrate-prod-Frisch-DB) laufen gegen denselben geteilten
 * Postgres-Server wie die E2E-Laeufe anderer Task-Umgebungen. Ohne Schutz
 * kippen z. B. exakte Zeilenmengen-Assertions, wenn eine fremde Umgebung
 * parallel dieselbe `_test`-DB seedet/loescht (bekanntes Muster, siehe
 * .agents/memory/shared-staging-test-db-race.md).
 *
 * Diese Datei liefert den Baustein fuer ein Vitest-`globalSetup`: Sie
 * erwirbt DENSELBEN Advisory-Lock wie die E2E-Suite (Schluessel =
 * `_test`-DB-Name, cluster-weit sichtbar) vor dem ersten DB-Zugriff und
 * gibt ihn ueber die zurueckgegebene Teardown-Funktion am Suite-Ende frei.
 * Ein parallel laufender fremder Lauf laesst die Suite also warten statt
 * scheitern.
 *
 * Skip via `E2E_SKIP_CROSS_RUN_LOCK=1` (gleiche Semantik wie in der
 * Playwright-Config: nur fuer Laeufe gegen eine garantiert private DB).
 */

import {
  normalizeDatabaseUrl,
  resolveDatabaseUrl,
} from "@workspace/db/database-url";
import { acquireCrossRunLock } from "./cross-run-lock";
import { deriveTestDbTarget } from "./test-db-name";

/**
 * Erwirbt den Lauf-uebergreifenden Lock fuer die `_test`-DB des aktuellen
 * Servers. Rueckgabe: Teardown-Funktion (fuer Vitest-globalSetup direkt
 * zurueckgeben). Bei gesetztem Skip-Env ein No-op.
 */
export async function acquireVitestDbLock(): Promise<() => Promise<void>> {
  if (process.env.E2E_SKIP_CROSS_RUN_LOCK) {
    return async () => {};
  }

  const base = resolveDatabaseUrl();
  if (!base) {
    // Die Suiten selbst melden fehlende DATABASE_URL mit eigener, klarer
    // Fehlermeldung — der Lock haelt sich hier raus.
    return async () => {};
  }

  const normalized = normalizeDatabaseUrl(base);
  const target = deriveTestDbTarget(normalized);

  // Private Wegwerf-DB dieser Umgebung (Task #633): kein fremder Lauf kann
  // sie treffen, der cluster-weite Lock ist unnoetig — nicht serialisieren.
  if (target.isPrivate) {
    return async () => {};
  }

  const handle = await acquireCrossRunLock(normalized, target.name, {
    // Grosszuegiger als das E2E-Default (20 min): In der Merge-Validierung
    // laufen test:db-Suiten VOR den E2E-Suiten und muessen auch eine laengere
    // Kette fremder Laeufe aussitzen koennen, statt das Gate rot zu machen.
    timeoutMs: 45 * 60_000,
    log: (m) => console.log(m.replace("[e2e]", "[test:db]")),
  });
  return () => handle.release();
}
