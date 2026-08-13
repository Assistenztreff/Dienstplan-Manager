// ---------------------------------------------------------------------------
// DB-gestuetzte Tests fuer die E-Mail-Rate-Bremse (forgot-password & resend-verification).
// ---------------------------------------------------------------------------
// Analog zu register-rate-limit.db.test.ts: eigene Wegwerf-DB pro Lauf,
// env VOR den dynamischen Imports umgebogen, nur email_rate_limit_attempts
// provisioniert. Semantik: Sliding Window pro IP, advisory-lock-sicher.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";

function deriveTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(normalizeDatabaseUrl(base));
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const name = `${current}_erl_${process.pid}_${Date.now().toString(36)}`;
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
  const derived = deriveTestDbUrl(base);
  const testUrl = derived.url;
  testDbName = derived.name;

  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  // Verwaiste Wegwerf-DBs frueherer Laeufe aufraumen.
  const orphans = await admin.query(
    `SELECT datname FROM pg_database
     WHERE datname ~ '_erl_[0-9]+_[a-z0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = pg_database.datname)`,
  );
  for (const row of orphans.rows as { datname: string }[]) {
    await admin.query(`DROP DATABASE IF EXISTS "${row.datname}"`).catch(() => {});
  }
  await admin.query(`CREATE DATABASE "${testDbName}"`);
  await admin.end();

  process.env.DATABASE_URL = testUrl;
  process.env.APP_DATABASE_URL = testUrl;

  dbmod = await import("@workspace/db");
  mod = await import("./email-rate-limit");

  await dbmod.db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_rate_limit_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await dbmod.db.execute(sql`
    CREATE INDEX IF NOT EXISTS email_rl_attempts_ip_attempted_at_idx
    ON email_rate_limit_attempts (ip, attempted_at)
  `);
}, 240_000);

afterAll(async () => {
  if (dbmod) await dbmod.pool.end();
  if (baseUrl && testDbName) {
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`).catch(() => {});
    await admin.end();
  }
});

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
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
    process.env.EMAIL_RATE_LIMIT_MAX = "5";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "3600000"; // 1 Stunde
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);

    for (let i = 0; i < 5; i++) {
      expect((await mod.checkEmailRateLimit("1.2.3.4", t0 + i * 1000)).allowed).toBe(true);
    }

    const blocked = await mod.checkEmailRateLimit("1.2.3.4", t0 + 5000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      // Aeltester Slot (t0) wird bei t0+3600000 frei => ~3595s Restzeit.
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);
    }
  });

  it("zaehlt IPs unabhaengig voneinander", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "1";
    const t0 = Date.UTC(2026, 0, 2, 8, 0, 0);
    expect((await mod.checkEmailRateLimit("10.0.0.1", t0)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("10.0.0.1", t0 + 1)).allowed).toBe(false);
    // Zweite IP hat eigenen, leeren Zaehler.
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
    // Jetzt t0+5000 und t0+10001 im Fenster => wieder voll.
    expect((await mod.checkEmailRateLimit("ip", t0 + 10_002)).allowed).toBe(false);
  });

  it("MAX=0 schaltet den Limiter komplett ab — ohne DB-Zeilen", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "0";
    const t0 = Date.UTC(2026, 0, 4, 10, 0, 0);
    for (let i = 0; i < 20; i++) {
      expect((await mod.checkEmailRateLimit("bulk", t0 + i)).allowed).toBe(true);
    }
    const rows = await dbmod.db.execute(sql`SELECT count(*)::int AS n FROM email_rate_limit_attempts`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("faellt bei unbrauchbaren ENV-Werten auf die Defaults zurueck (5/1h)", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "quatsch";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "-5";
    const t0 = Date.UTC(2026, 0, 5, 11, 0, 0);
    for (let i = 0; i < 5; i++) {
      expect((await mod.checkEmailRateLimit("d", t0 + i * 1000)).allowed).toBe(true);
    }
    const blocked = await mod.checkEmailRateLimit("d", t0 + 5000);
    expect(blocked.allowed).toBe(false);
  });

  it("Zaehler ist prozessuebergreifend: vorbestehende DB-Zeilen zaehlen mit", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "3";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "3600000";
    const t0 = Date.UTC(2026, 0, 6, 12, 0, 0);

    // Zwei Versuche von einer "anderen Instanz" voreintragen.
    await dbmod.db.execute(sql`
      INSERT INTO email_rate_limit_attempts (ip, attempted_at) VALUES
        (${"9.9.9.9"}, ${new Date(t0)}),
        (${"9.9.9.9"}, ${new Date(t0 + 1000)})
    `);

    expect((await mod.checkEmailRateLimit("9.9.9.9", t0 + 2000)).allowed).toBe(true);
    expect((await mod.checkEmailRateLimit("9.9.9.9", t0 + 3000)).allowed).toBe(false);
  });

  it("laesst unter PARALLELEN Versuchen strikt hoechstens MAX durch (Advisory-Lock)", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "1";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "3600000";
    const t0 = Date.UTC(2026, 0, 8, 14, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => mod.checkEmailRateLimit("race", t0 + i)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(1);

    const rows = await dbmod.db.execute(sql`SELECT count(*)::int AS n FROM email_rate_limit_attempts WHERE ip = 'race'`);
    expect((rows.rows[0] as { n: number }).n).toBe(1);

    // Nochmals mit MAX=3 und neuer IP.
    process.env.EMAIL_RATE_LIMIT_MAX = "3";
    const results3 = await Promise.all(
      Array.from({ length: 12 }, (_, i) => mod.checkEmailRateLimit("race3", t0 + i)),
    );
    expect(results3.filter((r) => r.allowed).length).toBe(3);
  });

  it("raeumt abgelaufene Zeilen beim Versuch mit auf", { timeout: 60_000 }, async () => {
    process.env.EMAIL_RATE_LIMIT_MAX = "5";
    process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "10000";
    const t0 = Date.UTC(2026, 0, 7, 13, 0, 0);

    await dbmod.db.execute(sql`
      INSERT INTO email_rate_limit_attempts (ip, attempted_at) VALUES
        (${"alt"}, ${new Date(t0 - 60_000)}),
        (${"alt2"}, ${new Date(t0 - 30_000)})
    `);

    expect((await mod.checkEmailRateLimit("frisch", t0)).allowed).toBe(true);

    const rows = await dbmod.db.execute(sql`SELECT ip FROM email_rate_limit_attempts`);
    expect((rows.rows as { ip: string }[]).map((r) => r.ip)).toEqual(["frisch"]);
  });
});
