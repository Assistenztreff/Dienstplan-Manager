import app from "./app";
import { logger } from "./lib/logger";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getBaseUrl } from "./lib/base-url";

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

/**
 * Pool-Warmup: 2 Verbindungen explizit aufbauen, damit beim ersten Request
 * kein Kaltstart-Overhead (2–3 s) entsteht. Fehler beim Warmup sind nicht
 * fatal — der Server startet trotzdem.
 */
async function warmUpPool(): Promise<void> {
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  for (const client of clients) {
    client.release();
  }
  logger.info("DB pool warmed up (2 connections)");
}

// Task #819: Startup-Migration und Pool-Warmup parallel ausführen, damit
// der Server schneller bereit ist. Beide Tasks sind unabhängig voneinander:
// die Migration schreibt DDL, der Warmup baut Verbindungen auf.
// warmUpPool-Fehler sind nicht fatal (server startet trotzdem mit lazy connect);
// ensureRequiredTables-Fehler brechen den Start ab.
Promise.all([
  ensureRequiredTables(),
  warmUpPool().catch((err) => {
    logger.warn({ err }, "DB pool warmup failed — will connect lazily");
  }),
])
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      // Task #810: Beim Start protokollieren, welche Basis-URL für E-Mail-Links
      // verwendet wird. Fehlt APP_URL, wird die Replit-Domain als Fallback
      // genutzt — nach einer Domain-Änderung muss APP_URL aktualisiert werden.
      const emailBaseUrl = getBaseUrl();
      logger.info({ emailBaseUrl }, "E-Mail-Links Basis-URL");
      if (!process.env["APP_URL"]?.trim()) {
        logger.warn(
          "APP_URL ist nicht gesetzt — E-Mail-Links nutzen die Replit-Domain als Fallback. " +
          "Nach einer Domain-Änderung APP_URL auf die neue Produktions-URL setzen.",
        );
      }

      // Task #818: Keepalive-Interval hält den DB-Pool und den Server nach
      // längerem Leerlauf (z. B. auf Replit nach > 5 Min ohne Anfragen) schnell.
      // Eine Verbindung alle 4 Minuten hält die Pool-Verbindungen offen
      // (Pool-Idle-Timeout: 5 Min). Nur in Produktion aktiv — Dev-Server startet
      // häufig neu, dort ist kein Keepalive nötig.
      if (process.env["NODE_ENV"] === "production") {
        const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
        setInterval(() => {
          pool.connect().then((client) => {
            client.release();
          }).catch((err) => {
            logger.warn({ err }, "Keepalive-Ping fehlgeschlagen");
          });
        }, KEEPALIVE_INTERVAL_MS);
        logger.info(
          { intervalMs: KEEPALIVE_INTERVAL_MS },
          "DB-Keepalive-Interval gestartet (Prod)",
        );
      }
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup migration failed — server not started");
    process.exit(1);
  });
