import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acquireCodegenLock, findRepoRoot } from "./lib/codegen-lock";

/**
 * Alle Unit-Suiten — unter derselben Sperre wie der Codegen-Wächter.
 *
 * Warum: Die Vitest-Suiten von dienstplan und api-server importieren die
 * GENERIERTEN Verzeichnisse (`lib/api-client-react/src/generated`,
 * `lib/api-zod/src/generated`). Der Codegen-Wächter (check-codegen-drift,
 * Teil von `pnpm run typecheck`) lässt Orval diese Ordner für einige Sekunden
 * LEEREN und neu schreiben. Die Abschluss-Validierung startet typecheck-,
 * unit- und e2e-Prüfung PARALLEL — ohne Sperre liest Vitest in genau dieses
 * Leerfenster hinein und scheitert mit "Cannot find module './generated/api'",
 * obwohl der Code korrekt ist (beobachtet in der Merge-Validierung).
 *
 * Die geteilte Sperre (siehe codegen-lock.ts) serialisiert Leeren und Lesen;
 * db- und scripts-Suiten lesen die Ordner zwar nicht, laufen aber der
 * Einfachheit halber mit unter der Sperre (Gesamtlaufzeit ~1 Minute, weit
 * unter der 10-Minuten-Verwaisungsgrenze der Sperre).
 */
const SUITES = [
  "pnpm --filter @workspace/dienstplan run test",
  "pnpm --filter @workspace/db run test",
  "pnpm --filter @workspace/test-fixtures run test",
  "pnpm --filter @workspace/api-server run test:unit",
  "pnpm --filter @workspace/scripts run test",
];

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const release = await acquireCodegenLock(repoRoot);
  try {
    for (const cmd of SUITES) {
      console.log(`[test-unit-locked] ${cmd}`);
      execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
    }
  } finally {
    release();
  }
}

main().catch((err) => {
  if (err instanceof Error && !("status" in err)) console.error(err.message);
  process.exit(
    typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 1,
  );
});
