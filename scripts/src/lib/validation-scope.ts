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
