import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../lib/db/src/database-url.ts";

const raw = process.env.PROD_DATABASE_URL ?? "";
let url = normalizeDatabaseUrl(raw);
const rotated = process.env.SCALEWAY_DB_PASSWORD;
if (rotated) { const p = new URL(url); p.password = encodeURIComponent(rotated); url = p.toString(); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const [shifts, contracts, memberships] = await Promise.all([
  pool.query(`SELECT COUNT(*) FROM shifts WHERE user_id=24`),
  pool.query(`SELECT COUNT(*) FROM contracts WHERE user_id=24`),
  pool.query(`SELECT COUNT(*) FROM team_members WHERE user_id=24`),
]);
console.log("Schichten:", shifts.rows[0].count, "| Verträge:", contracts.rows[0].count, "| Teams:", memberships.rows[0].count);
await pool.end();
