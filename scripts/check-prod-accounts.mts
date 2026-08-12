import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../lib/db/src/database-url.ts";

const raw = process.env.PROD_DATABASE_URL ?? "";
let url = normalizeDatabaseUrl(raw);
const rotated = process.env.SCALEWAY_DB_PASSWORD;
if (rotated) { const p = new URL(url); p.password = encodeURIComponent(rotated); url = p.toString(); }

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const res = await pool.query(
  `SELECT id, email, role, account_type, plan, is_active, created_at::date
   FROM users ORDER BY id`
);
console.table(res.rows);
await pool.end();
