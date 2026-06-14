import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = process.env.ADMIN_EMAIL ?? "admin@dienstplan.local";
  const password = process.env.ADMIN_PASSWORD ?? "admin1234";
  const name = process.env.ADMIN_NAME ?? "Administrator";

  const existing = await client.query(
    "SELECT id FROM users WHERE email = $1",
    [email.toLowerCase().trim()]
  );

  if (existing.rows.length > 0) {
    console.log(`Admin-Benutzer '${email}' existiert bereits (ID: ${existing.rows[0].id}).`);
    await client.end();
    return;
  }

  const passwordHash = hashPassword(password);
  const result = await client.query(
    `INSERT INTO users (name, email, role, password_hash, is_active)
     VALUES ($1, $2, 'admin', $3, true)
     RETURNING id`,
    [name, email.toLowerCase().trim(), passwordHash]
  );

  const adminId = result.rows[0].id;

  // Standard-Team für den neuen Admin anlegen (idempotent) und Mitgliedschaft sicherstellen.
  const teamResult = await client.query(
    `INSERT INTO teams (name, owner_id)
     SELECT 'Standard-Team', $1
     WHERE NOT EXISTS (SELECT 1 FROM teams)
     RETURNING id`,
    [adminId]
  );
  if (teamResult.rows.length > 0) {
    await client.query(
      `INSERT INTO team_members (team_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [teamResult.rows[0].id, adminId]
    );
  }

  console.log(`Admin-Benutzer erstellt:`);
  console.log(`  ID:       ${result.rows[0].id}`);
  console.log(`  Name:     ${name}`);
  console.log(`  E-Mail:   ${email}`);
  console.log(`  Passwort: ${password}`);
  console.log(`\nBitte das Passwort nach dem ersten Login ändern.`);

  await client.end();
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
