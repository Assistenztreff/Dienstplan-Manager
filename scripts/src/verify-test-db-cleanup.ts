import { execSync } from "node:child_process";
import pg from "pg";
import { TEAM_BOUND_TABLES } from "./lib/account-tree.js";
import { deriveTestDbUrl } from "./lib/test-db-url.js";

/**
 * Beweist automatisiert, dass die Test-DB nach einem ABGEBROCHENEN E2E-Lauf
 * wirklich sauber startet (Selbstheilung via `cleanup-test-accounts`).
 *
 * Ablauf:
 *   1. FK-Wächter: Alle Tabellen mit nicht-kaskadierendem FK auf `teams.id`
 *      werden aus dem Katalog (pg_constraint) gelesen und MÜSSEN exakt der
 *      Liste `TEAM_BOUND_TABLES` in `lib/account-tree.ts` entsprechen. Kommt
 *      eine neue team-gebundene Tabelle ohne Cleanup-Zweig hinzu, schlägt der
 *      Check hier sofort fehl — bevor die Test-DB still Leichen ansammelt.
 *   2. Abbruch-Simulation: Ein Zombie-Konto (`e2e.zombie…@dienstplan.test`)
 *      wird DIREKT in die `_test`-DB geschrieben — mit eigenem Team, einem
 *      verwaisten Assistenten und je einer Zeile in JEDER team-gebundenen
 *      Tabelle sowie den kaskadierenden Tabellen (team_members,
 *      allowance_settings-Override, team_branding_settings). Genau der
 *      Zustand, den ein per Ctrl-C/Timeout gekillter Lauf hinterlässt
 *      (afterAll-Hooks liefen nie).
 *   3. `cleanup-test-accounts` läuft gegen die `_test`-DB (wie in
 *      `setup-test-db` vor jedem Lauf bzw. im Playwright-globalTeardown).
 *   4. Assertions: Kein `e2e.*@dienstplan.test`-Konto mehr, Zombie-Team und
 *      verwaister Assistent weg, alle team-gebundenen Zeilen weg — und der
 *      geseedete Test-Admin (`admin@dienstplan.local`) lebt unverändert.
 *
 * Läuft AUSSCHLIESSLICH gegen die `_test`-DB (abgeleitet aus DATABASE_URL),
 * die Dev-DB wird nie berührt. Fehlt die `_test`-DB, wird sie automatisch
 * über `setup-test-db` provisioniert. Exit 0 = bewiesen sauber, Exit 1 =
 * Regression (Fehlermeldung nennt die Ursache).
 */

const ZOMBIE_ADMIN_EMAIL = "e2e.zombie-cleanup-check@dienstplan.test";
// BEWUSST ohne `e2e.`-Präfix: Der Verwaiste wird NICHT über das E-Mail-Muster
// gefunden, sondern muss über den Orphan-Zweig des Cleanups (Assistent, der
// AUSSCHLIESSLICH Mitglied der gelöschten Teams ist) mit abgeräumt werden —
// genau wie per Einladung angelegte Assistenten eines Zombie-Kontos.
const ZOMBIE_ORPHAN_EMAIL = "zombie.orphan-cleanup-check@dienstplan.test";
const SEED_ADMIN_EMAIL = "admin@dienstplan.local";

class CheckError extends Error {}

async function main(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  const { url: testUrl, name: testDbName } = deriveTestDbUrl(base);

  // _test-DB bei Bedarf provisionieren (idempotent).
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    testDbName,
  ]);
  await admin.end();
  if (exists.rowCount === 0) {
    console.log(`Test-DB "${testDbName}" fehlt — provisioniere via setup-test-db …`);
    execSync("pnpm --filter @workspace/scripts run setup-test-db", {
      stdio: "inherit",
      timeout: 300_000,
    });
  }

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();

  try {
    // ------------------------------------------------------------------
    // 1) FK-Wächter: neue team-gebundene Tabelle ohne Cleanup-Zweig?
    // ------------------------------------------------------------------
    const fkRes = await client.query<{ table_name: string }>(
      `SELECT c.conrelid::regclass::text AS table_name
         FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confrelid = 'teams'::regclass
          AND c.confdeltype <> 'c'
        ORDER BY 1`,
    );
    const actual = new Set(fkRes.rows.map((r) => r.table_name));
    const expected = new Set<string>(TEAM_BOUND_TABLES);
    const missingInCleanup = [...actual].filter((t) => !expected.has(t));
    const staleInCleanup = [...expected].filter((t) => !actual.has(t));
    if (missingInCleanup.length > 0) {
      throw new CheckError(
        `Neue team-gebundene Tabelle(n) OHNE Cleanup-Zweig entdeckt: ${missingInCleanup.join(", ")}. ` +
          `Bitte in TEAM_BOUND_TABLES (scripts/src/lib/account-tree.ts) ergänzen — ` +
          `sonst scheitert das Team-Löschen mit FK-Fehler und die Test-DB sammelt Konten-Leichen an.`,
      );
    }
    if (staleInCleanup.length > 0) {
      throw new CheckError(
        `TEAM_BOUND_TABLES enthält Tabelle(n) ohne nicht-kaskadierenden FK auf teams.id: ` +
          `${staleInCleanup.join(", ")}. Liste in scripts/src/lib/account-tree.ts bereinigen ` +
          `(oder Test-DB-Schema ist veraltet — setup-test-db ausführen).`,
      );
    }
    console.log(
      `FK-Wächter OK: ${actual.size} team-gebundene Tabelle(n) ohne Cascade, alle im Cleanup abgedeckt.`,
    );

    // ------------------------------------------------------------------
    // 2) Abbruch simulieren: Zombie-Baum direkt in die _test-DB schreiben.
    // ------------------------------------------------------------------
    // Reste eines früheren Check-Laufs entsorgen (idempotent).
    await client.query("DELETE FROM users WHERE email IN ($1, $2)", [
      ZOMBIE_ADMIN_EMAIL,
      ZOMBIE_ORPHAN_EMAIL,
    ]);

    const seedAdminBefore = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE email = $1",
      [SEED_ADMIN_EMAIL],
    );
    if (seedAdminBefore.rowCount !== 1) {
      throw new CheckError(
        `Seed-Admin "${SEED_ADMIN_EMAIL}" fehlt in der Test-DB — erst setup-test-db ausführen.`,
      );
    }

    const zombie = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, role, account_type)
       VALUES ('Zombie Cleanup-Check', $1, 'admin', 'privat') RETURNING id`,
      [ZOMBIE_ADMIN_EMAIL],
    );
    const zombieId = zombie.rows[0].id;

    const orphan = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, role)
       VALUES ('Zombie Verwaister Assistent', $1, 'assistant') RETURNING id`,
      [ZOMBIE_ORPHAN_EMAIL],
    );
    const orphanId = orphan.rows[0].id;

    const team = await client.query<{ id: number }>(
      `INSERT INTO teams (name, owner_id) VALUES ('Zombie-Team', $1) RETURNING id`,
      [zombieId],
    );
    const teamId = team.rows[0].id;

    await client.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2), ($1, $3)",
      [teamId, zombieId, orphanId],
    );

    // Je eine Zeile in JEDER team-gebundenen Tabelle (nicht-kaskadierend) …
    const model = await client.query<{ id: number }>(
      `INSERT INTO shift_models (team_id, name) VALUES ($1, 'Zombie-Dienst') RETURNING id`,
      [teamId],
    );
    await client.query(
      `INSERT INTO shift_templates (team_id, name, start_time, end_time)
       VALUES ($1, 'Zombie-Vorlage', '08:00', '16:00')`,
      [teamId],
    );
    await client.query(
      `INSERT INTO contracts (team_id, user_id, weekly_hours, start_date)
       VALUES ($1, $2, 30, '2026-01-01')`,
      [teamId, orphanId],
    );
    const shift = await client.query<{ id: number }>(
      `INSERT INTO shifts (team_id, user_id, shift_model_id, start_time, end_time)
       VALUES ($1, $2, $3, '2026-07-01 08:00', '2026-07-01 16:00') RETURNING id`,
      [teamId, orphanId, model.rows[0].id],
    );
    await client.query(
      `INSERT INTO time_tracking (team_id, user_id, shift_id, actual_start, actual_end)
       VALUES ($1, $2, $3, '2026-07-01 08:00', '2026-07-01 16:05')`,
      [teamId, orphanId, shift.rows[0].id],
    );

    // … plus kaskadierende Team-Anhängsel (müssen mit dem Team verschwinden).
    await client.query(
      "INSERT INTO allowance_settings (owner_id, team_id) VALUES ($1, $2)",
      [zombieId, teamId],
    );
    await client.query(
      "INSERT INTO team_branding_settings (team_id, logo_path) VALUES ($1, '/tmp/zombie.png')",
      [teamId],
    );

    console.log(
      `Zombie-Baum geseedet (Konto #${zombieId}, Team #${teamId}, verwaister Assistent #${orphanId}, ` +
        `je 1 Zeile in ${TEAM_BOUND_TABLES.join(", ")} + Cascade-Tabellen).`,
    );

    // ------------------------------------------------------------------
    // 3) Selbstheilung ausführen (wie setup-test-db / globalTeardown).
    // ------------------------------------------------------------------
    execSync("pnpm --filter @workspace/scripts run cleanup-test-accounts", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl },
      timeout: 120_000,
    });

    // ------------------------------------------------------------------
    // 4) Assertions.
    // ------------------------------------------------------------------
    const failures: string[] = [];

    const zombieUsers = await client.query(
      "SELECT email FROM users WHERE email LIKE 'e2e.%@dienstplan.test'",
    );
    if ((zombieUsers.rowCount ?? 0) > 0) {
      failures.push(
        `E2E-Konten überlebten den Cleanup: ${zombieUsers.rows.map((r) => r.email).join(", ")}`,
      );
    }

    const orphanLeft = await client.query("SELECT 1 FROM users WHERE id = $1", [orphanId]);
    if ((orphanLeft.rowCount ?? 0) > 0) {
      failures.push("Verwaister Assistent (nur Mitglied im Zombie-Team) wurde NICHT gelöscht.");
    }

    const teamLeft = await client.query("SELECT 1 FROM teams WHERE id = $1", [teamId]);
    if ((teamLeft.rowCount ?? 0) > 0) {
      failures.push("Zombie-Team wurde NICHT gelöscht.");
    }

    for (const table of TEAM_BOUND_TABLES) {
      const left = await client.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE team_id = $1`,
        [teamId],
      );
      if (left.rows[0].n > 0) {
        failures.push(`Tabelle "${table}" enthält noch ${left.rows[0].n} Zombie-Zeile(n).`);
      }
    }
    for (const table of ["team_members", "allowance_settings", "team_branding_settings"]) {
      const left = await client.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE team_id = $1`,
        [teamId],
      );
      if (left.rows[0].n > 0) {
        failures.push(`Cascade-Tabelle "${table}" enthält noch ${left.rows[0].n} Zombie-Zeile(n).`);
      }
    }

    const seedAdminAfter = await client.query("SELECT 1 FROM users WHERE email = $1", [
      SEED_ADMIN_EMAIL,
    ]);
    if (seedAdminAfter.rowCount !== 1) {
      failures.push(`Seed-Admin "${SEED_ADMIN_EMAIL}" hat den Cleanup NICHT überlebt!`);
    }

    if (failures.length > 0) {
      throw new CheckError(
        `Selbstheilungs-Check FEHLGESCHLAGEN:\n  - ${failures.join("\n  - ")}`,
      );
    }

    console.log(
      "Selbstheilungs-Check OK: Zombie-Baum vollständig entfernt, Seed-Admin unangetastet — " +
        "die Test-DB startet nach einem abgebrochenen Lauf sauber.",
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  if (err instanceof CheckError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fehler beim Selbstheilungs-Check:", err);
  }
  process.exit(1);
});
