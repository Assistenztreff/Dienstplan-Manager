/**
 * In-process ausfuehrbare Vorlauf-Checks fuer die isolierte E2E-Test-DB.
 *
 * Die Kernlogik der drei Checks
 *   - Testkonten-Trennung   (verify-account-separation)
 *   - Selbstheilung Konten  (verify-test-db-cleanup)
 *   - Fehlerzeilen-Cleanup  (verify-test-platform-errors-cleanup)
 * lebt hier als gemeinsame async-Funktionen OHNE Prozess-Seiteneffekte, damit
 * sie sowohl
 *   - von `artifacts/dienstplan/playwright.config.ts` per Top-Level-await
 *     direkt beim Config-Load laufen koennen (spart ~2-4s pnpm/tsx-Prozess-
 *     Startkosten PRO Check und Lauf), als auch
 *   - von den duennen CLI-Wrappern in `scripts/src/verify-*.ts` fuer manuelle
 *     Laeufe genutzt werden.
 *
 * Fehlerkontrakt: Eine erkannte Regression wirft `CheckError` mit einer
 * deutschen Fehlermeldung; alle anderen Fehler (DB nicht erreichbar etc.)
 * propagieren unveraendert. Beide brechen einen E2E-Lauf ab.
 *
 * Die Skripte, die GEPRUEFT werden (setup-test-accounts, migrate-teams,
 * cleanup-test-accounts, cleanup-test-platform-errors, setup-test-db), laufen
 * weiterhin bewusst als echte pnpm-Kindprozesse — genau diese CLI-Einstiege
 * sind der Pruefgegenstand bzw. die Selbstheilung.
 *
 * Alle Checks arbeiten AUSSCHLIESSLICH gegen die `_test`-DB (abgeleitet aus
 * der uebergebenen Dev-`DATABASE_URL`); die Dev-DB wird nie beruehrt.
 */

import { execSync } from "node:child_process";
import pg from "pg";
import {
  TEAM_BOUND_TABLES,
  deleteAccountTrees,
  TEST_ERROR_CONTEXTS,
} from "./index.js";

/** Erkannter Regressions-Fehlschlag eines Checks (Meldung nennt die Ursache). */
export class CheckError extends Error {}

/**
 * Leitet aus der Dev-`DATABASE_URL` die URL der isolierten Test-Datenbank
 * (`<dbname>_test`) ab.
 */
export function deriveTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(base);
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const testName = `${current}_test`;
  u.pathname = `/${testName}`;
  return { url: u.toString(), name: testName };
}

function provisionTestDb(reason: string): void {
  console.log(`${reason} — provisioniere via setup-test-db …`);
  execSync("pnpm --filter @workspace/scripts run setup-test-db", {
    stdio: "inherit",
    timeout: 300_000,
  });
}

/** Prueft, ob die `_test`-DB existiert; provisioniert sie bei Bedarf. */
async function ensureTestDbExists(base: string, testDbName: string): Promise<void> {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    testDbName,
  ]);
  await admin.end();
  if (exists.rowCount === 0) {
    provisionTestDb(`Test-DB "${testDbName}" fehlt`);
  }
}

function requireBaseUrl(base: string | undefined): string {
  if (!base) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  return base;
}

// ---------------------------------------------------------------------------
// Check 1: Testkonten-Trennung (ehem. scripts/src/verify-account-separation.ts)
// ---------------------------------------------------------------------------

const EMAIL_OLIVER = "admin@dienstplan.local";
const EMAIL_BETREIBER = "betreiber@dienstplan.local";
const EMAIL_DIENSTLEISTER = "dienstleister@dienstplan.local";
const EMAIL_ASSISTENT = "assistent@dienstplan.local";

// Stellvertreter fuer die 7 realen Assistenzkraefte in Olivers Team.
const REAL_ASSISTANT_COUNT = 7;
const realAssistantEmail = (n: number): string =>
  `verify.assistenzkraft${n}@dienstplan.local`;

async function findUserId(client: pg.Client, email: string): Promise<number | null> {
  const res = await client.query<{ id: number }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  return res.rows[0]?.id ?? null;
}

async function ensureUser(
  client: pg.Client,
  name: string,
  email: string,
  role: "admin" | "assistant" | "superadmin",
  accountType: "privat" | "dienstleister",
): Promise<number> {
  const existing = await findUserId(client, email);
  if (existing !== null) return existing;
  const res = await client.query<{ id: number }>(
    `INSERT INTO users (name, email, role, account_type, is_active)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [name, email, role, accountType],
  );
  return res.rows[0]!.id;
}

/**
 * Entfernt die vom Trennungs-Check geseedete Konstellation restlos
 * (idempotent). Laeuft VOR dem Seeden (Reste eines abgebrochenen Laufs) und
 * im finally (E2E-Laeufe sollen die Standard-Testdatenbank vorfinden).
 */
async function cleanupSeededConstellation(client: pg.Client): Promise<void> {
  // Betreiber + Dienstleister samt Team-Baeumen (loescht auch die Dummys
  // Max Mustermann 1-9 und den Test-Assistenten als verwaiste Mitglieder).
  const owners: number[] = [];
  for (const email of [EMAIL_BETREIBER, EMAIL_DIENSTLEISTER]) {
    const id = await findUserId(client, email);
    if (id !== null) owners.push(id);
  }
  if (owners.length > 0) {
    await deleteAccountTrees(client, owners);
  }
  // Rest ohne Team-Besitz: Test-Assistent (falls uebrig), die 7
  // Verify-Assistenzkraefte, versprengte Dummys. user_id-FKs (contracts,
  // team_members, …) kaskadieren beim User-Delete.
  await client.query(
    `DELETE FROM users
      WHERE email = $1
         OR email LIKE 'verify.assistenzkraft%@dienstplan.local'
         OR email LIKE 'max.mustermann%@dienstplan.local'`,
    [EMAIL_ASSISTENT],
  );
}

interface MembershipRow {
  team_id: number;
  team_name: string;
  email: string;
}

async function membershipSnapshot(client: pg.Client): Promise<MembershipRow[]> {
  // Fremde `e2e.*@dienstplan.test`-Konten (Spec-Fixtures paralleler Laeufe auf
  // der geteilten _test-DB) bewusst AUSBLENDEN: sie gehoeren nie zur hier
  // geseedeten Konstellation und entstehen/verschwinden sonst mitten zwischen
  // Vorher- und Nachher-Snapshot — der Check meldet dann faelschlich, dass
  // migrate-teams Mitgliedschaften hinzugefuegt/entfernt haette (Task #622).
  // Die eigentliche Regression (migrate-teams veraendert die Belegung der
  // Testkonten) bleibt voll abgedeckt: alle eigenen Fixtures (@dienstplan.local)
  // sind weiterhin im Snapshot.
  const res = await client.query<MembershipRow>(
    `SELECT tm.team_id, t.name AS team_name, u.email
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN users u ON u.id = tm.user_id
      WHERE u.email NOT LIKE 'e2e.%@dienstplan.test'
      ORDER BY tm.team_id, u.email`,
  );
  return res.rows;
}

const membershipKey = (r: MembershipRow): string => `${r.team_id}:${r.email}`;

/**
 * Beweist, dass die Team-Trennung der Dev-Testkonten einen kompletten
 * Merge-Zyklus (setup-test-accounts gefolgt von migrate-teams) unbeschadet
 * uebersteht — Regressionscheck: migrate-teams darf Nutzer mit bestehender
 * Mitgliedschaft NIE wieder ins erste Team einfuegen.
 *
 * Wirft `CheckError` bei Regression; raeumt in jedem Fall hinter sich auf.
 */
export async function runAccountSeparationCheck(
  baseDatabaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  const base = requireBaseUrl(baseDatabaseUrl);
  const { url: testUrl, name: testDbName } = deriveTestDbUrl(base);

  await ensureTestDbExists(base, testDbName);

  // Schema-Drift-Waechter: eine veraltete _test-DB (z. B. role-Enum ohne
  // 'superadmin') liesse das Seeden scheitern. setup-test-db pusht das
  // Schema und heilt notfalls per Drop+Recreate.
  {
    const probe = new pg.Client({ connectionString: testUrl });
    await probe.connect();
    const enumOk = await probe.query(
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'role' AND e.enumlabel = 'superadmin'`,
    );
    await probe.end();
    if (enumOk.rowCount === 0) {
      provisionTestDb(`Test-DB "${testDbName}" hat ein veraltetes Schema`);
    }
  }

  const runAgainstTestDb = (script: string): void => {
    execSync(`pnpm --filter @workspace/scripts run ${script}`, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl, APP_DATABASE_URL: testUrl },
      timeout: 180_000,
    });
  };

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();

  try {
    // ------------------------------------------------------------------
    // 1) Vorbedingungen + Reste frueherer Laeufe entsorgen.
    // ------------------------------------------------------------------
    const oliverId = await findUserId(client, EMAIL_OLIVER);
    if (oliverId === null) {
      throw new CheckError(
        `Seed-Admin "${EMAIL_OLIVER}" fehlt in der Test-DB — erst setup-test-db ausführen.`,
      );
    }
    const mainTeam = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [oliverId],
    );
    if (!mainTeam.rows[0]) {
      throw new CheckError(
        "Seed-Admin besitzt kein Team in der Test-DB — erst setup-test-db ausführen.",
      );
    }
    const mainTeamId = mainTeam.rows[0].id;

    await cleanupSeededConstellation(client);

    // ------------------------------------------------------------------
    // 2) Testkonten-Konstellation seeden.
    // ------------------------------------------------------------------
    const betreiberId = await ensureUser(
      client, "Betreiber", EMAIL_BETREIBER, "superadmin", "privat",
    );
    const dienstleisterId = await ensureUser(
      client, "Test-Dienstleister", EMAIL_DIENSTLEISTER, "admin", "dienstleister",
    );
    await ensureUser(client, "Test-Assistent", EMAIL_ASSISTENT, "assistant", "privat");

    // Dienstleister braucht ein eigenes Team (setup-test-accounts erwartet es).
    const dlOwned = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [dienstleisterId],
    );
    if (!dlOwned.rows[0]) {
      await client.query(
        "INSERT INTO teams (name, owner_id) VALUES ('Dienstleister-Team', $1)",
        [dienstleisterId],
      );
    }

    // 7 "reale" Assistenzkraefte mit Vertrag + Mitgliedschaft in Team 1
    // (die Endkontrolle von setup-test-accounts nutzt die Vertraege in
    // Team 1 als Whitelist der erwarteten Mitglieder).
    for (let n = 1; n <= REAL_ASSISTANT_COUNT; n++) {
      const id = await ensureUser(
        client, `Verify Assistenzkraft ${n}`, realAssistantEmail(n), "assistant", "privat",
      );
      await client.query(
        `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [mainTeamId, id],
      );
      const contract = await client.query(
        "SELECT 1 FROM contracts WHERE user_id = $1 AND team_id = $2",
        [id, mainTeamId],
      );
      if (contract.rowCount === 0) {
        await client.query(
          `INSERT INTO contracts (user_id, team_id, weekly_hours, vacation_days, start_date)
           VALUES ($1, $2, 30, 30, '2026-01-01')`,
          [id, mainTeamId],
        );
      }
    }
    console.log(
      `Konstellation geseedet: Betreiber #${betreiberId}, Dienstleister #${dienstleisterId}, ` +
        `Test-Assistent, ${REAL_ASSISTANT_COUNT} Assistenzkraefte in Team ${mainTeamId}.`,
    );

    // ------------------------------------------------------------------
    // 3) setup-test-accounts gegen die _test-DB (eigene Endkontrolle
    //    prueft die Ziel-Belegung bereits fail-fast).
    // ------------------------------------------------------------------
    console.log("\n--- setup-test-accounts (Test-DB) ---");
    runAgainstTestDb("setup-test-accounts");

    // ------------------------------------------------------------------
    // 4) Snapshot der Team-Belegung festhalten.
    // ------------------------------------------------------------------
    const before = await membershipSnapshot(client);
    const beforeKeys = new Set(before.map(membershipKey));

    // ------------------------------------------------------------------
    // 5) migrate-teams — der historisch gefaehrliche Merge-Schritt.
    // ------------------------------------------------------------------
    console.log("\n--- migrate-teams (Test-DB) ---");
    runAgainstTestDb("migrate-teams");

    // ------------------------------------------------------------------
    // 6) Assertions.
    // ------------------------------------------------------------------
    const failures: string[] = [];

    const after = await membershipSnapshot(client);
    const afterKeys = new Set(after.map(membershipKey));
    for (const r of after) {
      if (!beforeKeys.has(membershipKey(r))) {
        failures.push(
          `migrate-teams hat eine Mitgliedschaft HINZUGEFUEGT: ${r.email} in Team ${r.team_id} ("${r.team_name}") — die Trennung ist wieder kaputt.`,
        );
      }
    }
    for (const r of before) {
      if (!afterKeys.has(membershipKey(r))) {
        failures.push(
          `migrate-teams hat eine Mitgliedschaft ENTFERNT: ${r.email} aus Team ${r.team_id} ("${r.team_name}").`,
        );
      }
    }

    // Dashboard-Zaehler: aktive Assistenten pro Team (wie die Kachel im
    // Dashboard zaehlt) — Oliver 7, Dienstleister 5, Betreiber 5.
    const activeAssistants = async (ownerId: number): Promise<number> => {
      const res = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           JOIN teams t ON t.id = tm.team_id
          WHERE t.owner_id = $1 AND u.role = 'assistant' AND u.is_active
            -- Fremde e2e-Spec-Fixtures paralleler Laeufe nicht mitzaehlen
            -- (geteilte _test-DB, Task #622).
            AND u.email NOT LIKE 'e2e.%@dienstplan.test'`,
        [ownerId],
      );
      return res.rows[0]!.n;
    };

    const expectations: Array<[string, number, number]> = [
      ["Oliver (Team 1)", await activeAssistants(oliverId), REAL_ASSISTANT_COUNT],
      ["Dienstleister", await activeAssistants(dienstleisterId), 5],
      ["Betreiber", await activeAssistants(betreiberId), 5],
    ];
    for (const [label, actual, expected] of expectations) {
      if (actual !== expected) {
        failures.push(
          `Zaehler "${label}": ${actual} aktive Assistenten statt erwarteter ${expected}.`,
        );
      }
    }

    if (failures.length > 0) {
      throw new CheckError(
        `Testkonten-Trennungs-Check FEHLGESCHLAGEN:\n  - ${failures.join("\n  - ")}`,
      );
    }

    console.log(
      "\nTrennungs-Check OK: setup-test-accounts + migrate-teams lassen die " +
        `Team-Belegung unveraendert (Oliver ${REAL_ASSISTANT_COUNT} / Dienstleister 5 / Betreiber 5 aktive Assistenten).`,
    );
  } finally {
    // _test-DB wieder in den Standard-Zustand versetzen (nur Seed-Admin +
    // Standard-Team), damit E2E-Laeufe keine fremden Konten vorfinden.
    try {
      await cleanupSeededConstellation(client);
      console.log("Aufgeraeumt: geseedete Konstellation aus der Test-DB entfernt.");
    } catch (cleanupErr) {
      console.error("WARNUNG: Aufraeumen der Test-DB fehlgeschlagen:", cleanupErr);
    }
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Check 2: Selbstheilung Konten (ehem. scripts/src/verify-test-db-cleanup.ts)
// ---------------------------------------------------------------------------

const ZOMBIE_ADMIN_EMAIL = "e2e.zombie-cleanup-check@dienstplan.test";
// BEWUSST ohne `e2e.`-Praefix: Der Verwaiste wird NICHT ueber das E-Mail-Muster
// gefunden, sondern muss ueber den Orphan-Zweig des Cleanups (Assistent, der
// AUSSCHLIESSLICH Mitglied der geloeschten Teams ist) mit abgeraeumt werden —
// genau wie per Einladung angelegte Assistenten eines Zombie-Kontos.
const ZOMBIE_ORPHAN_EMAIL = "zombie.orphan-cleanup-check@dienstplan.test";
const SEED_ADMIN_EMAIL = "admin@dienstplan.local";

/**
 * Beweist, dass die Test-DB nach einem ABGEBROCHENEN E2E-Lauf wirklich sauber
 * startet (Selbstheilung via `cleanup-test-accounts`), inkl. FK-Waechter fuer
 * neue team-gebundene Tabellen ohne Cleanup-Zweig.
 *
 * Wirft `CheckError` bei Regression.
 */
export async function runTestDbCleanupCheck(
  baseDatabaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  const base = requireBaseUrl(baseDatabaseUrl);
  const { url: testUrl, name: testDbName } = deriveTestDbUrl(base);

  await ensureTestDbExists(base, testDbName);

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();

  try {
    // ------------------------------------------------------------------
    // 1) FK-Waechter: neue team-gebundene Tabelle ohne Cleanup-Zweig?
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
          `Bitte in TEAM_BOUND_TABLES (lib/test-fixtures/src/account-tree.ts) ergänzen — ` +
          `sonst scheitert das Team-Löschen mit FK-Fehler und die Test-DB sammelt Konten-Leichen an.`,
      );
    }
    if (staleInCleanup.length > 0) {
      throw new CheckError(
        `TEAM_BOUND_TABLES enthält Tabelle(n) ohne nicht-kaskadierenden FK auf teams.id: ` +
          `${staleInCleanup.join(", ")}. Liste in lib/test-fixtures/src/account-tree.ts bereinigen ` +
          `(oder Test-DB-Schema ist veraltet — setup-test-db ausführen).`,
      );
    }
    console.log(
      `FK-Wächter OK: ${actual.size} team-gebundene Tabelle(n) ohne Cascade, alle im Cleanup abgedeckt.`,
    );

    // ------------------------------------------------------------------
    // 2) Abbruch simulieren: Zombie-Baum direkt in die _test-DB schreiben.
    // ------------------------------------------------------------------
    // Reste eines frueheren Check-Laufs entsorgen (idempotent).
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
    const zombieId = zombie.rows[0]!.id;

    const orphan = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, role)
       VALUES ('Zombie Verwaister Assistent', $1, 'assistant') RETURNING id`,
      [ZOMBIE_ORPHAN_EMAIL],
    );
    const orphanId = orphan.rows[0]!.id;

    const team = await client.query<{ id: number }>(
      `INSERT INTO teams (name, owner_id) VALUES ('Zombie-Team', $1) RETURNING id`,
      [zombieId],
    );
    const teamId = team.rows[0]!.id;

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
      `INSERT INTO contracts (team_id, user_id, weekly_hours, start_date)
       VALUES ($1, $2, 30, '2026-01-01')`,
      [teamId, orphanId],
    );
    const shift = await client.query<{ id: number }>(
      `INSERT INTO shifts (team_id, user_id, shift_model_id, start_time, end_time)
       VALUES ($1, $2, $3, '2026-07-01 08:00', '2026-07-01 16:00') RETURNING id`,
      [teamId, orphanId, model.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO time_tracking (team_id, user_id, shift_id, actual_start, actual_end)
       VALUES ($1, $2, $3, '2026-07-01 08:00', '2026-07-01 16:05')`,
      [teamId, orphanId, shift.rows[0]!.id],
    );

    // … plus kaskadierende Team-Anhaengsel (muessen mit dem Team verschwinden).
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
    // 3) Selbstheilung ausfuehren (wie setup-test-db / globalTeardown).
    // ------------------------------------------------------------------
    execSync("pnpm --filter @workspace/scripts run cleanup-test-accounts", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl, APP_DATABASE_URL: testUrl },
      timeout: 120_000,
    });

    // ------------------------------------------------------------------
    // 4) Assertions.
    // ------------------------------------------------------------------
    const failures: string[] = [];

    // Nur das EIGENE Zombie-Konto pruefen — nicht pauschal alle
    // `e2e.*@dienstplan.test`-Konten: auf der geteilten _test-DB koennen
    // parallele fremde Laeufe jederzeit neue e2e-Konten anlegen (nach dem
    // Cleanup, vor dieser Assertion), was den Check faelschlich kippen
    // wuerde (Task #622). Der Beweis "Cleanup entfernt e2e-Konten" haengt
    // nur am eigenen geseedeten Konto.
    const zombieUsers = await client.query<{ email: string }>(
      "SELECT email FROM users WHERE email = $1",
      [ZOMBIE_ADMIN_EMAIL],
    );
    if ((zombieUsers.rowCount ?? 0) > 0) {
      failures.push(
        `E2E-Zombie-Konto überlebte den Cleanup: ${zombieUsers.rows.map((r) => r.email).join(", ")}`,
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
      const left = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE team_id = $1`,
        [teamId],
      );
      if (left.rows[0]!.n > 0) {
        failures.push(`Tabelle "${table}" enthält noch ${left.rows[0]!.n} Zombie-Zeile(n).`);
      }
    }
    for (const table of ["team_members", "allowance_settings", "team_branding_settings"]) {
      const left = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE team_id = $1`,
        [teamId],
      );
      if (left.rows[0]!.n > 0) {
        failures.push(`Cascade-Tabelle "${table}" enthält noch ${left.rows[0]!.n} Zombie-Zeile(n).`);
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

// ---------------------------------------------------------------------------
// Check 3: Fehlerzeilen-Cleanup
// (ehem. scripts/src/verify-test-platform-errors-cleanup.ts)
// ---------------------------------------------------------------------------

// Eindeutiger Marker fuer alle von diesem Check geseedeten Zeilen. So werden
// niemals fremde (echte) platform_errors-Zeilen mitgezaehlt oder geloescht.
const CHECK_MARKER = "e2e-cleanup-proof/platform-errors-verify";
// Kontext der "echten" Fehlerzeile: BEWUSST KEIN Test-Kontext — sie muss den
// Cleanup ueberleben. Traegt zusaetzlich den CHECK_MARKER, damit dieser Check
// sie am Ende selbst entfernt (der Cleanup laesst sie stehen).
const REAL_ERROR_CONTEXT = "verify/real-platform-error-must-survive";

/**
 * Beweist, dass der Fehlerzeilen-Cleanup (`cleanup-test-platform-errors`)
 * wirklich greift (beide Test-Kontexte weg) UND echte Fehler verschont
 * (fremder Kontext bleibt), zweiter Lauf idempotent.
 *
 * Wirft `CheckError` bei Regression; raeumt eigene Seeds in jedem Fall auf.
 */
export async function runPlatformErrorsCleanupCheck(
  baseDatabaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  const base = requireBaseUrl(baseDatabaseUrl);
  const { url: testUrl, name: testDbName } = deriveTestDbUrl(base);

  await ensureTestDbExists(base, testDbName);

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();

  const runCleanup = (): void => {
    execSync("pnpm --filter @workspace/scripts run cleanup-test-platform-errors", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl, APP_DATABASE_URL: testUrl },
      timeout: 120_000,
    });
  };

  // Zaehlt eigene Seed-Zeilen (ueber den Marker) mit einem bestimmten Kontext.
  const countOwn = async (context: string): Promise<number> => {
    const res = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_errors WHERE context = $1 AND message LIKE $2 || '%'",
      [context, CHECK_MARKER],
    );
    return res.rows[0]!.n;
  };

  try {
    // ------------------------------------------------------------------
    // 1) Reste eines frueheren Check-Laufs entsorgen (idempotent).
    // ------------------------------------------------------------------
    await client.query("DELETE FROM platform_errors WHERE message LIKE $1 || '%'", [
      CHECK_MARKER,
    ]);

    // ------------------------------------------------------------------
    // 2) Seeden: je eine Test-Kontext-Zeile + eine echte Fehlerzeile.
    // ------------------------------------------------------------------
    for (const context of TEST_ERROR_CONTEXTS) {
      await client.query(
        "INSERT INTO platform_errors (level, message, context) VALUES ('warning', $1, $2)",
        [`${CHECK_MARKER} ${context}`, context],
      );
    }
    await client.query(
      "INSERT INTO platform_errors (level, message, context) VALUES ('error', $1, $2)",
      [`${CHECK_MARKER} echter Fehler`, REAL_ERROR_CONTEXT],
    );
    console.log(
      `Geseedet: je 1 Zeile fuer ${TEST_ERROR_CONTEXTS.join(", ")} + 1 echte Zeile ` +
        `(Kontext "${REAL_ERROR_CONTEXT}").`,
    );

    // Vorbedingung bestaetigen, damit ein spaeterer "alles weg" nicht faelsch
    // als Erfolg durchgeht, obwohl gar nichts geseedet wurde.
    for (const context of TEST_ERROR_CONTEXTS) {
      if ((await countOwn(context)) !== 1) {
        throw new CheckError(
          `Vorbedingung verletzt: Test-Kontext-Zeile "${context}" wurde nicht angelegt.`,
        );
      }
    }
    if ((await countOwn(REAL_ERROR_CONTEXT)) !== 1) {
      throw new CheckError(
        "Vorbedingung verletzt: echte Fehlerzeile wurde nicht angelegt.",
      );
    }

    // ------------------------------------------------------------------
    // 3) Cleanup ausfuehren (wie setup-test-db / globalTeardown).
    // ------------------------------------------------------------------
    runCleanup();

    // ------------------------------------------------------------------
    // 4) Assertions: Test-Kontexte weg, echte Zeile bleibt.
    // ------------------------------------------------------------------
    const failures: string[] = [];
    for (const context of TEST_ERROR_CONTEXTS) {
      const left = await countOwn(context);
      if (left > 0) {
        failures.push(
          `Test-Kontext "${context}" hat den Cleanup ueberlebt (${left} Zeile(n) uebrig).`,
        );
      }
    }
    const realLeft = await countOwn(REAL_ERROR_CONTEXT);
    if (realLeft !== 1) {
      failures.push(
        `Echte Fehlerzeile (Kontext "${REAL_ERROR_CONTEXT}") wurde faelschlich geloescht ` +
          `(erwartet 1, gefunden ${realLeft}) — der Cleanup greift zu breit.`,
      );
    }

    // ------------------------------------------------------------------
    // 5) Idempotenz: zweiter Lauf laeuft durch, echte Zeile bleibt.
    // ------------------------------------------------------------------
    runCleanup();
    const realAfterSecond = await countOwn(REAL_ERROR_CONTEXT);
    if (realAfterSecond !== 1) {
      failures.push(
        `Nach dem zweiten (idempotenten) Cleanup-Lauf ist die echte Fehlerzeile nicht mehr ` +
          `unversehrt (erwartet 1, gefunden ${realAfterSecond}).`,
      );
    }

    if (failures.length > 0) {
      throw new CheckError(
        `Fehlerzeilen-Cleanup-Check FEHLGESCHLAGEN:\n  - ${failures.join("\n  - ")}`,
      );
    }

    console.log(
      "Fehlerzeilen-Cleanup-Check OK: beide Test-Kontexte entfernt, echte Fehlerzeile " +
        "unangetastet, zweiter Lauf idempotent — der Cleanup greift und verschont echte Fehler.",
    );
  } finally {
    // Aufraeumen: die geseedete echte Zeile (und etwaige Reste) selbst
    // entfernen — der Cleanup laesst sie bewusst stehen.
    await client.query("DELETE FROM platform_errors WHERE message LIKE $1 || '%'", [
      CHECK_MARKER,
    ]);
    await client.end();
  }
}
