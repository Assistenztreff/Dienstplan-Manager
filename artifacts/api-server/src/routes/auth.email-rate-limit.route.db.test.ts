// ---------------------------------------------------------------------------
// Routen-Verdrahtungstest fuer die E-Mail-Rate-Bremse (Task #801).
// ---------------------------------------------------------------------------
// Prueft, dass POST /api/auth/forgot-password und /api/auth/resend-verification
// nach Ueberschreiten des Limits tatsaechlich 429 mit Retry-After-Header
// zurueckgeben — und dass die Bremse VOR dem (in try/catch gewrappten)
// DB-Benutzer-Lookup greift, sodass NUR die email_rate_limit_attempts-Tabelle
// benoetigt wird.
//
// Aufbau wie auth.register-rate-limit.route.db.test.ts:
// - Eigene Wegwerf-DB (nur email_rate_limit_attempts provisioniert)
// - Env vor dynamischen Imports umgebogen
// - Minimale Express-App ohne Session-Store
// - Echter HTTP-Server auf Port 0
//
// Ausserdem: geteilter Zaehler — Versuche auf forgot-password und
// resend-verification teilen sich das Limit derselben IP.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import pg from "pg";
import { sql } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";

function deriveTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(normalizeDatabaseUrl(base));
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const name = `${current}_erl_rt_${process.pid}_${Date.now().toString(36)}`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name };
}

let baseUrl: string;
let testDbName: string;
let dbmod: typeof import("@workspace/db");
let server: Server;
let apiBase: string;

const ENV_KEYS = ["EMAIL_RATE_LIMIT_MAX", "EMAIL_RATE_LIMIT_WINDOW_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");
  baseUrl = base;
  const derived = deriveTestDbUrl(base);
  testDbName = derived.name;

  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDbName}"`);
  await admin.end();

  process.env.DATABASE_URL = derived.url;
  process.env.APP_DATABASE_URL = derived.url;
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Kleines, klar messbares Limit fuer den Test.
  process.env.EMAIL_RATE_LIMIT_MAX = "2";
  process.env.EMAIL_RATE_LIMIT_WINDOW_MS = "600000"; // 10 Minuten

  dbmod = await import("@workspace/db");
  await dbmod.db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_rate_limit_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    )
  `);

  // Minimale Express-App: JSON-Parser + Auth-Router unter /api.
  // Bewusst OHNE Session-Store — 429-Pfade beruehren req.session nicht.
  // KEIN trust proxy: req.ip = "127.0.0.1" (direkte Verbindung im Test).
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

function postForgotPassword(email = "test@example.com"): Promise<Response> {
  return fetch(`${apiBase}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function postResendVerification(email = "test@example.com"): Promise<Response> {
  return fetch(`${apiBase}/api/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/auth/forgot-password — Rate-Limit-Verdrahtung", () => {
  it("liefert nach MAX Versuchen 429 mit Retry-After", { timeout: 60_000 }, async () => {
    // Zuerst MAX=2 Zaehler aufbrauchen. In der Wegwerf-DB existiert nur die
    // email_rate_limit_attempts-Tabelle (kein users), daher liefern diese
    // Requests 500 — fuer den Zaehler-Test irrelevant, da checkEmailRateLimit
    // VOR dem User-Lookup laeuft und den Eintrag trotzdem schreibt.
    for (let i = 0; i < 2; i++) {
      await postForgotPassword();
    }

    // Versuch 3 ueberschreitet das Limit: 429 + Retry-After.
    const blocked = await postForgotPassword();
    expect(blocked.status).toBe(429);

    const retryAfter = blocked.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(600);

    const body = (await blocked.json()) as { error?: string };
    expect(body.error).toContain("Zu viele Versuche");

    // Fehlende E-Mail-Adresse bleibt 400 (Validierung VOR Rate-Limit).
    const bad = await fetch(`${apiBase}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/auth/resend-verification — Rate-Limit-Verdrahtung", () => {
  it("liefert nach MAX Versuchen 429 mit Retry-After", { timeout: 60_000 }, async () => {
    // Zaehler zuruecksetzen (vorheriger Test hat Zeilen hinterlassen).
    await dbmod.db.execute(sql`DELETE FROM email_rate_limit_attempts`);

    // Zaehler aufbrauchen (Status irrelevant, da users-Tabelle in der
    // Wegwerf-DB fehlt; checkEmailRateLimit schreibt den Eintrag trotzdem).
    for (let i = 0; i < 2; i++) {
      await postResendVerification();
    }

    const blocked = await postResendVerification();
    expect(blocked.status).toBe(429);

    const retryAfter = blocked.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    const body = (await blocked.json()) as { error?: string };
    expect(body.error).toContain("Zu viele Versuche");
  });
});

describe("Geteilter Zaehler: forgot-password + resend-verification", () => {
  it("zaehlt Versuche beider Endpunkte zusammen fuer dieselbe IP", { timeout: 60_000 }, async () => {
    await dbmod.db.execute(sql`DELETE FROM email_rate_limit_attempts`);

    // 1 forgot-password + 1 resend-verification = 2 Versuche (MAX=2 erreicht).
    // Status wird nicht geprueft — nur der Zaehler zaehlt.
    await postForgotPassword();
    await postResendVerification();

    // Dritter Versuch (egal welcher Endpunkt) → 429.
    const blocked = await postForgotPassword();
    expect(blocked.status).toBe(429);
  });
});
