// ---------------------------------------------------------------------------
// DB-gebundener Beweis: der Nach-Push-Backfill fuer is_partial_absence (#862)
// laeuft in der ECHTEN migrate-prod-Reihenfolge und holt eine Bestands-
// Abwesenheit korrekt nach, OBWOHL die Spalte beim Start des Upgrades noch
// gar nicht existiert.
// ---------------------------------------------------------------------------
// Der von der Code-Review gefundene Fehler: is_partial_absence entsteht erst
// durch den Schema-Push. Liefe der Backfill (wie urspruenglich implementiert)
// VOR dem Push, faende er die Spalte noch nicht vor, ueberspraenge sich als
// no-op — und wuerde NIE MEHR nachgeholt, weil jede Bestandszeile ab dem Push
// den Spalten-Default `false` traegt (nicht mehr von einer fehlenden Spalte
// unterscheidbar). Dieser Test bildet genau diesen Upgrade-Pfad nach:
//
//   1. Wegwerf-DB anlegen und via migrate-prod auf den AKTUELLEN Stand bringen.
//   2. Auf den Stand VOR #862 zuruecksetzen: is_partial_absence-Spalte entfernen.
//   3. Eine Bestands-Abwesenheit mit echten Teil-Tag-Uhrzeiten anlegen (genau
//      der Fall, der frueher nur ueber die Uhrzeiten als "Teil-Tag" erkennbar
//      war) — die Spalte existiert zu diesem Zeitpunkt noch NICHT.
//   4. Das ECHTE migrate-prod (Nicht-Frisch-Pfad, echte Skript-Reihenfolge)
//      erneut laufen lassen.
//   5. Pruefen: Spalte existiert danach, und die Bestandszeile wurde auf
//      is_partial_absence=true nachgezogen (nicht der stille Spalten-Default).
//
// Laeuft NIE gegen die Dev-DB: eigene Wegwerf-DB mit eindeutigem Namen,
// Aufraeumen in afterAll. Bewusst NICHT Teil des DB-freien Unit-Gates
// (ausgeschlossen ueber `**/*.db.test.ts` in scripts/package.json `test`).
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

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const PREFIX = "partialabsence_";

let baseUrl: string;
let targetUrl: string;
let targetDbName: string;
let upgradeOutput = "";
let upgradeStatus: number | null = null;
let legacyShiftId = 0;
let legacyInheritedFullDayShiftId = 0;

// Exakte Kopie von isPlainFullDay (shift-metrics-resolve.ts) — bewusst hier
// dupliziert (kein Cross-Package-Import von @workspace/api-server aus
// scripts), um im Test unabhaengig zu belegen, dass die SQL-Bedingung des
// Backfills fuer jeden hier verwendeten Zeitstempel GENAU denselben Wert
// liefert wie die alte, produktiv eingesetzte JS-Heuristik.
function isPlainFullDayReference(start: Date, end: Date): boolean {
  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    end.getUTCHours() === 23 &&
    end.getUTCMinutes() === 59
  );
}

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

  // 1. Aktuellen Stand aufbauen (Frisch-DB-Pfad legt is_partial_absence an).
  const initial = runMigrateProd();
  if (initial.status !== 0) {
    throw new Error(`Aufbau der Wegwerf-DB fehlgeschlagen:\n${initial.output}`);
  }

  // 2. + 3. Auf den Stand VOR #862 zuruecksetzen und eine Bestands-
  //    Abwesenheit mit echten Teil-Tag-Uhrzeiten anlegen — WICHTIG: die
  //    Spalte existiert an dieser Stelle bewusst noch NICHT.
  const client = targetClient();
  await client.connect();
  try {
    await client.query(`ALTER TABLE shifts DROP COLUMN IF EXISTS is_partial_absence;`);
    // Der Aufbau-Lauf in Schritt 1 nimmt (Wegwerf-DB ist zu diesem Zeitpunkt
    // frisch) den Frisch-DB-Pfad von migrate-prod und setzt dabei seit dem
    // Code-Review-Fund bereits den Einmal-Marker (s. migrate-prod.ts, Schritt
    // 4 laeuft jetzt IMMER, nicht nur bei Bestands-DBs). Um hier eine ECHTE
    // Bestands-DB von VOR #862 nachzubilden (die diesen Marker nie gesetzt
    // hat), muss er zusammen mit der Spalte zurueckgesetzt werden — sonst
    // wuerde der Nach-Push-Backfill unten den Marker schon als vergeben
    // vorfinden und faelschlich als No-op durchlaufen.
    await client.query(
      `DELETE FROM data_migrations WHERE name = 'backfill-partial-absence-flag';`,
    );

    const user = await client.query<{ id: number }>(
      `INSERT INTO users (name, email) VALUES ('Bestandskonto Halbtag', 'bestand-halbtag@example.test')
       RETURNING id`,
    );
    const team = await client.query<{ id: number }>(
      `INSERT INTO teams (name, owner_id) VALUES ('Bestandsteam Halbtag', $1) RETURNING id`,
      [user.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`,
      [team.rows[0]!.id, user.rows[0]!.id],
    );
    // Echte Teil-Tag-Uhrzeiten (13:00-17:00) — NICHT der Ganztages-Sentinel
    // 00:00-23:59. Genau der Fall, den die alte, uhrzeiten-basierte Logik vor
    // #862 bereits korrekt als "Teil-Tag" erkannt hat.
    const shift = await client.query<{ id: number }>(
      `INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status)
       VALUES ($1, $2, '2026-05-20 13:00:00', '2026-05-20 17:00:00', 'vacation', 'FIX')
       RETURNING id`,
      [team.rows[0]!.id, user.rows[0]!.id],
    );
    legacyShiftId = shift.rows[0]!.id;

    // Zweite Bestandszeile: ein ganztaegiger Urlaub, der ueber das
    // Lohnausfallprinzip die echten Uhrzeiten eines ERSETZTEN Dienstes
    // geerbt hat (z. B. 08:00-14:00) — in den Rohdaten identisch zu einem
    // bewusst gewaehlten Teil-Tag, aber semantisch ganztaegig gemeint. Diese
    // Zeile beweist NICHT, dass der Backfill die "richtige" Absicht erraet
    // (unmoeglich, s. Docstring in backfill-partial-absence-flag.ts) —
    // sondern dass sein Ergebnis exakt dem entspricht, was Kollisionspruefung
    // und Anzeige fuer diese Zeile SCHON VOR dieser Aufgabe geliefert haben.
    const inheritedShift = await client.query<{ id: number }>(
      `INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status)
       VALUES ($1, $2, '2026-05-21 08:00:00', '2026-05-21 14:00:00', 'vacation', 'FIX')
       RETURNING id`,
      [team.rows[0]!.id, user.rows[0]!.id],
    );
    legacyInheritedFullDayShiftId = inheritedShift.rows[0]!.id;
  } finally {
    await client.end();
  }

  // 4. Das ECHTE migrate-prod (Nicht-Frisch-Pfad, echte Skript-Reihenfolge:
  //    Daten-Migrationen -> SQL-Vorab-Schritte -> Push -> Nach-Push-Backfill).
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

describe("Nach-Push-Backfill von is_partial_absence gegen eine Bestands-DB VOR #862", () => {
  it("laeuft ohne interaktive Rueckfrage durch und fuehrt den Backfill NACH dem Push aus", () => {
    expect(upgradeStatus, upgradeOutput).toBe(0);
    expect(upgradeOutput).not.toContain("Ziel-DB ist leer");
    expect(upgradeOutput).toContain("Fertig: Produktions-DB");
    expect(upgradeOutput).not.toMatch(/Interactive prompts require a TTY/i);

    // Reihenfolge im Log beweisen: der Nach-Push-Schritt taucht NACH dem
    // Schema-Push-Schritt auf, nicht in der Vor-Push-Liste.
    const pushIdx = upgradeOutput.indexOf("Schema-Push (drizzle-kit)");
    const backfillIdx = upgradeOutput.indexOf("Daten-Migration (nach Push): backfill-partial-absence-flag");
    expect(pushIdx).toBeGreaterThan(-1);
    expect(backfillIdx).toBeGreaterThan(pushIdx);
  });

  it("legt is_partial_absence als NOT-NULL-Spalte mit Default false an", async () => {
    const client = targetClient();
    await client.connect();
    try {
      const col = await client.query<{
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'shifts' AND column_name = 'is_partial_absence'`,
      );
      expect(col.rows).toHaveLength(1);
      expect(col.rows[0]!.is_nullable).toBe("NO");
      expect(col.rows[0]!.column_default ?? "").toContain("false");
    } finally {
      await client.end();
    }
  });

  it("zieht die Bestands-Abwesenheit mit echten Teil-Tag-Uhrzeiten auf true nach (kein stiller Spalten-Default)", async () => {
    const client = targetClient();
    await client.connect();
    try {
      const row = await client.query<{ is_partial_absence: boolean }>(
        `SELECT is_partial_absence FROM shifts WHERE id = $1`,
        [legacyShiftId],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.is_partial_absence).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("liefert fuer einen ganztaegigen Urlaub mit geerbten Dienstzeiten GENAU den alten (uhrzeiten-basierten) Wert — keine neue Fehlklassifikation, keine Verhaltensaenderung", async () => {
    // Diese Zeile ist in den Rohdaten (08:00-14:00, type=vacation) nicht von
    // einem bewusst gewaehlten Teil-Tag unterscheidbar — diese Mehrdeutigkeit
    // ist strukturell unaufloesbar (s. Docstring in
    // backfill-partial-absence-flag.ts). Der Test beweist deshalb NICHT die
    // "richtige" Absicht, sondern Formel-Paritaet: is_partial_absence nach
    // dem Backfill MUSS exakt isPlainFullDay(startTime, endTime) entsprechen
    // (negiert), weil genau das schon vor dieser Aufgabe die Kollisions- und
    // Anzeige-Logik fuer diese Zeile berechnet hat. Kein Unterschied zum
    // Ist-Zustand vor dem Upgrade == keine Regression.
    const client = targetClient();
    await client.connect();
    try {
      const row = await client.query<{
        is_partial_absence: boolean;
        start_time: Date;
        end_time: Date;
      }>(
        `SELECT is_partial_absence, start_time, end_time FROM shifts WHERE id = $1`,
        [legacyInheritedFullDayShiftId],
      );
      expect(row.rows).toHaveLength(1);
      const expected = !isPlainFullDayReference(row.rows[0]!.start_time, row.rows[0]!.end_time);
      expect(row.rows[0]!.is_partial_absence).toBe(expected);
      expect(row.rows[0]!.is_partial_absence).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("hinterlaesst ein vollstaendiges Schema", async () => {
    const problems = await findMissingSchemaObjects(targetUrl);
    expect(problems).toEqual([]);
  });

  it("laeuft bei einem WEITEREN Deploy NICHT erneut — ein frisch angelegter, bewusst ganztaegiger Urlaub mit geerbten Uhrzeiten bleibt is_partial_absence=false", async () => {
    // Das war der 4. Code-Review-Fund: eine reine WHERE-Bedingung
    // (is_partial_absence=false + nicht-ganztaegige Zeiten) kann den
    // Backfill nicht vor sich selbst schuetzen, weil genau dieser Zustand ab
    // dem ersten Rollout auch LEGITIM entsteht (ein frisch angelegter,
    // bewusst ganztaegiger Urlaub, der ueber das Lohnausfallprinzip echte
    // Uhrzeiten geerbt hat). Simuliert hier einen ZWEITEN Produktions-Deploy
    // NACH dem ersten (dieser Test laeuft nach dem migrate-prod-Aufruf in
    // beforeAll) — die neue Zeile darf dabei nicht angefasst werden.
    const client = targetClient();
    await client.connect();
    let newRowId = 0;
    try {
      const user = await client.query<{ id: number }>(
        `SELECT id FROM users WHERE email = 'bestand-halbtag@example.test'`,
      );
      const team = await client.query<{ id: number }>(
        `SELECT id FROM teams WHERE owner_id = $1`,
        [user.rows[0]!.id],
      );
      // Von der NEUEN App-Logik (routes/shifts.ts) korrekt gesetzt:
      // ganztaegig gemeint (isPartialAbsence=false), aber mit den echten,
      // geerbten Uhrzeiten des ersetzten Dienstes gespeichert.
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO shifts (team_id, user_id, start_time, end_time, type, planning_status, is_partial_absence)
         VALUES ($1, $2, '2026-06-01 09:00:00', '2026-06-01 15:00:00', 'vacation', 'FIX', false)
         RETURNING id`,
        [team.rows[0]!.id, user.rows[0]!.id],
      );
      newRowId = inserted.rows[0]!.id;
    } finally {
      await client.end();
    }

    const secondDeploy = runMigrateProd();
    expect(secondDeploy.status, secondDeploy.output).toBe(0);
    // Der Nach-Push-Schritt wird zwar wieder AUFGERUFEN (Skript-Reihenfolge
    // unveraendert) …
    expect(secondDeploy.output).toContain(
      "Daten-Migration (nach Push): backfill-partial-absence-flag",
    );

    const verify = targetClient();
    await verify.connect();
    try {
      // … aber die Marker-Sperre laesst ihn ab dem zweiten Lauf ein No-op
      // sein: genau EIN Eintrag fuer diesen Migrationsnamen, nie mehr.
      const marker = await verify.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM data_migrations WHERE name = 'backfill-partial-absence-flag'`,
      );
      expect(marker.rows[0]!.count).toBe("1");

      const newRow = await verify.query<{ is_partial_absence: boolean }>(
        `SELECT is_partial_absence FROM shifts WHERE id = $1`,
        [newRowId],
      );
      expect(newRow.rows).toHaveLength(1);
      expect(newRow.rows[0]!.is_partial_absence).toBe(false);

      // Die urspruengliche Bestandszeile aus dem ERSTEN Deploy bleibt
      // unveraendert auf true (kein Zuruecksetzen durch den No-op-Lauf).
      const legacyRow = await verify.query<{ is_partial_absence: boolean }>(
        `SELECT is_partial_absence FROM shifts WHERE id = $1`,
        [legacyShiftId],
      );
      expect(legacyRow.rows[0]!.is_partial_absence).toBe(true);
    } finally {
      await verify.end();
    }
  }, 480_000);
});
