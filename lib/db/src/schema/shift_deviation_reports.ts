// ---------------------------------------------------------------------------
// Abweichungsmeldungen (Abweichungsmodell) — gegenseitige Bestätigung der
// tatsächlich geleisteten Arbeitszeit bei einem bereits vergangenen,
// bestätigten (FIX) Dienst.
// ---------------------------------------------------------------------------
// Ein Dienst gilt automatisch wie geplant als geleistet (SOLL-Wert). Weicht
// die tatsächliche Arbeitszeit ab, meldet die Assistenzkraft aktiv nur die
// Abweichung ("War anders") — keine Pflicht-Bestätigung jedes einzelnen
// Dienstes. Der Planer reagiert dann: annehmen (gemeldeter Wert übernimmt die
// Schicht, s. shift_changes.changeSource = 'deviation_accepted') oder mit
// Begründung widersprechen (Planwert bleibt maßgeblich, beide Werte bleiben
// sichtbar).
//
// Abbruchregel gegen Ping-Pong: GENAU EINE Meldung pro Dienst, für die ganze
// Lebensdauer der Schicht — UNIQUE(shift_id). Nach der Planer-Reaktion
// (angenommen ODER strittig) ist der Melde-Button für beide Seiten endgültig
// weg, kein zweiter Zyklus. Der Planer korrigiert eine Meldung nie still, nur
// annehmen oder widersprechen — daher keine "in Bearbeitung"-Zwischenstände.
//
// "Dienst ist ausgefallen": reportedAusgefallen=true, der Server setzt beim
// Melden reportedEndTime = reportedStartTime (Nulldauer) — läuft dadurch bei
// der Annahme ohne Sonderfall durch die bestehende Stundenberechnung
// (storeShiftMetrics), statt eine zweite Wahrheit für "0 Stunden" einzuführen.
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, boolean, text, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftsTable } from "./shifts";

export const shiftDeviationStatusEnum = pgEnum("shift_deviation_status", [
  "PENDING", // gemeldet, wartet auf Planer-Reaktion
  "ACCEPTED", // Planer hat angenommen — gemeldeter Wert gilt
  "DISPUTED", // Planer hat widersprochen — Planwert bleibt maßgeblich
]);

export const shiftDeviationReportsTable = pgTable(
  "shift_deviation_reports",
  {
    id: serial("id").primaryKey(),
    shiftId: integer("shift_id")
      .notNull()
      .references(() => shiftsTable.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id),
    // Meldende Assistenzkraft. Löschschutz konsistent mit shifts/
    // absence_requests/contracts/time_tracking/shift_changes.
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    status: shiftDeviationStatusEnum("status").notNull().default("PENDING"),
    reportedStartTime: timestamp("reported_start_time").notNull(),
    reportedEndTime: timestamp("reported_end_time").notNull(),
    reportedPauseMinutes: integer("reported_pause_minutes").notNull().default(0),
    reportedAusgefallen: boolean("reported_ausgefallen").notNull().default(false),
    reportedAt: timestamp("reported_at").notNull().defaultNow(),
    // Wer reagiert hat (Annehmen/Widersprechen) — IMMER aus der Session, nie
    // aus dem Request-Body.
    resolvedBy: integer("resolved_by").references(() => usersTable.id),
    resolvedAt: timestamp("resolved_at"),
    disputeReason: text("dispute_reason"),
  },
  (t) => [
    // Abbruchregel: genau eine Meldung pro Dienst, für immer.
    uniqueIndex("shift_deviation_reports_shift_id_unique").on(t.shiftId),
    index("shift_deviation_reports_team_id_status_idx").on(t.teamId, t.status),
    index("shift_deviation_reports_user_id_idx").on(t.userId),
  ],
);

export type ShiftDeviationReport = typeof shiftDeviationReportsTable.$inferSelect;
