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
import { execSync, spawn } from "node:child_process";
import { resolveTestDbSuffix } from "@workspace/test-fixtures/test-db-name";
import {
  classifyChangedFiles,
  planForCategory,
  type ChangeCategory,
  type ScopeResult,
  type ValidationLane,
  type ValidationPlan,
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

/**
 * Fuehrt ein Kommando aus; Ausgabe zeilenweise mit Lane-Praefix, damit die
 * verschraenkten Logs paralleler Lanes lesbar bleiben.
 */
function runCommand(
  cmd: string,
  lane: string,
  env: Record<string, string> | undefined,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const forward = (stream: NodeJS.WritableStream) => {
      let buffer = "";
      return (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) stream.write(`[${lane}] ${line}\n`);
      };
    };
    child.stdout.on("data", forward(process.stdout));
    child.stderr.on("data", forward(process.stderr));
    child.on("error", (err) => {
      log(`[${lane}] Startfehler: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Laesst die Kommandos einer Lane seriell laufen; erster Fehler bricht die Lane ab. */
async function runLane(lane: ValidationLane): Promise<boolean> {
  for (const cmd of lane.commands) {
    log(`[${lane.name}] >>> ${cmd}`);
    const started = Date.now();
    const code = await runCommand(cmd, lane.name, lane.env);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    if (code !== 0) {
      log(`[${lane.name}] Block fehlgeschlagen (nach ${mins} min): ${cmd}`);
      return false;
    }
    log(`[${lane.name}] Block gruen (${mins} min): ${cmd}`);
  }
  return true;
}

function describePlan(plan: ValidationPlan): string {
  const head =
    plan.serialHead.length > 0
      ? `  Zuerst seriell:\n${plan.serialHead.map((c) => `    - ${c}`).join("\n")}\n`
      : "";
  const lanes = plan.parallelLanes
    .map(
      (l) =>
        `  Lane ${l.name}${l.env ? ` (${Object.entries(l.env).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}:\n${l.commands.map((c) => `    - ${c}`).join("\n")}`,
    )
    .join("\n");
  const tail =
    plan.serialTail.length > 0
      ? `\n  Danach seriell:\n${plan.serialTail.map((c) => `    - ${c}`).join("\n")}`
      : "";
  return `${head}${lanes}${tail}`;
}

async function main(): Promise<void> {
  const scope = determineScope();
  log(`Kategorie: ${scope.category} — ${scope.reason}`);
  if (scope.decisiveFiles.length > 0) {
    log(`Massgebliche Datei(en): ${scope.decisiveFiles.join(", ")}`);
  }

  // Parallelisierung (Task #640): nur mit privatem Test-DB-Suffix sicher
  // (jede Shard-Lane bekommt eine eigene Wegwerf-DB). E2E_PARALLEL=0 als
  // bewusster Rueckfall auf die serielle Kette.
  let baseSuffix = "";
  try {
    baseSuffix = resolveTestDbSuffix();
  } catch {
    baseSuffix = "";
  }
  const allowParallel = process.env.E2E_PARALLEL !== "0";
  const plan = planForCategory(scope.category, baseSuffix, allowParallel);
  const totalCommands =
    plan.serialHead.length +
    plan.parallelLanes.reduce((n, l) => n + l.commands.length, 0) +
    plan.serialTail.length;

  if (process.argv.includes("--dry-run")) {
    log(
      totalCommands === 0
        ? "Dry-Run: kein E2E-Testblock noetig."
        : `Dry-Run: geplanter Ablauf (${plan.parallelLanes.length} parallele Lane(s)):\n${describePlan(plan)}`,
    );
    return;
  }
  if (totalCommands === 0) {
    log("Kein E2E-Testblock noetig — Kette wird uebersprungen (Typecheck/Unit/Screenshot-Check laufen separat).");
    return;
  }

  const startedAt = Date.now();
  log(`Geplanter Ablauf (${plan.parallelLanes.length} parallele Lane(s)):\n${describePlan(plan)}`);
  for (const cmd of plan.serialHead) {
    const ok = await runLane({ name: "head", commands: [cmd] });
    if (!ok) process.exit(1);
  }
  const results = await Promise.all(plan.parallelLanes.map((l) => runLane(l)));
  const failedLanes = plan.parallelLanes
    .filter((_, i) => !results[i])
    .map((l) => l.name);
  if (failedLanes.length > 0) {
    log(`Fehlgeschlagene Lane(s): ${failedLanes.join(", ")}`);
    process.exit(1);
  }
  for (const cmd of plan.serialTail) {
    const ok = await runLane({ name: "tail", commands: [cmd] });
    if (!ok) process.exit(1);
  }
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  log(`Alle ausgewaehlten Bloecke gruen (Gesamtdauer ${mins} min).`);
}

main().catch((err) => {
  log(`Unerwarteter Fehler: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exit(1);
});
