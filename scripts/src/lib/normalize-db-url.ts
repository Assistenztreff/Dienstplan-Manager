/**
 * Seiteneffekt-Import: loest die effektive Datenbank-URL auf
 * (APP_DATABASE_URL hat Vorrang vor DATABASE_URL; percent-kodiert unkodierte
 * Sonderzeichen im Passwort; optionaler sslmode-Rewrite via
 * DATABASE_SSL_NO_VERIFY=1) und schreibt sie nach process.env.DATABASE_URL,
 * bevor ein Script pg-Clients erstellt.
 * MUSS in jedem Script importiert werden, das DATABASE_URL direkt nutzt.
 */
import { resolveDatabaseUrl, normalizeDatabaseUrl } from "@workspace/db/database-url";

const databaseUrl = resolveDatabaseUrl();
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

/**
 * Produktionsdatenbank-Guard fuer Seed- und Test-Scripts.
 *
 * Bricht mit einem klaren Fehler ab, wenn DATABASE_URL auf denselben Host
 * wie PROD_DATABASE_URL zeigt — also auf die Scaleway-Produktionsdatenbank —
 * und kein explizites Opt-in gesetzt ist.
 *
 * WARUM nur PROD_DATABASE_URL und nicht APP_DATABASE_URL?
 * APP_DATABASE_URL wird von setup-test-db.ts in Kind-Prozessen bewusst auf
 * die Test-DB-URL ueberschrieben, damit normalize-db-url in den Kindprozessen
 * die Test-DB trifft. Wuerde der Guard APP_DATABASE_URL vergleichen, faendet
 * er im Kindprozess DATABASE_URL == APP_DATABASE_URL (beide = Test-DB) und
 * wuerde faelschlich abbrechen. PROD_DATABASE_URL ist ein Workspace-Secret,
 * das nie in Kind-Umgebungen ueberschrieben wird und eindeutig auf die
 * Scaleway-Prod-DB zeigt.
 *
 * Explizites Opt-in: ALLOW_PROD_SEED=1 (nur fuer kontrollierte Ausnahmen).
 *
 * MUSS direkt nach dem normalize-db-url-Seiteneffekt-Import aufgerufen
 * werden, damit DATABASE_URL bereits auf die aufgeloeste URL zeigt.
 */
/**
 * Extrahiert eine normalisierte Datenbank-Identitaet aus einer Postgres-URL:
 * "hostname:port/dbname" (ohne Credentials, ohne Query-Parameter).
 * Unterstuetzt URLs mit unkodiertem Passwort via normalizeDatabaseUrl.
 * Wirft, wenn die URL nicht parsebar ist.
 */
function dbIdentity(raw: string): string {
  const normalized = normalizeDatabaseUrl(raw);
  const parsed = new URL(normalized);
  if (!parsed.hostname) throw new Error("leerer Hostname");
  const port = parsed.port || "5432";
  // Nur den Pfad-Anteil (DB-Name), Suchparameter ignorieren
  const dbPath = parsed.pathname.split("?")[0] ?? "/";
  return `${parsed.hostname}:${port}${dbPath}`;
}

export function assertNotProdDb(): void {
  if (process.env.ALLOW_PROD_SEED === "1") return;

  const prodRaw = process.env.PROD_DATABASE_URL;
  if (!prodRaw) {
    // Kein Prod-Fingerprint gesetzt → fail closed: ohne bekannte Prod-Identitaet
    // kann der Guard die Sicherheit nicht garantieren. Explizites Opt-in noetig.
    console.error(
      `\nSICHERHEITSABBRUCH: PROD_DATABASE_URL ist nicht gesetzt.\n` +
        `Dieses Script verweigert den Start ohne bekannte Produktions-DB-Identitaet,\n` +
        `da es sonst nicht pruefen kann, ob DATABASE_URL auf Produktionsdaten zeigt.\n` +
        `Explizites Opt-in: ALLOW_PROD_SEED=1\n`,
    );
    process.exit(1);
  }

  // Normalisieren vor dem Parsen: Postgres-URLs mit unkodiertem Passwort
  // (z. B. Sonderzeichen wie #, ?) scheitern direkt an new URL().
  // Vergleich via "hostname:port/dbname" — reicht nicht, Hostname allein zu
  // pruefen, da Staging und Prod denselben Host teilen koennen und sich nur
  // im Datenbanknamen unterscheiden.
  let prodIdentity: string;
  try {
    prodIdentity = dbIdentity(prodRaw);
  } catch {
    // PROD_DATABASE_URL ist gesetzt, aber nicht parsebar → fail closed:
    // Der Guard kann die Prod-Identitaet nicht verifizieren — sicherer Abbruch.
    console.error(
      `\nSICHERHEITSABBRUCH: PROD_DATABASE_URL ist gesetzt, kann aber nicht geparst werden.\n` +
        `Dieses Script verweigert den Start, solange die Produktions-DB-Identitaet nicht\n` +
        `verifiziert werden kann.\n` +
        `Explizites Opt-in: ALLOW_PROD_SEED=1\n`,
    );
    process.exit(1);
  }

  const currentRaw = process.env.DATABASE_URL;
  if (!currentRaw) return;

  let currentIdentity: string;
  try {
    // DATABASE_URL wurde bereits durch den Seiteneffekt-Import normalisiert;
    // dbIdentity normalisiert nochmals — idempotent und defensiv.
    currentIdentity = dbIdentity(currentRaw);
  } catch {
    // DATABASE_URL ist gesetzt, aber nicht parsebar → fail closed:
    // Kann nicht ausschliessen, dass es die Prod-DB ist.
    console.error(
      `\nSICHERHEITSABBRUCH: DATABASE_URL kann nicht geparst werden.\n` +
        `Dieses Script verweigert den Start, solange die Ziel-DB nicht verifiziert werden kann.\n` +
        `Explizites Opt-in: ALLOW_PROD_SEED=1\n`,
    );
    process.exit(1);
  }

  if (prodIdentity === currentIdentity) {
    const redacted = currentRaw.replace(/:([^@]*)@/, ":***@");
    console.error(
      `\nSICHERHEITSABBRUCH: DATABASE_URL zeigt auf die Produktionsdatenbank ("${prodIdentity}").\n` +
        `Dieses Script ist NICHT fuer den Einsatz gegen die Produktionsdatenbank gedacht.\n` +
        `Aktuelle URL: ${redacted}\n` +
        `\nFalls du das wirklich beabsichtigst, setze explizit:\n` +
        `  ALLOW_PROD_SEED=1 pnpm ...\n`,
    );
    process.exit(1);
  }
}
