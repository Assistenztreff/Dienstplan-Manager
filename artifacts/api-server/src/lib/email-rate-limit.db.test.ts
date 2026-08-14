// ---------------------------------------------------------------------------
// DB-gestuetzte Tests fuer das E-Mail-Rate-Limit (forgot-password / resend-verification).
// ---------------------------------------------------------------------------
// Der Sliding-Window-Zaehler liegt in der gemeinsamen DB (email_rate_limit_attempts),
// damit die Bremse auch unter Autoscale plattformweit greift.
//
// Laeuft gegen eine EIGENE Wegwerf-Datenbank (`<dbname>_el_<pid>_<ts>`),
// NICHT gegen die geteilte `_test`-DB. Der Limiter braucht nur die eine
// Tabelle email_rate_limit_attempts — die provisioniert der Test selbst
// (idempotent), ohne setup-test-db.
//
// WICHTIG: @workspace/db und ./email-rate-limit werden DYNAMISCH importiert,
// NACHDEM DATABASE_URL auf die Test-DB umgebogen wurde (Pool-Konfiguration
// beim Modul-Load). APP_DATABASE_URL muss ebenfalls umgebogen werden, da
// resolveDatabaseUrl sie bevorzugt (Staging-Override).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";

// Pro Lauf EINDEUTIGE Wegwerf-DB — vermeidet Konflikte bei Parallel-Laeufen.
function deriveEmailRateLimitTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(normalizeDatabaseUrl(base));
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const name = `${current}_el_${process.pid}_${Date.now().toString(36)}`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name };
}

type Db = typeof import("@workspace/db");
type RateLimit = typeof import("./email-rate-limit");

let dbmod: Db;
let mod: RateLimit;
let baseUrl: string;
let testDbName: string;

const ENV_KEYS = ["EMAIL_RATE_LIMIT_MAX", "EMAIL_RATE_LIMIT_WINDOW_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");

  baseUrl = base;
  const derived = deriveEmailRateLimitTestDbUrl(base);
  const testUrl = derived.url;
  testDbName = derived.name;

  // Wegwerf-DB anlegen; verwaiste frueherer Laeufe entsorgen.
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const orphans = await admin.query(
    `SELECT datname FROM pg_database
     WHERE datname ~ '_el_[0-9]+_[a-z0-9]+$'
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
  mod = await import("./email-rate-limit");

  // Einzige benoetigte Tabelle idempotent anlegen.
  await dbmod.db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_rate_limit_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await dbmod.db.execute(sql`
    CREATE INDEX IF NOT EXISTS email_rate_limit_attempts_ip_attempted_at_idx
    ON email_rate_limit_attempts (ip, attempted_at)
  `);
}, 240_000);

afterAll(async () => {
  if (dbmod) {
    await dbmod.pool.end();
  }
  if (baseUrl && testDbName) {
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`).catch(() => {});
    await admin.end();
  }
});

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Tabelle vor jedem Test leeren.
  await dbmod.db.execute(sql`DELETE FROM email_rate_limit_attempts`);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("checkEmailRateLimit (DB-gestuetzt)", () => {
  it("erlaubt Versuche bis zum Limit und blockt danach mit Retry-After", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "3";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);

    expect((await mod.checkEmailRateLimit("1.2.3.4", t0)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("1.2.3.4", t0 + 1000)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("1.2.3.4", t0 + 2000)).allowed).toBe(true);

    const blocked = await mod.checkEmailRateLimit("1.2.3.4", t0 + 3000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      // Aeltester Slot (t0) wird bei t0+60000 frei => 57s Restzeit.
      expect(blocked.retryAfterSeconds).toBe(57);
    }
  });

  it("zaehlt IPs unabhaengig voneinander", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "1";
    const t0 = Date.UTC(2026, 0, 2, 8, 0, 0);
    expect((await mod.checkEmailRateLimit("10.0.0.1", t0)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("10.0.0.1", t0 + 1)).allowed).toBe(false);
    expect((await mod.checkEmailRateLimit("10.0.0.2", t0 + 2)).allowed).toBe(true);
  });

  it("gibt Slots nach Ablauf des Fensters wieder frei (Sliding Window)", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "2";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "10000";
    const t0 = Date.UTC(2026, 0, 3, 9, 0, 0);

    expect((await mod.checkEmailRateLimit("ip", t0)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("ip", t0 + 5000)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("ip", t0 + 6000)).allowed).toBe(false);
    // t0-Slot faellt bei t0+10000 aus dem Fenster.
    expect((await mod.checkEmailRateLimit("ip", t0 + 10_001)).allowed).toBe(true);
    // Jetzt sind t0+5000 und t0+10001 im Fenster => wieder voll.
    expect((await mod.checkEmailRateLimit("ip", t0 + 10_002)).allowed).toBe(false);
  });

  it("MAX=0 schaltet den Limiter komplett ab (E2E-Test-Stack) — ohne DB-Zeilen", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "0";
    const t0 = Date.UTC(2026, 0, 4, 10, 0, 0);
    for (let i = 0; i < 50; i++) {
      expect((await mod.checkEmailRateLimit("bulk", t0 + i)).allowed).toBe(true);
    }
    const rows = await dbmod.db.execute(sql`SELECT count(*)::int AS n FROM email_rate_limit_attempts`);
    const n = (rows.rows[0] as { n: number }).n;
    expect(n).toBe(0);
  });

  it("faellt bei unbrauchbaren ENV-Werten auf die Defaults zurueck (5/60min)", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "quatsch";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "-5";
    const t0 = Date.UTC(2026, 0, 5, 11, 0, 0);
    for (let i = 0; i < 5; i++) {
      expect((await mod.checkEmailRateLimit("d", t0 + i * 1000)).allowed).toBe(true);
    }
    const blocked = await mod.checkEmailRateLimit("d", t0 + 6_000);
    expect(blocked.allowed).toBe(false);
  });

  it("Zaehler ist prozessuebergreifend: vorbestehende DB-Zeilen zaehlen mit", { timeout: 60_000 }, async () => {
    // Simuliert eine ANDERE Instanz, die bereits Versuche eingetragen hat.
    process.env.EMAIL_RATE_LIMIT_MAX = "3";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = Date.UTC(2026, 0, 6, 12, 0, 0);

    await dbmod.db.execute(sql`
      INSERT INTO email_rate_limit_attempts (ip, attempted_at) VALUES
        ('9.9.9.9', ${new Date(t0).toISOString()}),
        ('9.9.9.9', ${new Date(t0 + 1000).toISOString()})
    `);

    expect((await mod.checkEmailRateLimit("9.9.9.9", t0 + 2000)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("9.9.9.9", t0 + 3000)).allowed).toBe(false);
  });

  it("laesst unter PARALLELEN Versuchen strikt hoechstens MAX durch (Advisory-Lock)", { timeout: 60_000 }, async () => {
    // Der Pro-IP-Advisory-Lock serialisiert parallele Transaktionen.
    process.env.EMAIL_RATE_LIMIT_MAX = "1";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = Date.UTC(2026, 0, 8, 14, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => mod.checkEmailRateLimit("race", t0 + i)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(1);

    const rows = await dbmod.db.execute(sql`SELECT count(*)::int AS n FROM email_rate_limit_attempts`);
    const n = (rows.rows[0] as { n: number }).n;
    expect(n).toBe(1);

    // MAX=3 und frische IP: exakt 3 kommen durch.
    process.env.EMAIL_RATE_LIMIT_MAX = "3";
    const results3 = await Promise.all(
      Array.from({ length: 12 }, (_, i) => mod.checkEmailRateLimit("race3", t0 + i)),
    );
    expect(results3.filter((r) => r.allowed).length).toBe(3);
  });

  it("raeumt abgelaufene Zeilen (auch fremder IPs) beim Versuch mit auf", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "5";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "10000";
    const t0 = Date.UTC(2026, 0, 7, 13, 0, 0);

    await dbmod.db.execute(sql`
      INSERT INTO email_rate_limit_attempts (ip, attempted_at) VALUES
        ('alt', ${new Date(t0 - 60_000).toISOString()}),
        ('alt2', ${new Date(t0 - 30_000).toISOString()})
    `);

    expect((await mod.checkEmailRateLimit("frisch", t0)).allowed).toBe(true);

    // Nur die frische Zeile darf noch in der Tabelle stehen.
    const rows = await dbmod.db.execute(sql`SELECT ip FROM email_rate_limit_attempts`);
    expect(rows.rows.map((r) => (r as { ip: string }).ip)).toEqual(["frisch"]);
  });
});
