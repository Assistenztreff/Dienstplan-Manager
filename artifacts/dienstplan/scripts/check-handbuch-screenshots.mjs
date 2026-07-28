#!/usr/bin/env node
/**
 * Frische-Prüfung für die Handbuch-Screenshots (Task #619).
 *
 * Die echten App-Screenshots im Handbuch
 * (`artifacts/mockup-sandbox/src/components/mockups/handbuch/_assets/`)
 * entstehen per `pnpm --filter @workspace/dienstplan run screenshots:handbuch`
 * und veralten still, sobald sich die UI ändert (z. B. neues Logo).
 *
 * Mechanik (Fingerprint, NICHT git/mtime — Checkouts zerstören mtimes):
 * - Beim Screenshot-Lauf wird ein Hash über alle screenshot-relevanten
 *   Quellen (src/, public/, index.html der Dienstplan-App) in
 *   `_assets/handbuch-screenshots.fingerprint.json` geschrieben (`--update`).
 * - Der Check-Modus (Default) berechnet den Hash erneut und schlägt fehl,
 *   wenn er vom gespeicherten abweicht → Hinweis in der Merge-Prüfung.
 *
 * Aufruf (aus artifacts/dienstplan):
 *   node scripts/check-handbuch-screenshots.mjs           # prüfen
 *   node scripts/check-handbuch-screenshots.mjs --update  # Stempel setzen
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FINGERPRINT_FILE = path.resolve(
  APP_DIR,
  "../mockup-sandbox/src/components/mockups/handbuch/_assets/handbuch-screenshots.fingerprint.json",
);

/** Screenshot-relevante Eingaben: alles, was im Browser gerendert wird. */
const INPUT_DIRS = ["src", "public"];
const INPUT_FILES = ["index.html"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function computeFingerprint() {
  const files = [];
  for (const d of INPUT_DIRS) {
    const abs = path.join(APP_DIR, d);
    if (existsSync(abs) && statSync(abs).isDirectory()) files.push(...walk(abs));
  }
  for (const f of INPUT_FILES) {
    const abs = path.join(APP_DIR, f);
    if (existsSync(abs)) files.push(abs);
  }
  files.sort();
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(path.relative(APP_DIR, f));
    hash.update("\0");
    hash.update(readFileSync(f));
    hash.update("\0");
  }
  return { fingerprint: hash.digest("hex"), fileCount: files.length };
}

const current = computeFingerprint();

if (process.argv.includes("--update")) {
  writeFileSync(
    FINGERPRINT_FILE,
    JSON.stringify(
      {
        comment:
          "Automatisch geschrieben von scripts/check-handbuch-screenshots.mjs --update (Ende von screenshots:handbuch). Nicht von Hand ändern.",
        fingerprint: current.fingerprint,
        fileCount: current.fileCount,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Handbuch-Screenshot-Fingerprint aktualisiert (${current.fileCount} Quelldateien).`,
  );
  process.exit(0);
}

if (!existsSync(FINGERPRINT_FILE)) {
  console.error(
    "Kein Fingerprint gefunden — Handbuch-Screenshots wurden noch nie mit Stempel erzeugt.\n" +
      "Bitte ausführen: pnpm --filter @workspace/dienstplan run screenshots:handbuch",
  );
  process.exit(1);
}

const stored = JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"));
if (stored.fingerprint !== current.fingerprint) {
  console.error(
    "⚠ Handbuch-Screenshots sind veraltet: Die UI-Quellen der Dienstplan-App haben sich\n" +
      `  seit dem letzten Screenshot-Lauf (${stored.generatedAt}) geändert.\n\n` +
      "  Bitte neu erzeugen (überschreibt die Bilder reproduzierbar und setzt den Stempel):\n" +
      "    pnpm --filter @workspace/dienstplan run screenshots:handbuch\n\n" +
      "  Danach die aktualisierten Bilder + Fingerprint-Datei mit committen.",
  );
  process.exit(1);
}

console.log("Handbuch-Screenshots sind aktuell (Fingerprint stimmt überein).");
