import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { resolveDatabaseUrl } from "./database-url";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

process.env.DATABASE_URL = databaseUrl;

// Remote-DB (Scaleway): Verbindungen lange halten und per TCP-Keepalive stützen,
// damit keine Reconnect-Stürme entstehen — schnelle Auth-Wiederholungen quittiert
// der Server sporadisch mit 28P01 ("password authentication failed").
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
});

// Transiente Verbindungsfehler (z. B. Server-seitiges Kappen idler Verbindungen)
// dürfen den Prozess nicht crashen; der Pool ersetzt die Verbindung selbst.
pool.on("error", (err) => {
  console.error("PG Pool error:", err.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./shift-metrics";
