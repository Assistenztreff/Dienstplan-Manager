// ---------------------------------------------------------------------------
// Loesch-Archiv: der Nachweis, der das Loeschen einer Assistenzkraft ueberlebt.
// ---------------------------------------------------------------------------
// Ausgangsproblem: eine Assistenzkraft zu loeschen riss frueher Schichten,
// Abwesenheiten, Vertraege und Zeiterfassung mit — genau die Daten, die
// § 16 ArbZG und § 17 MiLoG zwei Jahre lang aufbewahrt sehen wollen. Der
// Loeschschutz (Stufe 1, ON DELETE RESTRICT) hat das gestoppt, damit aber das
// Loeschen ueberhaupt unmoeglich gemacht.
//
// Diese Tabelle macht es wieder moeglich, nur eben sauber: bevor geloescht
// wird, erzeugt der Server aus der Datenbank ein Archiv (Stundenliste,
// Stundenkonto, Lohnauswertung, Aenderungshistorie) und legt es HIER ab.
// Dieselben Bytes bekommt der Planer als Download — die abgelegte Datei ist
// also byte-gleich mit dem, was im Archiv steht, und nicht nur "inhaltlich
// aehnlich". Das Archiv ist der zweite Anker fuer den Fall, dass der externe
// Ordner mal nicht mitzieht; die heruntergeladene Datei bleibt der erste.
//
// BEWUSST OHNE FREMDSCHLUESSEL auf users: die Zeile muss den geloeschten
// Nutzer ueberleben — ein FK wuerde genau das Loeschen blockieren, das sie
// ermoeglichen soll. Name, E-Mail und die ausloesende Person stehen deshalb
// als Textschnappschuss drin, nicht als Verweis.
//
// Append-only: Zeilen werden nie geaendert (ausser dem einmaligen Stempel
// deletedAt) und nie geloescht — wie plan_changes, month_closings,
// shift_changes.
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, text, timestamp, customType, index } from "drizzle-orm/pg-core";
import { teamsTable } from "./teams";

// Drizzle kennt bytea nicht ab Werk. Der Inhalt ist eine ZIP-Datei, also
// Rohbytes — kein base64-Umweg, der die Zeile um ein Drittel aufblaehen wuerde.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const deletionArchivesTable = pgTable(
  "deletion_archives",
  {
    id: serial("id").primaryKey(),
    // Die geloeschte Person — als reine Zahl, nicht als Verweis (s. oben).
    userId: integer("user_id").notNull(),
    userName: text("user_name").notNull(),
    userEmail: text("user_email"),
    // Team zum Zeitpunkt des Archivs. Einziger Fremdschluessel der Tabelle,
    // und bewusst `set null`: das Archiv darf auch ein geloeschtes Team
    // ueberleben. Dient der Sichtbarkeits-Pruefung beim Lesen.
    teamId: integer("team_id").references(() => teamsTable.id, { onDelete: "set null" }),
    // Wer den Export ausgeloest hat — ebenfalls ohne Verweis, damit das
    // Loeschen dieses Admin-Kontos spaeter nicht am Archiv scheitert.
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    content: bytea("content").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Gesetzt, sobald das Loeschen mit diesem Archiv tatsaechlich
    // durchgelaufen ist. Bleibt null, wenn der Planer den Export
    // heruntergeladen, das Loeschen aber abgebrochen hat — auch das ist eine
    // wahre Aussage ueber den Vorgang und wird nicht aufgeraeumt.
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("deletion_archives_user_id_idx").on(t.userId),
    index("deletion_archives_team_id_created_at_idx").on(t.teamId, t.createdAt),
  ],
);

export type DeletionArchive = typeof deletionArchivesTable.$inferSelect;
