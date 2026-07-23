import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { normalizeDatabaseUrl } from "./database-url";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL);

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./shift-metrics";
