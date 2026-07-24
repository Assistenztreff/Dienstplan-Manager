// ---------------------------------------------------------------------------
// DB-gebundener Beweis: migrate-prod baut eine LEERE Ziel-DB komplett auf.
// ---------------------------------------------------------------------------
// Der Frisch-DB-Pfad in migrate-prod.ts (isFreshDb: keine users-Tabelle =>
// Daten-Migrationen und PRE_PUSH_SQL werden uebersprungen, Schema wird direkt
// gepusht) war bisher nur manuell geprueft. Dieser Test legt eine leere
// Wegwerf-Datenbank auf demselben Postgres-Server an, laesst das ECHTE
// migrate-prod-Skript mit `--yes <dbname>` dagegen laufen und verifiziert
// anschliessend via findMissingSchemaObjects (@workspace/db/verify-schema),
// dass KEIN Objekt gegenueber dem Drizzle-Schema fehlt — inklusive der
// Session-Tabelle von connect-pg-simple.
//
// Laeuft NIE gegen die Dev-DB: die Wegwerf-DB traegt einen eindeutigen Namen
// (Zeitstempel + PID) und wird in afterAll wieder geloescht; liegengebliebene
// Wegwerf-DBs frueherer, abgebrochener Laeufe werden vorab aufgeraeumt.
// Bewusst NICHT Teil des DB-freien Unit-Gates (siehe package.json test:db).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  normalizeDatabaseUrl,
  resolveDatabaseUrl,
} from "@workspace/db/database-url";
import {
  findMissingSchemaObjects,
  countSchemaTables,
} from "@workspace/db/verify-schema";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// Namenspraefix der Wegwerf-DBs (auch fuers Aufraeumen von Altlasten).
const PREFIX = "mpfresh_";

let baseUrl: string;
let targetUrl: string;
let targetDbName: string;
let migrateOutput = "";
let migrateStatus: number | null = null;

function adminClient(): pg.Client {
  return new pg.Client({
    connectionString: baseUrl,
    connectionTimeoutMillis: 15_000,
  });
}

function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

beforeAll(async () => {
  const raw = resolveDatabaseUrl();
  if (!raw) throw new Error("DATABASE_URL muss gesetzt sein.");
  baseUrl = normalizeDatabaseUrl(raw);

  targetDbName = `${PREFIX}${Date.now()}_${process.pid}`;
  targetUrl = withDbName(baseUrl, targetDbName);

  const admin = adminClient();
  await admin.connect();
  try {
    // Altlasten abgebrochener Laeufe entsorgen (best effort). Der Name
    // enthaelt den Erstellungs-Zeitstempel — nur DEUTLICH alte Wegwerf-DBs
    // droppen, damit ein paralleler Lauf auf demselben Server nie seine
    // gerade aktive DB verliert.
    const stale = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE '${PREFIX}%'`,
    );
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const row of stale.rows) {
      const ts = Number(row.datname.slice(PREFIX.length).split("_")[0]);
      if (!Number.isFinite(ts) || ts >= cutoff) continue;
      await admin
        .query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`)
        .catch(() => {});
    }
    await admin.query(`CREATE DATABASE "${targetDbName}"`);
  } finally {
    await admin.end();
  }

  // Das ECHTE Skript ausfuehren — genau wie beim Veroeffentlichen, nur mit
  // der Wegwerf-DB als Ziel. DATABASE_URL bleibt die Dev-/Staging-URL, damit
  // der Kollisions-Guard (anderer DB-Name, gleicher Host) mitgetestet wird.
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@workspace/scripts",
      "run",
      "migrate-prod",
      "--yes",
      targetDbName,
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: {
        ...process.env,
        PROD_DATABASE_URL: targetUrl,
        DATABASE_URL: baseUrl,
        APP_DATABASE_URL: baseUrl,
      },
      timeout: 480_000,
    },
  );
  migrateOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  migrateStatus = result.status;
  if (result.error) throw result.error;
}, 600_000);

afterAll(async () => {
  if (!baseUrl || !targetDbName) return;
  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query(
      `DROP DATABASE IF EXISTS "${targetDbName}" WITH (FORCE)`,
    );
  } finally {
    await admin.end();
  }
});

describe("migrate-prod gegen leere Ziel-DB (Frisch-DB-Pfad)", () => {
  it("laeuft erfolgreich durch und nimmt den Frisch-DB-Pfad (Daten-Migrationen/PRE_PUSH_SQL uebersprungen)", () => {
    expect(migrateStatus, migrateOutput).toBe(0);
    expect(migrateOutput).toContain("Ziel-DB ist leer");
    // Frisch-Pfad: keine Daten-Migration und keine SQL-Vorab-Schritte gelaufen.
    expect(migrateOutput).not.toContain("[1/4] Daten-Migration");
    expect(migrateOutput).not.toContain("[2/4] Idempotente SQL-Vorab-Schritte");
    // Skript-eigene Verifikation und Erfolgsmeldung.
    expect(migrateOutput).toContain("[4/4] Schema-Verifikation");
    expect(migrateOutput).toContain("Fertig: Produktions-DB");
  });

  it("hinterlaesst ein vollstaendiges Schema (findMissingSchemaObjects leer)", async () => {
    const problems = await findMissingSchemaObjects(targetUrl);
    expect(problems).toEqual([]);
  });

  it("legt alle Drizzle-Tabellen inklusive Session-Tabelle an", async () => {
    const client = new pg.Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const names = new Set(tables.rows.map((r) => r.table_name));
      // Session-Tabelle (connect-pg-simple) MUSS mit angelegt werden — sonst
      // stirbt der erste Login auf einer frisch aufgebauten Produktions-DB.
      expect(names.has("session")).toBe(true);
      expect(names.has("users")).toBe(true);
      expect(names.size).toBeGreaterThanOrEqual(countSchemaTables());
    } finally {
      await client.end();
    }
  });
});
