// ---------------------------------------------------------------------------
// DB-gestuetzte Tests fuer die Enumerations-Bremse der Registrierung.
// ---------------------------------------------------------------------------
// Der Sliding-Window-Zaehler liegt seit Task #600 in der gemeinsamen DB
// (register_attempts), damit die Bremse auch mit mehreren Autoscale-Instanzen
// plattformweit greift. Semantik unveraendert: Sliding Window pro IP,
// ENV-konfigurierbar, MAX=0 = aus.
//
// Laeuft gegen eine EIGENE, winzige Wegwerf-Datenbank (`<dbname>_rl_test`),
// NICHT gegen die geteilte `<dbname>_test`: die wird von parallelen
// Task-Umgebungen regelmaessig neu aufgebaut (Drop + Recreate), was hier
// mitten im Lauf Zeilen/Tabellen verschwinden liess. Der Limiter braucht nur
// die eine Tabelle register_attempts — die provisioniert der Test selbst
// (idempotent), ganz ohne setup-test-db.
//
// WICHTIG: @workspace/db und ./register-rate-limit werden DYNAMISCH
// importiert, NACHDEM DATABASE_URL auf die Test-DB umgebogen wurde — der
// DB-Pool wird beim Modul-Load konfiguriert. APP_DATABASE_URL MIT umbiegen:
// resolveDatabaseUrl bevorzugt sie (Staging-Override), sonst traefe der Pool
// die Basis-DB. Vitest isoliert Testdateien voneinander, die uebrigen
// (DB-freien) Tests bleiben unberuehrt.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";

// Pro Lauf EINDEUTIGE Wegwerf-DB: selbst zwei gleichzeitige Laeufe dieses
// Tests (z. B. lokal + Merge-Validierung) duerfen sich nicht die Zaehler-
// Tabelle teilen, sonst loeschen sich ihre beforeEach-Aufraeumer gegenseitig
// die gezaehlten Zeilen weg (Over-Admission-Flakes).
function deriveRateLimitTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(normalizeDatabaseUrl(base));
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const name = `${current}_rl_${process.pid}_${Date.now().toString(36)}`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name };
}

type Db = typeof import("@workspace/db");
type RateLimit = typeof import("./register-rate-limit");

let dbmod: Db;
let mod: RateLimit;
let baseUrl: string;
let testDbName: string;

const ENV_KEYS = ["REGISTER_RATE_LIMIT_MAX", "REGISTER_RATE_LIMIT_WINDOW_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");

  baseUrl = base;
  const derived = deriveRateLimitTestDbUrl(base);
  const testUrl = derived.url;
  testDbName = derived.name;

  // Wegwerf-DB anlegen — von der Basis-Verbindung aus. Nebenbei verwaiste
  // Wegwerf-DBs frueherer (abgebrochener) Laeufe ohne aktive Verbindung
  // wegraeumen, damit sich auf dem Server nichts ansammelt.
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const orphans = await admin.query(
    `SELECT datname FROM pg_database
     WHERE datname ~ '_rl_[0-9]+_[a-z0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = pg_database.datname)`,
  );
  for (const row of orphans.rows as { datname: string }[]) {
    await admin.query(`DROP DATABASE IF EXISTS "${row.datname}"`).catch(() => {});
  }
  await admin.query(`CREATE DATABASE "${testDbName}"`);
  await admin.end();

  // Env VOR den dynamischen Imports umbiegen (Pool-Konfiguration beim Load).
  process.env.DATABASE_URL = testUrl;
  process.env.APP_DATABASE_URL = testUrl;

  dbmod = await import("@workspace/db");
  mod = await import("./register-rate-limit");

  // Einzige benoetigte Tabelle idempotent anlegen (Spiegel des
  // Drizzle-Schemas lib/db/src/schema/register_attempts.ts).
  await dbmod.db.execute(sql`
    CREATE TABLE IF NOT EXISTS register_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await dbmod.db.execute(sql`
    CREATE INDEX IF NOT EXISTS register_attempts_ip_attempted_at_idx
    ON register_attempts (ip, attempted_at)
  `);
}, 240_000);

afterAll(async () => {
  if (dbmod) {
    await dbmod.pool.end();
  }
  // Eigene Wegwerf-DB wieder wegraeumen.
  if (baseUrl && testDbName) {
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`).catch(() => {});
    await admin.end();
  }
});

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  await dbmod.db.delete(dbmod.registerAttemptsTable);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("checkRegisterRateLimit (DB-gestuetzt)", () => {
  it("erlaubt Versuche bis zum Limit und blockt danach mit Retry-After", { timeout: 60_000 }, async () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "3";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);

    expect((await mod.checkRegisterRateLimit("1.2.3.4", t0)).allowed).toBe(true);
    expect((await mod.checkRegisterRateLimit("1.2.3.4", t0 + 1000)).allowed).toBe(true);
    expect((await mod.checkRegisterRateLimit("1.2.3.4", t0 + 2000)).allowed).toBe(true);

    const blocked = await mod.checkRegisterRateLimit("1.2.3.4", t0 + 3000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      // Aeltester Slot (t0) wird bei t0+60000 frei => 57s Restzeit.
      expect(blocked.retryAfterSeconds).toBe(57);
    }
  });

  it("zaehlt IPs unabhaengig voneinander", { timeout: 60_000 }, async () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "1";
    const t0 = Date.UTC(2026, 0, 2, 8, 0, 0);
    expect((await mod.checkRegisterRateLimit("10.0.0.1", t0)).allowed).toBe(true);
    expect((await mod.checkRegisterRateLimit("10.0.0.1", t0 + 1)).allowed).toBe(false);
    expect((await mod.checkRegisterRateLimit("10.0.0.2", t0 + 2)).allowed).toBe(true);
  });

  it("gibt Slots nach Ablauf des Fensters wieder frei (Sliding Window)", { timeout: 60_000 }, async () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "2";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "10000";
    const t0 = Date.UTC(2026, 0, 3, 9, 0, 0);

    expect((await mod.checkRegisterRateLimit("ip", t0)).allowed).toBe(true);
    expect((await mod.checkRegisterRateLimit("ip", t0 + 5000)).allowed).toBe(true);
    expect((await mod.checkRegisterRateLimit("ip", t0 + 6000)).allowed).toBe(false);
    // t0-Slot faellt bei t0+10000 aus dem Fenster.
    expect((await mod.checkRegisterRateLimit("ip", t0 + 10_001)).allowed).toBe(true);
    // Jetzt sind t0+5000 und t0+10001 im Fenster => wieder voll.
    expect((await mod.checkRegisterRateLimit("ip", t0 + 10_002)).allowed).toBe(false);
  });

  it("MAX=0 schaltet den Limiter komplett ab (E2E-Test-Stack) — ohne DB-Zeilen", { timeout: 60_000 }, async () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "0";
    const t0 = Date.UTC(2026, 0, 4, 10, 0, 0);
    for (let i = 0; i < 50; i++) {
      expect((await mod.checkRegisterRateLimit("bulk", t0 + i)).allowed).toBe(true);
    }
    const rows = await dbmod.db.select().from(dbmod.registerAttemptsTable);
    expect(rows.length).toBe(0);
  });

  it("faellt bei unbrauchbaren ENV-Werten auf die Defaults zurueck (20/10min)", { timeout: 60_000 }, async () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "quatsch";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "-5";
    const t0 = Date.UTC(2026, 0, 5, 11, 0, 0);
    for (let i = 0; i < 20; i++) {
      expect((await mod.checkRegisterRateLimit("d", t0 + i * 1000)).allowed).toBe(true);
    }
    const blocked = await mod.checkRegisterRateLimit("d", t0 + 21_000);
    expect(blocked.allowed).toBe(false);
  });

  it("Zaehler ist prozessuebergreifend: vorbestehende DB-Zeilen zaehlen mit", { timeout: 60_000 }, async () => {
    // Simuliert eine ANDERE Instanz, die bereits Versuche eingetragen hat —
    // genau der Fall, den der In-Memory-Zaehler verpasst haette.
    process.env.REGISTER_RATE_LIMIT_MAX = "3";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = Date.UTC(2026, 0, 6, 12, 0, 0);

    await dbmod.db.insert(dbmod.registerAttemptsTable).values([
      { ip: "9.9.9.9", attemptedAt: new Date(t0) },
      { ip: "9.9.9.9", attemptedAt: new Date(t0 + 1000) },
    ]);

    expect((await mod.checkRegisterRateLimit("9.9.9.9", t0 + 2000)).allowed).toBe(true);
    expect((await mod.checkRegisterRateLimit("9.9.9.9", t0 + 3000)).allowed).toBe(false);
  });

  it("laesst unter PARALLELEN Versuchen strikt hoechstens MAX durch (Advisory-Lock)", { timeout: 60_000 }, async () => {
    // Genau die Luecke des naiven INSERT...SELECT WHERE count<max: unter
    // READ COMMITTED sehen parallele Transaktionen denselben Vorher-Count.
    // Der Pro-IP-Advisory-Lock muss das serialisieren — auch ueber mehrere
    // Pool-Verbindungen (= simulierte Instanzen) hinweg.
    process.env.REGISTER_RATE_LIMIT_MAX = "1";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = Date.UTC(2026, 0, 8, 14, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => mod.checkRegisterRateLimit("race", t0 + i)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(1);

    const rows = await dbmod.db.select().from(dbmod.registerAttemptsTable);
    expect(rows.length).toBe(1);

    // Dasselbe mit MAX=3 und frischer IP: exakt 3 kommen durch.
    process.env.REGISTER_RATE_LIMIT_MAX = "3";
    const results3 = await Promise.all(
      Array.from({ length: 12 }, (_, i) => mod.checkRegisterRateLimit("race3", t0 + i)),
    );
    expect(results3.filter((r) => r.allowed).length).toBe(3);
  });

  it("raeumt abgelaufene Zeilen (auch fremder IPs) beim Versuch mit auf", { timeout: 60_000 }, async () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "5";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "10000";
    const t0 = Date.UTC(2026, 0, 7, 13, 0, 0);

    await dbmod.db.insert(dbmod.registerAttemptsTable).values([
      { ip: "alt", attemptedAt: new Date(t0 - 60_000) },
      { ip: "alt2", attemptedAt: new Date(t0 - 30_000) },
    ]);

    expect((await mod.checkRegisterRateLimit("frisch", t0)).allowed).toBe(true);

    const rows = await dbmod.db.select().from(dbmod.registerAttemptsTable);
    expect(rows.map((r) => r.ip)).toEqual(["frisch"]);
  });
});
