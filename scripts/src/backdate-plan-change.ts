import pg from "pg";

/**
 * Setzt den Zeitstempel (created_at) eines Plan-Aenderungsprotokoll-Eintrags
 * direkt in der DB — identifiziert ueber seine eindeutige Notiz/Belegnummer.
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht: plan_changes.created_at
 * wird serverseitig immer auf "jetzt" gesetzt (append-only Audit-Log, kein
 * API-Weg zum Backdaten — und das soll auch so bleiben). Die E2E-Specs zum
 * Zeitraum-Filter brauchen aber Eintraege mit Zeitstempeln in verschiedenen
 * Monaten (inkl. Randtage Monatserster/-letzter), um zu beweisen, dass die
 * Schnellauswahl "Letzter Monat" serverseitig wirklich nur den gewaehlten
 * Monat liefert.
 *
 * Aufruf ueber Umgebungsvariablen (analog set-plan), damit der Aufruf aus dem
 * Test per execSync mit ueberschriebener DATABASE_URL (Test-DB) erfolgen kann:
 *   BACKDATE_PLAN_CHANGE_NOTE       – eindeutige Notiz des Eintrags (Pflicht)
 *   BACKDATE_PLAN_CHANGE_CREATED_AT – neuer Zeitstempel, ISO-8601 (Pflicht)
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const note = process.env.BACKDATE_PLAN_CHANGE_NOTE;
  if (!note) {
    throw new Error("BACKDATE_PLAN_CHANGE_NOTE muss gesetzt sein.");
  }

  const createdAtRaw = process.env.BACKDATE_PLAN_CHANGE_CREATED_AT;
  if (!createdAtRaw) {
    throw new Error("BACKDATE_PLAN_CHANGE_CREATED_AT muss gesetzt sein.");
  }
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(
      `Ungueltiger Zeitstempel "${createdAtRaw}" (ISO-8601 erwartet).`,
    );
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const res = await client.query(
    "UPDATE plan_changes SET created_at = $1 WHERE note = $2",
    [createdAt.toISOString(), note],
  );
  await client.end();

  if (res.rowCount === 0) {
    throw new Error(`Kein plan_changes-Eintrag mit Notiz "${note}" gefunden.`);
  }
  console.log(
    `created_at fuer ${res.rowCount} Eintrag/Eintraege mit Notiz "${note}" auf ${createdAt.toISOString()} gesetzt.`,
  );
}

main().catch((err) => {
  console.error("Fehler beim Backdaten des Plan-Protokoll-Eintrags:", err);
  process.exit(1);
});
