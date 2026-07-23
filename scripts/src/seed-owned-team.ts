import "./lib/normalize-db-url";
import pg from "pg";

/**
 * Legt fuer einen Nutzer (per E-Mail) ein Team an, dessen Owner er ist —
 * bzw. raeumt es wieder ab.
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht: Ueber die API kann nur ein
 * Dienstleister-Admin Teams anlegen (Owner = Anfragender). Die E2E-Specs
 * brauchen aber einen Weg, einen ASSISTENTEN zum Team-Eigentuemer zu machen,
 * um den 409-Schutz von DELETE /api/users/:id ("Konto besitzt noch Teams")
 * im UI nachzustellen.
 *
 * Aufruf ueber Umgebungsvariablen (analog set-plan), damit der Aufruf aus dem
 * Test per execSync mit ueberschriebener DATABASE_URL (Test-DB) erfolgen kann:
 *   OWNED_TEAM_EMAIL  – E-Mail des Ziel-Nutzers (Pflicht)
 *   OWNED_TEAM_NAME   – Team-Name (Default "E2E Owned Team")
 *   OWNED_TEAM_ACTION – "create" (Default) | "delete"
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const email = process.env.OWNED_TEAM_EMAIL;
  if (!email) {
    throw new Error("OWNED_TEAM_EMAIL muss gesetzt sein.");
  }

  const name = process.env.OWNED_TEAM_NAME ?? "E2E Owned Team";
  const action = process.env.OWNED_TEAM_ACTION ?? "create";
  if (action !== "create" && action !== "delete") {
    throw new Error(`Ungueltige Aktion "${action}" (erlaubt: create | delete).`);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const userRes = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    const user = userRes.rows[0];
    if (!user) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }

    if (action === "create") {
      const res = await client.query<{ id: number }>(
        "INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING id",
        [name, user.id],
      );
      console.log(
        `Team "${name}" (id ${res.rows[0]!.id}) fuer "${email}" angelegt.`,
      );
    } else {
      const res = await client.query(
        "DELETE FROM teams WHERE owner_id = $1 AND name = $2",
        [user.id, name],
      );
      console.log(
        `${res.rowCount ?? 0} Team(s) "${name}" von "${email}" entfernt.`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Seeden des eigenen Teams:", err);
  process.exit(1);
});
