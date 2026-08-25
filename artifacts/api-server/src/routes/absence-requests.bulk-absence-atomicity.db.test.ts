// ---------------------------------------------------------------------------
// DB-gestützter Regressionstest: Code-Review-Fund #887 (Konkurrenz-Fix, 2. Runde).
// ---------------------------------------------------------------------------
// `runBulkAbsenceCreation` wurde ursprünglich IMMER in einer eigenen
// `db.transaction` ausgeführt. Die Antrags-Bestätigung (POST
// /absence-requests/:id/approve) hält aber selbst schon eine offene
// Transaktion (Advisory-Lock + Status-Update) — der Aufruf öffnete darin eine
// ZWEITE, unabhängige Transaktion auf einer zweiten Pool-Verbindung. Damit
// konnten Schicht-Anlage und Urlaubskonto-Buchung committen, OBWOHL das
// äußere Status-Update danach scheitert/zurückrollt — verwaiste Schichten zu
// einem PENDING/nicht bestätigten Antrag. Zusätzlich verbrauchte das zwei
// Pool-Verbindungen pro Bestätigung.
//
// Der Fix: `runBulkAbsenceCreation(input, outerTx?)` nutzt bei gesetztem
// `outerTx` DIESE Transaktion direkt, statt eine eigene zu öffnen. Diese
// Tests beweisen beide Eigenschaften unabhängig vom HTTP-Layer:
//  1. Rollback der äußeren Transaktion nimmt auch die "bereits erstellten"
//     Schichten wieder zurück (kein eigenständiges Nested-Commit).
//  2. Der Advisory-Lock aus `runBulkAbsenceCreation` bleibt so lange aktiv,
//     wie die äußere Transaktion offen ist — ein zweiter Aufruf für dieselbe
//     Person blockiert bis zum Commit/Rollback, statt sofort durchzulaufen
//     (was nur möglich wäre, wenn der erste Aufruf längst auf einer eigenen
//     Verbindung committed und den Lock freigegeben hätte).
//
// Läuft gegen die isolierte Test-Datenbank (`<dbname>_test`, wie die
// E2E-Suite), NIE gegen die Dev-DB. Fehlt sie oder ihr Schema, wird sie
// einmalig via setup-test-db provisioniert (idempotent).
//
// WICHTIG: @workspace/db und ../routes/shifts werden DYNAMISCH importiert,
// NACHDEM DATABASE_URL auf die Test-DB umgebogen wurde — der DB-Pool wird
// beim Modul-Load konfiguriert.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql, eq } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";
import { deriveTestDbTarget } from "@workspace/test-fixtures/test-db-name";

function deriveTestDbUrl(base: string): string {
  return deriveTestDbTarget(normalizeDatabaseUrl(base)).url;
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

type Db = typeof import("@workspace/db");
type ShiftsRoute = typeof import("./shifts");

let dbmod: Db;
let mod: ShiftsRoute;

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");

  process.env.DATABASE_URL = deriveTestDbUrl(base);
  process.env.APP_DATABASE_URL = process.env.DATABASE_URL;

  dbmod = await import("@workspace/db");
  mod = await import("./shifts");

  try {
    await dbmod.db.execute(sql`SELECT 1 FROM shifts LIMIT 1`);
  } catch {
    execSync("pnpm --filter @workspace/scripts run setup-test-db", {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
}, 240_000);

afterAll(async () => {
  if (dbmod) {
    await dbmod.pool.end();
  }
});

// Eigenes Team + eigene Person je Test — vermeidet Advisory-Lock-Kollisionen
// (Lock-Schlüssel ist an userId gekoppelt) und Aufräum-Überschneidungen mit
// parallelen Testdateien.
async function makeTeamAndUser(label: string): Promise<{ teamId: number; userId: number }> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const [owner] = await dbmod.db
    .insert(dbmod.usersTable)
    .values({
      name: `Atomicity Owner ${label} ${suffix}`,
      email: `atomicity-owner-${label}-${suffix}@dienstplan.test`,
      role: "admin",
      accountType: "privat",
      plan: "premium",
    })
    .returning();
  const [team] = await dbmod.db
    .insert(dbmod.teamsTable)
    .values({ name: `Atomicity Team ${label} ${suffix}`, ownerId: owner!.id })
    .returning();
  const [assistant] = await dbmod.db
    .insert(dbmod.usersTable)
    .values({
      name: `Atomicity Assistant ${label} ${suffix}`,
      email: `atomicity-assistant-${label}-${suffix}@dienstplan.test`,
      role: "assistant",
      accountType: "privat",
      plan: "premium",
    })
    .returning();
  return { teamId: team!.id, userId: assistant!.id };
}

async function cleanup(teamId: number, userId: number, ownerEmailUserIds: number[]): Promise<void> {
  await dbmod.db.delete(dbmod.timeTrackingTable).where(eq(dbmod.timeTrackingTable.userId, userId));
  await dbmod.db.delete(dbmod.shiftsTable).where(eq(dbmod.shiftsTable.userId, userId));
  await dbmod.db.delete(dbmod.teamsTable).where(eq(dbmod.teamsTable.id, teamId));
  await dbmod.db.delete(dbmod.usersTable).where(eq(dbmod.usersTable.id, userId));
  for (const id of ownerEmailUserIds) {
    await dbmod.db.delete(dbmod.usersTable).where(eq(dbmod.usersTable.id, id));
  }
}

function fullDay(dateKey: string): [string, { startTime: Date; endTime: Date }] {
  return [
    dateKey,
    {
      startTime: new Date(`${dateKey}T00:00:00.000Z`),
      endTime: new Date(`${dateKey}T23:59:59.999Z`),
    },
  ];
}

describe("runBulkAbsenceCreation mit outerTx (Atomicity, Code-Review #887)", () => {
  it(
    "Rollback der aeusseren Transaktion nimmt bereits erstellte Schichten wieder zurueck",
    { timeout: 60_000 },
    async () => {
      const { teamId, userId } = await makeTeamAndUser("rollback");
      const [owner] = await dbmod.db
        .select({ ownerId: dbmod.teamsTable.ownerId })
        .from(dbmod.teamsTable)
        .where(eq(dbmod.teamsTable.id, teamId));
      try {
        const day = fullDay("2026-09-14");

        await expect(
          dbmod.db.transaction(async (tx) => {
            const result = await mod.runBulkAbsenceCreation(
              { userId, teamId, type: "sick", days: [day] },
              tx,
            );
            // Innerhalb der (noch nicht committeten) Transaktion sieht der
            // Aufrufer die Schicht bereits — das ist erwartet und beweist,
            // dass die Anlage tatsächlich stattgefunden hat, BEVOR sie
            // gleich per Rollback wieder verworfen wird.
            expect(result.created.length).toBe(1);
            throw new Error("erzwungener Rollback zum Atomicity-Beweis");
          }),
        ).rejects.toThrow("erzwungener Rollback zum Atomicity-Beweis");

        // Nach dem Rollback darf NICHTS aus runBulkAbsenceCreation übrig
        // geblieben sein. Wäre die Anlage (wie vor dem Fix) in einer eigenen,
        // unabhängigen Transaktion gelaufen, hätte sie bereits committed und
        // die Schicht würde hier trotzdem existieren.
        const remaining = await dbmod.db
          .select()
          .from(dbmod.shiftsTable)
          .where(eq(dbmod.shiftsTable.userId, userId));
        expect(remaining.length).toBe(0);
      } finally {
        await cleanup(teamId, userId, owner ? [owner.ownerId] : []);
      }
    },
  );

  it(
    "Advisory-Lock bleibt fuer die volle Dauer der aeusseren Transaktion aktiv (kein eigenstaendiges Nested-Commit)",
    { timeout: 60_000 },
    async () => {
      const { teamId, userId } = await makeTeamAndUser("lock");
      const [owner] = await dbmod.db
        .select({ ownerId: dbmod.teamsTable.ownerId })
        .from(dbmod.teamsTable)
        .where(eq(dbmod.teamsTable.id, teamId));
      try {
        const dayOne = fullDay("2026-09-15");
        const dayTwo = fullDay("2026-09-16");

        let releaseOuter!: () => void;
        const outerGate = new Promise<void>((resolve) => {
          releaseOuter = resolve;
        });
        let outerDone = false;

        const outerPromise = dbmod.db
          .transaction(async (tx) => {
            await mod.runBulkAbsenceCreation({ userId, teamId, type: "sick", days: [dayOne] }, tx);
            // Hält die äußere Transaktion (und damit den Advisory-Lock)
            // bewusst offen, bis der Test es freigibt.
            await outerGate;
          })
          .then(() => {
            outerDone = true;
          });

        // Kurze Wartezeit, damit der Lock innerhalb der äußeren Transaktion
        // sicher erworben ist, bevor der zweite (konkurrierende) Aufruf startet.
        await new Promise((r) => setTimeout(r, 300));
        expect(outerDone, "aeussere Transaktion darf hier noch nicht fertig sein").toBe(false);

        let secondDone = false;
        const secondPromise = mod
          .runBulkAbsenceCreation({ userId, teamId, type: "sick", days: [dayTwo] })
          .then(() => {
            secondDone = true;
          });

        // Solange die äußere Transaktion offen ist, MUSS der zweite Aufruf
        // (derselbe Advisory-Lock-Schlüssel: "shifts-bulk:user:" + userId)
        // blockiert bleiben. Ein eigenständig committender Nested-Aufruf hätte
        // den Lock längst wieder freigegeben — der zweite Aufruf liefe sofort durch.
        await new Promise((r) => setTimeout(r, 800));
        expect(
          secondDone,
          "zweiter Aufruf darf nicht durchlaufen, solange die aeussere Transaktion offen ist",
        ).toBe(false);
        expect(outerDone).toBe(false);

        releaseOuter();
        await outerPromise;
        await secondPromise;
        expect(outerDone).toBe(true);
        expect(secondDone, "zweiter Aufruf muss nach Freigabe des Locks durchlaufen").toBe(true);

        const rows = await dbmod.db
          .select()
          .from(dbmod.shiftsTable)
          .where(eq(dbmod.shiftsTable.userId, userId));
        expect(rows.length).toBe(2);
      } finally {
        await cleanup(teamId, userId, owner ? [owner.ownerId] : []);
      }
    },
  );
});
