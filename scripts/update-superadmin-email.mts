import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../lib/db/src/database-url.ts";

const raw = process.env.PROD_DATABASE_URL ?? "";
if (!raw) { console.error("PROD_DATABASE_URL nicht gesetzt"); process.exit(1); }

let url = normalizeDatabaseUrl(raw);
const rotated = process.env.SCALEWAY_DB_PASSWORD;
if (rotated) {
  const parsed = new URL(url);
  parsed.password = encodeURIComponent(rotated);
  url = parsed.toString();
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const result = await pool.query(
  `UPDATE users SET email = $1 WHERE email = $2 RETURNING id, email, role`,
  ["kontakt@assistenztreff.de", "admin@dienstplan.local"],
);
if (result.rowCount === 0) {
  console.log("Kein Account mit admin@dienstplan.local gefunden — ggf. bereits geändert.");
} else {
  console.log("✓ E-Mail geändert:", result.rows);
}

await pool.end();
