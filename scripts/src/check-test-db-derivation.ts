/**
 * Waechter gegen verstreute Test-DB-Namensableitungen (Task #635).
 *
 * Die Ableitung `<dbname>_test[_<suffix>]` lebt ZENTRAL in
 * `lib/test-fixtures/src/test-db-name.ts` (`deriveTestDbTarget`). Vor der
 * Zentralisierung gab es vier verstreute Kopien; eine davon waere beinahe
 * uebersehen worden und haette still gegen die falsche DB getestet.
 *
 * Dieser Check laeuft im Merge-Gate (Teil von `pnpm run typecheck`) und
 * schlaegt fehl, sobald irgendwo NEU ad-hoc `_test`-Ableitungslogik
 * (String-Bau eines Test-DB-Namens) ausserhalb des zentralen Moduls
 * auftaucht. Erlaubt bleiben Erwaehnungen in Kommentaren/Fehlermeldungen und
 * reine PRUEF-Regexe (z. B. "endet der DB-Name auf _test?") — verboten ist
 * nur das KONSTRUIEREN eines Namens.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Einzige Stelle, an der Test-DB-Namen gebaut werden duerfen. */
const ALLOWED_FILES = new Set([
  "lib/test-fixtures/src/test-db-name.ts",
  // Der Waechter selbst (enthaelt die Muster als Regex-Quellen).
  "scripts/src/check-test-db-derivation.ts",
  "scripts/src/check-test-db-derivation.test.ts",
]);

const SCAN_DIRS = ["artifacts", "lib", "scripts"];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "generated",
  "test-results",
  "playwright-report",
]);
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);

/**
 * Muster fuer NAMENS-KONSTRUKTION (nicht blosse Erwaehnung):
 *  - Template-Interpolation direkt vor `_test`:   `${base}_test...`
 *  - `_test_` direkt vor einer Interpolation:      `..._test_${suffix}`
 *  - String-Konkatenation mit einem `_test`-Literal: x + "_test", "_test" + x
 */
const DERIVATION_PATTERNS: RegExp[] = [
  /\$\{[^}]*\}_test/,
  /_test_?\$\{/,
  /\+\s*['"`]_test/,
  /['"`]_test_?['"`]\s*\+/,
  /\.concat\(\s*['"`]_test/,
];

/** Zeilen, die nur Kommentar sind, ignorieren (Doku darf `_test` erwaehnen). */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

export interface Violation {
  file: string;
  line: number;
  text: string;
}

export function findViolationsInSource(source: string, relFile: string): Violation[] {
  if (ALLOWED_FILES.has(relFile)) return [];
  const violations: Violation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (DERIVATION_PATTERNS.some((p) => p.test(line))) {
      violations.push({ file: relFile, line: i + 1, text: line.trim() });
    }
  }
  return violations;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry) || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
}

export function scanRepo(repoRoot: string): Violation[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    try {
      walk(path.join(repoRoot, dir), files);
    } catch {
      // Verzeichnis fehlt -> ueberspringen.
    }
  }
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    violations.push(...findViolationsInSource(readFileSync(file, "utf8"), rel));
  }
  return violations;
}

function findRepoRoot(start: string): string {
  let dir = start;
  while (true) {
    try {
      statSync(path.join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error("pnpm-workspace.yaml nicht gefunden");
      dir = parent;
    }
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const violations = scanRepo(repoRoot);
  if (violations.length > 0) {
    console.error(
      "[check-test-db-derivation] Ad-hoc Test-DB-Namensableitung gefunden — " +
        "bitte deriveTestDbTarget aus @workspace/test-fixtures/test-db-name verwenden:\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    process.exit(1);
  }
  console.log("[check-test-db-derivation] OK — keine verstreuten _test-Ableitungen.");
}
