import pg from "pg";
import { resolveDatabaseUrl } from "@workspace/db/database-url";

type RevaluationRow = {
  shiftId: number;
  userId: number;
  userName: string;
  contractId: number | null;
  day: string;
  oldHours: number;
  newHours: number;
  trackedVacationHours: number | null;
  contractHoursUsed: number | null;
};

function emailFilter(): string | null {
  const raw = process.argv.find((arg) => arg.startsWith("--email="));
  return raw ? raw.slice("--email=".length).trim().toLowerCase() : null;
}

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error("APP_DATABASE_URL/DATABASE_URL ist nicht gesetzt.");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows: dbRows } = await client.query<{ db: string }>(
      "SELECT current_database() AS db",
    );
    const targetDb = dbRows[0]?.db ?? "unbekannt";
    const filter = emailFilter();

    const { rows } = await client.query<RevaluationRow>(
      `
        SELECT
          s.id AS "shiftId",
          u.id AS "userId",
          u.name AS "userName",
          c.id AS "contractId",
          (s.start_time AT TIME ZONE 'UTC')::date::text AS day,
          ROUND(COALESCE(s.valued_hours, 0)::numeric, 2)::float8 AS "oldHours",
          ROUND((
            CASE
              WHEN EXTRACT(HOUR FROM s.start_time AT TIME ZONE 'UTC') = 0
               AND EXTRACT(MINUTE FROM s.start_time AT TIME ZONE 'UTC') = 0
               AND EXTRACT(HOUR FROM s.end_time AT TIME ZONE 'UTC') = 23
               AND EXTRACT(MINUTE FROM s.end_time AT TIME ZONE 'UTC') = 59
              THEN COALESCE(
                CASE
                  WHEN c.weekly_hours > 0 AND c.workdays_per_week > 0
                  THEN c.weekly_hours / c.workdays_per_week
                END,
                owner_settings.vacation_hours_per_day,
                8
              )
              ELSE EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600
            END
          )::numeric, 2)::float8 AS "newHours",
          tracked.hours AS "trackedVacationHours",
          c.vacation_hours_used AS "contractHoursUsed"
        FROM shifts s
        JOIN users u ON u.id = s.user_id
        JOIN teams t ON t.id = s.team_id
        LEFT JOIN LATERAL (
          SELECT c0.*
          FROM contracts c0
          WHERE c0.user_id = s.user_id
            AND c0.team_id = s.team_id
            AND c0.start_date <= (s.start_time AT TIME ZONE 'UTC')::date
            AND (c0.end_date IS NULL OR c0.end_date >= (s.start_time AT TIME ZONE 'UTC')::date)
          ORDER BY c0.start_date DESC, c0.id DESC
          LIMIT 1
        ) c ON TRUE
        LEFT JOIN allowance_settings owner_settings
          ON owner_settings.owner_id = t.owner_id
         AND owner_settings.team_id IS NULL
        LEFT JOIN LATERAL (
          SELECT ROUND(COALESCE(SUM(tt.actual_hours), 0)::numeric, 2)::float8 AS hours
          FROM time_tracking tt
          WHERE tt.shift_id = s.id
        ) tracked ON TRUE
        WHERE s.type = 'vacation'
          AND ($1::text IS NULL OR LOWER(u.email) = $1)
        ORDER BY u.id, s.start_time, s.id
      `,
      [filter],
    );

    const changed = rows.filter((row) => Math.abs(row.newHours - row.oldHours) >= 0.005);
    const byContract = new Map<
      number,
      { userId: number; userName: string; before: number; delta: number; shifts: number }
    >();
    for (const row of changed) {
      if (row.contractId == null || row.contractHoursUsed == null) continue;
      const current = byContract.get(row.contractId) ?? {
        userId: row.userId,
        userName: row.userName,
        before: row.contractHoursUsed,
        delta: 0,
        shifts: 0,
      };
      current.delta += row.newHours - row.oldHours;
      current.shifts += 1;
      byContract.set(row.contractId, current);
    }

    console.log(
      JSON.stringify(
        {
          mode: "READ_ONLY_DRY_RUN",
          database: targetDb,
          emailFilter: filter,
          inspectedVacationShifts: rows.length,
          changedVacationShifts: changed.length,
          shifts: changed.map((row) => ({
            ...row,
            deltaHours: Math.round((row.newHours - row.oldHours) * 100) / 100,
          })),
          contracts: [...byContract.entries()].map(([contractId, value]) => ({
            contractId,
            userId: value.userId,
            userName: value.userName,
            affectedShifts: value.shifts,
            beforeHoursUsed: value.before,
            afterHoursUsed: Math.round((value.before + value.delta) * 100) / 100,
            deltaHours: Math.round(value.delta * 100) / 100,
          })),
        },
        null,
        2,
      ),
    );
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});