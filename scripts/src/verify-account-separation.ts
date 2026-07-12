import { execSync } from "node:child_process";
import pg from "pg";
import { deleteAccountTrees } from "@workspace/test-fixtures";
import { deriveTestDbUrl } from "./lib/test-db-url.js";

/**
 * Beweist automatisiert, dass die Team-Trennung der Dev-Testkonten einen
 * kompletten Merge-Zyklus (setup-test-accounts gefolgt von migrate-teams)
 * unbeschadet uebersteht — Regressionscheck fuer die Reparatur aus Task
 * "Testkonten-Trennung": migrate-teams darf Nutzer mit bestehender
 * Mitgliedschaft NIE wieder ins erste Team einfuegen.
 *
 * Ablauf (analog verify-test-db-cleanup, AUSSCHLIESSLICH gegen die
 * `_test`-DB — die Dev-DB wird nie beruehrt):
 *   1. `_test`-DB bei Bedarf via `setup-test-db` provisionieren.
 *   2. Testkonten-Konstellation seeden (idempotent): Betreiber (superadmin),
 *      Test-Dienstleister (admin/dienstleister) mit eigenem Team,
 *      Test-Assistent sowie 7 "reale" Assistenzkraefte mit Vertrag +
 *      Mitgliedschaft in Team 1 des Seed-Admins (= Oliver-Aequivalent).
 *   3. `setup-test-accounts` gegen die `_test`-DB ausfuehren (richtet die
 *      Ziel-Belegung ein, inkl. eigener Fail-fast-Endkontrolle).
 *   4. Team-Belegung als Snapshot festhalten.
 *   5. `migrate-teams` ausfuehren (der historisch gefaehrliche Schritt:
 *      lief frueher bei jedem Merge und stopfte alle Konten zurueck in
 *      Team 1).
 *   6. Assertions: Belegung Byte-genau unveraendert UND die Dashboard-Zaehler
 *      stimmen (Oliver 7, Dienstleister 5, Betreiber 5 aktive Assistenten).
 *   7. Aufraeumen: geseedete Konstellation restlos entfernen, damit die
 *      `_test`-DB fuer E2E-Laeufe wieder im Standard-Zustand ist
 *      (nur Seed-Admin + Standard-Team).
 *
 * Exit 0 = Trennung bewiesen stabil, Exit 1 = Regression (Fehlermeldung
 * nennt die Ursache).
 */

const EMAIL_OLIVER = "admin@dienstplan.local";
const EMAIL_BETREIBER = "betreiber@dienstplan.local";
const EMAIL_DIENSTLEISTER = "dienstleister@dienstplan.local";
const EMAIL_ASSISTENT = "assistent@dienstplan.local";

// Stellvertreter fuer die 7 realen Assistenzkraefte in Olivers Team.
const REAL_ASSISTANT_COUNT = 7;
const realAssistantEmail = (n: number): string =>
  `verify.assistenzkraft${n}@dienstplan.local`;

class CheckError extends Error {}

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
 * Entfernt die vom Check geseedete Konstellation restlos (idempotent).
 * Laeuft VOR dem Seeden (Reste eines abgebrochenen Laufs) und im finally
 * (E2E-Laeufe sollen die Standard-Testdatenbank vorfinden).
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
  const res = await client.query<MembershipRow>(
    `SELECT tm.team_id, t.name AS team_name, u.email
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN users u ON u.id = tm.user_id
      ORDER BY tm.team_id, u.email`,
  );
  return res.rows;
}

const membershipKey = (r: MembershipRow): string => `${r.team_id}:${r.email}`;

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

  const provision = (reason: string): void => {
    console.log(`${reason} — provisioniere via setup-test-db …`);
    execSync("pnpm --filter @workspace/scripts run setup-test-db", {
      stdio: "inherit",
      timeout: 300_000,
    });
  };

  if (exists.rowCount === 0) {
    provision(`Test-DB "${testDbName}" fehlt`);
  } else {
    // Schema-Drift-Wächter: eine veraltete _test-DB (z. B. role-Enum ohne
    // 'superadmin') liesse das Seeden scheitern. setup-test-db pusht das
    // Schema und heilt notfalls per Drop+Recreate.
    const probe = new pg.Client({ connectionString: testUrl });
    await probe.connect();
    const enumOk = await probe.query(
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'role' AND e.enumlabel = 'superadmin'`,
    );
    await probe.end();
    if (enumOk.rowCount === 0) {
      provision(`Test-DB "${testDbName}" hat ein veraltetes Schema`);
    }
  }

  const runAgainstTestDb = (script: string): void => {
    execSync(`pnpm --filter @workspace/scripts run ${script}`, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl },
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
          WHERE t.owner_id = $1 AND u.role = 'assistant' AND u.is_active`,
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

main().catch((err) => {
  if (err instanceof CheckError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fehler beim Testkonten-Trennungs-Check:", err);
  }
  process.exit(1);
});
