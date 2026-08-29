// ---------------------------------------------------------------------------
// Widerspruch gegen eine Planer-Korrektur (Kay-Entscheidung 28.08.2026,
// "Weg A"). Gegenstück zum Abweichungsmodell — dieselbe Frage, andere
// Richtung.
// ---------------------------------------------------------------------------
// Ändert der Planer einen bereits gearbeiteten, bestätigten Dienst, fällt
// dieser auf ANGEBOTEN zurück und wartet auf die Zustimmung der betroffenen
// Assistenzkraft (s. faelltZurueck in shifts-crud.ts). Bisher konnte sie NUR
// zustimmen — ohne Widerspruch stand eine einseitig geänderte Arbeitszeit im
// System, und ein "Nein" blieb unsichtbar: der Dienst haette einfach ewig auf
// "Korrektur" gestanden, ohne dass jemand den Grund erfährt.
//
// Das Recht ist jetzt symmetrisch: Der Planer darf einer Meldung der
// Assistenzkraft widersprechen (shift_deviation_reports.status = DISPUTED),
// die Assistenzkraft darf einer Korrektur des Planers widersprechen.
//
// KEINE eigene Entscheidungslogik: Der Widerspruch ändert die Schicht nicht.
// Er dokumentiert nur, dass keine Einigkeit besteht — geklärt wird im
// Gespräch. Danach hat der Planer zwei Wege (beide loesen den Widerspruch):
//   - zuruecknehmen: Schicht geht auf den Wert VOR der Korrektur zurueck
//     (Quelle: juengster shift_changes-Eintrag) und ist wieder FIX.
//   - nachbearbeiten: neue Zeit eintragen — die Schicht bleibt ANGEBOTEN und
//     geht als neue Korrektur zurueck an die Assistenzkraft.
//
// Anders als bei der Abweichungsmeldung gibt es hier KEIN UNIQUE(shift_id):
// ein Dienst darf mehrfach korrigiert werden (Tippfehler, nachgereichter
// Stundenzettel), also auch mehrfach bestritten. Offen sein darf aber immer
// nur EIN Widerspruch je Dienst — dafuer der partielle Unique-Index unten.
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, text, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftsTable } from "./shifts";

export const shiftCorrectionObjectionStatusEnum = pgEnum("shift_correction_objection_status", [
  "OPEN", // Widerspruch steht, Planer muss reagieren
  "RESOLVED", // Planer hat zurueckgenommen oder nachbearbeitet
]);

export const shiftCorrectionObjectionResolutionEnum = pgEnum(
  "shift_correction_objection_resolution",
  [
    "WITHDRAWN", // Korrektur zurueckgenommen — alter Wert gilt wieder
    "REWORKED", // Korrektur nachbearbeitet — neue Zeit geht erneut zur Bestaetigung
  ],
);

export const shiftCorrectionObjectionsTable = pgTable(
  "shift_correction_objections",
  {
    id: serial("id").primaryKey(),
    shiftId: integer("shift_id")
      .notNull()
      .references(() => shiftsTable.id, { onDelete: "cascade" }),
    // Team zum Zeitpunkt des Widerspruchs — eigene Spalte statt JOIN, damit
    // team-gescopte Abfragen ohne Join filtern koennen (Muster wie ueberall).
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id),
    // Widersprechende Assistenzkraft. Loeschschutz konsistent mit den uebrigen
    // Zeitnachweis-Tabellen (§ 16 ArbZG / § 17 MiLoG, 2 Jahre).
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    /** Pflicht: ohne Begruendung ist ein Widerspruch fuer den Planer wertlos. */
    reason: text("reason").notNull(),
    /** Zeiten, gegen die widersprochen wurde — festgehalten, weil der Planer
     *  sie danach aendern darf und der Streitstand sonst nicht mehr
     *  nachvollziehbar waere. */
    disputedStartTime: timestamp("disputed_start_time", { withTimezone: true }).notNull(),
    disputedEndTime: timestamp("disputed_end_time", { withTimezone: true }).notNull(),
    status: shiftCorrectionObjectionStatusEnum("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolution: shiftCorrectionObjectionResolutionEnum("resolution"),
    resolvedBy: integer("resolved_by").references(() => usersTable.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    // Hoechstens EIN offener Widerspruch je Dienst; erledigte beliebig viele.
    uniqueIndex("shift_correction_objections_open_unique")
      .on(t.shiftId)
      .where(sql`status = 'OPEN'`),
    index("shift_correction_objections_team_status_idx").on(t.teamId, t.status),
    index("shift_correction_objections_user_idx").on(t.userId),
  ],
);
