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
  /type:\s*["'](vacation|urlaub|krank|sick|abgesagt_an|abgesagt_ag|freistellung|kind_krank|freizeitausgleich|urlaubsabgeltung)["']|\/shifts\/bulk-absence/;

// Erkennt jedes rohe ISO-Datumsliteral ("2027-03-10"), AUCH innerhalb eines
// Template-Literals wie `2027-03-10T08:00:00.000Z` -- bewusst OHNE Pflicht auf
// ein vorangehendes Anführungszeichen, damit auch Backtick-Literale erfasst
// werden. Dynamisch aus einem Anker berechnete Daten tauchen NIE als rohe
// Ziffernfolge im Quelltext auf (sie stehen als `${...}`-Ausdruck da), daher
// keine Kollision mit dem Anker-Muster.
const DATE_LITERAL_RE = /\d{4}-\d{2}-\d{2}/;

// Schluessel `${Dateiname}:${Zeilennummer}` (NICHT nur der Zeilentext!) ->
// erwarteter getrimmter Zeilentext + Begruendung, warum GENAU DIESER Treffer
// bewusst KEIN Zeitbomben-Risiko ist. Eine reine Text-Uebereinstimmung waere
// unsicher: eine neue, identische Datumszeile an einer ANDEREN Stelle
// derselben Datei (z. B. in einem neuen Testblock) wuerde sonst denselben
// Baseline-Eintrag "erben" und stillschweigend durchrutschen, ganz ohne
// eigene Pruefung. Die Bindung an Datei+Zeilennummer erzwingt: (a) ein
// Duplikat an anderer Stelle ist ein NEUER, ungeprüfter Treffer -> schlaegt
// fehl; (b) verschiebt sich die urspruengliche Zeile (Zeilennummer aendert
// sich), erkennt der `expectedText`-Abgleich das und verlangt eine bewusste
// Aktualisierung des Eintrags statt eines stillen Weiterbestehens.
interface BaselineEntry {
  expectedText: string;
  reason: string;
}

const REASON_LOHNAUSWERTUNG_FIXED_MONTH =
  "Fester Zeitraum (Mo 12. - Do 15.10.2026, keine Sonntage/Feiertage) nur fuer deterministische Lohn-Testdaten. forwardPlanningBlocked laesst vergangene und aktuelle Monate IMMER zu (Bestandsschutz) - das Datum kann nicht in die Zukunfts-Sperre laufen, auch NACHDEM es real vergangen ist. Aufraeumen via deleteFreeAccount (direktes SQL, kein gefuehrter DELETE-Endpunkt) - absence_delete_past_blocked greift hier nie.";

const BASELINE: Record<string, BaselineEntry> = {
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:48": {
    expectedText: 'const NIGHT_START = "2026-10-12T22:00:00.000Z";',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:49": {
    expectedText: 'const NIGHT_END = "2026-10-13T06:00:00.000Z";',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:50": {
    expectedText: 'const PCT_START = "2026-10-13T08:00:00.000Z";',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:51": {
    expectedText: 'const PCT_END = "2026-10-13T18:00:00.000Z"; // Plan 10h',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:52": {
    expectedText: 'const PCT_IST_END = "2026-10-13T17:00:00.000Z"; // Ist 9h',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:53": {
    expectedText: 'const FLAT_START = "2026-10-14T08:00:00.000Z";',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:54": {
    expectedText: 'const FLAT_END = "2026-10-14T12:00:00.000Z"; // Plan 4h',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:55": {
    expectedText: 'const FLAT_IST_END = "2026-10-14T11:00:00.000Z"; // Ist 3h',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
  "dienstplan-lohnauswertung-ist-modus-api.spec.ts:56": {
    expectedText: 'const VACATION_DAY = "2026-10-15";',
    reason: REASON_LOHNAUSWERTUNG_FIXED_MONTH,
  },
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

/**
 * Reine, dateisystemfreie Kernlogik (fuer Unit-Tests exportiert): findet
 * Zeilen mit hartkodierten Datumsliteralen in einer Abwesenheits-Spec, die
 * NICHT durch einen exakt (Datei+Zeilennummer+Text) passenden BASELINE-
 * Eintrag gedeckt sind.
 */
export function findViolationsInSource(content: string, name: string): Violation[] {
  if (!ABSENCE_MARKER_RE.test(content)) return [];

  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (!DATE_LITERAL_RE.test(line)) continue;
    const lineNo = i + 1;
    const baselineEntry = BASELINE[`${name}:${lineNo}`];
    // Nur exempt, wenn Datei+Zeilennummer UND der Zeilentext exakt zum
    // eingetragenen Baseline-Eintrag passen. Ein Duplikat derselben Zeile an
    // anderer Position (andere Zeilennummer) trifft keinen Eintrag und wird
    // als neuer, ungeprüfter Treffer gemeldet; verschiebt sich die
    // urspruengliche Zeile inhaltlich, faellt der Text-Abgleich durch und
    // verlangt eine bewusste Aktualisierung statt stillen Weiterbestehens.
    if (baselineEntry && baselineEntry.expectedText === trimmed) continue;
    violations.push({ file: name, line: lineNo, text: trimmed });
  }
  return violations;
}

function scanFile(repoRoot: string, name: string): Violation[] {
  const full = path.join(repoRoot, E2E_DIR, name);
  const content = readFileSync(full, "utf8");
  return findViolationsInSource(content, name);
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const e2eDir = path.join(repoRoot, E2E_DIR);

  const files = listSpecFiles(e2eDir);
  const newViolations: Violation[] = [];

  for (const file of files) {
    newViolations.push(...scanFile(repoRoot, file));
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
      "die EINZELNE Zeile (Schluessel \"<Datei>:<Zeilennummer>\", plus erwarteter Zeilentext)\n" +
      "mit Begruendung in BASELINE (scripts/src/check-e2e-date-fixtures.ts) eintragen.\n",
  );
  for (const v of newViolations) {
    console.error(`  ${E2E_DIR}/${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

main();
