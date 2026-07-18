import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Codegen-Drift-Waechter (Merge-Absicherung).
 *
 * Problem: `lib/api-spec/openapi.yaml` ist die Single Source of Truth; der
 * generierte API-Client (`lib/api-client-react/src/generated`) und die Zod-
 * Schemas (`lib/api-zod/src/generated`) entstehen daraus per Orval-Codegen.
 * Wird nach einer openapi.yaml-Aenderung der Codegen vergessen (oder sein
 * Output nicht mitgemerged), liegt der generierte Stand hinter der Spec zurueck
 * und `pnpm run typecheck` wird rot — oft erst nachdem der Merge schon auf main
 * gelandet ist.
 *
 * Dieser Waechter laeuft im Merge-Gate (als Teil von `pnpm run typecheck`):
 *  1. Fingerprint (Hash) der generierten Verzeichnisse VOR dem Codegen nehmen.
 *  2. Codegen deterministisch ausfuehren (Orval regeneriert beide Verzeichnisse).
 *  3. Fingerprint NACH dem Codegen vergleichen.
 *
 * Aendert sich etwas, war der vorliegende Codegen veraltet -> harter
 * Fehlschlag mit klarer Meldung. Als Nebeneffekt liegen die frisch generierten
 * (korrekten) Dateien danach im Arbeitsbaum, sodass der Fix nur noch committet
 * werden muss. Ohne Spec-Drift ist der Lauf idempotent (kein Diff).
 *
 * Bewusst OHNE `git diff`: Der Vergleich laeuft gegen den Arbeitsbaum, nicht
 * gegen HEAD — sonst schluege der Guard fehl, obwohl die (noch nicht
 * committeten) generierten Dateien bereits korrekt sind, und er braucht kein
 * Git-Lock (stale index.lock-Gefahr in Sandbox-Umgebungen).
 */

const GENERATED_DIRS = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    // pnpm-workspace.yaml markiert die Repo-Wurzel.
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function hashDirectory(dir: string, hash: ReturnType<typeof createHash>): void {
  if (!existsSync(dir)) {
    hash.update(`missing:${dir}\n`);
    return;
  }
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hash.update(`dir:${entry.name}\n`);
      hashDirectory(full, hash);
    } else if (entry.isFile()) {
      hash.update(`file:${entry.name}\n`);
      hash.update(readFileSync(full));
    }
  }
}

function fingerprint(repoRoot: string): string {
  const hash = createHash("sha256");
  for (const dir of GENERATED_DIRS) {
    hashDirectory(path.join(repoRoot, dir), hash);
  }
  return hash.digest("hex");
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);

  const before = fingerprint(repoRoot);

  console.log("[codegen-guard] Fuehre Codegen aus (Orval regeneriert den API-Client)...");
  try {
    execSync("pnpm --filter @workspace/api-spec exec orval --config ./orval.config.ts", {
      cwd: repoRoot,
      stdio: "inherit",
      timeout: 180_000,
    });
  } catch {
    throw new Error(
      "[codegen-guard] Der Codegen-Lauf (Orval) selbst ist fehlgeschlagen — siehe Ausgabe oben.",
    );
  }

  const after = fingerprint(repoRoot);

  if (before === after) {
    console.log("[codegen-guard] Kein Drift — generierter API-Client ist aktuell.");
    return;
  }

  console.error(
    "\n[codegen-guard] FEHLER: Der eingecheckte API-Codegen ist VERALTET.\n" +
      "Die openapi.yaml wurde geaendert, ohne den Codegen-Output mitzugenerieren/-committen.\n" +
      "Behebung: `pnpm --filter @workspace/api-spec run codegen` ausfuehren und die\n" +
      "Aenderungen in lib/api-client-react/src/generated und lib/api-zod/src/generated committen.\n" +
      "(Der Codegen wurde soeben ausgefuehrt — die korrekten Dateien liegen bereits im Arbeitsbaum.)",
  );
  process.exit(1);
}

main();
