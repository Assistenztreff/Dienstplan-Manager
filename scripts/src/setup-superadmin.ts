import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const [argEmail, argPassword, argName] = process.argv
    .slice(2)
    .filter((a) => a !== "--");

  const email = (argEmail ?? process.env.SUPERADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = argPassword ?? process.env.SUPERADMIN_PASSWORD ?? "";
  const name = argName ?? process.env.SUPERADMIN_NAME ?? "Betreiber";

  if (!email || !email.includes("@")) {
    console.error(
      "Fehler: E-Mail fehlt oder ungültig.\n" +
        "Nutzung: pnpm --filter @workspace/scripts run setup-superadmin -- <email> <passwort> [name]\n" +
        "Oder per Env: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME"
    );
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error(
      "Fehler: Passwort fehlt oder zu kurz (mindestens 8 Zeichen).\n" +
        "Es gibt bewusst KEIN Standard-Passwort für das Betreiber-Konto."
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const existing = await client.query(
      "SELECT id, role FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      const { id, role } = existing.rows[0];
      if (role === "superadmin") {
        console.log(`Superadmin '${email}' existiert bereits (ID: ${id}). Nichts zu tun.`);
        return;
      }
      await client.query(
        "UPDATE users SET role = 'superadmin', is_active = true WHERE id = $1",
        [id]
      );
      console.log(
        `Bestehendes Konto '${email}' (ID: ${id}, bisherige Rolle: ${role}) wurde zum Superadmin befördert.\n` +
          `Passwort wurde NICHT geändert.`
      );
      return;
    }

    const passwordHash = hashPassword(password);
    const result = await client.query(
      `INSERT INTO users (name, email, role, password_hash, is_active)
       VALUES ($1, $2, 'superadmin', $3, true)
       RETURNING id`,
      [name, email, passwordHash]
    );

    console.log(`Superadmin-Konto erstellt:`);
    console.log(`  ID:     ${result.rows[0].id}`);
    console.log(`  Name:   ${name}`);
    console.log(`  E-Mail: ${email}`);
    console.log(`\nZugang: Login wie üblich, danach ist /operator-dashboard sichtbar.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
