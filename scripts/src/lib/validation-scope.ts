/**
 * Zuordnungsregeln fuer die gestaffelte Abschlusspruefung (Task #636).
 *
 * EINZIGE Stelle, die Dateipfade des Monorepos auf Aenderungs-Kategorien
 * abbildet. Die Kategorie bestimmt, welche Bloecke der seriellen E2E-Kette
 * beim Task-Abschluss laufen (`scripts/src/scoped-e2e.ts`):
 *
 *   Kategorie   | api-server test:db | scripts test:db | e2e:api | e2e:smoke
 *   ------------|--------------------|-----------------|---------|----------
 *   docs        |         —          |        —        |    —    |    —
 *   frontend    |         —          |        —        |    —    |    ✓
 *   full        |         ✓          |        ✓        |    ✓    |    ✓
 *
 * Typecheck, Unit-Tests und der Handbuch-Screenshot-Frische-Check laufen
 * UNABHAENGIG davon immer (eigene Validierungs-Kommandos; der Screenshot-
 * Check ist ein reiner Fingerprint-Vergleich in Sekunden und bleibt deshalb
 * bewusst ungestaffelt).
 *
 * SICHERHEITSREGEL: Im Zweifel alles. Unbekannte Pfade, Aenderungen an
 * API-Server, Datenbank-Schema, geteilten Bibliotheken (lib/**), Skripten,
 * Test-Infrastruktur (e2e/, playwright.config, package.json, Lockfile, ...)
 * ergeben IMMER die volle Kette. Gemischte Aenderungen eskalieren auf die
 * strengste betroffene Kategorie (full > frontend > docs).
 */

/** Aenderungs-Kategorien, aufsteigend nach Pruef-Umfang. */
export type ChangeCategory = "docs" | "frontend" | "full";

const SEVERITY: Record<ChangeCategory, number> = {
  docs: 0,
  frontend: 1,
  full: 2,
};

/**
 * Nur-Doku-Pfade: koennen weder API-Verhalten noch UI-Rendering aendern.
 *  - Markdown ueberall (replit.md, tasks.md, docs, READMEs)
 *  - Agent-Gedaechtnis/-Skills (.agents/**), Task-Notizen (.local/**)
 *  - Anhaenge (attached_assets/**)
 */
function isDocsPath(p: string): boolean {
  if (p.endsWith(".md")) return true;
  if (p.startsWith(".agents/")) return true;
  if (p.startsWith(".local/")) return true;
  if (p.startsWith("attached_assets/")) return true;
  return false;
}

/**
 * Nur-Frontend-Pfade: reine Oberflaeche der Dienstplan-App bzw. der
 * Mockup-Sandbox. Bewusst ENG gefasst:
 *  - `artifacts/dienstplan/src/**`, `public/**`, `index.html` (Client-Code;
 *    der API-Server liegt komplett in artifacts/api-server)
 *  - `artifacts/mockup-sandbox/**` (reine Vorschau-Umgebung, laeuft in
 *    keinem Testblock mit) — AUSSER deren package.json (Dependency-
 *    Aenderungen = Infrastruktur => full, siehe unten)
 *
 * NICHT frontend (=> full): `artifacts/dienstplan/e2e/**` (Testinhalte),
 * `playwright.config.ts`, `vite.config.ts`, `package.json`, tsconfigs —
 * alles Test-/Build-Infrastruktur.
 */
function isFrontendPath(p: string): boolean {
  if (
    p.startsWith("artifacts/dienstplan/src/") ||
    p.startsWith("artifacts/dienstplan/public/") ||
    p === "artifacts/dienstplan/index.html"
  ) {
    return true;
  }
  if (p.startsWith("artifacts/mockup-sandbox/")) {
    // Dependency-/Build-Aenderungen der Sandbox bleiben Infrastruktur.
    const rest = p.slice("artifacts/mockup-sandbox/".length);
    return !/^(package\.json|pnpm-lock\.yaml|vite\.config|tsconfig)/.test(rest);
  }
  return false;
}

/** Kategorie einer einzelnen geaenderten Datei (unbekannt => full). */
export function classifyPath(path: string): ChangeCategory {
  const p = path.replace(/^\.\//, "");
  if (isDocsPath(p)) return "docs";
  if (isFrontendPath(p)) return "frontend";
  // Alles andere — api-server, lib/** (db-Schema, api-spec, test-fixtures,
  // ...), scripts/**, e2e-Specs, Konfiguration, Lockfiles, Workflows,
  // unbekannte neue Verzeichnisse — loest die volle Kette aus.
  return "full";
}

export interface ScopeResult {
  category: ChangeCategory;
  /** Beispiel-Dateien, die die Kategorie (mit)bestimmt haben. */
  decisiveFiles: string[];
  /** Klartext-Begruendung fuer das Log. */
  reason: string;
}

/**
 * Ermittelt aus der Liste geaenderter Dateien die Gesamt-Kategorie
 * (strengste Einzel-Kategorie gewinnt). Leere Liste => full: ohne
 * nachweisbaren Aenderungsumfang wird nichts uebersprungen.
 */
export function classifyChangedFiles(paths: string[]): ScopeResult {
  if (paths.length === 0) {
    return {
      category: "full",
      decisiveFiles: [],
      reason:
        "Keine geaenderten Dateien ermittelbar — Sicherheitsregel: volle Kette.",
    };
  }
  let category: ChangeCategory = "docs";
  let decisive: string[] = paths.slice(0, 5);
  for (const p of paths) {
    const c = classifyPath(p);
    if (SEVERITY[c] > SEVERITY[category]) {
      category = c;
      decisive = [p];
    } else if (c === category && decisive.length < 5 && !decisive.includes(p)) {
      decisive.push(p);
    }
    if (category === "full" && decisive.length >= 5) break;
  }
  if (category === "full") {
    decisive = paths.filter((p) => classifyPath(p) === "full").slice(0, 5);
  } else if (category === "frontend") {
    decisive = paths.filter((p) => classifyPath(p) === "frontend").slice(0, 5);
  } else {
    decisive = paths.slice(0, 5);
  }
  const reasonByCategory: Record<ChangeCategory, string> = {
    docs: "Nur Doku-/Notiz-Dateien geaendert — kein Testblock der E2E-Kette noetig.",
    frontend:
      "Nur Frontend-Oberflaeche (und ggf. Doku) geaendert — UI-Smoke-Tests genuegen.",
    full: "Mindestens eine Datei ausserhalb von Doku/Frontend geaendert — volle Kette.",
  };
  return { category, decisiveFiles: decisive, reason: reasonByCategory[category] };
}

/** Testbloecke der seriellen E2E-Kette, in Ausfuehrungsreihenfolge. */
export const E2E_BLOCKS = {
  apiServerDb: "pnpm --filter @workspace/api-server run test:db",
  scriptsDb: "pnpm --filter @workspace/scripts run test:db",
  e2eApi: "pnpm --filter @workspace/dienstplan run test:e2e:api",
  e2eSmoke: "pnpm --filter @workspace/dienstplan run test:e2e:smoke",
} as const;

/** Zu einer Kategorie gehoerende Kommandos (Reihenfolge = Ausfuehrung). */
export function blocksForCategory(category: ChangeCategory): string[] {
  switch (category) {
    case "docs":
      return [];
    case "frontend":
      return [E2E_BLOCKS.e2eSmoke];
    case "full":
      return [
        E2E_BLOCKS.apiServerDb,
        E2E_BLOCKS.scriptsDb,
        E2E_BLOCKS.e2eApi,
        E2E_BLOCKS.e2eSmoke,
      ];
  }
}

// --- Paralleler Ausfuehrungsplan (Task #640) --------------------------------
// Die volle Kette lief bisher seriell (~30-40 min). Da jede Umgebung private
// Test-DBs `<dbname>_test_<suffix>` besitzt (Task #633) und die Playwright-
// Config Ports/Locks pro Lauf parametrisierbar sind, koennen die teuren
// Bloecke in unabhaengige "Lanes" zerlegt werden, die gleichzeitig laufen:
//
//   Lane db-tests    : api-server test:db  ->  scripts test:db (seriell)
//   Lane api-shard-1 : Haelfte 1 der *-api.spec.ts (eigene DB + Ports)
//   Lane api-shard-2 : Haelfte 2 der *-api.spec.ts (eigene DB + Ports)
//   Danach seriell   : e2e:smoke (Standard-Stack/-DB, UI-lastig — bewusst
//                      NICHT unter Volllast, sonst Timeout-Flakes)
//
// Jede API-Shard-Lane bekommt einen EIGENEN Test-DB-Suffix (Basis-Suffix der
// Umgebung + Shard-Buchstabe) und eigene Ports — kein geteilter DB-Zustand,
// keine Port-Kollisionen, kein gemeinsamer Lauf-Lock (Lock-Datei ist port-
// gebunden, s. playwright.config.ts).
//
// SICHERHEITSREGEL: Ohne privaten Basis-Suffix (E2E_SHARED_TEST_DB=1) oder
// bei E2E_PARALLEL=0 faellt der Plan auf die bewaehrte serielle Kette zurueck.

export interface ValidationLane {
  name: string;
  /** Kommandos, die INNERHALB der Lane seriell laufen. */
  commands: string[];
  /** Zusaetzliche Umgebungsvariablen fuer alle Kommandos der Lane. */
  env?: Record<string, string>;
}

export interface ValidationPlan {
  /** Lanes, die gleichzeitig laufen. */
  parallelLanes: ValidationLane[];
  /** Kommandos, die NACH allen Lanes seriell laufen. */
  serialTail: string[];
}

/** Anzahl paralleler API-Spec-Shards. */
export const API_SHARD_COUNT = 2;

/** Feste Port-Paare der Shard-Lanes (Standard-Lauf nutzt 8099/5199). */
const SHARD_PORTS: ReadonlyArray<{ api: string; web: string }> = [
  { api: "8091", web: "5191" },
  { api: "8092", web: "5192" },
];

/** Shard-Kommando: playwright direkt, damit `--shard` sicher ankommt. */
function apiShardCommand(shard: number): string {
  return `pnpm --filter @workspace/dienstplan exec playwright test "api\\.spec\\.ts$" --shard=${shard}/${API_SHARD_COUNT}`;
}

/**
 * Erstellt den Ausfuehrungsplan fuer eine Kategorie.
 *
 * @param baseSuffix privater Test-DB-Suffix der Umgebung
 *   (resolveTestDbSuffix()); leer = geteilte `_test`-DB, dann ist Sharding
 *   NICHT sicher und es laeuft die serielle Kette.
 * @param allowParallel false (z. B. E2E_PARALLEL=0) erzwingt die serielle
 *   Kette.
 */
export function planForCategory(
  category: ChangeCategory,
  baseSuffix: string,
  allowParallel: boolean,
): ValidationPlan {
  const serial: ValidationPlan = {
    parallelLanes:
      blocksForCategory(category).length > 0
        ? [{ name: "seriell", commands: blocksForCategory(category) }]
        : [],
    serialTail: [],
  };
  if (category !== "full" || !allowParallel || !baseSuffix) return serial;

  // Suffix-Whitelist: [a-z0-9]{1,16}. Basis (Standard: 10 Hex-Zeichen) auf 15
  // kappen, damit + Shard-Ziffer sicher passt.
  const base = baseSuffix.toLowerCase().slice(0, 15);
  if (!/^[a-z0-9]{1,15}$/.test(base)) return serial;

  const shardLanes: ValidationLane[] = [];
  for (let i = 1; i <= API_SHARD_COUNT; i++) {
    const ports = SHARD_PORTS[i - 1];
    if (!ports) return serial;
    shardLanes.push({
      name: `api-shard-${i}`,
      commands: [apiShardCommand(i)],
      env: {
        E2E_TEST_DB_SUFFIX: `${base}${i}`,
        E2E_API_PORT: ports.api,
        E2E_WEB_PORT: ports.web,
      },
    });
  }
  return {
    parallelLanes: [
      { name: "db-tests", commands: [E2E_BLOCKS.apiServerDb, E2E_BLOCKS.scriptsDb] },
      ...shardLanes,
    ],
    serialTail: [E2E_BLOCKS.e2eSmoke],
  };
}
