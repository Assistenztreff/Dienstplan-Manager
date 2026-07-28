// ---------------------------------------------------------------------------
// Regressionstest fuer das Aufbewahrungslimit des Fehler-Trackings.
// ---------------------------------------------------------------------------
// Das Fehler-Tracking behaelt nur die N zuletzt AUFGETRETENEN Eintraege
// (platform_errors, Prod-Limit 500). Diese Tests beweisen, dass die
// Beschneidung die AELTESTEN (nach lastSeenAt) verwirft und die neuesten
// behaelt — erledigte (resolved) Eintraege zaehlen mit und werden weder
// bevorzugt behalten noch bevorzugt verworfen.
//
// Laeuft bewusst gegen die isolierte Test-Datenbank (`<dbname>_test`, wie die
// E2E-Suite) und NIE gegen die Dev-DB: das Pruning loescht tabellenweit, mit
// kleinem Limit wuerde es echte Dev-Eintraege vernichten. Fehlt die Test-DB
// oder ihr Schema, wird sie einmalig via setup-test-db provisioniert
// (idempotent). Das Limit wird per Env PLATFORM_ERRORS_MAX_STORED klein
// gestellt, statt >500 echte Zeilen zu schreiben.
//
// WICHTIG: @workspace/db und ./platform-errors werden DYNAMISCH importiert,
// NACHDEM DATABASE_URL auf die Test-DB umgebogen wurde — beide lesen ihre
// Konfiguration beim Modul-Load. Vitest isoliert Testdateien voneinander,
// die uebrigen (DB-freien) Tests bleiben davon unberuehrt.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";
import { deriveTestDbTarget } from "@workspace/test-fixtures/test-db-name";

// Klein gestelltes Aufbewahrungslimit fuer diese Tests.
const TEST_LIMIT = 5;

// Zentrale Namenslogik (inkl. privatem Umgebungs-Suffix, Task #633) — muss
// dieselbe DB treffen wie setup-test-db, sonst provisioniert der Fallback
// unten eine andere DB als die, gegen die getestet wird.
function deriveTestDbUrl(base: string): string {
  return deriveTestDbTarget(normalizeDatabaseUrl(base)).url;
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

type Db = typeof import("@workspace/db");
type PlatformErrors = typeof import("./platform-errors");

let dbmod: Db;
let mod: PlatformErrors;

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");

  // Env VOR den dynamischen Imports umbiegen: db-Pool und Limit werden beim
  // Modul-Load gelesen.
  process.env.DATABASE_URL = deriveTestDbUrl(base);
  process.env.PLATFORM_ERRORS_MAX_STORED = String(TEST_LIMIT);

  dbmod = await import("@workspace/db");
  mod = await import("./platform-errors");

  // Test-DB/Schema vorhanden? Sonst einmalig provisionieren (idempotent) —
  // mit der URSPRUENGLICHEN Dev-URL, das Skript leitet die Test-DB selbst ab.
  try {
    await dbmod.db.execute(sql`SELECT 1 FROM platform_errors LIMIT 1`);
  } catch {
    execSync("pnpm --filter @workspace/scripts run setup-test-db", {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, DATABASE_URL: base, APP_DATABASE_URL: base },
      timeout: 180_000,
    });
    await dbmod.db.execute(sql`SELECT 1 FROM platform_errors LIMIT 1`);
  }
}, 240_000);

afterAll(async () => {
  // Test-DB aufraeumen und Pool schliessen, damit vitest nicht haengt.
  if (dbmod) {
    await dbmod.db.delete(dbmod.platformErrorsTable).catch(() => {});
    await dbmod.pool.end();
  }
});

beforeEach(async () => {
  // Die Test-DB ist wegwerfbar; die Tabelle vor jedem Test leeren macht die
  // Assertions deterministisch (Pruning wirkt tabellenweit).
  await dbmod.db.delete(dbmod.platformErrorsTable);
});

/** Legt eine Zeile mit explizitem lastSeenAt direkt an (fuer Determinismus). */
async function seedRow(input: {
  message: string;
  lastSeenAt: Date;
  resolved?: boolean;
}): Promise<void> {
  await dbmod.db.insert(dbmod.platformErrorsTable).values({
    level: "warning",
    message: input.message,
    context: "retention-test",
    resolved: input.resolved ?? false,
    lastSeenAt: input.lastSeenAt,
  });
}

async function remainingMessages(): Promise<string[]> {
  const rows = await dbmod.db.select().from(dbmod.platformErrorsTable);
  return rows.map((r) => r.message).sort();
}

describe("Aufbewahrungslimit platform_errors", () => {
  it("prunePlatformErrors behaelt die neuesten N nach lastSeenAt, die aeltesten fliegen raus — erledigte zaehlen mit", async () => {
    const base = Date.now() - 60 * 60 * 1000;
    // 8 Eintraege, i=0 ist der aelteste. Der AELTESTE und der NEUESTE sind
    // erledigt (resolved) — beide muessen exakt wie unerledigte behandelt
    // werden: der alte fliegt raus, der neue bleibt.
    for (let i = 0; i < 8; i++) {
      await seedRow({
        message: `fehler-${i}`,
        lastSeenAt: new Date(base + i * 60_000),
        resolved: i === 0 || i === 7,
      });
    }

    await mod.prunePlatformErrors(TEST_LIMIT);

    expect(await remainingMessages()).toEqual([
      "fehler-3",
      "fehler-4",
      "fehler-5",
      "fehler-6",
      "fehler-7",
    ]);
    // Der erledigte NEUESTE ist noch da und weiterhin erledigt.
    const rows = await dbmod.db.select().from(dbmod.platformErrorsTable);
    expect(rows.find((r) => r.message === "fehler-7")?.resolved).toBe(true);
  });

  it("recordPlatformError beschneidet automatisch auf das (injizierte) Limit", async () => {
    // 7 eindeutige Fehler nacheinander melden — Limit ist 5 (via Env).
    expect(mod.MAX_STORED_ERRORS).toBe(TEST_LIMIT);
    for (let i = 0; i < 7; i++) {
      await mod.recordPlatformError({
        level: "warning",
        message: `boom-${i}`,
        context: "retention-test",
      });
    }

    // Die 2 zuerst gemeldeten sind raus, die 5 zuletzt gemeldeten bleiben.
    expect(await remainingMessages()).toEqual([
      "boom-2",
      "boom-3",
      "boom-4",
      "boom-5",
      "boom-6",
    ]);
  });

  it("Wiederauftreten (Buendelung) rettet einen alten Eintrag vor der Beschneidung", async () => {
    const base = Date.now() - 60 * 60 * 1000;
    // 5 Eintraege am Limit; "fehler-0" ist der aelteste Kandidat fuers Pruning.
    for (let i = 0; i < 5; i++) {
      await seedRow({
        message: `fehler-${i}`,
        lastSeenAt: new Date(base + i * 60_000),
      });
    }

    // "fehler-0" tritt ERNEUT auf: Buendelung aktualisiert lastSeenAt auf
    // jetzt. Der anschliessend gemeldete NEUE Fehler verdraengt daher
    // "fehler-1" (nun der aelteste), nicht den Dauerbrenner "fehler-0".
    await mod.recordPlatformError({
      level: "warning",
      message: "fehler-0",
      context: "retention-test",
    });
    await mod.recordPlatformError({
      level: "warning",
      message: "fehler-neu",
      context: "retention-test",
    });

    expect(await remainingMessages()).toEqual([
      "fehler-0",
      "fehler-2",
      "fehler-3",
      "fehler-4",
      "fehler-neu",
    ]);
    const rows = await dbmod.db.select().from(dbmod.platformErrorsTable);
    expect(rows.find((r) => r.message === "fehler-0")?.count).toBe(2);
  });
});
