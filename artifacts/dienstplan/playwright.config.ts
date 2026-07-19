import { defineConfig, devices } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * E2E-Konfiguration für die Dienstplan-App.
 *
 * WICHTIG: Die E2E-Tests legen Daten an und löschen sie wieder (u.a. der
 * Lösch-Test für Assistenzkräfte). Damit das NIE die echte Entwicklungs-
 * Datenbank berührt, startet Playwright hier einen vollständig isolierten
 * Test-Stack gegen eine separate Datenbank:
 *
 *   - eigener API-Server (PORT 8099) mit DATABASE_URL = `<dbname>_test`
 *   - eigener Vite-Server (PORT 5199), der /api an den Test-API weiterleitet
 *
 * Die Test-DB wird direkt hier in der Konfiguration provisioniert (siehe
 * unten: `setup-test-db` läuft synchron beim Laden der Config) — damit gilt
 * das auch für Einzel-Spec-Läufe via `pnpm exec playwright test <name>`,
 * die das `test:e2e`-npm-Skript umgehen. Die laufenden Replit-Workflows und
 * die echte Datenbank bleiben unangetastet.
 *
 * Override-Möglichkeit: Ist `E2E_BASE_URL` von außen gesetzt, wird KEIN
 * Test-Stack gestartet und die Tests laufen gegen die angegebene URL
 * (z.B. den geteilten Proxy unter http://localhost:80) — nur für bewusste
 * manuelle Läufe gedacht.
 */

const API_PORT = process.env.E2E_API_PORT ?? "8099";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5199";

const chromiumExecutable = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// Externe Override-URL? Dann gegen diese testen, ohne eigenen Stack.
const externalBaseUrl = process.env.E2E_BASE_URL;
const useManagedStack = !externalBaseUrl;

function deriveTestDbUrl(base: string): string {
  const u = new URL(base);
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  u.pathname = `/${current}_test`;
  return u.toString();
}

const baseURL = externalBaseUrl ?? `http://localhost:${WEB_PORT}`;

// Damit die Specs (eigener `BASE_URL`-Konstantenfallback) denselben Stack
// treffen wie der Browser, E2E_BASE_URL für die Worker-Prozesse setzen.
process.env.E2E_BASE_URL = baseURL;

const databaseUrl = process.env.DATABASE_URL;
if (useManagedStack && !databaseUrl) {
  throw new Error("DATABASE_URL muss für den isolierten E2E-Test-Stack gesetzt sein.");
}
const testDatabaseUrl = databaseUrl ? deriveTestDbUrl(databaseUrl) : "";

// --- Schema-Fingerprint zum Überspringen von setup-test-db bei unverändertem
// Schema (Task #327/#377) ---------------------------------------------------
// Idee: `setup-test-db` (Schema-Push + Seed, ~20s) muss nur laufen, wenn sich
// seit dem letzten erfolgreichen Lauf am relevanten Zustand etwas geändert hat.
// Wir hashen dafür die Drizzle-Schema-Dateien plus die Skripte, die die Test-DB
// aufbauen. Passt der Hash zum Marker (gitignored unter node_modules/.cache),
// wird die Provisionierung übersprungen. Sicherheit vor Geschwindigkeit: bei
// jedem Zweifel (fehlender Marker, Lese-/Schreibfehler, geänderter Hash) wird
// provisioniert. Marker wird ERST nach erfolgreichem setup-test-db geschrieben.

// Repo-Wurzel von cwd aus suchen (playwright.config läuft ohne __dirname in
// ESM; cwd ist der Artefakt-Ordner, aber wir laufen robust nach oben).
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

// Deterministischer Hash über alle Eingaben, die den Test-DB-Zustand bestimmen:
// Schema-Dateien (Struktur) + drizzle.config + die Setup/Seed-Skripte. Ändert
// sich davon irgendetwas, ist der Marker ungültig und es wird neu provisioniert.
// Der Test-DB-Name fließt mit ein, damit ein Wechsel der DATABASE_URL (andere
// Ziel-DB) ebenfalls neu provisioniert.
function computeSchemaFingerprint(repoRoot: string, testDbName: string): string {
  const files: string[] = [];
  const schemaDir = path.join(repoRoot, "lib/db/src/schema");
  if (existsSync(schemaDir)) {
    for (const entry of readdirSync(schemaDir).sort()) {
      if (entry.endsWith(".ts")) files.push(path.join(schemaDir, entry));
    }
  }
  for (const rel of [
    "lib/db/drizzle.config.ts",
    "scripts/src/setup-test-db.ts",
    // Auch die Seed-/Migrations-Skripte, die setup-test-db aufruft, bestimmen
    // den Zustand der _test-DB. Aendert sich eines davon (z. B. neue Migration,
    // anderes Seeding), MUSS der Marker invalidieren, sonst laeuft die Suite
    // gegen eine veraltete _test-DB und muss wieder manuell repariert werden
    // (Task #499: Testdatenbank haelt automatisch mit Schema-Aenderungen Schritt).
    "scripts/src/setup-admin.ts",
    "scripts/src/migrate-teams.ts",
    "scripts/src/migrate-allowance-settings.ts",
  ]) {
    const abs = path.join(repoRoot, rel);
    if (existsSync(abs)) files.push(abs);
  }
  const hash = createHash("sha256");
  hash.update(`db:${testDbName}\0`);
  for (const file of files) {
    hash.update(path.relative(repoRoot, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const repoRoot = findRepoRoot(process.cwd());
const testDbName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ""))
  : "";
const schemaMarkerPath = path.join(
  repoRoot,
  "node_modules/.cache/dienstplan-e2e/test-db-schema.hash",
);

let schemaFingerprint = "";
let schemaUnchanged = false;
if (useManagedStack) {
  try {
    schemaFingerprint = computeSchemaFingerprint(repoRoot, testDbName);
    schemaUnchanged =
      existsSync(schemaMarkerPath) &&
      readFileSync(schemaMarkerPath, "utf8").trim() === schemaFingerprint;
  } catch {
    // Im Zweifel provisionieren: leerer Fingerprint verhindert Marker-Treffer.
    schemaFingerprint = "";
    schemaUnchanged = false;
  }
}

// --- Waisen-Prozess-Bereinigung (Task: abgebrochene Läufe blockieren Folgeläufe) ---
// Wird ein Lauf hart abgebrochen (Ctrl-C, `timeout`-Kill, SIGKILL), überleben
// die von Playwright gestarteten webServer-Kinder (API auf 8099, Vite auf
// 5199). Der nächste Lauf scheitert dann sofort, weil `reuseExistingServer:
// false` belegte Ports ablehnt ("...is already used"). Deshalb: VOR dem Start
// belegte Test-Ports erkennen und die Waisen beenden (TERM, notfalls KILL).
// Nur für den verwalteten Stack und nur im Hauptprozess — und nur auf den
// dedizierten E2E-Ports, die Dev-Workflows (8080/5000 etc.) nie benutzen.

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// PIDs aller Prozesse, die auf dem Port LAUSCHEN (lsof: exit 1 = keine Treffer).
function listListenerPids(port: string): number[] {
  const res = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (res.error != null) {
    // lsof nicht verfügbar o.ä. — dann keine Bereinigung möglich; Playwright
    // meldet einen belegten Port später selbst.
    console.warn(`[e2e] lsof für Port ${port} nicht ausführbar:`, res.error.message);
    return [];
  }
  if (!res.stdout) return [];
  return res.stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function reapOrphansOnPort(port: string, label: string): void {
  let pids = listListenerPids(port);
  if (pids.length === 0) return;
  console.log(
    `[e2e] Port ${port} (${label}) ist belegt — vermutlich Waisen eines abgebrochenen Laufs. Beende PID(s) ${pids.join(", ")}...`,
  );
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* Prozess evtl. schon weg */
    }
  }
  // Bis zu 5s auf sauberes Beenden warten, dann hart nachfassen.
  const termDeadline = Date.now() + 5_000;
  while (Date.now() < termDeadline) {
    pids = listListenerPids(port);
    if (pids.length === 0) {
      console.log(`[e2e] Port ${port} (${label}) ist wieder frei.`);
      return;
    }
    sleepSync(250);
  }
  console.log(
    `[e2e] Port ${port} (${label}) nach SIGTERM weiter belegt — SIGKILL für PID(s) ${pids.join(", ")}.`,
  );
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Prozess evtl. schon weg */
    }
  }
  const killDeadline = Date.now() + 5_000;
  while (Date.now() < killDeadline) {
    if (listListenerPids(port).length === 0) {
      console.log(`[e2e] Port ${port} (${label}) ist wieder frei.`);
      return;
    }
    sleepSync(250);
  }
  throw new Error(
    `Port ${port} (${label}) ist weiterhin belegt und konnte nicht freigeräumt werden — bitte manuell prüfen (lsof -ti tcp:${port} -sTCP:LISTEN).`,
  );
}

// --- Lauf-Lock (Task: paralleler Zweitlauf darf laufenden Lauf nicht abschiessen) ---
// Die Waisen-Bereinigung oben beendet ALLES auf den Test-Ports. Damit ein
// versehentlich parallel gestarteter zweiter Lauf nicht still die Server des
// ersten killt, haelt jeder verwaltete Lauf ein Lockfile mit seiner PID.
// Unterscheidung beim Start:
//   - Lock vorhanden + Inhaber-PID lebt  -> ABBRUCH mit klarer Meldung
//     (bewusst VOR jeder Port-Bereinigung).
//   - Lock vorhanden + Inhaber-PID tot   -> verwaister Lock eines hart
//     abgebrochenen Laufs; Lock uebernehmen und Waisen reapen wie bisher.
//   - Kein Lock                          -> Lock schreiben, Waisen reapen.
// Freigabe: globalTeardown loescht den Lock, wenn er noch uns gehoert. Nach
// hartem Abbruch bleibt der Lock liegen, zeigt aber auf eine tote PID und
// blockiert den naechsten Lauf deshalb nicht (Selbstheilung bleibt erhalten).
const runLockPath = path.join(
  repoRoot,
  "node_modules/.cache/dienstplan-e2e/run.lock",
);

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = Prozess existiert, gehoert aber jemand anderem -> lebt.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function acquireRunLock(): void {
  let ownerPid: number | null = null;
  if (existsSync(runLockPath)) {
    try {
      const raw = readFileSync(runLockPath, "utf8").trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isInteger(parsed) && parsed > 0) ownerPid = parsed;
    } catch {
      // Unlesbarer Lock: wie verwaist behandeln (unten ueberschreiben).
    }
    if (ownerPid !== null && ownerPid !== process.pid && isPidAlive(ownerPid)) {
      throw new Error(
        `Es laeuft bereits ein E2E-Lauf (PID ${ownerPid}, Lock ${runLockPath}). ` +
          "Dieser Lauf bricht ab, um die Server des laufenden Laufs nicht zu beenden. " +
          "Bitte den laufenden Lauf abwarten oder beenden. Ist der Lock faelschlich " +
          "haengen geblieben, obwohl kein Lauf mehr aktiv ist: Lockdatei loeschen und erneut starten.",
      );
    }
    if (ownerPid !== null && ownerPid !== process.pid) {
      console.log(
        `[e2e] Verwaister Lauf-Lock gefunden (PID ${ownerPid} lebt nicht mehr) — Lock wird uebernommen.`,
      );
    }
  }
  mkdirSync(path.dirname(runLockPath), { recursive: true });
  writeFileSync(runLockPath, `${process.pid}\n`);
}

// Test-DB VOR jedem Lauf idempotent provisionieren — bewusst hier in der
// Config statt im `test:e2e`-npm-Skript oder in einem globalSetup:
//   - Einzel-Spec-Läufe via `pnpm exec playwright test <name>` umgehen das
//     npm-Skript; ohne dieses Setup liefen sie nach Schema-Änderungen gegen
//     eine veraltete `<dbname>_test`-DB (500 "column ... does not exist").
//   - Die Config lädt garantiert BEVOR die webServer starten — der API-Server
//     bootet also nie gegen eine fehlende/veraltete Test-DB (bei globalSetup
//     ist die Reihenfolge relativ zu webServer nicht garantiert).
// Guards: nur im Hauptprozess (Worker laden die Config erneut, sollen aber
// nicht erneut provisionieren) und nur für den verwalteten Stack —
// `E2E_BASE_URL`-Läufe gegen externe Stacks überspringen das Setup weiterhin.
// `E2E_SKIP_DB_SETUP=1` als bewusste Abkürzung für schnelle Wiederholungs-
// läufe ohne zwischenzeitliche Schema-Änderung.
const isWorkerProcess = !!process.env.TEST_WORKER_INDEX;

// Lauf-Lock ZUERST erwerben (bricht bei lebendem Inhaber ab, uebernimmt
// verwaiste Locks), DANN Waisen reapen — so beendet ein versehentlich
// parallel gestarteter Zweitlauf nie die Server eines aktiven Laufs.
// Waisen-Bereinigung IMMER vor einem verwalteten Lauf (auch bei
// E2E_SKIP_DB_SETUP=1 — gerade schnelle Wiederholungsläufe treffen sonst
// auf die Reste des zuvor abgebrochenen Laufs).
if (useManagedStack && !isWorkerProcess) {
  acquireRunLock();
  reapOrphansOnPort(API_PORT, "Test-API");
  reapOrphansOnPort(WEB_PORT, "Test-Vite");
}

if (useManagedStack && !isWorkerProcess && !process.env.E2E_SKIP_DB_SETUP) {
  // Marker-Treffer allein genügt NICHT (Task #499): der Hash beweist nur
  // "setup-test-db lief mit diesen Quelldateien", nicht dass die _test-DB
  // wirklich auf dem Stand ist (Drift durch stillen Push-Fehlschlag, Marker
  // aus anderem Kontext, manuelle Eingriffe). Deshalb bei Marker-Treffer
  // zusätzlich der schnelle IST-Check: alle Drizzle-Tabellen/-Spalten in der
  // _test-DB vorhanden? Schlägt er fehl (auch: DB fehlt/nicht erreichbar),
  // wird ganz normal provisioniert — setup-test-db heilt sich notfalls per
  // Drop + Recreate selbst.
  // Der Check läuft in-process (Top-Level-await, ESM-Config) statt als
  // pnpm/tsx-Kindprozess — spart ~2-4s Prozess-Startkosten pro Lauf. Die
  // Vergleichslogik teilt sich die Config mit dem manuellen CLI-Skript
  // `verify-test-db-schema` über `@workspace/db/verify-schema` (bewusst
  // eigener Export-Pfad ohne den Pool-Seiteneffekt des Haupt-Index).
  let skipProvisioning = false;
  if (schemaUnchanged) {
    console.log(
      "[e2e] Schema unverändert (Marker-Treffer) — prüfe IST-Zustand der Test-DB (in-process Schema-Check)...",
    );
    try {
      const { findMissingSchemaObjects } = await import(
        "@workspace/db/verify-schema"
      );
      const problems = await findMissingSchemaObjects(testDatabaseUrl);
      if (problems.length === 0) {
        skipProvisioning = true;
      } else {
        console.log(
          `[e2e] Test-DB weicht trotz Marker-Treffer vom Schema ab (${problems.length} Abweichung(en)) — setup-test-db läuft erneut.`,
        );
        for (const p of problems) console.log(`[e2e]   - ${p}`);
      }
    } catch (err) {
      // Auch "DB fehlt / nicht erreichbar" ist ein "bitte provisionieren"-
      // Signal — setup-test-db heilt sich per Drop + Recreate selbst.
      console.log(
        "[e2e] Test-DB-Schema-Check fehlgeschlagen (DB fehlt/nicht erreichbar?) — setup-test-db läuft erneut.",
        err,
      );
    }
  }

  if (skipProvisioning) {
    // Schema (+ Setup/Seed-Skripte) unverändert UND IST-Zustand der Test-DB
    // verifiziert -> teure Provisionierung sicher überspringen.
    console.log(
      "[e2e] Test-DB verifiziert aktuell — setup-test-db wird übersprungen. Erzwingen: node_modules/.cache/dienstplan-e2e löschen oder E2E ohne Marker laufen lassen.",
    );
  } else {
    console.log("[e2e] Test-Datenbank wird provisioniert (setup-test-db)...");
    const setup = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "setup-test-db"],
      { stdio: "inherit", timeout: 300_000 },
    );
    if (setup.status !== 0 || setup.error != null) {
      throw new Error(
        "setup-test-db fehlgeschlagen — Test-Datenbank konnte nicht provisioniert werden (siehe Ausgabe oben).",
      );
    }
    // Marker ERST nach Erfolg schreiben. Schlägt das Schreiben fehl, läuft der
    // nächste Lauf halt wieder voll durch (Sicherheit vor Geschwindigkeit).
    if (schemaFingerprint) {
      try {
        mkdirSync(path.dirname(schemaMarkerPath), { recursive: true });
        writeFileSync(schemaMarkerPath, `${schemaFingerprint}\n`);
      } catch (err) {
        console.warn(
          "[e2e] Schema-Marker konnte nicht geschrieben werden — nächster Lauf provisioniert erneut.",
          err,
        );
      }
    }
  }

  // Regressionscheck Testkonten-Trennung: beweist VOR jedem E2E-Lauf, dass
  // setup-test-accounts + migrate-teams die Team-Belegung der Dev-Testkonten
  // nicht zerstoeren. Laeuft bewusst HIER (Config-Load, vor dem Start der
  // webServer): der Check seedet/entfernt Konten in der `_test`-DB und darf
  // deshalb nie parallel zu laufenden Specs arbeiten. Er raeumt nach sich
  // selbst restlos auf (Test-DB danach wieder nur Seed-Admin + Standard-Team).
  // Skip via `E2E_SKIP_SEPARATION_CHECK=1` fuer schnelle Wiederholungslaeufe
  // (analog E2E_SKIP_DB_SETUP, das den Check ebenfalls ueberspringt).
  if (!process.env.E2E_SKIP_SEPARATION_CHECK) {
    console.log("[e2e] Testkonten-Trennungs-Check (verify-account-separation)...");
    const separation = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "verify-account-separation"],
      { stdio: "inherit", timeout: 600_000 },
    );
    if (separation.status !== 0 || separation.error != null) {
      throw new Error(
        "verify-account-separation fehlgeschlagen — die Testkonten-Trennung ist beschaedigt oder der Check konnte nicht laufen (siehe Ausgabe oben). Kein E2E-Lauf gegen einen unklaren Zustand.",
      );
    }
  }

  // Selbstheilungs-Nachweis (verify-test-db-cleanup): beweist VOR jedem E2E-Lauf,
  // dass die `_test`-DB nach einem ABGEBROCHENEN Lauf wieder sauber startet
  // (cleanup-test-accounts entfernt Zombie-Konten restlos, Seed-Admin bleibt).
  // Er dient zusaetzlich als FK-Waechter und erkennt neue team-gebundene
  // Tabellen ohne Cleanup-Zweig.
  // Laeuft bewusst HIER (Config-Load, vor dem webServer-Start):
  // er seedet/entfernt Konten in der `_test`-DB und darf nie parallel zu Specs
  // laufen. Skip via `E2E_SKIP_CLEANUP_CHECK=1` fuer schnelle Wiederholungslaeufe
  // (analog E2E_SKIP_SEPARATION_CHECK).
  if (!process.env.E2E_SKIP_CLEANUP_CHECK) {
    console.log("[e2e] Selbstheilungs-Check (verify-test-db-cleanup)...");
    const cleanup = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "verify-test-db-cleanup"],
      { stdio: "inherit", timeout: 600_000 },
    );
    if (cleanup.status !== 0 || cleanup.error != null) {
      throw new Error(
        "verify-test-db-cleanup fehlgeschlagen — die Test-DB-Selbstheilung ist beschaedigt oder der Check konnte nicht laufen (siehe Ausgabe oben). Kein E2E-Lauf gegen einen unklaren Zustand.",
      );
    }
  }

  // Fehlerzeilen-Cleanup-Nachweis (verify-test-platform-errors-cleanup): beweist
  // VOR jedem E2E-Lauf, dass der platform_errors-Cleanup wirklich greift (beide
  // Test-Kontexte weg) UND echte Fehler verschont (fremder Kontext bleibt),
  // zweiter Lauf idempotent. Ohne diesen Beweis kann der Cleanup still
  // verrutschen und die _test-DB wieder mit Alt-Fehlerzeilen volllaufen.
  // Laeuft bewusst HIER (Config-Load, vor dem webServer-Start): er seedet/
  // entfernt Zeilen in der `_test`-DB und darf nie parallel zu Specs laufen.
  // Skip via `E2E_SKIP_CLEANUP_CHECK=1` (analog verify-test-db-cleanup).
  if (!process.env.E2E_SKIP_CLEANUP_CHECK) {
    console.log(
      "[e2e] Fehlerzeilen-Cleanup-Check (verify-test-platform-errors-cleanup)...",
    );
    const errorsCleanup = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "verify-test-platform-errors-cleanup"],
      { stdio: "inherit", timeout: 600_000 },
    );
    if (errorsCleanup.status !== 0 || errorsCleanup.error != null) {
      throw new Error(
        "verify-test-platform-errors-cleanup fehlgeschlagen — der platform_errors-Cleanup ist beschaedigt oder der Check konnte nicht laufen (siehe Ausgabe oben). Kein E2E-Lauf gegen einen unklaren Zustand.",
      );
    }
  }
}

// Damit Specs/Helper, die zur Laufzeit einen zweiten Admin seeden
// (`seedForeignAdmin` -> setup-admin per execSync), in DIESELBE Datenbank
// schreiben, gegen die der isolierte Test-API-Server läuft (die `_test`-DB),
// die abgeleitete Test-DB-URL für die Worker-Prozesse bereitstellen. Ohne das
// erbt der execSync die Dev-`DATABASE_URL` und der Admin landet in der Dev-DB
// -> der spätere Login gegen die Test-DB schlägt fehl.
if (useManagedStack && testDatabaseUrl) {
  process.env.E2E_TEST_DATABASE_URL = testDatabaseUrl;
}

export default defineConfig({
  testDir: "./e2e",
  // Nach jedem Lauf uebrig gebliebene `e2e.*@dienstplan.test`-Konten aus der
  // Test-DB entfernen (Specs, deren afterAll-Cleanup fehlte/fehlschlug).
  // Harte Abbrueche heilt zusaetzlich setup-test-db VOR dem naechsten Lauf.
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // Unter Volllast der Gesamtsuite (ein Worker, geteilter Test-Stack) reichen
  // die 30s-Defaults fuer mehrstufige UI-Flows nicht zuverlaessig — einzelne
  // Specs kippen sonst lauf-abhaengig (Whack-a-mole). Echte Haenger werden
  // weiterhin erkannt, nur eben nach 60s.
  timeout: 60000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    // Mobiles Viewport: die Liste/Monat-Umschaltung ist nur in der
    // Mobilansicht (md:hidden) sichtbar.
    viewport: { width: 400, height: 720 },
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : {},
  },
  ...(useManagedStack
    ? {
        webServer: [
          {
            // Isolierter API-Server auf der Test-Datenbank.
            command: "pnpm --filter @workspace/api-server run dev",
            url: `http://localhost:${API_PORT}/api/healthz`,
            timeout: 120000,
            reuseExistingServer: false,
            env: {
              PORT: API_PORT,
              DATABASE_URL: testDatabaseUrl,
              NODE_ENV: "development",
            },
          },
          {
            // Isolierter Vite-Server, leitet /api an den Test-API weiter.
            command: "pnpm --filter @workspace/dienstplan run dev",
            url: `http://localhost:${WEB_PORT}/`,
            timeout: 120000,
            reuseExistingServer: false,
            env: {
              PORT: WEB_PORT,
              BASE_PATH: "/",
              E2E_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
            },
          },
        ],
      }
    : {}),
});
