/**
 * Lauf-uebergreifender E2E-Lock via Postgres-Advisory-Lock.
 *
 * Problem: Parallel arbeitende Task-Umgebungen teilen sich dieselbe externe
 * Staging-Datenbank und damit auch die abgeleitete `_test`-DB. Der lokale
 * PID-Lockfile (node_modules/.cache/dienstplan-e2e/run.lock) schuetzt nur
 * innerhalb EINER Umgebung — fremde Umgebungen sehen ihn nicht. Deren
 * Pre-Flight-Checks (verify-account-separation etc.) und Spec-Teardowns
 * seeden/loeschen Konten in derselben `_test`-DB und kippen so laufende
 * fremde Laeufe.
 *
 * Loesung: Ein Session-Advisory-Lock auf dem GETEILTEN Postgres-Server.
 * Advisory-Locks leben im Shared Memory des Server-Clusters (Datenbank-
 * uebergreifend) — zwei Sessions, die denselben Schluessel anfordern,
 * kollidieren also auch dann, wenn sie aus voellig getrennten Umgebungen
 * kommen. Der Lock wird beim Config-Load erworben und bis zum Prozessende
 * gehalten (Session-Ende gibt ihn automatisch frei — auch nach SIGKILL,
 * sobald der Server den Verbindungsabriss bemerkt). Kein Aufraeum-Zustand,
 * keine haengenden Lockdateien.
 *
 * Der Schluessel wird deterministisch aus dem Namen der `_test`-DB abgeleitet:
 * Laeufe gegen verschiedene Test-DBs (z. B. lokale Neon-DB vs. Staging)
 * blockieren sich nicht gegenseitig.
 */

import { createHash } from "node:crypto";
import pg from "pg";

export interface CrossRunLockHandle {
  /** Gibt den Lock explizit frei (Best effort; Session-Ende reicht auch). */
  release: () => Promise<void>;
}

/** Stabiler signed-64-bit-Schluessel aus dem Test-DB-Namen. */
export function crossRunLockKey(testDbName: string): bigint {
  const digest = createHash("sha256")
    .update(`dienstplan-e2e-cross-run-lock:${testDbName}`)
    .digest();
  // Erste 8 Bytes als signed BigInt64 (Postgres-Advisory-Locks sind bigint).
  return digest.readBigInt64BE(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Erwirbt den Lauf-uebergreifenden E2E-Lock auf dem Server hinter
 * `baseDatabaseUrl` (Dev-DB-URL — die `_test`-DB muss dafuer noch nicht
 * existieren; der Advisory-Lock-Schluesselraum ist cluster-weit).
 *
 * Wartet per Polling (`pg_try_advisory_lock`) bis der Lock frei ist, mit
 * regelmaessiger Fortschrittsmeldung. Nach `timeoutMs` wird abgebrochen —
 * lieber ein klarer Fehler als ein ewig haengender Lauf.
 *
 * Die zurueckgegebene Verbindung bleibt offen (Socket ist ge-unref-t, haelt
 * den Prozess also nicht am Leben): Session-Ende = Lock-Freigabe.
 */
export async function acquireCrossRunLock(
  baseDatabaseUrl: string,
  testDbName: string,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<CrossRunLockHandle> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const log = options.log ?? ((m: string) => console.log(m));

  const key = crossRunLockKey(testDbName);
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  await client.connect();

  let acquired = false;
  try {
    const deadline = Date.now() + timeoutMs;
    let waitingSince: number | null = null;
    for (;;) {
      const res = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [key.toString()],
      );
      if (res.rows[0]?.locked) {
        acquired = true;
        break;
      }
      if (waitingSince === null) {
        waitingSince = Date.now();
        log(
          `[e2e] Geteilte Test-DB "${testDbName}" ist durch einen fremden E2E-Lauf belegt — warte auf den Lauf-uebergreifenden Lock (max. ${Math.round(timeoutMs / 60_000)} min)...`,
        );
      } else if ((Date.now() - waitingSince) % 60_000 < pollIntervalMs) {
        log(
          `[e2e] Warte weiter auf den Lauf-uebergreifenden E2E-Lock (${Math.round((Date.now() - waitingSince) / 1000)}s)...`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Lauf-uebergreifender E2E-Lock fuer "${testDbName}" nach ${Math.round(timeoutMs / 60_000)} min nicht frei geworden — ` +
            "ein fremder Lauf haelt ihn ungewoehnlich lange. Spaeter erneut versuchen; " +
            "haengt der fremde Lauf, gibt der Server den Lock frei, sobald dessen Verbindung endet.",
        );
      }
      await sleep(pollIntervalMs);
    }
  } finally {
    if (!acquired) {
      await client.end().catch(() => {});
    }
  }

  // Socket unref: Die offene Verbindung darf den Prozess am Ende des Laufs
  // nicht am Leben halten. Der Lock lebt trotzdem bis zum Prozessende.
  type StreamCarrier = { connection?: { stream?: { unref?: () => void } } };
  (client as unknown as StreamCarrier).connection?.stream?.unref?.();

  log(`[e2e] Lauf-uebergreifender E2E-Lock fuer "${testDbName}" erworben.`);

  return {
    release: async () => {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [key.toString()]);
      } catch {
        /* Session-Ende gibt den Lock ohnehin frei */
      }
      await client.end().catch(() => {});
    },
  };
}
