// ---------------------------------------------------------------------------
// DB-gebundener Beweis: migrate-prod hebt eine BEFUELLTE Bestands-DB des
// VORHERIGEN Releases prompt-frei auf den aktuellen Schema-Stand.
// ---------------------------------------------------------------------------
// Der riskante Fall beim Veroeffentlichen ist nicht die leere DB (dafuer gibt
// es migrate-prod.fresh-db.test.ts), sondern die gewachsene Kunden-DB: Dort
// trifft `drizzle-kit push` ohne TTY auf einen NEUEN Enum-Typ PLUS eine NEUE
// NOT-NULL-Spalte auf einer bereits befuellten Tabelle — genau die Kombination,
// bei der push interaktiv nachfragen und der Lauf haengen bzw. abbrechen kann.
// Die Absicherung dagegen sind die idempotenten Vorab-Schritte in
// scripts/src/lib/pre-push-sql.ts.
//
// Aufbau:
//   1. Wegwerf-DB anlegen und via migrate-prod auf den AKTUELLEN Stand bringen.
//   2. Auf den Stand des VORHERIGEN Releases zuruecksetzen: access_level-Spalte
//      und Enum-Typ entfernen.
//   3. Bestandsdaten anlegen (Konto, Team, Mitgliedschaft) — die Zeilen, die
//      eine echte Kunden-DB gefaehrlich machen.
//   4. Das ECHTE migrate-prod erneut laufen lassen (Nicht-Frisch-Pfad).
//   5. Pruefen: Spalte da, NOT NULL, Standard "keine", Bestandszeile befuellt,
//      kein TTY-Prompt, Schema vollstaendig.
//
// Laeuft NIE gegen die Dev-DB: eigene Wegwerf-DB mit eindeutigem Namen,
// Aufraeumen in afterAll. Bewusst NICHT Teil des DB-freien Unit-Gates.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  normalizeDatabaseUrl,
  resolveDatabaseUrl,
} from "@workspace/db/database-url";
import { findMissingSchemaObjects } from "@workspace/db/verify-schema";
import { runPrePushSql } from "./lib/pre-push-sql.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const PREFIX = "prepush_";

let baseUrl: string;
let targetUrl: string;
let targetDbName: string;
let upgradeOutput = "";
let upgradeStatus: number | null = null;
let memberId = 0;

function adminClient(): pg.Client {
  return new pg.Client({
    connectionString: baseUrl,
    connectionTimeoutMillis: 15_000,
  });
}

function targetClient(): pg.Client {
  return new pg.Client({
    connectionString: targetUrl,
    connectionTimeoutMillis: 15_000,
  });
}

function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function runMigrateProd(): { output: string; status: number | null } {
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
  if (result.error) throw result.error;
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
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
    // Altlasten abgebrochener Laeufe entsorgen (best effort) — nur deutlich
    // alte Wegwerf-DBs, damit ein paralleler Lauf nichts Aktives verliert.
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

  // 1. Aktuellen Stand aufbauen (Frisch-DB-Pfad).
  const initial = runMigrateProd();
  if (initial.status !== 0) {
    throw new Error(`Aufbau der Wegwerf-DB fehlgeschlagen:\n${initial.output}`);
  }

  // 2. + 3. Auf den vorherigen Release-Stand zuruecksetzen und befuellen.
  const client = targetClient();
  await client.connect();
  try {
    await client.query(`ALTER TABLE team_members DROP COLUMN IF EXISTS access_level;`);
    await client.query(`DROP TYPE IF EXISTS team_access_level;`);

    const user = await client.query<{ id: number }>(
      `INSERT INTO users (name, email) VALUES ('Bestandskonto', 'bestand@example.test')
       RETURNING id`,
    );
    const team = await client.query<{ id: number }>(
      `INSERT INTO teams (name, owner_id) VALUES ('Bestandsteam', $1) RETURNING id`,
      [user.rows[0]!.id],
    );
    const member = await client.query<{ id: number }>(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`,
      [team.rows[0]!.id, user.rows[0]!.id],
    );
    memberId = member.rows[0]!.id;
  } finally {
    await client.end();
  }

  // 4. Das ECHTE Skript auf die Bestands-DB loslassen.
  const upgrade = runMigrateProd();
  upgradeOutput = upgrade.output;
  upgradeStatus = upgrade.status;
}, 1_200_000);

afterAll(async () => {
  if (!baseUrl || !targetDbName) return;
  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${targetDbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

describe("migrate-prod gegen befuellte Bestands-DB des vorherigen Releases", () => {
  it("laeuft ohne interaktive Rueckfrage durch", () => {
    expect(upgradeStatus, upgradeOutput).toBe(0);
    expect(upgradeOutput).not.toContain("Ziel-DB ist leer");
    expect(upgradeOutput).toContain("[2/4] Idempotente SQL-Vorab-Schritte");
    expect(upgradeOutput).toContain("Fertig: Produktions-DB");
    expect(upgradeOutput).not.toMatch(/Interactive prompts require a TTY/i);
  });

  it("legt access_level als NOT-NULL-Spalte mit Standard 'keine' an", async () => {
    const client = targetClient();
    await client.connect();
    try {
      const col = await client.query<{
        is_nullable: string;
        column_default: string | null;
        udt_name: string;
      }>(
        `SELECT is_nullable, column_default, udt_name
           FROM information_schema.columns
          WHERE table_name = 'team_members' AND column_name = 'access_level'`,
      );
      expect(col.rows).toHaveLength(1);
      expect(col.rows[0]!.is_nullable).toBe("NO");
      expect(col.rows[0]!.udt_name).toBe("team_access_level");
      expect(col.rows[0]!.column_default ?? "").toContain("keine");
    } finally {
      await client.end();
    }
  });

  it("setzt Bestands-Mitgliedschaften auf 'keine' (keine stillen Rechte)", async () => {
    const client = targetClient();
    await client.connect();
    try {
      const row = await client.query<{ access_level: string }>(
        `SELECT access_level FROM team_members WHERE id = ${memberId}`,
      );
      expect(row.rows[0]!.access_level).toBe("keine");
    } finally {
      await client.end();
    }
  });

  it("hinterlaesst ein vollstaendiges Schema", async () => {
    const problems = await findMissingSchemaObjects(targetUrl);
    expect(problems).toEqual([]);
  });

  // Eigenes Zeitlimit: zwei komplette Vorab-Schritt-Durchlaeufe brauchen mehr
  // als die 5s-Vorgabe von vitest.
  it("die Vorab-Schritte sind wiederholbar (idempotent)", { timeout: 60_000 }, async () => {
    const client = targetClient();
    await client.connect();
    try {
      await runPrePushSql(client);
      await runPrePushSql(client);
      const row = await client.query<{ access_level: string }>(
        `SELECT access_level FROM team_members WHERE id = ${memberId}`,
      );
      expect(row.rows[0]!.access_level).toBe("keine");
    } finally {
      await client.end();
    }
  });
});
