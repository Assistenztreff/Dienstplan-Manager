import "./lib/normalize-db-url";
import { assertNotProdDb } from "./lib/normalize-db-url";
import pg from "pg";
import { deleteAccountTrees } from "@workspace/test-fixtures";

/**
 * Entfernt ALLE liegengebliebenen E2E-Test-Konten (`e2e.*@dienstplan.test`)
 * samt ihres kompletten Datenbaums in EINEM Batch aus der Datenbank.
 *
 * Hintergrund: Jede E2E-Spec raeumt ihre registrierten Konten zwar selbst per
 * `deleteFreeAccount`/`deleteAccountByEmail` auf — bricht ein Lauf aber
 * mittendrin ab (Timeout, Ctrl-C, Crash), laufen die afterAll-Hooks nicht und
 * die Konten bleiben als Leichen in der `_test`-DB liegen. Dieses Skript macht
 * die Test-DB selbstheilend; es wird aufgerufen:
 *   - von `setup-test-db.ts` VOR jedem Lauf (heilt Reste abgebrochener Laeufe),
 *   - vom Playwright-globalTeardown NACH jedem Lauf.
 *
 * Sicherung: Es werden AUSSCHLIESSLICH Konten mit E-Mail-Muster
 * `e2e.%@dienstplan.test` geloescht — der geseedete Test-Admin
 * (`admin@dienstplan.local`) und alle echten Konten sind nie betroffen.
 * Die FK-sichere Loeschlogik ist mit `delete-account.ts` geteilt
 * (`@workspace/test-fixtures`, account-tree). Idempotent: keine Treffer = Erfolg (Exit 0).
 */
async function main(): Promise<void> {
  // Sicherheitsabbruch: dieses Script ist NICHT fuer Produktionsdaten gedacht.
  assertNotProdDb();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const res = await client.query<{ id: number; email: string }>(
      "SELECT id, email FROM users WHERE email LIKE 'e2e.%@dienstplan.test'",
    );
    if (res.rowCount === 0) {
      console.log("Keine E2E-Test-Konten gefunden — nichts zu tun.");
      return;
    }

    const userIds = res.rows.map((r) => r.id);
    const result = await deleteAccountTrees(client, userIds);
    console.log(
      `E2E-Test-Konten bereinigt: ${result.deletedUsers} Konto/Konten, ` +
        `${result.deletedTeams} Team(s), ${result.deletedOrphans} verwaiste(r) Assistent(en).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Bereinigen der E2E-Test-Konten:", err);
  process.exit(1);
});
