// ---------------------------------------------------------------------------
// Urlaubs-/Krankheitsanträge mit Bestätigungspflicht (#887).
// ---------------------------------------------------------------------------
// Eine reine Assistenzkraft kann sich seit #887 NICHT mehr direkt Urlaub oder
// Krankheit eintragen (das würde sofort einen `shifts`-Eintrag erzeugen und
// den Urlaubszähler belasten). Stattdessen landet der Wunsch hier als PENDING
// Antrag; erst die Bestätigung eines Planers (Admin/Teamleiter/Koordinator mit
// Planungsrecht) erzeugt über dieselbe Logik wie `POST /shifts/bulk-absence`
// die eigentlichen Schichten (s. runBulkAbsenceCreation in routes/shifts.ts).
//
// Bewusst eine EIGENE Tabelle statt eines Pending-Status auf `shiftsTable`:
// Schicht-Zeilen gelten überall (Kalender, Stundenbilanz, Urlaubskonto,
// Überschneidungsprüfung) als verbindlich — ein Pending-Flag dort hätte jeden
// dieser Lesepfade zusätzlich verzweigen müssen. `days` speichert die exakt
// vom Client gewählten Tage/Zeiten (wie bei BulkAbsenceInput), damit die
// Genehmigung bei der Freigabe 1:1 dieselben Werte durch die bestehende
// Sammel-Anlage-Logik schickt (keine zweite, abweichende Implementierung –
// s. Gedächtnis „bwavg dropped from single-shift path").
//
// planningStatus (VORLAEUFIG/ANGEBOTEN/FIX, s. shifts.ts) ist ein GETRENNTES
// Konzept (Dienst-Vorschlag/-Bestätigung) und wird hier NICHT wiederverwendet.
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { teamsTable } from "./teams";

// wunschfrei = Wunsch, an diesen Tagen nicht eingeplant zu werden (Termin,
// private Gruende). Erst die Genehmigung macht daraus eine verbindliche
// Sperre; abgelehnt bleibt der Tag normal planbar.
export const absenceRequestTypeEnum = pgEnum("absence_request_type", [
  "vacation",
  "sick",
  "wunschfrei",
]);
export const absenceRequestStatusEnum = pgEnum("absence_request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// Ein Eintrag pro Kalendertag — identisches Format zu BulkAbsenceInput.days.
export type AbsenceRequestDay = { startTime: string; endTime: string };

export const absenceRequestsTable = pgTable(
  "absence_requests",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id),
    // Löschschutz: KEIN CASCADE, siehe shifts.ts (dieselbe Aufbewahrungspflicht
    // gilt für Urlaubs-/Krankheitsanträge als Teil des Zeitnachweises).
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    type: absenceRequestTypeEnum("type").notNull(),
    status: absenceRequestStatusEnum("status").notNull().default("PENDING"),
    days: jsonb("days").$type<AbsenceRequestDay[]>().notNull(),
    notes: jsonb("notes").$type<string | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    // Wer den Antrag bestätigt/abgelehnt hat — IMMER aus req.session abgeleitet,
    // nie aus dem Request-Body (s. Gedächtnis „Client-trusted audit actor fields").
    resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // IDs der bei Genehmigung tatsächlich angelegten Schichten (Debug/Nachverfolgung).
    resultShiftIds: jsonb("result_shift_ids").$type<number[]>(),
  },
  (t) => [
    index("absence_requests_team_status_idx").on(t.teamId, t.status),
    index("absence_requests_user_status_idx").on(t.userId, t.status),
  ],
);

export type AbsenceRequest = typeof absenceRequestsTable.$inferSelect;
export type InsertAbsenceRequest = typeof absenceRequestsTable.$inferInsert;
