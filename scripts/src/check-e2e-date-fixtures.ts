import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wächter gegen rottende Abwesenheits-Datums-Fixtures in E2E-Specs (Task #890).
 *
 * Hintergrund: Mehrere Specs, die Urlaub/Krank-Abwesenheiten über
 * POST /api/shifts oder POST /api/shifts/bulk-absence anlegen, hatten fest
 * einprogrammierte Kalenderdaten (z. B. "2027-03-10"). Zwei unabhängige,
 * echte Business-Guards reagieren, sobald ein solches Datum real vergeht:
 *
 *  1. `absence_delete_past_blocked` — das Aufräumen (DELETE) einer Abwesenheit
 *     in afterAll/afterEach schlägt fehl, sobald ihr Datum in die Vergangenheit
 *     gerutscht ist.
 *  2. `forwardPlanningBlocked` (siehe artifacts/api-server/src/routes/shifts.ts)
 *     — das Anlegen schlägt fehl, wenn das Datum das Vorausplanungslimit
 *     (Free=1, Premium=12 Monate) überschreitet.
 *
 * Siehe .agents/memory/e2e-absence-date-anchor-pattern.md für das robuste
 * Muster (Anker "heute + kleiner Puffer", andere Daten als Monats-/Tages-
 * Offset vom Anker) sowie artifacts/dienstplan/e2e/README.md für die
 * Kurzfassung für menschliche Spec-Autoren.
 *
 * Dieser Wächter blockiert NICHT jedes `${YEAR}`/getFullYear()-Datum in der
 * Suite (die meisten sind sichere Relativ-zu-heute-Muster, z. B. "letzter
 * Monat"-Snapshots) — nur echte HARTKODIERTE ISO-Datumsliterale
 * ("2027-03-10") in Specs, die nachweislich eine Abwesenheit (Urlaub/Krank/
 * Freistellung/...) anlegen. Das ist genau die Kombination, die beide Guards
 * oben auslösen kann.
 *
 * Bereits bekannte, geprüfte Ausnahmen stehen in BASELINE (mit Begründung,
 * warum sie NICHT rotten) — neue Treffer außerhalb der Baseline sind ein
 * Merge-Fehler.
 */

const E2E_DIR = "artifacts/dienstplan/e2e";

const ABSENCE_MARKER_RE =
  /type:\s*["'](vacation|urlaub|krank|sick|abgesagt_an|abgesagt_ag|freistellung|kind_krank)["']|\/shifts\/bulk-absence/;

// Erkennt "…"2027-03-10…" oder '…2027-03-10…' — bewusst NUR einfache/doppelte
// Anführungszeichen, keine Template-Literale (Backtick). Dynamisch aus einem
// Anker berechnete Daten werden immer über `${...}`-Interpolation in
// Template-Literalen eingesetzt (siehe futureYearFor/dayString-Muster) und
// tauchen deshalb hier nicht auf.
const DATE_LITERAL_RE = /["']\d{4}-\d{2}-\d{2}/;

// Datei -> Begründung, warum ein Treffer hier bewusst KEIN Zeitbomben-Risiko
// ist (nach individueller Prüfung, kein pauschales Grandfathering).
const BASELINE: Record<string, string> = {
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts":
    "Fester Monat (Okt. 2026) nur fuer deterministische Lohn-Testdaten (keine " +
    "Sonntage/Feiertage im Zeitraum). forwardPlanningBlocked laesst vergangene " +
    "und aktuelle Monate IMMER zu (Bestandsschutz) - das Datum kann nicht in " +
    "die Zukunfts-Sperre laufen. Aufraeumen via deleteFreeAccount (direktes " +
    "SQL, kein gefuehrter DELETE-Endpunkt) - absence_delete_past_blocked " +
    "greift hier nie.",
};

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    try {
      readFileSync(path.join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      // weitersuchen
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function listSpecFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".spec.ts"))
    .map((e) => e.name)
    .sort();
}

function scanFile(repoRoot: string, name: string): Violation[] {
  const full = path.join(repoRoot, E2E_DIR, name);
  const content = readFileSync(full, "utf8");
  if (!ABSENCE_MARKER_RE.test(content)) return [];

  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (DATE_LITERAL_RE.test(line)) {
      violations.push({ file: name, line: i + 1, text: trimmed });
    }
  }
  return violations;
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const e2eDir = path.join(repoRoot, E2E_DIR);

  const files = listSpecFiles(e2eDir);
  const newViolations: Violation[] = [];

  for (const file of files) {
    const hits = scanFile(repoRoot, file);
    if (hits.length === 0) continue;
    if (file in BASELINE) continue; // individuell geprueft, siehe BASELINE-Kommentar
    newViolations.push(...hits);
  }

  if (newViolations.length === 0) {
    console.log(
      `[e2e-date-fixtures] Keine hartkodierten Abwesenheits-Datumsliterale ausserhalb der Baseline (${files.length} Specs geprueft).`,
    );
    return;
  }

  console.error(
    "\n[e2e-date-fixtures] FEHLER: Hartkodiertes Kalenderdatum in einer Abwesenheits-E2E-Spec gefunden.\n" +
      "Ein fest einprogrammiertes Datum (z. B. \"2027-03-10\") rottet, sobald die Zeit vergeht:\n" +
      "  - Aufraeumen (DELETE) kann am Vergangenheits-Loeschschutz scheitern.\n" +
      "  - Anlegen kann am Vorausplanungslimit (historyMonths) scheitern.\n" +
      "Bitte auf das Anker-Muster umstellen (heute + kleiner Puffer, andere Daten als Offset) -\n" +
      "siehe artifacts/dienstplan/e2e/README.md. Ist das Datum nachweislich unproblematisch,\n" +
      "die Datei mit Begruendung in BASELINE (scripts/src/check-e2e-date-fixtures.ts) eintragen.\n",
  );
  for (const v of newViolations) {
    console.error(`  ${E2E_DIR}/${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

main();
