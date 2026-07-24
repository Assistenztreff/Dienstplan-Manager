// Reine, DB-freie Prüf-Helfer für migrate-prod.ts — hier ausgelagert,
// damit die Sicherheitsnetze per Vitest-Unit-Tests eingefroren sind.

export interface CliArgs {
  targetUrlRaw: string | undefined;
  apply: boolean;
  confirmName: string | undefined;
}

export function parseArgs(
  argv: string[],
  env: { PROD_DATABASE_URL?: string } = process.env,
): CliArgs {
  let apply = false;
  let confirmName: string | undefined;
  let targetUrlRaw = env.PROD_DATABASE_URL;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes") {
      apply = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        confirmName = next;
        i++;
      }
    } else if (arg.startsWith("--yes=")) {
      apply = true;
      confirmName = arg.slice("--yes=".length);
    } else if (!arg.startsWith("--")) {
      targetUrlRaw = arg;
    } else {
      throw new Error(`Unbekannte Option: ${arg}`);
    }
  }
  return { targetUrlRaw, apply, confirmName };
}

export function hostAndDb(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
}

export function dbName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "").split("?")[0];
}

/**
 * Staging-/Dev-Guard: true, wenn die Ziel-URL mit einer Umgebungs-URL
 * kollidiert (identische URL ODER identischer Host+Port+DB-Name).
 * Beide URLs müssen bereits normalisiert sein.
 */
export function urlsCollide(targetUrl: string, envUrl: string): boolean {
  if (envUrl === targetUrl) return true;
  let targetHostDb: string;
  try {
    targetHostDb = hostAndDb(targetUrl);
  } catch {
    return false;
  }
  let envHostDb: string;
  try {
    envHostDb = hostAndDb(envUrl);
  } catch {
    return false;
  }
  return envHostDb === targetHostDb;
}

/** Bestätigung: --yes <name> muss exakt dem DB-Namen der Ziel-URL entsprechen. */
export function confirmNameMatches(
  confirmName: string | undefined,
  targetDbName: string,
): boolean {
  return confirmName === targetDbName;
}

export const TTY_PROMPT_PATTERN = /Interactive prompts require a TTY/i;
export const ERROR_LINE_PATTERN = /^\s*Error:/m;
export const SESSION_DROP_PATTERN =
  /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?"?(public"?\."?)?session"?/i;
export const NO_CHANGES_PATTERN =
  /No changes detected|Everything's fine|schema is up to date/i;

/** Push-Ausgabe, die als Fehlschlag gilt (Prompt ohne TTY oder Error-Zeile). */
export function pushOutputIndicatesFailure(output: string): boolean {
  return TTY_PROMPT_PATTERN.test(output) || ERROR_LINE_PATTERN.test(output);
}
