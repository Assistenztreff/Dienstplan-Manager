import type pg from "pg";

/**
 * FK-sichere Loeschlogik fuer (Test-)Konten samt ihres kompletten Datenbaums.
 *
 * Hintergrund: `DELETE /api/users/:id` scheitert fuer selbst-registrierte
 * Konten, weil die Registrierung ein "Standard-Team" (teams.owner_id) inkl.
 * 4 geseedeter Schichtmodelle anlegt. `teams.owner_id` kaskadiert zwar beim
 * User-Delete, aber die team-gebundenen Tabellen (shift_models, shifts,
 * contracts, time_tracking) referenzieren `teams.id` OHNE
 * Cascade — der Team-Cascade schlaegt also mit FK-Fehler fehl und die Test-DB
 * sammelt mit jedem E2E-Lauf tote Konten + Teams an.
 *
 * Reihenfolge (batch-faehig, eine Transaktion):
 *   1. team-gebundene Daten der besessenen Teams (Ist-Zeiten, Schichten,
 *      Vertraege, Vorlagen, Schichtmodelle),
 *   2. verwaiste Assistenten, die AUSSCHLIESSLICH Mitglied dieser Teams sind
 *      (und selbst keine Teams besitzen),
 *   3. die Teams selbst (team_members/branding kaskadieren),
 *   4. die Konten (allowance_settings kaskadiert; Restdaten in fremden Teams
 *      kaskadieren ueber user_id-FKs).
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht.
 */
/**
 * Team-gebundene Tabellen, die `teams.id` OHNE `ON DELETE CASCADE`
 * referenzieren und daher hier explizit VOR dem Team-Delete geleert werden
 * muessen. Reihenfolge beachten (FKs untereinander: time_tracking -> shifts
 * -> shift_models).
 *
 * WICHTIG: Kommt eine neue Tabelle mit nicht-kaskadierendem FK auf `teams.id`
 * hinzu, MUSS sie hier ergaenzt werden — sonst schlaegt das Loeschen der Teams
 * mit FK-Fehler fehl und die Test-DB sammelt wieder Konten-Leichen an. Das
 * Skript `verify-test-db-cleanup` prueft genau diese Invariante automatisch.
 */
export const TEAM_BOUND_TABLES = [
  "time_tracking",
  "shifts",
  "contracts",
  "shift_models",
] as const;

export interface DeleteAccountTreesResult {
  deletedUsers: number;
  deletedTeams: number;
  deletedOrphans: number;
}

export async function deleteAccountTrees(
  client: pg.Client,
  userIds: number[],
): Promise<DeleteAccountTreesResult> {
  if (userIds.length === 0) {
    return { deletedUsers: 0, deletedTeams: 0, deletedOrphans: 0 };
  }

  await client.query("BEGIN");
  try {
    const teamsRes = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = ANY($1)",
      [userIds],
    );
    const teamIds = teamsRes.rows.map((r) => r.id);

    let orphanCount = 0;
    if (teamIds.length > 0) {
      // 1) Team-gebundene Daten (team_id ohne Cascade auf teams.id).
      for (const table of TEAM_BOUND_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE team_id = ANY($1)`, [teamIds]);
      }

      // 2) Verwaiste Assistenten: nur Mitglied in den zu loeschenden Teams,
      //    besitzen selbst keine Teams. (User-Delete kaskadiert deren
      //    Restdaten ueber user_id-FKs.)
      const orphanRes = await client.query(
        `DELETE FROM users u
          WHERE NOT (u.id = ANY($1))
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
        [userIds, teamIds],
      );
      orphanCount = orphanRes.rowCount ?? 0;

      // 3) Teams (team_members + branding kaskadieren).
      await client.query("DELETE FROM teams WHERE id = ANY($1)", [teamIds]);
    }

    // 4) Plan-Aenderungsprotokoll: plan_changes referenziert users OHNE
    //    Cascade (account_id + changed_by). Das Audit-Log ist in der App
    //    bewusst append-only — hier geht es NUR um Test-Infrastruktur, die
    //    Test-Konten samt ihrer Protokollzeilen restlos entfernen muss, sonst
    //    blockiert der FK jedes Loeschen von Konten mit Plan-Historie.
    await client.query(
      "DELETE FROM plan_changes WHERE account_id = ANY($1) OR changed_by = ANY($1)",
      [userIds],
    );

    // 5) Konten selbst.
    const usersRes = await client.query("DELETE FROM users WHERE id = ANY($1)", [
      userIds,
    ]);

    await client.query("COMMIT");
    return {
      deletedUsers: usersRes.rowCount ?? 0,
      deletedTeams: teamIds.length,
      deletedOrphans: orphanCount,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}
