/**
 * Gemeinsame Ableitung des port-gebundenen E2E-Lauf-Lock-Pfads.
 *
 * Hintergrund (Task #643): playwright.config.ts (Erwerb) und
 * e2e/global-teardown.ts (Freigabe) leiteten den Lock-Namen frueher jeweils
 * lokal ab. Als die Shard-Lanes port-gebundene Namen bekamen, wurde die
 * Config zunaechst nicht angepasst — Shard 2 wartete 15 Minuten auf den
 * workspace-globalen `run.lock` von Shard 1. Damit Config und Teardown nie
 * wieder auseinanderlaufen, gibt es genau EINE Ableitung: diese Funktion.
 *
 * WICHTIG: Der Teardown darf die Playwright-Config nie importieren (deren
 * Start-Seiteneffekte wuerden erneut laufen) — deshalb lebt der Helper hier
 * im seiteneffektfreien Fixtures-Paket.
 */

import path from "node:path";

export const DEFAULT_E2E_API_PORT = "8099";
export const DEFAULT_E2E_WEB_PORT = "5199";

/** Port-gebundener Lock-Dateiname relativ zur Repo-Wurzel. */
export function runLockRelativePath(apiPort: string, webPort: string): string {
  return path.join(
    "node_modules/.cache/dienstplan-e2e",
    `run-${apiPort}-${webPort}.lock`,
  );
}

/**
 * Absoluter Lock-Pfad. Ports kommen aus `env` (E2E_API_PORT/E2E_WEB_PORT)
 * mit denselben Defaults, die auch die Playwright-Config verwendet.
 */
export function deriveRunLockPath(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const apiPort = env.E2E_API_PORT ?? DEFAULT_E2E_API_PORT;
  const webPort = env.E2E_WEB_PORT ?? DEFAULT_E2E_WEB_PORT;
  return path.join(repoRoot, runLockRelativePath(apiPort, webPort));
}
