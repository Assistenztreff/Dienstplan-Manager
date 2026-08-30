/**
 * FK-sichere Loeschlogik fuer (Test-)Konten samt ihres kompletten Datenbaums.
 *
 * Hintergrund: `DELETE /api/users/:id` scheitert fuer selbst-registrierte
 * Konten, weil die Registrierung ein "Standard-Team" (teams.owner_id) inkl.
 * geseedeter Schichtmodelle anlegt. `teams.owner_id` kaskadiert zwar beim
 * User-Delete, aber die team-gebundenen Tabellen (shift_models, shifts,
 * contracts, time_tracking) referenzieren `teams.id` OHNE Cascade — der
 * Team-Cascade schlaegt also mit FK-Fehler fehl und die Test-DB sammelt mit
 * jedem E2E-Lauf tote Konten + Teams an.
 *
 * Lebt bewusst in `@workspace/test-fixtures`, damit BEIDE Nutzer dieselbe
 * Logik teilen, ohne dass Leaf-Pakete einander importieren:
 *   - die Test-Skripte (`scripts/src/*`: delete-account, cleanup-test-accounts,
 *     setup-test-accounts, verify-account-separation, verify-test-db-cleanup),
 *   - die Playwright-E2E-Helfer (`artifacts/dienstplan/e2e/helpers`), die die
 *     Bereinigung in-process ausfuehren statt pro Aufruf einen ~3s teuren
 *     `pnpm --filter ... run <skript>`-Prozess zu spawnen.
 *
 * Reihenfolge (batch-faehig, eine Transaktion):
 *   1. team-gebundene Daten der besessenen Teams (Ist-Zeiten, Schichten,
 *      Vertraege, Schichtmodelle),
 *   2. verwaiste Assistenten, die AUSSCHLIESSLICH Mitglied dieser Teams sind
 *      (und selbst keine Teams besitzen),
 *   3. die Teams selbst (team_members/branding kaskadieren),
 *   4. plan_changes-Zeilen der Konten (append-only-Log ohne Cascade),
 *   5. die Konten (allowance_settings kaskadiert; Restdaten in fremden Teams
 *      kaskadieren ueber user_id-FKs).
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht.
 */

/**
 * Minimaler struktureller Client-Typ, damit dieses Lib-Paket KEINE
 * `pg`-Abhaengigkeit braucht: sowohl `pg.Client` als auch `pg.PoolClient`
 * erfuellen diese Signatur strukturell.
 */
export interface AccountTreeDbClient {
  query(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

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
import { USER_BOUND_RESTRICT_TABLES } from "@workspace/db/user-bound-tables";

export const TEAM_BOUND_TABLES = [
  "month_closings",
  "time_tracking",
  "shifts",
  "contracts",
  "shift_models",
  "absence_requests",
  // Haengen zwar per ON DELETE CASCADE am Dienst und verschwinden mit ihm —
  // der Selbstheilungs-Check verlangt aber jede team_id-Tabelle ausdruecklich,
  // damit eine neue Tabelle nie stillschweigend durchrutscht.
  "shift_changes",
  "shift_deviation_reports",
  // Loesch-Archive (Stufe 5). In der PRODUKTION haengen sie NICHT am Team:
  // team_id ist ON DELETE SET NULL, ein geloeschtes Team laesst das Archiv
  // also stehen — genau so gewollt, der Nachweis soll alles ueberleben. Fuer
  // die Test-DB muessen sie trotzdem mit weg, sonst sammeln sich ueber die
  // Laeufe hinweg Archiv-Leichen mit verwaisten Konto-IDs an.
  "deletion_archives",
] as const;

/**
 * Tabellen, die per user_id am Konto haengen und seit dem Loeschschutz
 * (§ 16 ArbZG / § 17 MiLoG, 28.08.2026) mit ON DELETE RESTRICT statt CASCADE
 * verknuepft sind. Genau das ist der Zweck des Loeschschutzes: Zeitnachweise
 * duerfen beim Loeschen einer Assistenzkraft NICHT stillschweigend
 * verschwinden. Fuer die Test-Infrastruktur muessen sie deshalb ausdruecklich
 * vorher weg — frueher erledigte das die Kaskade.
 *
 * Reihenfolge ist relevant: die drei Schicht-Protokolltabellen zuerst
 * (haengen zusaetzlich am Dienst), danach die uebrigen, zuletzt die Dienste.
 */
export { USER_BOUND_RESTRICT_TABLES };

export async function deleteUserBoundRows(
  client: AccountTreeDbClient,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  for (const table of USER_BOUND_RESTRICT_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [ids]);
  }
}

export interface DeleteAccountTreesResult {
  deletedUsers: number;
  deletedTeams: number;
  deletedOrphans: number;
}

export async function deleteAccountTrees(
  client: AccountTreeDbClient,
  userIds: number[],
): Promise<DeleteAccountTreesResult> {
  if (userIds.length === 0) {
    return { deletedUsers: 0, deletedTeams: 0, deletedOrphans: 0 };
  }

  await client.query("BEGIN");
  try {
    const teamsRes = await client.query(
      "SELECT id FROM teams WHERE owner_id = ANY($1)",
      [userIds],
    );
    const teamIds = (teamsRes.rows as { id: number }[]).map((r) => r.id);

    let orphanCount = 0;
    if (teamIds.length > 0) {
      // 1) Team-gebundene Daten (team_id ohne Cascade auf teams.id).
      for (const table of TEAM_BOUND_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE team_id = ANY($1)`, [teamIds]);
      }

      // 2) Verwaiste Assistenten: nur Mitglied in den zu loeschenden Teams,
      //    besitzen selbst keine Teams. Ihre user_id-gebundenen Daten werden
      //    ausdruecklich vorher geloescht (Loeschschutz statt Kaskade).
      const orphanIdsRes = await client.query(
        `SELECT u.id FROM users u
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
      await deleteUserBoundRows(
        client,
        (orphanIdsRes.rows as { id: number }[]).map((r) => r.id),
      );

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

    // 5) Verwaltete Koordinatoren: users.managed_by_user_id referenziert das
    //    Konto OHNE Cascade — ein uebrig gebliebener Teamkoordinator wuerde
    //    das Loeschen seines Dienstleister-Kontos blockieren. (Deren
    //    user_id-gebundene Restdaten kaskadieren ueber die User-FKs.)
    const managedRes = await client.query(
      "SELECT id FROM users WHERE managed_by_user_id = ANY($1)",
      [userIds],
    );
    await deleteUserBoundRows(
      client,
      (managedRes.rows as { id: number }[]).map((r) => r.id),
    );
    await client.query("DELETE FROM users WHERE managed_by_user_id = ANY($1)", [
      userIds,
    ]);

    // 6) Konten selbst — vorher ihre per RESTRICT geschuetzten Daten.
    await deleteUserBoundRows(client, userIds);
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
