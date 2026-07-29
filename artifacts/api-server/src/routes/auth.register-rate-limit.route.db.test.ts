// ---------------------------------------------------------------------------
// Routen-Verdrahtungstest fuer die Registrierungs-Bremse (Task #621).
// ---------------------------------------------------------------------------
// Die Limiter-LOGIK ist in lib/register-rate-limit.db.test.ts DB-gestuetzt
// abgedeckt. Hier geht es um die ROUTE: dass POST /api/auth/register bei
// Ueberschreitung tatsaechlich 429 liefert — samt Retry-After-Header und
// Fehlercode "rate_limited" — und dass die Bremse VOR jeder weiteren
// Validierung/DB-Arbeit greift.
//
// Aufbau wie der Schwester-Test: eigene Wegwerf-DB (`<dbname>_rl_...`), env
// VOR den dynamischen Imports umgebogen (Pool-Konfiguration beim Modul-Load),
// nur die Tabelle register_attempts wird provisioniert. Der Auth-Router wird
// in eine MINIMALE Express-App gemountet (ohne Session-Store — die 400/429-
// Pfade beruehren req.session nicht), echter HTTP-Server auf Port 0, echte
// fetch()-Requests. Die uebrige E2E-Suite (REGISTER_RATE_LIMIT_MAX=0) bleibt
// unberuehrt: dieser Test setzt sein kleines Limit nur prozesslokal.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import pg from "pg";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";

function deriveRateLimitTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(normalizeDatabaseUrl(base));
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const name = `${current}_rl_${process.pid}_${Date.now().toString(36)}`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name };
}

let baseUrl: string;
let testDbName: string;
let dbmod: typeof import("@workspace/db");
let server: Server;
let apiBase: string;

const ENV_KEYS = ["REGISTER_RATE_LIMIT_MAX", "REGISTER_RATE_LIMIT_WINDOW_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");
  baseUrl = base;
  const derived = deriveRateLimitTestDbUrl(base);
  testDbName = derived.name;

  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDbName}"`);
  await admin.end();

  // Env VOR den dynamischen Imports umbiegen (Pool-Konfiguration beim Load).
  // APP_DATABASE_URL MIT umbiegen: resolveDatabaseUrl bevorzugt sie.
  process.env.DATABASE_URL = derived.url;
  process.env.APP_DATABASE_URL = derived.url;
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Kleines, klar messbares Limit NUR fuer diesen Prozess.
  process.env.REGISTER_RATE_LIMIT_MAX = "2";
  process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "600000";

  dbmod = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  await dbmod.db.execute(sql`
    CREATE TABLE IF NOT EXISTS register_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    )
  `);

  // Minimale App: nur JSON-Parser + Auth-Router unter /api — bewusst OHNE
  // Session-Store, damit keine weiteren Tabellen noetig sind.
  const express = (await import("express")).default;
  const authRouter = (await import("./auth")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Server-Adresse unerwartet");
  apiBase = `http://127.0.0.1:${addr.port}`;
}, 240_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dbmod) await dbmod.pool.end();
  if (baseUrl && testDbName) {
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`).catch(() => {});
    await admin.end();
  }
});

function postRegister(body: unknown): Promise<Response> {
  return fetch(`${apiBase}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register — Rate-Limit-Verdrahtung", () => {
  it("liefert nach MAX Versuchen 429 mit Retry-After und code=rate_limited", { timeout: 60_000 }, async () => {
    // Die ersten MAX=2 Versuche zaehlen und laufen bis zur normalen
    // Validierung durch (leerer Body => 400, KEIN 429): Beweis, dass die
    // Bremse unterhalb des Limits nicht faelschlich zuschlaegt.
    for (let i = 0; i < 2; i++) {
      const res = await postRegister({});
      expect(res.status).toBe(400);
    }

    // Versuch 3 ueberschreitet das Limit: 429 + Retry-After + Fehlercode.
    const blocked = await postRegister({});
    expect(blocked.status).toBe(429);

    const retryAfter = blocked.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds)).toBe(true);
    // Fenster = 600s: die Wartezeit muss plausibel im Fenster liegen.
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(600);

    const body = (await blocked.json()) as { code?: string; error?: string };
    expect(body.code).toBe("rate_limited");
    expect(body.error).toContain("Zu viele Registrierungsversuche");

    // Die Bremse greift VOR der Validierung: auch ein syntaktisch kompletter
    // Request bleibt bei 429 (kein 400/409/201 — kein Existenz-Orakel mehr).
    const blocked2 = await postRegister({
      name: "Test",
      email: `rate-limit-${Date.now()}@example.com`,
      password: "passwort-123",
    });
    expect(blocked2.status).toBe(429);
    expect(((await blocked2.json()) as { code?: string }).code).toBe("rate_limited");
  });
});
