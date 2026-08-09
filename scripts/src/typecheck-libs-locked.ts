import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acquireCodegenLock, findRepoRoot } from "./lib/codegen-lock";

/**
 * `tsc --build` über die Bibliotheken — unter derselben Sperre wie der
 * Codegen-Wächter.
 *
 * Warum: tsc liest `lib/api-client-react/src/generated` und
 * `lib/api-zod/src/generated`. Regeneriert eine PARALLEL laufende Prüfkette
 * genau in diesem Moment den API-Client (Orval leert die Ordner kurz),
 * scheitert tsc mit TS2307/TS6307, obwohl der Code korrekt ist. Die geteilte
 * Sperre serialisiert Leeren und Lesen.
 */
async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const release = await acquireCodegenLock(repoRoot);
  try {
    execSync("tsc --build", { cwd: repoRoot, stdio: "inherit" });
  } finally {
    release();
  }
}

main().catch((err) => {
  if (err instanceof Error && !("status" in err)) console.error(err.message);
  process.exit(typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : 1);
});
