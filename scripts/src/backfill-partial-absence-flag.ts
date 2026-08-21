import "./lib/normalize-db-url";
import pg from "pg";

/**
 * Backfillt `is_partial_absence` für Bestands-Abwesenheiten (Task #862).
 *
 * Hintergrund: Vor der neuen Spalte gab es im Kalender-Schicht-Dialog bereits
 * einen "Von-bis"-Zeitraum für Urlaub (echte, nicht-ganztägige Uhrzeiten statt
 * des 00:00–23:59-Sentinels). Anzeige und Kollisionsprüfung lasen damals
 * ausschließlich die GESPEICHERTEN Uhrzeiten (isPlainFullDay), um "ganztägig"
 * vs. "Teil-Tag" zu unterscheiden — UNABHÄNGIG davon, WARUM eine Zeile
 * nicht-ganztägige Zeiten trug (bewusst gewählter Teil-Tag ODER ein
 * ganztägiger Eintrag, der über das Lohnausfallprinzip die echten Zeiten
 * eines ersetzten Dienstes geerbt hat). Beide Fälle waren in den Rohdaten
 * schon immer ununterscheidbar UND wurden von der alten Logik schon immer
 * IDENTISCH behandelt (siehe unten).
 *
 * `is_partial_absence` ersetzt diese Heuristik für NEUE Einträge durch die
 * persistierte Nutzer-Absicht (siehe routes/shifts.ts) — das behebt den
 * Fehler NUR für Zeilen, die AB SOFORT (mit gesetztem Flag) entstehen. Für
 * Bestandszeilen bleibt die Mehrdeutigkeit strukturell unauflösbar: es gibt
 * keine gespeicherte Spur mehr, ob die Zeiten bewusst gewählt oder geerbt
 * wurden (der ersetzte Dienst wird beim Ersetzen gelöscht statt archiviert).
 *
 * WICHTIG — das hier ist KEINE neue Klassifikations-Heuristik, sondern die
 * EXAKTE Fortschreibung des Ist-Zustands: `is_partial_absence = true` genau
 * dann, wenn `isPlainFullDay(startTime, endTime)` false ist (identische
 * Bedingung, hier als SQL). Vor dieser Migration haben ALLE DREI Lesestellen
 * (Kollisionsprüfung in routes/shifts.ts, Tagesleisten-Anzeige und
 * Abwesenheits-Zeitraum-Gruppierung in dienstplan.tsx) exakt diese Bedingung
 * direkt auf den gespeicherten Zeiten ausgewertet — ohne jede Vorstellung
 * von "Nutzer-Absicht". Für JEDE Bestandszeile liefert `is_partial_absence`
 * nach diesem Backfill also GENAU den Wert, den die drei Lesestellen für
 * diese Zeile schon VOR dieser Migration berechnet haben. Ein ganztägiger
 * Eintrag mit geerbten Uhrzeiten (z. B. 08:00–14:00) kollidierte und wurde
 * mit Zeitspanne angezeigt — SCHON VORHER, nicht erst durch diesen Backfill
 * (s. Regressionstest "geerbte Uhrzeiten eines ganztaegigen Urlaubs loesen
 * KEINE Kollision aus (isPartialAbsence)" in
 * dienstplan-halbtags-urlaub-api.spec.ts: der Kommentar dort dokumentiert
 * ausdrücklich den VOR dieser Aufgabe bereits bestehenden Fehler). Es gibt
 * also am Tag des Deployments KEINE Verhaltensänderung für Bestandsdaten.
 *
 * Die Alternative (Bestandszeilen mit nicht-ganztägigen Zeiten pauschal als
 * `false`/ganztägig einstufen) wäre der tatsächlich riskantere Weg: sie
 * würde für jede Zeile, die in Wahrheit ein bewusst gewählter Teil-Tag war
 * (über den allgemeinen Schicht-Dialog schon vor #862 möglich), die
 * Kollisionsprüfung stillschweigend ABSCHALTEN — ein neuer Dienst könnte
 * dann unbemerkt in den Teil-Tag-Urlaub hineingeplant werden. `true` ist
 * der konservativere Default zwischen zwei unvermeidbar unsicheren
 * Optionen: er erhält die Schutzwirkung (Kollisionsprüfung bleibt aktiv)
 * und ändert exakt NICHTS am Ist-Zustand. Eine echte rückwirkende Auflösung
 * der Mehrdeutigkeit ist ausgeschlossen, weil die ursprüngliche Absicht
 * nirgends gespeichert wurde (der ersetzte Dienst wird beim Ersetzen
 * gelöscht statt archiviert).
 *
 * Rein additiv (nur false → true), ohne interaktive Prompts (läuft im
 * Post-Merge ohne TTY). Gilt bewusst für ALLE Abwesenheitstypen, nicht nur
 * "vacation": dienstplan.tsx gruppiert/zeigt Zeiträume für JEDEN
 * Abwesenheitstyp anhand von isPartialAbsence (nicht nur Urlaub) — s.
 * buildAbsenceRanges/DayDetailRow, die schon vor dieser Aufgabe uniform
 * isPlainFullDayIso auf allen Abwesenheitstypen ausgewertet haben.
 *
 * GENAU EINMAL pro Bestands-DB, nicht bei jedem Deploy erneut: post-merge.sh
 * und migrate-prod.ts führen diese Migration bei JEDEM Lauf gegen eine
 * bestehende DB aus. Eine WHERE-Bedingung allein (`is_partial_absence=false`
 * UND nicht-ganztägige Zeiten) reicht NICHT als Idempotenz-Schutz, weil
 * genau dieser Zustand ab dem ersten Rollout auch LEGITIM neu entsteht — ein
 * frisch angelegter, bewusst ganztägiger Urlaub, der über das
 * Lohnausfallprinzip echte Uhrzeiten geerbt hat, hat korrekt
 * `is_partial_absence=false` UND nicht-ganztägige Zeiten. Eine Wiederholung
 * ohne Sperre würde diese frisch korrekten Zeilen beim nächsten Deploy
 * erneut fälschlich auf `true` umklassifizieren. Der `data_migrations`-
 * Marker (s. @workspace/db Schema) sperrt die Migration deshalb dauerhaft
 * auf den ERSTEN erfolgreichen Lauf: `INSERT … ON CONFLICT DO NOTHING`
 * gewinnt nur einmal; jeder weitere Aufruf ist ein garantiertes No-op.
 */
const MIGRATION_NAME = "backfill-partial-absence-flag";
const ABSENCE_TYPES = [
  "vacation",
  "sick",
  "freizeitausgleich",
  "kind_krank",
  "freistellung",
  "abgesagt_ag",
  "abgesagt_an",
  "urlaubsabgeltung",
] as const;

// Nur die Klausen-Logik (fuer db.test.ts direkt importierbar, ohne eigene
// Verbindung/Prozess aufzumachen — analog zu runPrePushSql in pre-push-sql.ts).
export async function backfillPartialAbsenceFlag(
  client: Pick<pg.Client, "query">,
): Promise<number> {
  const tableExists = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'shifts'"
  );
  if ((tableExists.rowCount ?? 0) === 0) {
    return 0;
  }
  const columnExists = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'shifts' AND column_name = 'is_partial_absence'`
  );
  if ((columnExists.rowCount ?? 0) === 0) {
    // db push legt die Spalte an; läuft VOR dem Schema-Push (s. post-merge.sh
    // / migrate-prod.ts), also greift dieser Fall nur bei einer frischen DB,
    // die den Push noch vor sich hat — dann gibt es keine Bestandszeilen.
    return 0;
  }

  const markerTableExists = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'data_migrations'"
  );
  if ((markerTableExists.rowCount ?? 0) === 0) {
    // Sollte im normalen Ablauf nie eintreten (data_migrations entsteht im
    // selben Push wie is_partial_absence) — ohne Marker-Tabelle aber lieber
    // gar nicht laufen als ungeschützt wiederholbar sein.
    return 0;
  }

  // Marker-Claim und UPDATE müssen ATOMAR sein: bricht das UPDATE ab
  // (Netzwerk, Lock, Prozessabbruch) NACHDEM der Marker committed wurde,
  // gölte die Migration für jeden künftigen Deploy fälschlich als erledigt
  // und wird NIE nachgeholt — die Bestandszeilen blieben dauerhaft
  // fehlklassifiziert. Eine Transaktion stellt sicher: entweder committen
  // Marker UND UPDATE gemeinsam, oder keins von beidem (Rollback), sodass
  // ein Wiederholungslauf die Migration erneut versuchen kann.
  await client.query("BEGIN");
  try {
    // Einmal-Sperre: nur der ERSTE erfolgreiche Aufruf gewinnt den Marker und
    // führt das UPDATE aus. Jeder weitere Aufruf (nächster Deploy) ist ein
    // garantiertes No-op — s. Docstring oben, warum die WHERE-Bedingung
    // allein dafür nicht ausreicht.
    const claim = await client.query(
      `INSERT INTO data_migrations (name) VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING name`,
      [MIGRATION_NAME],
    );
    if ((claim.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return 0;
    }

    const result = await client.query(
      `UPDATE shifts
          SET is_partial_absence = true
        WHERE type = ANY($1::shift_type[])
          AND is_partial_absence = false
          AND NOT (
            EXTRACT(HOUR FROM start_time) = 0 AND EXTRACT(MINUTE FROM start_time) = 0
            AND EXTRACT(HOUR FROM end_time) = 23 AND EXTRACT(MINUTE FROM end_time) = 59
          )`,
      [ABSENCE_TYPES as unknown as string[]]
    );
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const count = await backfillPartialAbsenceFlag(client);
    console.log(
      `${count} Bestands-Abwesenheit(en) mit echten Teil-Tag-Zeiten auf is_partial_absence=true nachgezogen.`
    );
  } finally {
    await client.end();
  }
}

// Direkter Aufruf (tsx ./src/backfill-partial-absence-flag.ts) vs. Import in
// Tests unterscheiden — sonst wuerde main() beim Importieren fuer db.test.ts
// ungewollt mitlaufen.
if (process.argv[1] && process.argv[1].endsWith("backfill-partial-absence-flag.ts")) {
  main().catch((err) => {
    console.error("Migration fehlgeschlagen:", err);
    process.exit(1);
  });
}
