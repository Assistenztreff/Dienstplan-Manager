import { execSync } from "node:child_process";
import pg from "pg";

/**
 * Richtet eine isolierte Test-Datenbank für die E2E-Tests ein.
 *
 * Die E2E-Tests legen Daten an und löschen sie wieder (u.a. der Lösch-Test für
 * Assistenzkräfte). Damit das NIE die echte Entwicklungs-Datenbank berührt,
 * läuft der gesamte Playwright-Lauf gegen eine separate Datenbank
 * (`<dbname>_test`), die hier provisioniert wird:
 *
 * 1. Datenbank anlegen (falls noch nicht vorhanden).
 * 2. Schema pushen (Drizzle), Admin anlegen, Team-Migration ausführen.
 *
 * Idempotent: mehrfaches Ausführen ist gefahrlos.
 */

function deriveTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(base);
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const testName = `${current}_test`;
  u.pathname = `/${testName}`;
  return { url: u.toString(), name: testName };
}

async function main(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const { url: testUrl, name: testDbName } = deriveTestDbUrl(base);

  // Test-Datenbank anlegen (von der bestehenden Verbindung aus). CREATE DATABASE
  // kann nicht für die gerade verbundene DB ausgeführt werden, daher verbinden
  // wir uns mit der echten Dev-DB und legen die separate Test-DB an.
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    testDbName,
  ]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${testDbName}"`);
    console.log(`Test-Datenbank "${testDbName}" angelegt.`);
  } else {
    console.log(`Test-Datenbank "${testDbName}" existiert bereits.`);
  }
  await admin.end();

  // Schema + Seed gegen die Test-DB. DATABASE_URL für die Kind-Prozesse
  // überschreiben, damit Drizzle/Setup-Skripte die Test-DB treffen.
  const childEnv = { ...process.env, DATABASE_URL: testUrl };
  const run = (cmd: string): void => {
    execSync(cmd, { stdio: "inherit", env: childEnv });
  };

  run("pnpm --filter @workspace/db run push");
  run("pnpm --filter @workspace/scripts run setup-admin");
  run("pnpm --filter @workspace/scripts run migrate-teams");

  // Test-Admin auf Premium setzen (NUR Test-Infrastruktur, niemals die echte
  // Dev-DB). Hintergrund: Die serverseitige Durchsetzung der Free-Limits würde
  // sonst bestehende E2E-Specs brechen, die als Standard-Admin parallel viele
  // Schichtmodelle anlegen (maxShiftModels=3 im Free-Tarif) bzw. die
  // Massenbearbeitung (bulkEdit = Premium) testen. Die dedizierten Plan-Gate-
  // Specs registrieren sich stattdessen frische Free-Konten und prüfen die
  // Limits isoliert.
  const seed = new pg.Client({ connectionString: testUrl });
  await seed.connect();
  await seed.query(
    "UPDATE users SET plan = 'premium' WHERE email = $1",
    ["admin@dienstplan.local"],
  );
  await seed.end();
  console.log("Test-Admin auf Premium gesetzt.");

  console.log("Test-Datenbank ist bereit.");
}

main().catch((err) => {
  console.error("Fehler beim Einrichten der Test-Datenbank:", err);
  process.exit(1);
});
