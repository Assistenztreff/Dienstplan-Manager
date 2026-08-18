// Temporäres READ-ONLY-Diagnoseskript: Urlaubs-Einträge Oliver Kennedy August 2026
// auf der Produktions-DB prüfen (Nachtstunden-Frage). Wird nach Gebrauch gelöscht.
import pg from "pg";
import { normalizeDatabaseUrl } from "@workspace/db/database-url";

const raw = process.env.PROD_DATABASE_URL;
if (!raw) {
  console.error("PROD_DATABASE_URL fehlt");
  process.exit(1);
}
const url = normalizeDatabaseUrl(raw);
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function main() {
  const users = await pool.query(
    `SELECT id, name FROM users WHERE name ILIKE '%kennedy%'`
  );
  console.log("users:", JSON.stringify(users.rows));
  if (users.rows.length === 0) return;
  const uid = users.rows[0].id;
  const shifts = await pool.query(
    `SELECT id, type, team_id,
            to_char(start_time, 'YYYY-MM-DD HH24:MI') AS start_t,
            to_char(end_time, 'YYYY-MM-DD HH24:MI') AS end_t,
            valued_hours, night_hours, sunday_hours, holiday_hours, planning_status
       FROM shifts
      WHERE user_id = $1
        AND start_time >= '2026-08-01' AND start_time < '2026-09-01'
      ORDER BY start_time`,
    [uid]
  );
  console.log("aug shifts:", JSON.stringify(shifts.rows, null, 1));
}

main()
  .catch((e) => {
    console.error("Fehler:", e instanceof Error ? e.message : String(e));
  })
  .finally(async () => {
    await pool.end();
    process.exit(0);
  });
