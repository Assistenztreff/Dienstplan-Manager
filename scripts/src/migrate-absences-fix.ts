import pg from "pg";

/**
 * Korrigiert Bestands-Abwesenheiten (Urlaub/Krankheit) auf den verbindlichen
 * Planungsstatus FIX.
 *
 * Hintergrund: Abwesenheiten sind produktseitig immer verbindlich (Default FIX).
 * Über den Kalender-Schicht-Dialog angelegte Urlaube/Krankmeldungen wurden aber
 * mit Status VORLAEUFIG (Entwurf) gespeichert. Eine solche Zeile ist eine
 * Sackgasse: Die Auswertung (`/dashboard/hours-balance`) zählt nur FIX-Zeilen,
 * und die Kalender-Sammelbestätigung schließt Abwesenheiten bewusst aus — sie
 * lässt sich also nie einrechnen, obwohl sie in der Abwesenheitsliste steht.
 *
 * Diese Migration setzt jede Abwesenheits-Zeile (type IN ('vacation','sick'))
 * mit Status ungleich FIX einmalig auf FIX, sodass sie sofort in den
 * Auswertungen (erfüllte Stunden + Bilanz) erscheint. Idempotent und ohne
 * interaktive Prompts (läuft im Post-Merge ohne TTY).
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const tableExists = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'shifts'"
    );
    if (tableExists.rowCount === 0) {
      // Frische DB: db push legt die Tabelle direkt im Zielzustand an.
      console.log("shifts existiert noch nicht — nichts zu migrieren.");
      return;
    }

    const result = await client.query(
      `UPDATE shifts
         SET planning_status = 'FIX'
       WHERE type IN ('vacation', 'sick')
         AND planning_status <> 'FIX'`
    );
    console.log(
      `${result.rowCount} Bestands-Abwesenheit(en) auf Status FIX korrigiert.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration fehlgeschlagen:", err);
  process.exit(1);
});
