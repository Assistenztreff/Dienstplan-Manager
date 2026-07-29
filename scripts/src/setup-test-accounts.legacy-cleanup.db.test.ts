// ---------------------------------------------------------------------------
// DB-gebundener Beweis: setup-test-accounts raeumt Altlasten selbst weg.
// ---------------------------------------------------------------------------
// Schritt 0 des Skripts (removeLegacyMembers) entfernt eingeschleuste
// Mitglieder aus Betreiber- und Dienstleister-Team:
//   - Kern-Konten verlieren nur die Mitgliedschaft,
//   - unbekannte Konten (alte manuelle Testkonten) werden samt komplettem
//     Datenbaum via deleteAccountTrees geloescht (inkl. Schichten, Vertraegen,
//     Zeiterfassung und eigener Teams).
// Das war bisher nur manuell in der Dev-DB verifiziert. Dieser Test baut eine
// EIGENE Wegwerf-Datenbank (volles Drizzle-Schema via db push) mit den vier
// Kern-Konten auf, schleust ein Fremdkonto mit Datenbaum ins
// Dienstleister-Team ein und laesst das ECHTE Skript dagegen laufen.
//
// Bewusst KEINE geteilte `_test`-DB: setup-test-accounts formt die gesamte
// Team-Belegung um — auf der von parallelen E2E-Laeufen genutzten DB waere
// das destruktiv. Muster analog migrate-prod.fresh-db.test.ts (Wegwerf-DB
// mit eindeutigem Namen, Altlasten-Aufraeumen, Drop in afterAll).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  normalizeDatabaseUrl,
  resolveDatabaseUrl,
} from "@workspace/db/database-url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// Namenspraefix der Wegwerf-DBs (auch fuers Aufraeumen von Altlasten
// abgebrochener Laeufe; Name enthaelt den Erstellungs-Zeitstempel).
const PREFIX = "stacct_";

const EMAIL_OLIVER = "admin@dienstplan.local";
const EMAIL_BETREIBER = "betreiber@dienstplan.local";
const EMAIL_DIENSTLEISTER = "dienstleister@dienstplan.local";
const EMAIL_ASSISTENT = "assistent@dienstplan.local";
const EMAIL_FREMD = "test1@tester.de";
// Eingeschleustes Fremdkonto im STANDARD-Team — MIT Vertrag in Team 1
// (Task #647): frueher galt es dadurch als "erwartetes Mitglied" der
// Endkontrolle und blieb dauerhaft liegen.
const EMAIL_FREMD_STD = "test2@tester.de";
// Eine der realen Assistenzkraefte aus der festen Whitelist des Skripts.
const EMAIL_REAL = "tolga_kahraman@hotmail.de";

let baseUrl: string;
let targetUrl: string;
let targetDbName: string;
let runOutput = "";
let runStatus: number | null = null;
let fremdId = 0;
let fremdTeamId = 0;
let dlTeamId = 0;
let stdTeamId = 0;
let fremdStdId = 0;
let realId = 0;

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

async function insertUser(
  client: pg.Client,
  name: string,
  email: string,
  role: string,
  accountType = "privat",
): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO users (name, email, role, account_type, is_active)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [name, email, role, accountType],
  );
  return res.rows[0]!.id;
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
    // Altlasten abgebrochener Laeufe entsorgen (best effort): nur DEUTLICH
    // alte Wegwerf-DBs droppen, damit parallele Laeufe nie ihre gerade
    // aktive DB verlieren.
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

  // Volles Drizzle-Schema in die frische DB pushen. drizzle-kit push beendet
  // sich auch bei "Interactive prompts require a TTY" mit Exit-Code 0 —
  // deshalb Ausgabe mitschneiden und den Fehlertext explizit werten (auf
  // einer LEEREN DB gibt es regulaer keine Rueckfragen).
  const childEnv = {
    ...process.env,
    DATABASE_URL: targetUrl,
    APP_DATABASE_URL: targetUrl,
  };
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: childEnv,
    timeout: 300_000,
  });
  const pushOutput = `${push.stdout ?? ""}${push.stderr ?? ""}`;
  if (
    push.status !== 0 ||
    push.error != null ||
    /Interactive prompts require a TTY/i.test(pushOutput)
  ) {
    throw new Error(`drizzle-kit push fehlgeschlagen:\n${pushOutput}`);
  }

  // Zielbild-Grundgeruest + eingeschleuste Altlast seeden.
  const seed = new pg.Client({ connectionString: targetUrl });
  await seed.connect();
  try {
    const oliverId = await insertUser(seed, "Oliver Straub", EMAIL_OLIVER, "admin");
    const betreiberId = await insertUser(seed, "Betreiber", EMAIL_BETREIBER, "superadmin");
    const dlId = await insertUser(
      seed,
      "Test-Dienstleister",
      EMAIL_DIENSTLEISTER,
      "admin",
      "dienstleister",
    );
    const assistentId = await insertUser(seed, "Test-Assistent", EMAIL_ASSISTENT, "assistant");

    const mkTeam = async (name: string, ownerId: number): Promise<number> => {
      const res = await seed.query<{ id: number }>(
        "INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING id",
        [name, ownerId],
      );
      const teamId = res.rows[0]!.id;
      await seed.query(
        "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)",
        [teamId, ownerId],
      );
      return teamId;
    };

    stdTeamId = await mkTeam("Standard-Team", oliverId);
    await mkTeam("Betreiber-Team", betreiberId);
    dlTeamId = await mkTeam("Dienstleister-Team", dlId);

    // Fremdkonto (altes manuelles Testkonto): eigenes Team samt Schichtmodell
    // und Schicht + eingeschleuste Mitgliedschaft und Datenbaum (Vertrag,
    // Schicht, Zeiterfassung, Plan-Historie) im Dienstleister-Team.
    fremdId = await insertUser(seed, "Alter Tester", EMAIL_FREMD, "admin");
    fremdTeamId = await mkTeam("Fremd-Team", fremdId);
    const fremdModel = await seed.query<{ id: number }>(
      `INSERT INTO shift_models (team_id, name, color, valuation_percent, sort_order)
       VALUES ($1, 'Fremd-Modell', '#123456', 100, 1) RETURNING id`,
      [fremdTeamId],
    );
    await seed.query(
      `INSERT INTO shifts (team_id, user_id, start_time, end_time, shift_model_id)
       VALUES ($1, $2, '2026-03-02 08:00', '2026-03-02 16:00', $3)`,
      [fremdTeamId, fremdId, fremdModel.rows[0]!.id],
    );

    await seed.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)",
      [dlTeamId, fremdId],
    );
    await seed.query(
      `INSERT INTO contracts (user_id, team_id, weekly_hours, vacation_days, start_date)
       VALUES ($1, $2, 20, 25, '2026-01-01')`,
      [fremdId, dlTeamId],
    );
    const dlShift = await seed.query<{ id: number }>(
      `INSERT INTO shifts (team_id, user_id, start_time, end_time)
       VALUES ($1, $2, '2026-03-03 08:00', '2026-03-03 16:00') RETURNING id`,
      [dlTeamId, fremdId],
    );
    await seed.query(
      `INSERT INTO time_tracking (team_id, user_id, shift_id, actual_start, actual_end)
       VALUES ($1, $2, $3, '2026-03-03 08:05', '2026-03-03 15:55')`,
      [dlTeamId, fremdId, dlShift.rows[0]!.id],
    );
    // plan_changes referenziert users OHNE Cascade — genau der FK, der das
    // Loeschen frueher blockierte.
    await seed.query(
      `INSERT INTO plan_changes (account_id, old_plan, new_plan, changed_by)
       VALUES ($1, 'free', 'premium', $2)`,
      [fremdId, fremdId],
    );

    // Kern-Konto als eingeschleustes Mitglied: darf NUR die Mitgliedschaft
    // verlieren, nie geloescht werden.
    await seed.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)",
      [dlTeamId, assistentId],
    );

    // Standard-Team (Task #647): reale Assistenzkraft (aus der festen
    // Whitelist) MIT Vertrag muss bleiben; eingeschleustes Fremdkonto MIT
    // Vertrag in Team 1 muss trotz Vertrags-"Tarnung" entfernt werden.
    realId = await insertUser(seed, "Tolga Kahraman", EMAIL_REAL, "assistant");
    await seed.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)",
      [stdTeamId, realId],
    );
    await seed.query(
      `INSERT INTO contracts (user_id, team_id, weekly_hours, vacation_days, start_date)
       VALUES ($1, $2, 30, 30, '2026-01-01')`,
      [realId, stdTeamId],
    );
    fremdStdId = await insertUser(seed, "Std-Eindringling", EMAIL_FREMD_STD, "assistant");
    await seed.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)",
      [stdTeamId, fremdStdId],
    );
    await seed.query(
      `INSERT INTO contracts (user_id, team_id, weekly_hours, vacation_days, start_date)
       VALUES ($1, $2, 20, 25, '2026-01-01')`,
      [fremdStdId, stdTeamId],
    );
  } finally {
    await seed.end();
  }

  // Das ECHTE Skript gegen die Wegwerf-DB laufen lassen.
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", "setup-test-accounts"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: childEnv,
      timeout: 300_000,
    },
  );
  if (result.error) throw result.error;
  runOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  runStatus = result.status;
}, 600_000);

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

describe("setup-test-accounts raeumt eingeschleuste Altlasten selbst weg", () => {
  it("laeuft trotz Fremdkonto fehlerfrei durch (Endkontrolle erreicht)", () => {
    expect(runStatus, runOutput).toBe(0);
    expect(runOutput).toContain("Endkontrolle OK");
    // Schritt 0 hat das Fremdkonto als Altlast erkannt und geloescht ...
    expect(runOutput).toContain(EMAIL_FREMD);
    expect(runOutput).toMatch(/Altlasten-Konto/);
    // ... und das Kern-Konto nur aus dem Team entfernt.
    expect(runOutput).toContain(
      `Mitgliedschaft von Kern-Konto ${EMAIL_ASSISTENT} entfernt`,
    );
    // Auch das Standard-Team hat sein Fremdkonto selbst entsorgt.
    expect(runOutput).toContain(EMAIL_FREMD_STD);
  });

  it("wirft das Fremdkonto MIT Vertrag aus dem Standard-Team, reale Assistenzkraft bleibt", async () => {
    const client = new pg.Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const members = await client.query<{ email: string }>(
        `SELECT u.email FROM team_members tm JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = $1 ORDER BY u.email`,
        [stdTeamId],
      );
      expect(members.rows.map((r) => r.email).sort()).toEqual(
        [EMAIL_OLIVER, EMAIL_REAL].sort(),
      );

      // Fremdkonto samt Datenbaum (inkl. Vertrag in Team 1) restlos weg.
      const fremdUsers = await client.query(
        "SELECT 1 FROM users WHERE id = $1 OR email = $2",
        [fremdStdId, EMAIL_FREMD_STD],
      );
      expect(fremdUsers.rowCount).toBe(0);
      const fremdContracts = await client.query(
        "SELECT 1 FROM contracts WHERE user_id = $1",
        [fremdStdId],
      );
      expect(fremdContracts.rowCount).toBe(0);

      // Reale Assistenzkraft behaelt Konto, Mitgliedschaft und Vertrag.
      const realContract = await client.query(
        "SELECT 1 FROM contracts WHERE user_id = $1 AND team_id = $2",
        [realId, stdTeamId],
      );
      expect(realContract.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("entfernt das Fremdkonto restlos samt Datenbaum (Konto, Team, Schichten, Vertraege, Zeiterfassung, Plan-Historie)", async () => {
    const client = new pg.Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const count = async (sql: string, params: unknown[]): Promise<number> => {
        const res = await client.query<{ n: number }>(sql, params);
        return res.rows[0]!.n;
      };

      expect(
        await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [EMAIL_FREMD]),
      ).toBe(0);
      expect(
        await count("SELECT count(*)::int AS n FROM teams WHERE id = $1", [fremdTeamId]),
      ).toBe(0);
      for (const table of ["shifts", "contracts", "time_tracking"]) {
        expect(
          await count(
            `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1 OR team_id = $2`,
            [fremdId, fremdTeamId],
          ),
          table,
        ).toBe(0);
      }
      expect(
        await count(
          "SELECT count(*)::int AS n FROM plan_changes WHERE account_id = $1 OR changed_by = $1",
          [fremdId],
        ),
      ).toBe(0);
      expect(
        await count("SELECT count(*)::int AS n FROM shift_models WHERE team_id = $1", [
          fremdTeamId,
        ]),
      ).toBe(0);
      expect(
        await count("SELECT count(*)::int AS n FROM team_members WHERE user_id = $1", [
          fremdId,
        ]),
      ).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("laesst die Kern-Konten unangetastet und erreicht das Zielbild", async () => {
    const client = new pg.Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const core = await client.query<{ email: string }>(
        "SELECT email FROM users WHERE email = ANY($1) ORDER BY email",
        [[EMAIL_OLIVER, EMAIL_BETREIBER, EMAIL_DIENSTLEISTER, EMAIL_ASSISTENT]],
      );
      expect(core.rows.map((r) => r.email).sort()).toEqual(
        [EMAIL_OLIVER, EMAIL_BETREIBER, EMAIL_DIENSTLEISTER, EMAIL_ASSISTENT].sort(),
      );

      // Dienstleister-Team: exakt Dienstleister + Mustermann 5-9 — kein
      // Fremdkonto, kein Kern-Konto mehr als Mitglied.
      const dlMembers = await client.query<{ email: string }>(
        `SELECT u.email FROM team_members tm JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = $1 ORDER BY u.email`,
        [dlTeamId],
      );
      expect(dlMembers.rows.map((r) => r.email).sort()).toEqual(
        [
          EMAIL_DIENSTLEISTER,
          ...[5, 6, 7, 8, 9].map((n) => `max.mustermann${n}@dienstplan.local`),
        ].sort(),
      );
    } finally {
      await client.end();
    }
  });
});
