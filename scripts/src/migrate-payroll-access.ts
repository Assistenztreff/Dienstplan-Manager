/**
 * migrate-payroll-access
 *
 * Setzt unzulässige Lohndaten-Freigaben zurück.
 *
 * Regel (serverseitig in lib/teams.ts durchgesetzt): can_view_payroll ist
 * AUSSCHLIESSLICH Unternehmens-Teamleitern eines Dienstleister-Kontos
 * vorbehalten. Alles andere — Assistenzkräfte, Mitglieder ohne
 * Teamleiter-Status, Teamleiter in Privat-Konten — darf die Lohn- und
 * SV-Daten nicht sehen.
 *
 * Das Skript ist idempotent: ein zweiter Lauf findet nichts mehr.
 *
 *   pnpm --filter @workspace/scripts run migrate-payroll-access
 *   pnpm --filter @workspace/scripts run migrate-payroll-access -- --dry-run
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

const UNZULAESSIG = sql`
  tm.can_view_payroll = true
  AND (
    tm.is_teamleiter = false
    OR o.account_type <> 'dienstleister'
  )
`;

async function main(): Promise<void> {
  const found = await db.execute(sql`
    SELECT tm.id, tm.team_id, tm.user_id, tm.is_teamleiter,
           u.name AS person, u.role AS person_role,
           o.account_type AS konto_typ
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    JOIN users o ON o.id = t.owner_id
    JOIN users u ON u.id = tm.user_id
    WHERE ${UNZULAESSIG}
    ORDER BY tm.id
  `);

  if (found.rows.length === 0) {
    console.log("Keine unzulässigen Lohndaten-Freigaben gefunden. Nichts zu tun.");
    return;
  }

  console.log(`Unzulässige Lohndaten-Freigaben: ${found.rows.length}`);
  for (const row of found.rows as Array<Record<string, unknown>>) {
    console.log(
      `  Mitgliedschaft #${row["id"]} — Team ${row["team_id"]}, Person ${row["person"]} ` +
        `(Rolle ${row["person_role"]}, Teamleiter: ${row["is_teamleiter"]}, Konto: ${row["konto_typ"]})`,
    );
  }

  if (dryRun) {
    console.log("--dry-run: nichts geändert.");
    return;
  }

  const updated = await db.execute(sql`
    UPDATE team_members tm
    SET can_view_payroll = false
    FROM teams t, users o
    WHERE t.id = tm.team_id
      AND o.id = t.owner_id
      AND ${UNZULAESSIG}
    RETURNING tm.id
  `);
  console.log(`Zurückgesetzt: ${updated.rows.length} Mitgliedschaft(en).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
