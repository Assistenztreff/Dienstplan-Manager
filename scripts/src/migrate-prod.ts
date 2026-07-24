import { spawnSync } from "node:child_process";
import pg from "pg";
import { normalizeDatabaseUrl } from "@workspace/db/database-url";
import { findMissingSchemaObjects } from "@workspace/db/verify-schema";
import {
  parseArgs,
  hostAndDb,
  dbName,
  urlsCollide,
  confirmNameMatches,
  pushOutputIndicatesFailure,
  TTY_PROMPT_PATTERN,
  SESSION_DROP_PATTERN,
  NO_CHANGES_PATTERN,
} from "./lib/migrate-prod-guards.js";

/**
 * Sicherer Produktions-DB-Abgleich beim Veröffentlichen (Republish).
 *
 * Beim Veröffentlichen wandert nur der Code nach Produktion — Schema-Änderungen
 * der Datenbank nicht. Dieses Skript bringt die (Scaleway-)Produktions-DB
 * kontrolliert auf den aktuellen Drizzle-Schema-Stand:
 *
 *   Dry-Run (Standard, ändert NICHTS):
 *     PROD_DATABASE_URL='postgres://…' pnpm --filter @workspace/scripts run migrate-prod
 *     (oder URL als erstes Argument nach `--`)
 *
 *   Anwenden (ausdrückliche Bestätigung = Name der Ziel-DB):
 *     PROD_DATABASE_URL='…' pnpm --filter @workspace/scripts run migrate-prod -- --yes <dbname>
 *
 * Sicherheitsnetze:
 * - Die Ziel-URL MUSS explizit übergeben werden (PROD_DATABASE_URL oder
 *   Argument) — niemals stillschweigend die Umgebungs-URL.
 * - Läuft NIE gegen die Staging-/Dev-URL (DATABASE_URL / APP_DATABASE_URL):
 *   identische URL oder identischer Host+DB-Name => Abbruch.
 * - Schreiben nur mit `--yes <dbname>`, wobei <dbname> exakt dem Datenbank-
 *   namen der Ziel-URL entsprechen muss.
 * - drizzle-kit push läuft ohne TTY: interaktive Rückfragen (Datenverlust/
 *   Truncate) führen zu einem klaren Abbruch mit Handlungsanweisung statt
 *   Hängen oder stiller Teilanwendung.
 * - Geplante Statements werden VOR dem Anwenden inspiziert; ein DROP der
 *   Session-Tabelle (`session`, von connect-pg-simple) bricht IMMER ab.
 * - Daten-Migrationen (migrate-teams u. a.) laufen wie im Post-Merge-Ablauf
 *   VOR dem Schema-Push, in derselben Reihenfolge.
 * - Scaleway-Besonderheiten: URL-Normalisierung (unkodierte Passwörter) via
 *   normalizeDatabaseUrl; TLS-Verhalten via DATABASE_SSL_NO_VERIFY=1 (Opt-in).
 */

// Daten-Migrationen in Post-Merge-Reihenfolge (scripts/post-merge.sh) —
// idempotent, laufen VOR dem Schema-Push gegen die Ziel-DB.
const DATA_MIGRATIONS = [
  "migrate-teams",
  "migrate-allowance-settings",
  "migrate-absences-fix",
  "backfill-team-shift-models",
] as const;

// Idempotente SQL-Vorab-Schritte aus scripts/post-merge.sh (dort per psql):
// verhindern interaktive drizzle-push-Rückfragen auf Bestands-DBs.
// Bei Änderungen in post-merge.sh hier mitziehen.
const PRE_PUSH_SQL: string[] = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token text;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_calendar_token_unique') THEN
       ALTER TABLE users ADD CONSTRAINT users_calendar_token_unique UNIQUE (calendar_token);
     END IF;
   END $$;`,
  `ALTER TABLE allowance_settings ADD COLUMN IF NOT EXISTS team_id integer;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_team_id_teams_id_fk') THEN
       ALTER TABLE allowance_settings
         ADD CONSTRAINT allowance_settings_team_id_teams_id_fk
         FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_team_id_unique') THEN
       ALTER TABLE allowance_settings ADD CONSTRAINT allowance_settings_team_id_unique UNIQUE (team_id);
     END IF;
   END $$;`,
  `ALTER TABLE allowance_settings DROP CONSTRAINT IF EXISTS allowance_settings_owner_id_unique;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS allowance_settings_owner_account_unique
     ON allowance_settings (owner_id) WHERE team_id IS NULL;`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'branding_settings' AND column_name = 'id') THEN
       ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_pkey;
       ALTER TABLE branding_settings DROP COLUMN id;
       ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_owner_id_unique;
       ALTER TABLE branding_settings ADD CONSTRAINT branding_settings_pkey PRIMARY KEY (owner_id);
     END IF;
   END $$;`,
  `DROP SEQUENCE IF EXISTS branding_settings_id_seq;`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'team_branding_settings' AND column_name = 'id') THEN
       ALTER TABLE team_branding_settings DROP CONSTRAINT IF EXISTS team_branding_settings_pkey;
       ALTER TABLE team_branding_settings DROP COLUMN id;
       ALTER TABLE team_branding_settings DROP CONSTRAINT IF EXISTS team_branding_settings_team_id_unique;
       ALTER TABLE team_branding_settings ADD CONSTRAINT team_branding_settings_pkey PRIMARY KEY (team_id);
     END IF;
   END $$;`,
  `DROP SEQUENCE IF EXISTS team_branding_settings_id_seq;`,
];


/** drizzle-kit push gegen die Ziel-URL ausführen; Ausgabe zurückgeben. */
function runDrizzlePush(
  targetUrl: string,
  opts: { strict: boolean },
): { output: string; status: number | null; error?: Error } {
  // pnpm hängt zusätzliche Argumente ohne "--" direkt an das Script an.
  const args = ["--filter", "@workspace/db", "run", "push", "--verbose"];
  if (opts.strict) args.push("--strict");
  const result = spawnSync("pnpm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DATABASE_URL: targetUrl,
      APP_DATABASE_URL: targetUrl,
    },
    encoding: "utf8",
    timeout: 300_000,
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
    error: result.error,
  };
}


async function main(): Promise<void> {
  const { targetUrlRaw, apply, confirmName } = parseArgs(process.argv.slice(2));

  if (!targetUrlRaw) {
    console.error(
      [
        "FEHLER: Keine Produktions-DB-URL übergeben.",
        "",
        "Verwendung:",
        "  Dry-Run:   PROD_DATABASE_URL='postgres://…' pnpm --filter @workspace/scripts run migrate-prod",
        "  Anwenden:  PROD_DATABASE_URL='postgres://…' pnpm --filter @workspace/scripts run migrate-prod -- --yes <dbname>",
        "",
        "Die URL kann alternativ als erstes Argument (nach `--`) übergeben werden.",
        "Die Umgebungs-URL (DATABASE_URL/APP_DATABASE_URL) wird bewusst NIE",
        "stillschweigend verwendet.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const targetUrl = normalizeDatabaseUrl(targetUrlRaw);
  let targetHostDb: string;
  try {
    targetHostDb = hostAndDb(targetUrl);
  } catch {
    throw new Error(
      "Die übergebene Produktions-URL ist nicht parsebar (auch nach Normalisierung). Bitte Passwort URL-kodieren.",
    );
  }
  const targetDbName = dbName(targetUrl);

  // Sicherheitsnetz: NIE gegen Staging/Dev laufen.
  for (const [envName, raw] of [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["APP_DATABASE_URL", process.env.APP_DATABASE_URL],
  ] as const) {
    if (!raw) continue;
    const envUrl = normalizeDatabaseUrl(raw);
    let envHostDb: string | undefined;
    try {
      envHostDb = hostAndDb(envUrl);
    } catch {
      envHostDb = undefined;
    }
    if (urlsCollide(targetUrl, envUrl)) {
      console.error(
        `ABBRUCH: Die Ziel-URL entspricht der Staging-/Dev-URL aus ${envName} (${envHostDb ?? "?"}). ` +
          "migrate-prod läuft ausschließlich gegen eine EIGENE Produktions-DB.",
      );
      process.exit(1);
    }
  }

  // Verbindung prüfen.
  const probe = new pg.Client({
    connectionString: targetUrl,
    connectionTimeoutMillis: 15_000,
  });
  await probe.connect();
  const info = await probe.query<{ db: string }>("SELECT current_database() AS db");
  await probe.end();
  console.log(`Ziel-Datenbank: ${targetHostDb} (current_database = ${info.rows[0].db})`);

  if (apply && !confirmNameMatches(confirmName, targetDbName)) {
    console.error(
      `ABBRUCH: Bestätigung fehlt oder falsch. Zum Anwenden exakt den Namen der Ziel-DB angeben: --yes ${targetDbName}`,
    );
    process.exit(1);
  }

  if (!apply) {
    // ---------- Dry-Run: nur anzeigen, nichts ändern ----------
    console.log(
      "\nDry-Run (keine Änderungen). Geplante Schema-Statements laut drizzle-kit:\n",
    );
    const dry = runDrizzlePush(targetUrl, { strict: true });
    process.stdout.write(dry.output);
    if (dry.error) throw dry.error;
    if (NO_CHANGES_PATTERN.test(dry.output)) {
      console.log("\nErgebnis: Schema ist bereits aktuell.");
    } else if (TTY_PROMPT_PATTERN.test(dry.output)) {
      console.log(
        "\nHinweis: drizzle-kit hat vor dem (im Dry-Run gewollten) Abbruch die anstehenden Statements ausgegeben — es wurde NICHTS angewendet.",
      );
    }
    console.log(
      [
        "",
        "WICHTIG: Beim echten Lauf laufen zuerst die Daten-Migrationen",
        `(${DATA_MIGRATIONS.join(", ")}) sowie idempotente SQL-Vorab-Schritte —`,
        "der tatsächliche Push-Diff kann dadurch KLEINER ausfallen als oben angezeigt.",
        "",
        `Anwenden mit: pnpm --filter @workspace/scripts run migrate-prod -- --yes ${targetDbName}`,
      ].join("\n"),
    );
    return;
  }

  // ---------- Anwenden ----------
  console.log(`\nBestätigung ok (--yes ${targetDbName}). Starte Migration…`);

  // Frische (leere) Ziel-DB erkennen: Daten-Migrationen und SQL-Vorab-Schritte
  // setzen Bestandstabellen voraus — bei einer leeren DB direkt zum Push.
  const freshProbe = new pg.Client({ connectionString: targetUrl });
  await freshProbe.connect();
  const usersExists = await freshProbe.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'",
  );
  await freshProbe.end();
  const isFreshDb = usersExists.rowCount === 0;
  if (isFreshDb) {
    console.log(
      "Ziel-DB ist leer (keine users-Tabelle) — Daten-Migrationen und SQL-Vorab-Schritte werden übersprungen, Schema wird frisch angelegt.",
    );
  }

  // 1) Daten-Migrationen (Post-Merge-Reihenfolge) gegen die Ziel-DB.
  for (const name of isFreshDb ? [] : DATA_MIGRATIONS) {
    console.log(`\n[1/4] Daten-Migration: ${name}`);
    const result = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", name],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          ...process.env,
          DATABASE_URL: targetUrl,
          APP_DATABASE_URL: targetUrl,
        },
        timeout: 300_000,
      },
    );
    if (result.status !== 0 || result.error) {
      throw new Error(
        `Daten-Migration "${name}" fehlgeschlagen — Abbruch VOR dem Schema-Push (nichts weiter angewendet).`,
      );
    }
  }

  // 2) Idempotente SQL-Vorab-Schritte (wie post-merge.sh).
  if (!isFreshDb) {
    console.log("\n[2/4] Idempotente SQL-Vorab-Schritte…");
    const sqlClient = new pg.Client({ connectionString: targetUrl });
    await sqlClient.connect();
    try {
      for (const stmt of PRE_PUSH_SQL) {
        await sqlClient.query(stmt);
      }
    } finally {
      await sqlClient.end();
    }
  }

  // 3) Geplante Statements inspizieren (Strict-Lauf ohne TTY wendet nichts an),
  //    dann Push. Ein DROP der Session-Tabelle bricht IMMER ab.
  console.log("\n[3/4] Schema-Push (drizzle-kit)…");
  const plan = runDrizzlePush(targetUrl, { strict: true });
  if (SESSION_DROP_PATTERN.test(plan.output)) {
    process.stdout.write(plan.output);
    console.error(
      "\nABBRUCH: drizzle-kit will die Session-Tabelle (`session`) löschen. " +
        "Das darf nie passieren — die Tabelle muss im Drizzle-Schema stehen (lib/db). Nichts angewendet.",
    );
    process.exit(1);
  }
  const push = runDrizzlePush(targetUrl, { strict: false });
  process.stdout.write(push.output);
  if (
    push.status !== 0 ||
    push.error != null ||
    pushOutputIndicatesFailure(push.output)
  ) {
    console.error(
      [
        "",
        "FEHLER: drizzle-kit push ist fehlgeschlagen oder wollte interaktiv nachfragen",
        "(Datenverlust-/Truncate-Rückfrage ohne TTY). Es wurde NICHT still teilweise angewendet.",
        "Handlungsanweisung: Die betroffene Schema-Änderung braucht einen idempotenten",
        "SQL-Vorab-Schritt (Vorbild: PRE_PUSH_SQL in diesem Skript bzw. scripts/post-merge.sh),",
        "der die Änderung prompt-frei macht. Danach migrate-prod erneut ausführen.",
      ].join("\n"),
    );
    process.exit(1);
  }

  // 4) Verifizieren: fehlt nach dem Push etwas gegenüber dem Drizzle-Schema?
  console.log("\n[4/4] Schema-Verifikation…");
  const problems = await findMissingSchemaObjects(targetUrl);
  if (problems.length > 0) {
    console.error(
      `FEHLER: Nach dem Push fehlen noch ${problems.length} Objekt(e) gegenüber dem Drizzle-Schema:`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "Vermutlich hat drizzle-kit eine Rückfrage verschluckt. Idempotenten SQL-Vorab-Schritt ergänzen und erneut ausführen.",
    );
    process.exit(1);
  }

  console.log(
    `\nFertig: Produktions-DB "${targetDbName}" ist auf dem aktuellen Schema-Stand. Jetzt kann der Code veröffentlicht werden (Republish).`,
  );
}

main().catch((err) => {
  console.error("Fehler bei migrate-prod:", err);
  process.exit(1);
});
