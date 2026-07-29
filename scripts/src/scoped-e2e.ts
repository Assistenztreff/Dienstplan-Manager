/**
 * Gestaffelte E2E-Kette fuer die Abschlusspruefung (Task #636).
 *
 * Ermittelt aus dem tatsaechlichen Aenderungsumfang (git) die Aenderungs-
 * Kategorie und startet nur die zugehoerigen Bloecke der seriellen E2E-Kette.
 * Die Zuordnungsregeln leben zentral in `lib/validation-scope.ts`.
 *
 * Aenderungsumfang = committete Abweichung von der Basis (merge-base mit dem
 * Haupt-Zweig) PLUS alle uncommitteten/untracked Aenderungen im Arbeitsbaum.
 *
 * SICHERHEITSREGEL: Jede Unsicherheit (kein git, keine Basis-Referenz
 * auffindbar, leerer Aenderungsumfang, Parse-Fehler) fuehrt zur vollen Kette.
 *
 * Overrides:
 *   VALIDATION_SCOPE=full|frontend|docs  — Kategorie erzwingen (fuer
 *     Probelaeufe/Debugging; wird im Log ausgewiesen)
 *   VALIDATION_DIFF_BASE=<ref>           — Basis-Referenz erzwingen
 *   --dry-run                            — nur Kategorie + geplante Bloecke
 *                                          ausgeben, nichts ausfuehren
 */
import { execSync, spawnSync } from "node:child_process";
import {
  blocksForCategory,
  classifyChangedFiles,
  type ChangeCategory,
  type ScopeResult,
} from "./lib/validation-scope.js";

const log = (msg: string): void => console.log(`[scoped-e2e] ${msg}`);

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
  } catch {
    return null;
  }
}

/** Basis-Referenz fuer den Diff: Override > main-repl/main > origin/main > main. */
function findBaseRef(): string | null {
  const override = process.env.VALIDATION_DIFF_BASE;
  const candidates = override
    ? [override]
    : ["main-repl/main", "origin/main", "main"];
  for (const ref of candidates) {
    if (git(`rev-parse --verify --quiet ${ref}`) !== null) return ref;
  }
  return null;
}

/** Geaenderte Dateien (Basis..HEAD + Arbeitsbaum) oder null bei Unsicherheit. */
function collectChangedFiles(): string[] | null {
  const baseRef = findBaseRef();
  if (baseRef === null) {
    log("Keine Basis-Referenz gefunden (main-repl/main, origin/main, main).");
    return null;
  }
  const mergeBase = git(`merge-base ${baseRef} HEAD`);
  if (mergeBase === null) {
    log(`merge-base mit ${baseRef} nicht ermittelbar.`);
    return null;
  }
  const committed = git(`diff --name-only ${mergeBase} HEAD`);
  const status = git("status --porcelain");
  if (committed === null || status === null) return null;

  const files = new Set<string>();
  for (const line of committed.split("\n")) {
    const f = line.trim();
    if (f) files.add(f);
  }
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    // Porcelain v1: XY <pfad> bzw. XY <alt> -> <neu> (Rename). Bewusst NICHT
    // ueber feste Spalten-Offsets parsen: git() trimmt die Gesamtausgabe und
    // frisst damit das fuehrende Leerzeichen der ersten Zeile (" M foo").
    const m = line.trim().match(/^\S+\s+(.*)$/);
    if (m === null) continue;
    const rest = m[1]!;
    const arrow = rest.indexOf(" -> ");
    const raw = arrow >= 0 ? rest.slice(arrow + 4) : rest;
    const f = raw.replace(/^"|"$/g, "").trim();
    if (f) files.add(f);
  }
  log(`Basis: ${baseRef} (merge-base ${mergeBase.slice(0, 10)}), ${files.size} geaenderte Datei(en).`);
  return [...files].sort();
}

function determineScope(): ScopeResult {
  const forced = process.env.VALIDATION_SCOPE as ChangeCategory | undefined;
  if (forced === "full" || forced === "frontend" || forced === "docs") {
    return {
      category: forced,
      decisiveFiles: [],
      reason: `Kategorie per VALIDATION_SCOPE=${forced} erzwungen.`,
    };
  }
  const files = collectChangedFiles();
  if (files === null) {
    return {
      category: "full",
      decisiveFiles: [],
      reason:
        "Aenderungsumfang nicht ermittelbar (git-Fehler) — Sicherheitsregel: volle Kette.",
    };
  }
  return classifyChangedFiles(files);
}

function main(): void {
  const scope = determineScope();
  log(`Kategorie: ${scope.category} — ${scope.reason}`);
  if (scope.decisiveFiles.length > 0) {
    log(`Massgebliche Datei(en): ${scope.decisiveFiles.join(", ")}`);
  }

  const commands = blocksForCategory(scope.category);
  if (process.argv.includes("--dry-run")) {
    log(
      commands.length === 0
        ? "Dry-Run: kein E2E-Testblock noetig."
        : `Dry-Run: es liefen ${commands.length} von 4 Bloecken:\n${commands.map((c) => `  - ${c}`).join("\n")}`,
    );
    return;
  }
  if (commands.length === 0) {
    log("Kein E2E-Testblock noetig — Kette wird uebersprungen (Typecheck/Unit/Screenshot-Check laufen separat).");
    return;
  }
  log(`Es laufen ${commands.length} von 4 Bloecken der E2E-Kette.`);
  for (const cmd of commands) {
    log(`>>> ${cmd}`);
    const res = spawnSync(cmd, { shell: true, stdio: "inherit" });
    if (res.status !== 0 || res.error != null) {
      log(`Block fehlgeschlagen: ${cmd}`);
      process.exit(res.status ?? 1);
    }
  }
  log("Alle ausgewaehlten Bloecke gruen.");
}

main();
