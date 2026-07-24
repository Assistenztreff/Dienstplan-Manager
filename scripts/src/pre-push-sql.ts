import "./lib/normalize-db-url";
import pg from "pg";
import { runPrePushSql } from "./lib/pre-push-sql.js";

/**
 * Führt die gemeinsamen idempotenten SQL-Vorab-Schritte (lib/pre-push-sql.ts)
 * gegen DATABASE_URL aus — Post-Merge-Ersatz für die früheren psql-Blöcke in
 * scripts/post-merge.sh. Läuft VOR `db push`, damit push ohne TTY keine
 * interaktiven Rückfragen stellt.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runPrePushSql(client);
    console.log("Idempotente SQL-Vorab-Schritte angewendet.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("SQL-Vorab-Schritte fehlgeschlagen:", err);
  process.exit(1);
});
