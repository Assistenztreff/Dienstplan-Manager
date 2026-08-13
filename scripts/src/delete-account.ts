import "./lib/normalize-db-url";
import { assertNotProdDb } from "./lib/normalize-db-url";
import pg from "pg";
import { deleteAccountTrees } from "@workspace/test-fixtures";

/**
 * Loescht ein (Test-)Konto samt seines kompletten Datenbaums direkt in der DB.
 *
 * Die eigentliche FK-sichere Loeschlogik lebt in `@workspace/test-fixtures` (account-tree)
 * (geteilt mit `cleanup-test-accounts.ts`, der Batch-Variante nach
 * E-Mail-Muster). Details zur Loesch-Reihenfolge siehe dort.
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht. Sicherung: Es werden nur
 * E-Mails der Test-Domain `@dienstplan.test` akzeptiert, solange nicht
 * DELETE_ACCOUNT_ALLOW_ANY=1 gesetzt ist.
 *
 * Aufruf ueber Umgebungsvariablen (analog set-plan), damit der Aufruf aus dem
 * Test per execSync mit ueberschriebener DATABASE_URL (Test-DB) erfolgen kann:
 *   DELETE_ACCOUNT_EMAIL     – E-Mail des Zielkontos (Pflicht)
 *   DELETE_ACCOUNT_ALLOW_ANY – "1" erlaubt auch Nicht-Test-Domains
 *
 * Idempotent: Existiert kein Konto mit der E-Mail, ist das ein Erfolg (Exit 0).
 */
async function main(): Promise<void> {
  // Sicherheitsabbruch: dieses Script ist NICHT fuer Produktionsdaten gedacht.
  assertNotProdDb();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const email = process.env.DELETE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error("DELETE_ACCOUNT_EMAIL muss gesetzt sein.");
  }

  if (
    process.env.DELETE_ACCOUNT_ALLOW_ANY !== "1" &&
    !email.endsWith("@dienstplan.test")
  ) {
    throw new Error(
      `Sicherheitsstopp: "${email}" ist keine Test-Adresse (@dienstplan.test). ` +
        "DELETE_ACCOUNT_ALLOW_ANY=1 setzen, um das zu erzwingen.",
    );
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const userRes = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userRes.rowCount === 0) {
      console.log(`Kein Nutzer mit E-Mail "${email}" gefunden — nichts zu tun.`);
      return;
    }
    const userId = userRes.rows[0]!.id;

    const result = await deleteAccountTrees(client, [userId]);
    console.log(
      `Konto "${email}" (id ${userId}) geloescht: ${result.deletedTeams} Team(s), ` +
        `${result.deletedOrphans} verwaiste(r) Assistent(en).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Loeschen des Kontos:", err);
  process.exit(1);
});
