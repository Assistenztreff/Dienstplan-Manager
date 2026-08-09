import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Repo-weite Sperre rund um den generierten API-Client.
 *
 * Problem: Der Codegen-Wächter (check-codegen-drift) lässt Orval mit
 * `clean: true` laufen — für einige Sekunden sind
 * `lib/api-client-react/src/generated` und `lib/api-zod/src/generated` LEER.
 * Läuft gleichzeitig eine zweite Prüfkette (z. B. Abschluss-Validierung
 * parallel zum typecheck-Workflow), liest deren `tsc --build` genau in dieses
 * Fenster hinein und scheitert mit TS2307/TS6307, obwohl der Code korrekt ist.
 *
 * Lösung: Alle Abschnitte, die die generierten Verzeichnisse LEEREN (Orval)
 * oder LESEN (typecheck:libs), halten dieselbe Verzeichnis-Sperre. mkdir ist
 * atomar; eine Sperre gilt als verwaist, wenn der eingetragene Prozess nicht
 * mehr lebt oder sie älter als MAX_AGE ist.
 */

const LOCK_DIR_NAME = ".codegen-lock";
const MAX_AGE_MS = 10 * 60 * 1000; // Orval + tsc --build liegen weit darunter.
const POLL_MS = 500;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockPath(repoRoot: string): string {
  return path.join(repoRoot, ".local", "state", LOCK_DIR_NAME);
}

function tryRemoveStale(dir: string): void {
  try {
    const meta = JSON.parse(readFileSync(path.join(dir, "owner.json"), "utf8")) as {
      pid: number;
      at: number;
    };
    const stale = !pidAlive(meta.pid) || Date.now() - meta.at > MAX_AGE_MS;
    if (stale) rmSync(dir, { recursive: true, force: true });
  } catch {
    // owner.json fehlt/kaputt: nur nach Alter der Verzeichnis-Erstellung gehen
    // wir nicht — sicherheitshalber nach MAX_AGE via mtime aufräumen.
    try {
      if (Date.now() - statSync(dir).mtimeMs > MAX_AGE_MS) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      /* Verzeichnis ist bereits weg — gut so. */
    }
  }
}

/** Blockiert, bis die Sperre gehalten wird; gibt eine release-Funktion zurück. */
export async function acquireCodegenLock(repoRoot: string): Promise<() => void> {
  const dir = lockPath(repoRoot);
  mkdirSync(path.dirname(dir), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(
        path.join(dir, "owner.json"),
        JSON.stringify({ pid: process.pid, at: Date.now() }),
      );
      return () => {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* bereits entfernt */
        }
      };
    } catch {
      tryRemoveStale(dir);
      if (Date.now() - started > MAX_AGE_MS) {
        throw new Error(
          `[codegen-lock] Sperre ${dir} nach ${MAX_AGE_MS / 60000} min nicht erhalten — verwaisten Ordner prüfen/löschen.`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

export function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
