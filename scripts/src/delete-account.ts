import pg from "pg";

/**
 * Loescht ein (Test-)Konto samt seines kompletten Datenbaums direkt in der DB.
 *
 * Hintergrund: `DELETE /api/users/:id` scheitert fuer selbst-registrierte
 * Konten, weil die Registrierung ein "Standard-Team" (teams.owner_id) inkl.
 * 4 geseedeter Schichtmodelle anlegt. `teams.owner_id` kaskadiert zwar beim
 * User-Delete, aber die team-gebundenen Tabellen (shift_models, shifts,
 * contracts, time_tracking, shift_templates) referenzieren `teams.id` OHNE
 * Cascade — der Team-Cascade schlaegt also mit FK-Fehler fehl und die Test-DB
 * sammelt mit jedem E2E-Lauf tote Konten + Teams an.
 *
 * Dieses Skript raeumt FK-sicher auf:
 *   1. team-gebundene Daten der besessenen Teams (Ist-Zeiten, Schichten,
 *      Vertraege, Vorlagen, Schichtmodelle),
 *   2. verwaiste Assistenten, die AUSSCHLIESSLICH Mitglied dieser Teams sind
 *      (und selbst keine Teams besitzen),
 *   3. die Teams selbst (team_members/branding kaskadieren),
 *   4. das Konto (allowance_settings kaskadiert).
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

    await client.query("BEGIN");

    const teamsRes = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1",
      [userId],
    );
    const teamIds = teamsRes.rows.map((r) => r.id);

    let orphanCount = 0;
    if (teamIds.length > 0) {
      // 1) Team-gebundene Daten (team_id ohne Cascade auf teams.id).
      await client.query("DELETE FROM time_tracking WHERE team_id = ANY($1)", [teamIds]);
      await client.query("DELETE FROM shifts WHERE team_id = ANY($1)", [teamIds]);
      await client.query("DELETE FROM contracts WHERE team_id = ANY($1)", [teamIds]);
      await client.query("DELETE FROM shift_templates WHERE team_id = ANY($1)", [teamIds]);
      await client.query("DELETE FROM shift_models WHERE team_id = ANY($1)", [teamIds]);

      // 2) Verwaiste Assistenten: nur Mitglied in den zu loeschenden Teams,
      //    besitzen selbst keine Teams. (User-Delete kaskadiert deren
      //    Restdaten ueber user_id-FKs.)
      const orphanRes = await client.query(
        `DELETE FROM users u
          WHERE u.id <> $1
            AND u.role = 'assistant'
            AND EXISTS (
              SELECT 1 FROM team_members tm
               WHERE tm.user_id = u.id AND tm.team_id = ANY($2)
            )
            AND NOT EXISTS (
              SELECT 1 FROM team_members tm
               WHERE tm.user_id = u.id AND NOT (tm.team_id = ANY($2))
            )
            AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.owner_id = u.id)`,
        [userId, teamIds],
      );
      orphanCount = orphanRes.rowCount ?? 0;

      // 3) Teams (team_members + branding kaskadieren).
      await client.query("DELETE FROM teams WHERE id = ANY($1)", [teamIds]);
    }

    // 4) Konto selbst (allowance_settings kaskadiert; Restdaten in fremden
    //    Teams kaskadieren ueber user_id-FKs).
    await client.query("DELETE FROM users WHERE id = $1", [userId]);

    await client.query("COMMIT");
    console.log(
      `Konto "${email}" (id ${userId}) geloescht: ${teamIds.length} Team(s), ` +
        `${orphanCount} verwaiste(r) Assistent(en).`,
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Loeschen des Kontos:", err);
  process.exit(1);
});
