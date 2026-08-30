// ---------------------------------------------------------------------------
// Tauschwunsch: "Kann dieser Dienst getauscht werden?" (Kay 30.08.2026)
// ---------------------------------------------------------------------------
// Bekommt eine Assistenzkraft kurzfristig einen Termin (Arzt, privat), konnte
// sie bisher nur zum Hoerer greifen: Ein Vorschlag liess sich ausschliesslich
// ANNEHMEN, und ein bestaetigter Dienst gar nicht mehr kommentieren. Der
// Tauschwunsch ist dieser fehlende Rueckweg — eine Anfrage mit Begruendung,
// ueber die der Planer entscheidet.
//
// ABGRENZUNG zu den beiden anderen Rueckkanaelen:
//   * Abwesenheitsantrag (absence_requests, Typ wunschfrei) blockt Tage im
//     VORAUS, bevor geplant wird — hier gibt es noch keinen Dienst.
//   * Abweichungsmeldung (shift_deviation_reports) betrifft einen bereits
//     GEARBEITETEN Dienst — "ich habe anders gearbeitet als geplant".
//   * Der Tauschwunsch liegt dazwischen: der Dienst steht im Plan, ist aber
//     noch nicht gearbeitet.
//
// KEINE eigene Entscheidungslogik am Dienst: Ein Tauschwunsch aendert weder
// planningStatus noch Zeiten noch die zugewiesene Person. Er dokumentiert nur
// die Bitte. Der Planer setzt sie um, indem er den Dienst wie immer umbesetzt
// (dann RESOLVED/REASSIGNED) oder ablehnt (RESOLVED/DECLINED). Damit bleibt
// der Dienst-Statusfluss unangetastet — bewusst anders als beim
// zurueckgebauten Widerspruch, der genau daran zu komplex wurde (a78274c).
//
// Mehrere Wuensche je Dienst sind erlaubt (der erste wird abgelehnt, spaeter
// kommt ein zweiter Termin dazwischen), aber immer nur EINER offen — dafuer
// der partielle Unique-Index unten, wie bei der Abweichungsmeldung.
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, text, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftsTable } from "./shifts";

export const shiftSwapRequestStatusEnum = pgEnum("shift_swap_request_status", [
  "OPEN", // Anfrage steht, Planer muss reagieren
  "RESOLVED", // Planer hat umbesetzt oder abgelehnt
]);

export const shiftSwapRequestResolutionEnum = pgEnum("shift_swap_request_resolution", [
  "REASSIGNED", // Dienst ging an jemand anderen — Wunsch erfuellt
  "DECLINED", // Dienst bleibt — Wunsch abgelehnt
]);

export const shiftSwapRequestsTable = pgTable(
  "shift_swap_requests",
  {
    id: serial("id").primaryKey(),
    shiftId: integer("shift_id")
      .notNull()
      .references(() => shiftsTable.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id),
    // Anfragende Assistenzkraft. Loeschschutz konsistent mit shifts/
    // absence_requests/contracts/time_tracking/shift_changes.
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    status: shiftSwapRequestStatusEnum("status").notNull().default("OPEN"),
    // Pflicht: Ohne Grund kann der Planer nicht abwaegen, und die
    // Assistenzkraft hat spaeter keinen Beleg, dass und warum sie gefragt hat.
    reason: text("reason").notNull(),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    resolution: shiftSwapRequestResolutionEnum("resolution"),
    // Optionale Antwort des Planers, vor allem bei einer Ablehnung.
    resolutionNote: text("resolution_note"),
    // Wer reagiert hat — IMMER aus der Session, nie aus dem Request-Body
    // (s. Gedaechtnis "Client-trusted audit actor fields").
    resolvedBy: integer("resolved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    // Hoechstens EIN offener Wunsch je Dienst; erledigte behindern nicht.
    uniqueIndex("shift_swap_requests_open_unique")
      .on(t.shiftId)
      .where(sql`status = 'OPEN'`),
    index("shift_swap_requests_team_id_status_idx").on(t.teamId, t.status),
    index("shift_swap_requests_user_id_idx").on(t.userId),
  ],
);

export type ShiftSwapRequest = typeof shiftSwapRequestsTable.$inferSelect;
export type InsertShiftSwapRequest = typeof shiftSwapRequestsTable.$inferInsert;
