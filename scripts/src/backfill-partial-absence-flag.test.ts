// ---------------------------------------------------------------------------
// Schneller, DB-freier Beweis der Transaktions-Atomaritaet zwischen Marker-
// Claim und UPDATE (4. Code-Review-Fund): schlaegt das UPDATE fehl, NACHDEM
// der Marker in derselben Transaktion eingefuegt wurde, muss ein ROLLBACK
// den Marker mit zuruecknehmen — sonst gilt die Migration fuer jeden
// kuenftigen Deploy faelschlich als erledigt und wird nie nachgeholt.
//
// Simuliert eine echte Postgres-Transaktion in-memory (ROLLBACK macht den
// INSERT innerhalb derselben BEGIN/COMMIT-Klammer ungeschehen), ohne eine
// echte DB zu brauchen — ergaenzt (nicht ersetzt) den echten DB-Test in
// backfill-partial-absence-flag.bestands-db.db.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type pg from "pg";
import { backfillPartialAbsenceFlag } from "./backfill-partial-absence-flag";

type MockClient = Pick<pg.Client, "query">;

function makeMockClient(opts: { failUpdateOnce: boolean }): {
  client: MockClient;
  calls: string[];
} {
  const calls: string[] = [];
  // Simuliert den einzigen relevanten DB-Zustand: ob der Marker committed
  // ist (persistent) oder nur innerhalb einer offenen Transaktion existiert
  // (wird bei ROLLBACK wieder verworfen).
  let markerCommitted = false;
  let markerPendingInTx = false;
  let updateAttempts = 0;

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const s = sql.trim();
    calls.push(s.split("\n")[0]!.trim());

    if (s === "BEGIN") {
      markerPendingInTx = false;
      return { rowCount: 0, rows: [] } as unknown as pg.QueryResult;
    }
    if (s === "COMMIT") {
      if (markerPendingInTx) markerCommitted = true;
      markerPendingInTx = false;
      return { rowCount: 0, rows: [] } as unknown as pg.QueryResult;
    }
    if (s === "ROLLBACK") {
      // Ein Rollback nimmt jeden innerhalb dieser Transaktion vorgenommenen
      // Schreibzugriff zurueck — inklusive des Marker-INSERTs.
      markerPendingInTx = false;
      return { rowCount: 0, rows: [] } as unknown as pg.QueryResult;
    }
    if (s.includes("information_schema.tables") && s.includes("'shifts'")) {
      return { rowCount: 1, rows: [{}] } as unknown as pg.QueryResult;
    }
    if (s.includes("information_schema.columns")) {
      return { rowCount: 1, rows: [{}] } as unknown as pg.QueryResult;
    }
    if (s.includes("information_schema.tables") && s.includes("'data_migrations'")) {
      return { rowCount: 1, rows: [{}] } as unknown as pg.QueryResult;
    }
    if (s.includes("INSERT INTO data_migrations")) {
      if (markerCommitted) {
        // ON CONFLICT DO NOTHING: Marker existiert bereits dauerhaft.
        return { rowCount: 0, rows: [] } as unknown as pg.QueryResult;
      }
      markerPendingInTx = true;
      return {
        rowCount: 1,
        rows: [{ name: "backfill-partial-absence-flag" }],
      } as unknown as pg.QueryResult;
    }
    if (s.includes("UPDATE shifts")) {
      updateAttempts += 1;
      if (opts.failUpdateOnce && updateAttempts === 1) {
        throw new Error("simulierter Verbindungsabbruch waehrend UPDATE");
      }
      return { rowCount: 3, rows: [] } as unknown as pg.QueryResult;
    }
    throw new Error(`Unerwartete Query im Mock: ${s}`);
  });

  return { client: { query } as unknown as MockClient, calls };
}

describe("backfillPartialAbsenceFlag — Atomaritaet Marker-Claim + UPDATE", () => {
  it("nimmt den Marker per ROLLBACK zurueck, wenn das UPDATE fehlschlaegt, UND der naechste Aufruf holt die Migration erfolgreich nach", async () => {
    const { client, calls } = makeMockClient({ failUpdateOnce: true });

    // 1. Lauf: UPDATE schlaegt fehl -> muss werfen, Marker darf NICHT
    //    dauerhaft committet bleiben.
    await expect(backfillPartialAbsenceFlag(client)).rejects.toThrow(
      "simulierter Verbindungsabbruch",
    );
    expect(calls).toContain("BEGIN");
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");

    // 2. Lauf (naechster Deploy/Retry): derselbe In-Memory-Zustand (Marker
    //    NICHT committed) -> die Migration muss erneut versucht werden und
    //    diesmal durchlaufen, statt sich als "bereits erledigt" zu ueberspringen.
    const rowsUpdated = await backfillPartialAbsenceFlag(client);
    expect(rowsUpdated).toBe(3);
  });

  it("laesst einen bereits erfolgreich committeten Marker als dauerhaftes No-op stehen", async () => {
    const { client } = makeMockClient({ failUpdateOnce: false });

    const first = await backfillPartialAbsenceFlag(client);
    expect(first).toBe(3);

    // Dritter Aufruf (weiterer Deploy): Marker ist jetzt dauerhaft committet
    // -> garantiertes No-op, kein erneutes UPDATE.
    const second = await backfillPartialAbsenceFlag(client);
    expect(second).toBe(0);
  });
});
