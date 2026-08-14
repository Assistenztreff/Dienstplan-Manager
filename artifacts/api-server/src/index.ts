import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotente Startup-Migration: legt Tabellen an, die im Drizzle-Schema
 * existieren, aber auf der Produktions-DB noch fehlen können (z. B. weil
 * migrate-prod noch nicht explizit ausgeführt wurde).
 * CREATE TABLE IF NOT EXISTS ist sicher auf Dev- und Prod-DB.
 */
async function ensureRequiredTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_rate_limit_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS email_rl_attempts_ip_attempted_at_idx
      ON email_rate_limit_attempts (ip, attempted_at);

    CREATE TABLE IF NOT EXISTS register_rate_limit_attempts (
      id serial PRIMARY KEY,
      ip text NOT NULL,
      attempted_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS register_rl_attempts_ip_attempted_at_idx
      ON register_rate_limit_attempts (ip, attempted_at);
  `);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

ensureRequiredTables()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup migration failed — server not started");
    process.exit(1);
  });
