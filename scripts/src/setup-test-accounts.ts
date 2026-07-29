import "./lib/normalize-db-url";
import pg from "pg";
import { DEFAULT_SHIFT_MODELS } from "@workspace/shift-defaults";
import { deleteAccountTrees } from "@workspace/test-fixtures";

/**
 * Trennt die Dev-Testkonten in eigenstaendige, sauber isolierte Datenbestaende
 * (Task "Testkonten trennen und neu aufsetzen").
 *
 * Zielbild:
 *   1. Oliver Straub (admin@dienstplan.local, privat) -> PREMIUM. Uebernimmt
 *      das "Standard-Team" (bisher Maria Hoffmann) als Eigentuemer — inkl.
 *      der 7 realen Assistenzkraefte, aller Schichten und Vertraege. Kein
 *      anderes Admin-/Superadmin-Konto bleibt Mitglied.
 *   2. Betreiber (betreiber@dienstplan.local, superadmin) -> bleibt FREE.
 *      Eigenes "Betreiber-Team" mit 4 Dummys (Max Mustermann 1-4), den
 *      Standard-Schichtmodellen aus @workspace/shift-defaults, leerer Dienstplan.
 *   3. Test-Dienstleister (dienstleister@dienstplan.local) -> PREMIUM.
 *      Bestehendes "Dienstleister-Team" mit 5 Dummys (Max Mustermann 5-9),
 *      leerer Dienstplan.
 *   4. Test-Assistent (assistent@dienstplan.local) -> Mitglied im
 *      Betreiber-Team mit Basis-Vertrag.
 *   5. Alt-Konten Maria Hoffmann + "Assistenzdienst" (samt Rest-Team)
 *      werden FK-sicher geloescht.
 *
 * Idempotent: Jeder Schritt prueft den Ist-Zustand und tut nur, was fehlt.
 * Nur fuer die Dev-/Test-Datenbank gedacht.
 */

const EMAIL_OLIVER = "admin@dienstplan.local";
const EMAIL_BETREIBER = "betreiber@dienstplan.local";
const EMAIL_DIENSTLEISTER = "dienstleister@dienstplan.local";
const EMAIL_ASSISTENT = "assistent@dienstplan.local";
const EMAIL_MARIA = "maria.hoffmann@example.de";
const EMAIL_ALT_DIENST = "dienst@dienstplan.local";

const BETREIBER_TEAM_NAME = "Betreiber-Team";

/**
 * Die 7 realen Assistenzkraefte des Standard-Teams (Zielbild, Task #647).
 * Diese Liste ist die verbindliche Whitelist fuer Team 1: Schritt 0 entfernt
 * alle anderen (nicht-e2e-)Konten aus dem Standard-Team — auch solche, die
 * sich einen Vertrag in Team 1 erschlichen haben. Die Endkontrolle prueft
 * gegen dieselbe Liste (frueher dienten die Vertraege in Team 1 als
 * Whitelist, wodurch ein eingeschleustes Fremdkonto MIT Vertrag als
 * "erwartetes Mitglied" durchging). Aendert sich der reale Bestand,
 * muss diese Liste angepasst werden. Vergleiche immer case-insensitiv
 * (Eintraege hier kleingeschrieben).
 *
 * Zusaetzlich zaehlen die vom E2E-Harness geseedeten Stellvertreter
 * `verify.assistenzkraft%@dienstplan.local` (verify-account-separation)
 * als reale Assistenzkraefte — auf der Test-DB stehen sie fuer die 7
 * echten Konten und duerfen weder geloescht noch beanstandet werden.
 */
const VERIFY_ASSISTANT_PATTERN = "verify.assistenzkraft%@dienstplan.local";
const isVerifyAssistantEmail = (email: string): boolean =>
  /^verify\.assistenzkraft.*@dienstplan\.local$/i.test(email);
const REAL_ASSISTANT_EMAILS = [
  "tolga_kahraman@hotmail.de",
  "florian.thierer@gmail.com",
  "camillo.neubert@web.de",
  "tortuenomade@hotmail.fr",
  "kontakt@assistenztreff.de",
  "centaury82@gmail.com",
  "ollie@exemple.com",
] as const;

interface UserRow {
  id: number;
  role: string;
}

async function findUser(client: pg.Client, email: string): Promise<UserRow | null> {
  const res = await client.query<UserRow>(
    "SELECT id, role FROM users WHERE email = $1",
    [email],
  );
  return res.rows[0] ?? null;
}

async function ensureMembership(client: pg.Client, teamId: number, userId: number): Promise<void> {
  await client.query(
    `INSERT INTO team_members (team_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (team_id, user_id) DO NOTHING`,
    [teamId, userId],
  );
}

/**
 * Legt einen Dummy-Assistenten (Max Mustermann N) an, falls er noch nicht
 * existiert, und stellt Team-Mitgliedschaft + Basis-Vertrag sicher.
 * Bewusst OHNE Premium-Lohndaten (Lohn-/SV-Felder bleiben NULL) und ohne
 * Passwort (kein Login noetig).
 */
async function ensureDummyAssistant(
  client: pg.Client,
  n: number,
  teamId: number,
): Promise<void> {
  const email = `max.mustermann${n}@dienstplan.local`;
  const name = `Max Mustermann ${n}`;

  let user = await findUser(client, email);
  if (!user) {
    const res = await client.query<UserRow>(
      `INSERT INTO users (name, email, role, is_active)
       VALUES ($1, $2, 'assistant', true)
       RETURNING id, role`,
      [name, email],
    );
    user = res.rows[0]!;
    console.log(`  Dummy angelegt: ${name} (id ${user.id})`);
  }

  await ensureMembership(client, teamId, user.id);

  const contract = await client.query(
    "SELECT 1 FROM contracts WHERE user_id = $1 AND team_id = $2",
    [user.id, teamId],
  );
  if (contract.rowCount === 0) {
    await client.query(
      `INSERT INTO contracts (user_id, team_id, weekly_hours, vacation_days, start_date)
       VALUES ($1, $2, 30, 30, '2026-01-01')`,
      [user.id, teamId],
    );
  }
}

async function ensureShiftModels(client: pg.Client, teamId: number): Promise<void> {
  const existing = await client.query(
    "SELECT count(*)::int AS n FROM shift_models WHERE team_id = $1",
    [teamId],
  );
  if (existing.rows[0].n > 0) return;
  for (const m of DEFAULT_SHIFT_MODELS) {
    await client.query(
      `INSERT INTO shift_models
         (team_id, name, color, valuation_percent, sort_order,
          default_start_time, default_end_time, default_weekdays, compensation_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        teamId,
        m.name,
        m.color,
        m.valuationPercent,
        m.sortOrder,
        m.defaultStartTime,
        m.defaultEndTime,
        [...m.defaultWeekdays],
        m.compensationType,
      ],
    );
  }
  console.log(
    `  ${DEFAULT_SHIFT_MODELS.length} Standard-Schichtmodelle fuer Team ${teamId} angelegt.`,
  );
}

/**
 * Entfernt Altlasten-Mitglieder aus einem Zielbild-Team (Betreiber- bzw.
 * Dienstleister-Team), BEVOR die Haupt-Transaktion laeuft:
 *   - Bekannte Kern-Konten (Oliver, Betreiber, Dienstleister, Assistent)
 *     verlieren nur die Mitgliedschaft.
 *   - Unbekannte Konten (z. B. alte manuelle Testkonten wie test1@tester.de)
 *     werden samt komplettem Datenbaum via deleteAccountTrees geloescht —
 *     inkl. Schichten, Vertraegen und Zeiterfassung (user_id-FKs kaskadieren).
 * Fremde e2e-Spec-Fixtures (`e2e.*@dienstplan.test`) bleiben unangetastet.
 */
async function removeLegacyMembers(
  client: pg.Client,
  teamId: number,
  allowedEmails: Set<string>,
  coreEmails: Set<string>,
  label: string,
): Promise<void> {
  const res = await client.query<{ id: number; email: string }>(
    `SELECT u.id, u.email
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
        AND u.email NOT LIKE 'e2e.%@dienstplan.test'`,
    [teamId],
  );
  const legacy = res.rows.filter(
    (r) => !allowedEmails.has(r.email.toLowerCase()) && !isVerifyAssistantEmail(r.email),
  );
  if (legacy.length === 0) return;

  const membershipOnly = legacy.filter((r) => coreEmails.has(r.email.toLowerCase()));
  const toDelete = legacy.filter((r) => !coreEmails.has(r.email.toLowerCase()));

  for (const m of membershipOnly) {
    await client.query(
      "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, m.id],
    );
    console.log(`${label}: Mitgliedschaft von Kern-Konto ${m.email} entfernt.`);
  }
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    const result = await deleteAccountTrees(client, ids);
    console.log(
      `${label}: ${toDelete.length} Altlasten-Konto/Konten samt Daten geloescht ` +
        `(${toDelete.map((r) => r.email).join(", ")}; ` +
        `${result.deletedUsers} Konten, ${result.deletedTeams} Teams, ` +
        `${result.deletedOrphans} verwaiste Assistenten).`,
    );
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL muss gesetzt sein.");

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const oliver = await findUser(client, EMAIL_OLIVER);
    const betreiber = await findUser(client, EMAIL_BETREIBER);
    const dienstleister = await findUser(client, EMAIL_DIENSTLEISTER);
    const assistent = await findUser(client, EMAIL_ASSISTENT);
    const maria = await findUser(client, EMAIL_MARIA);
    const altDienst = await findUser(client, EMAIL_ALT_DIENST);

    if (!oliver) throw new Error(`Konto ${EMAIL_OLIVER} nicht gefunden.`);
    if (!betreiber) throw new Error(`Konto ${EMAIL_BETREIBER} nicht gefunden.`);
    if (!dienstleister) throw new Error(`Konto ${EMAIL_DIENSTLEISTER} nicht gefunden.`);
    if (!assistent) throw new Error(`Konto ${EMAIL_ASSISTENT} nicht gefunden.`);

    // ------------------------------------------------------------------
    // 0) Altlasten-Bereinigung (eigene Transaktion in deleteAccountTrees,
    //    daher VOR der Haupt-Transaktion): fremde manuelle Testkonten aus
    //    Betreiber- und Dienstleister-Team entfernen, damit die
    //    Ziel-Belegungs-Pruefung am Ende erreichbar ist.
    // ------------------------------------------------------------------
    const coreEmails = new Set<string>([
      EMAIL_OLIVER,
      EMAIL_BETREIBER,
      EMAIL_DIENSTLEISTER,
      EMAIL_ASSISTENT,
      EMAIL_MARIA,
      EMAIL_ALT_DIENST,
    ]);
    // Standard-Team (Team von Oliver bzw. noch von Maria): Whitelist sind
    // Oliver + die realen Assistenzkraefte. Kern-Konten und die
    // Mustermann-Dummys werden erst in Schritt 1 (Mitgliedschafts-Umzug)
    // behandelt, daher hier erlaubt; alles andere ist eine Altlast.
    const preMainOwnerId = maria?.id ?? oliver.id;
    const preMainTeam = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [preMainOwnerId],
    );
    if (preMainTeam.rows[0]) {
      await removeLegacyMembers(
        client,
        preMainTeam.rows[0].id,
        new Set<string>([
          EMAIL_OLIVER,
          EMAIL_MARIA,
          EMAIL_ASSISTENT,
          ...REAL_ASSISTANT_EMAILS,
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
            (n) => `max.mustermann${n}@dienstplan.local`,
          ),
        ]),
        coreEmails,
        "Standard-Team",
      );
    }
    const preBetreiberTeam = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [betreiber.id],
    );
    if (preBetreiberTeam.rows[0]) {
      await removeLegacyMembers(
        client,
        preBetreiberTeam.rows[0].id,
        new Set<string>([
          EMAIL_BETREIBER,
          EMAIL_ASSISTENT,
          ...[1, 2, 3, 4].map((n) => `max.mustermann${n}@dienstplan.local`),
        ]),
        coreEmails,
        "Betreiber-Team",
      );
    }
    const preDlTeam = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [dienstleister.id],
    );
    if (preDlTeam.rows[0]) {
      await removeLegacyMembers(
        client,
        preDlTeam.rows[0].id,
        new Set<string>([
          EMAIL_DIENSTLEISTER,
          ...[5, 6, 7, 8, 9].map((n) => `max.mustermann${n}@dienstplan.local`),
        ]),
        coreEmails,
        "Dienstleister-Team",
      );
    }

    await client.query("BEGIN");

    // ------------------------------------------------------------------
    // 1) Standard-Team an Oliver uebertragen (falls noch bei Maria) und
    //    fremde Admin-/Superadmin-Konten sowie den Test-Assistenten aus dem
    //    Team entfernen. Die 7 realen Assistenzkraefte bleiben Mitglieder.
    // ------------------------------------------------------------------
    let mainTeamId: number | null = null;
    if (maria) {
      const owned = await client.query<{ id: number }>(
        "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
        [maria.id],
      );
      if (owned.rows[0]) {
        mainTeamId = owned.rows[0].id;
        await client.query("UPDATE teams SET owner_id = $1 WHERE id = $2", [
          oliver.id,
          mainTeamId,
        ]);
        console.log(`Team ${mainTeamId} ("Standard-Team") an Oliver Straub uebertragen.`);
      }
    }
    if (mainTeamId === null) {
      const owned = await client.query<{ id: number }>(
        "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
        [oliver.id],
      );
      mainTeamId = owned.rows[0]?.id ?? null;
    }
    if (mainTeamId === null) throw new Error("Kein Standard-Team fuer Oliver gefunden.");

    await ensureMembership(client, mainTeamId, oliver.id);

    // Alle Mitglieder entfernen, die KEINE Assistenten sind (fremde Admins,
    // Superadmin) — ausser Oliver selbst. Zusaetzlich den Test-Assistenten
    // (der gehoert kuenftig ins Betreiber-Team) und die Mustermann-Dummys
    // (die gehoeren ins Betreiber- bzw. Dienstleister-Team; das
    // migrate-teams-Skript hatte sie frueher bei jedem Merge wieder in
    // Team 1 eingefuegt).
    const removed = await client.query(
      `DELETE FROM team_members tm
        USING users u
        WHERE tm.user_id = u.id
          AND tm.team_id = $1
          AND tm.user_id <> $2
          AND (u.role <> 'assistant'
               OR u.id = $3
               OR u.email LIKE 'max.mustermann%@dienstplan.local')`,
      [mainTeamId, oliver.id, assistent.id],
    );
    if (removed.rowCount) {
      console.log(`${removed.rowCount} fremde Mitgliedschaft(en) aus Team ${mainTeamId} entfernt.`);
    }

    await client.query("UPDATE users SET plan = 'premium' WHERE id = $1", [oliver.id]);
    console.log("Oliver Straub -> premium.");

    // ------------------------------------------------------------------
    // 2) Betreiber-Team (Free): eigenes Team, 4 Dummys, Standard-Schichtmodelle
    //    (aus @workspace/shift-defaults),
    //    leerer Dienstplan. Betreiber bleibt free.
    // ------------------------------------------------------------------
    let betreiberTeamId: number;
    const betreiberOwned = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [betreiber.id],
    );
    if (betreiberOwned.rows[0]) {
      betreiberTeamId = betreiberOwned.rows[0].id;
    } else {
      const res = await client.query<{ id: number }>(
        "INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING id",
        [BETREIBER_TEAM_NAME, betreiber.id],
      );
      betreiberTeamId = res.rows[0]!.id;
      console.log(`Betreiber-Team angelegt (id ${betreiberTeamId}).`);
    }
    await ensureMembership(client, betreiberTeamId, betreiber.id);
    await ensureShiftModels(client, betreiberTeamId);
    for (let n = 1; n <= 4; n++) {
      await ensureDummyAssistant(client, n, betreiberTeamId);
    }
    // Zielbild explizit durchsetzen: Betreiber bleibt FREE (auch wenn der
    // Plan in der Dev-DB zwischenzeitlich verstellt wurde) — davon haengen
    // die Free-Gates des Betreiber-Teams ab (z. B. historyMonths=1 fuer den
    // Test-Assistenten).
    await client.query("UPDATE users SET plan = 'free' WHERE id = $1", [betreiber.id]);
    console.log("Betreiber -> free.");

    // ------------------------------------------------------------------
    // 3) Test-Dienstleister (Premium): 5 Dummys im Dienstleister-Team.
    // ------------------------------------------------------------------
    const dlOwned = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE owner_id = $1 ORDER BY id LIMIT 1",
      [dienstleister.id],
    );
    if (!dlOwned.rows[0]) throw new Error("Kein Team fuer Test-Dienstleister gefunden.");
    const dlTeamId = dlOwned.rows[0].id;
    await ensureMembership(client, dlTeamId, dienstleister.id);
    await ensureShiftModels(client, dlTeamId);
    for (let n = 5; n <= 9; n++) {
      await ensureDummyAssistant(client, n, dlTeamId);
    }
    await client.query("UPDATE users SET plan = 'premium' WHERE id = $1", [dienstleister.id]);
    console.log("Test-Dienstleister -> premium.");

    // ------------------------------------------------------------------
    // 4) Test-Assistent ins Betreiber-Team + Basis-Vertrag.
    // ------------------------------------------------------------------
    await ensureMembership(client, betreiberTeamId, assistent.id);
    const assistentContract = await client.query(
      "SELECT 1 FROM contracts WHERE user_id = $1 AND team_id = $2",
      [assistent.id, betreiberTeamId],
    );
    if (assistentContract.rowCount === 0) {
      await client.query(
        `INSERT INTO contracts (user_id, team_id, weekly_hours, vacation_days, start_date)
         VALUES ($1, $2, 30, 30, '2026-01-01')`,
        [assistent.id, betreiberTeamId],
      );
      console.log("Vertrag fuer Test-Assistent im Betreiber-Team angelegt.");
    }
    // Alte Mitgliedschaften des Test-Assistenten ausserhalb des
    // Betreiber-Teams entfernen (er soll NUR eigene Daten dort sehen).
    await client.query(
      "DELETE FROM team_members WHERE user_id = $1 AND team_id <> $2",
      [assistent.id, betreiberTeamId],
    );

    // ------------------------------------------------------------------
    // Endkontrolle (Fail-fast): Ziel-Belegung aller drei Teams pruefen,
    // BEVOR committed wird. Schlaegt eine Pruefung fehl, wird die gesamte
    // Transaktion zurueckgerollt.
    // ------------------------------------------------------------------
    const errors: string[] = [];

    const memberRows = async (teamId: number): Promise<{ id: number; email: string; role: string }[]> => {
      // Fremde `e2e.*@dienstplan.test`-Konten ausblenden: auf der geteilten
      // `_test`-DB koennen parallele Laeufe solche Spec-Fixtures jederzeit
      // anlegen (Task #622); sie gehoeren nie zum hier geprueften Zielbild.
      // In der Dev-DB existieren solche Konten regulaer nicht.
      const res = await client.query<{ id: number; email: string; role: string }>(
        `SELECT u.id, u.email, u.role
           FROM team_members tm JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = $1
            AND u.email NOT LIKE 'e2e.%@dienstplan.test'
          ORDER BY u.id`,
        [teamId],
      );
      return res.rows;
    };

    // Team 1 (Oliver): exakt Oliver + die realen Assistenzkraefte. Als
    // Whitelist dient die feste Liste REAL_ASSISTANT_EMAILS (Task #647) —
    // NICHT mehr die Vertraege in Team 1: ein eingeschleustes Fremdkonto
    // MIT Vertrag galt sonst als "erwartetes Mitglied". Existierende reale
    // Konten, deren Mitgliedschaft fehlt, werden weiterhin als Fehler
    // erkannt; in frischen DBs ohne die realen Konten prueft die Liste
    // schlicht nur die vorhandenen.
    const realAssistants = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE lower(email) = ANY($1) OR email LIKE $2",
      [[...REAL_ASSISTANT_EMAILS], VERIFY_ASSISTANT_PATTERN],
    );
    const expectedTeam1Ids = new Set<number>([
      oliver.id,
      ...realAssistants.rows.map((r) => r.id),
    ]);
    const team1Members = await memberRows(mainTeamId);
    for (const m of team1Members) {
      if (!expectedTeam1Ids.has(m.id)) {
        errors.push(`Team ${mainTeamId}: unerwartetes Mitglied ${m.email} (id ${m.id}, role ${m.role}).`);
      }
    }
    for (const id of expectedTeam1Ids) {
      if (!team1Members.some((m) => m.id === id)) {
        errors.push(`Team ${mainTeamId}: erwartetes Mitglied mit id ${id} fehlt.`);
      }
    }

    // Betreiber-Team: exakt Betreiber + Test-Assistent + Mustermann 1-4.
    const expectBetreiber = new Set<string>([
      EMAIL_BETREIBER,
      EMAIL_ASSISTENT,
      ...[1, 2, 3, 4].map((n) => `max.mustermann${n}@dienstplan.local`),
    ]);
    const betreiberMembers = await memberRows(betreiberTeamId);
    for (const m of betreiberMembers) {
      if (!expectBetreiber.has(m.email)) {
        errors.push(`Betreiber-Team: unerwartetes Mitglied ${m.email} (id ${m.id}).`);
      }
    }
    for (const email of expectBetreiber) {
      if (!betreiberMembers.some((m) => m.email === email)) {
        errors.push(`Betreiber-Team: Mitglied ${email} fehlt.`);
      }
    }

    // Dienstleister-Team: exakt Dienstleister + Mustermann 5-9.
    const expectDl = new Set<string>([
      EMAIL_DIENSTLEISTER,
      ...[5, 6, 7, 8, 9].map((n) => `max.mustermann${n}@dienstplan.local`),
    ]);
    const dlMembers = await memberRows(dlTeamId);
    for (const m of dlMembers) {
      if (!expectDl.has(m.email)) {
        errors.push(`Dienstleister-Team: unerwartetes Mitglied ${m.email} (id ${m.id}).`);
      }
    }
    for (const email of expectDl) {
      if (!dlMembers.some((m) => m.email === email)) {
        errors.push(`Dienstleister-Team: Mitglied ${email} fehlt.`);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        "Ziel-Belegung der Teams nicht erreicht:\n  - " + errors.join("\n  - "),
      );
    }
    console.log("Endkontrolle OK: Team-Belegung entspricht dem Zielbild.");

    await client.query("COMMIT");

    // ------------------------------------------------------------------
    // 5) Alt-Konten loeschen (eigene Transaktion in deleteAccountTrees).
    //    Vorher plan_changes-Referenzen kappen (kein Cascade auf users).
    // ------------------------------------------------------------------
    const toDelete = [maria, altDienst].filter((u): u is UserRow => u !== null);
    if (toDelete.length > 0) {
      const ids = toDelete.map((u) => u.id);
      await client.query(
        "DELETE FROM plan_changes WHERE account_id = ANY($1) OR changed_by = ANY($1)",
        [ids],
      );
      const result = await deleteAccountTrees(client, ids);
      console.log(
        `Alt-Konten geloescht: ${result.deletedUsers} Konto/Konten, ` +
          `${result.deletedTeams} Team(s), ${result.deletedOrphans} verwaiste(r) Assistent(en).`,
      );
    } else {
      console.log("Keine Alt-Konten mehr vorhanden — nichts zu loeschen.");
    }

    console.log("\nFertig. Testkonten sind jetzt sauber getrennt.");
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
  console.error("Fehler beim Aufsetzen der Testkonten:", err);
  process.exit(1);
});
