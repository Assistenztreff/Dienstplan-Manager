import "./lib/normalize-db-url";
import { execSync, spawnSync } from "node:child_process";
import pg from "pg";
import { deriveTestDbUrl } from "./lib/test-db-url.js";

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
 *
 * Selbstheilung: `drizzle-kit push` fragt bei manchen Schema-Änderungen
 * (z. B. neue UNIQUE-Spalte an bestehender Tabelle) interaktiv nach und
 * bricht ohne TTY ab. Da die Test-DB wegwerfbar ist, wird sie in dem Fall
 * automatisch verworfen und frisch neu aufgebaut (Drop + Recreate + Push) —
 * kein manueller SQL-Eingriff mehr nötig.
 */

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

  // Nutzungs-Stempel (Datenbank-Kommentar) SOFORT setzen: private Test-DBs
  // ohne Stempel wuerde die Selbstaufraeumung (cleanupStaleTestDbs) sonst nie
  // als "von uns verwaltet" erkennen; der Stempel schuetzt zugleich frisch
  // angelegte DBs vor einem Drop durch parallele Umgebungen (Task #633).
  const { touchTestDbComment } = await import(
    "@workspace/test-fixtures/test-db-name"
  );
  await touchTestDbComment(base, testDbName);

  // Schema + Seed gegen die Test-DB. DATABASE_URL für die Kind-Prozesse
  // überschreiben, damit Drizzle/Setup-Skripte die Test-DB treffen.
  // APP_DATABASE_URL mit überschreiben, sonst gewinnt der Staging-Override
  // (resolveDatabaseUrl) in den Kind-Prozessen über die Test-URL.
  const childEnv = { ...process.env, DATABASE_URL: testUrl, APP_DATABASE_URL: testUrl };
  // stdin wird bewusst NICHT durchgereicht ("ignore"): drizzle-kit push soll
  // bei interaktiven Rückfragen sofort mit "Interactive prompts require a TTY"
  // fehlschlagen statt zu hängen — der Fehler löst dann den Neuaufbau aus.
  const run = (cmd: string): void => {
    execSync(cmd, {
      stdio: ["ignore", "inherit", "inherit"],
      env: childEnv,
      timeout: 180_000,
    });
  };

  // drizzle-kit push beendet sich auch bei "Interactive prompts require a TTY"
  // mit Exit-Code 0 (!), daher reicht der Exit-Code nicht: Ausgabe mitschneiden
  // und den bekannten Fehlertext explizit als Fehlschlag werten.
  const pushSchema = (): void => {
    const result = spawnSync(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
        encoding: "utf8",
        timeout: 180_000,
      },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(output);
    if (
      result.status !== 0 ||
      result.error != null ||
      /Interactive prompts require a TTY/i.test(output) ||
      /^\s*Error:/m.test(output)
    ) {
      throw new Error("drizzle-kit push fehlgeschlagen (siehe Ausgabe oben).");
    }
  };

  // Nach dem Push den IST-Zustand der Test-DB gegen das Drizzle-Schema
  // verifizieren (Task #499): drizzle-kit push kann in Randfällen "erfolgreich"
  // durchlaufen, ohne alle Änderungen anzuwenden (z. B. verschluckte Prompts).
  // Fehlen danach Tabellen/Spalten, greift dieselbe Selbstheilung wie beim
  // Push-Fehlschlag: Drop + Recreate + erneuter Push.
  const pushAndVerify = (): void => {
    pushSchema();
    run("pnpm --filter @workspace/scripts run verify-test-db-schema");
  };

  try {
    pushAndVerify();
  } catch {
    // Push gescheitert (typisch: veraltete Test-DB + Schema-Änderung, die eine
    // interaktive Bestätigung bräuchte). Die Test-DB ist wegwerfbar: komplett
    // neu aufbauen und erneut pushen. WITH (FORCE) trennt offene Verbindungen.
    console.log(
      `Schema-Push fehlgeschlagen — Test-Datenbank "${testDbName}" wird neu aufgebaut (Drop + Recreate).`,
    );
    const rebuild = new pg.Client({ connectionString: base });
    await rebuild.connect();
    await rebuild.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await rebuild.query(`CREATE DATABASE "${testDbName}"`);
    await rebuild.end();
    console.log(`Test-Datenbank "${testDbName}" frisch angelegt.`);
    const { touchTestDbComment: touchAfterRebuild } = await import(
      "@workspace/test-fixtures/test-db-name"
    );
    await touchAfterRebuild(base, testDbName);
    pushAndVerify();
  }
  run("pnpm --filter @workspace/scripts run setup-admin");
  run("pnpm --filter @workspace/scripts run migrate-teams");
  run("pnpm --filter @workspace/scripts run migrate-allowance-settings");

  // Selbstheilung: Konten-Leichen abgebrochener E2E-Laeufe (Timeout, Ctrl-C,
  // Crash — afterAll-Hooks liefen dann nie) VOR dem Lauf entfernen. Loescht
  // ausschliesslich `e2e.*@dienstplan.test`-Konten, nie den Seed-Admin.
  run("pnpm --filter @workspace/scripts run cleanup-test-accounts");

  // Selbstheilung (analog Konten-Cleanup): liegengebliebene Test-Zeilen in
  // `platform_errors` (Dev-Boom + geseedete Retention-Zeilen) abgebrochener
  // Laeufe VOR dem Lauf entfernen. Loescht ausschliesslich die Test-Kontexte
  // in der `_test`-DB, nie echte Fehler-Eintraege.
  run("pnpm --filter @workspace/scripts run cleanup-test-platform-errors");

  // Test-Admin auf Premium setzen (NUR Test-Infrastruktur, niemals die echte
  // Dev-DB). Hintergrund: Die serverseitige Durchsetzung der Free-Limits würde
  // sonst bestehende E2E-Specs brechen, die als Standard-Admin parallel viele
  // Schichtmodelle anlegen (maxShiftModels=4 im Free-Tarif) bzw. die
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
