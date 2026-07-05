import pg from "pg";

// ---------------------------------------------------------------------------
// revoke-superadmin — Betreiber-Rechte (Rolle "superadmin") sicher ENTZIEHEN.
// ---------------------------------------------------------------------------
// Gegenstück zu setup-superadmin.ts. Betreiber-Rechte werden bewusst NUR per
// Skript/DB vergeben — und ebenso nur per Skript wieder entzogen; es gibt
// absichtlich KEINEN Weg über die App (Registrierung, Operator-Plan-Endpunkt,
// Profil setzen/entziehen die Rolle nie, siehe Absicherungs-Spec
// dienstplan-superadmin-nicht-ueber-api.spec.ts).
//
// Verhalten:
//   - Konto existiert nicht            -> Fehler (exit 1).
//   - Konto ist KEIN superadmin        -> nichts zu tun (idempotent, exit 0).
//   - Konto ist superadmin             -> Rolle auf "admin" zurückgestuft.
//
// Zurückgestuft wird auf "admin" (nicht gelöscht/deaktiviert): der Betreiber
// nutzt die App ohnehin wie ein Admin, verliert aber den Operator-Zugriff. Das
// Passwort, is_active und der Konto-Typ bleiben unverändert.
//
// Sicherung gegen Aussperren: den LETZTEN verbleibenden Superadmin entzieht das
// Skript nur mit ausdrücklicher Bestätigung (Flag --force oder Env
// SUPERADMIN_ALLOW_LAST_REVOKE=1), damit die Plattform nicht versehentlich ohne
// jeden Operator dasteht.
//
// Nutzung:
//   pnpm --filter @workspace/scripts run revoke-superadmin -- <email> [--force]
//   oder per Env: SUPERADMIN_EMAIL (+ optional SUPERADMIN_ALLOW_LAST_REVOKE=1)
// ---------------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2).filter((a) => a !== "--");
  const allowLast =
    rawArgs.includes("--force") ||
    process.env.SUPERADMIN_ALLOW_LAST_REVOKE === "1";
  const [argEmail] = rawArgs.filter((a) => !a.startsWith("--"));

  const email = (argEmail ?? process.env.SUPERADMIN_EMAIL ?? "")
    .toLowerCase()
    .trim();

  if (!email || !email.includes("@")) {
    console.error(
      "Fehler: E-Mail fehlt oder ungültig.\n" +
        "Nutzung: pnpm --filter @workspace/scripts run revoke-superadmin -- <email> [--force]\n" +
        "Oder per Env: SUPERADMIN_EMAIL (+ optional SUPERADMIN_ALLOW_LAST_REVOKE=1)"
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

    if (existing.rows.length === 0) {
      console.error(`Abbruch: Konto '${email}' existiert nicht.`);
      process.exit(1);
    }

    const { id, role } = existing.rows[0];

    if (role !== "superadmin") {
      // Idempotent: schon kein Betreiber mehr -> nichts zu tun.
      console.log(
        `Konto '${email}' (ID: ${id}) ist kein Superadmin (Rolle: ${role}). Nichts zu tun.`
      );
      return;
    }

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM users WHERE role = 'superadmin'"
    );
    const superadminCount = rows[0].n as number;

    if (superadminCount <= 1 && !allowLast) {
      console.error(
        `Abbruch: '${email}' (ID: ${id}) ist der EINZIGE verbleibende Superadmin.\n` +
          `Wird ihm die Rolle entzogen, hat die Plattform keinen Operator mehr.\n` +
          `Zum Bestätigen: Flag '--force' anhängen oder Env SUPERADMIN_ALLOW_LAST_REVOKE=1 setzen.\n` +
          `Beispiel: pnpm --filter @workspace/scripts run revoke-superadmin -- <email> --force`
      );
      process.exit(1);
    }

    await client.query("UPDATE users SET role = 'admin' WHERE id = $1", [id]);

    console.log(
      `Betreiber-Rechte entzogen: '${email}' (ID: ${id}) ist jetzt Rolle 'admin'.\n` +
        `Passwort, Aktiv-Status und Konto-Typ blieben unverändert; der Operator-Zugriff ist ab sofort weg.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
