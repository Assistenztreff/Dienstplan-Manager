import "./lib/normalize-db-url";
import { deriveTestDbUrl } from "./lib/test-db-url.js";
const { url } = deriveTestDbUrl(process.env.DATABASE_URL!);
process.env.DATABASE_URL = url; process.env.APP_DATABASE_URL = url;
const { db, pool } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
for (let i = 0; i < 10; i++) {
  const r = await db.execute(sql`SELECT count(*) FILTER (WHERE created_at > now() - interval '2 minutes') AS fresh, count(*) AS total FROM users WHERE email LIKE 'e2e.%'`);
  console.log(new Date().toISOString(), r.rows[0]);
  const { fresh } = r.rows[0] as { fresh: string };
  if (fresh === "0") break;
  await new Promise((res) => setTimeout(res, 20000));
}
// stale cleanup
const users = await db.execute(sql`SELECT id, email FROM users WHERE email LIKE 'e2e.%' AND created_at < now() - interval '5 minutes'`);
console.log("cleanup:", users.rows.map((r) => (r as {email:string}).email));
for (const row of users.rows as { id: number }[]) {
  const id = row.id;
  for (const t of ["time_tracking","shifts","contracts","team_members"]) {
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE user_id = ${id}`)).catch(() => {});
  }
  await db.execute(sql`DELETE FROM plan_changes WHERE actor_id = ${id}`).catch(() => {});
  const teams = await db.execute(sql`SELECT id FROM teams WHERE owner_id = ${id}`);
  for (const t of teams.rows as { id: number }[]) {
    for (const tbl of ["time_tracking","shifts","contracts","shift_models","team_members"]) {
      await db.execute(sql.raw(`DELETE FROM ${tbl} WHERE team_id = ${t.id}`)).catch(() => {});
    }
    await db.execute(sql`DELETE FROM teams WHERE id = ${t.id}`).catch(() => {});
  }
  await db.execute(sql`DELETE FROM users WHERE id = ${id}`).catch((e) => console.log("user", id, e.message));
}
console.log("done");
await pool.end();
