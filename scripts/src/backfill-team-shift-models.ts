import pg from "pg";

/**
 * Einmaliger, idempotenter Daten-Backfill (Task: Schicht-Dialog: Dienste
 * team-bezogen laden): Teams OHNE ein einziges Schichtmodell bekommen die 5
 * Standard-Dienste (wie bei der Registrierung und — seit diesem Task — beim
 * Anlegen neuer Teams über POST /teams).
 *
 * Hintergrund: Vor dem Fix wurden über POST /api/teams angelegte Zusatz-Teams
 * OHNE Dienste erstellt; der Schicht-Dialog bot dann Modelle fremder eigener
 * Teams an, deren Speichern der Server korrekt mit 403 ablehnte. Neue Teams
 * werden jetzt beim Anlegen geseedet; dieses Skript zieht die BESTEHENDEN
 * leeren Teams nach.
 *
 * Idempotent: nur Teams mit 0 Modellen werden befüllt — mehrfaches Ausführen
 * ändert nichts. Die Liste MUSS mit DEFAULT_SHIFT_MODELS in
 * artifacts/api-server/src/lib/default-shift-models.ts übereinstimmen.
 */

const DEFAULT_MODELS = [
  { name: "Frühdienst", color: "amber", sortOrder: 0, start: "08:00", end: "16:00", weekdays: [1, 2, 3, 4, 5] },
  { name: "Spätdienst", color: "indigo", sortOrder: 1, start: "16:00", end: "23:00", weekdays: [1, 2, 3, 4, 5] },
  { name: "Nachtdienst", color: "slate", sortOrder: 2, start: "23:00", end: "08:00", weekdays: [1, 2, 3, 4, 5] },
  { name: "Bereitschaft", color: "teal", sortOrder: 3, start: "08:00", end: "14:00", weekdays: [6, 7] },
  { name: "24h Dienst", color: "purple", sortOrder: 4, start: "09:00", end: "09:00", weekdays: [1, 2, 3, 4, 5, 6, 7] },
] as const;

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: teams } = await client.query<{ id: number; name: string }>(`
      SELECT t.id, t.name FROM teams t
      WHERE NOT EXISTS (SELECT 1 FROM shift_models sm WHERE sm.team_id = t.id)
      ORDER BY t.id
    `);
    if (teams.length === 0) {
      console.log("Alle Teams haben bereits Schichtmodelle — nichts zu tun.");
      return;
    }
    for (const team of teams) {
      for (const m of DEFAULT_MODELS) {
        await client.query(
          `INSERT INTO shift_models
             (team_id, name, color, valuation_percent, sort_order,
              default_start_time, default_end_time, default_weekdays, compensation_type)
           VALUES ($1, $2, $3, 100, $4, $5, $6, $7, 'regular')`,
          [team.id, m.name, m.color, m.sortOrder, m.start, m.end, [...m.weekdays]],
        );
      }
      console.log(`Team ${team.id} („${team.name}"): 5 Standard-Dienste angelegt.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
