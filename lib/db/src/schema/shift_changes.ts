// ---------------------------------------------------------------------------
// Änderungshistorie für bereits bestätigte (FIX) Dienste.
// ---------------------------------------------------------------------------
// Aufzeichnungspflichtig ist die tatsächlich geleistete Arbeitszeit mit
// Beginn, Ende und Dauer (§ 3 Abs. 2 Nr. 1 ArbSchG, BAG-Urteil 13.09.2022).
// Bis hierher wurde ein bereits bestätigter Dienst beim Bearbeiten einfach
// überschrieben — der alte Wert war ab dem UPDATE unwiederbringlich weg,
// obwohl das genau der Fall ist, den ein belastbarer Zeitnachweis abdecken
// muss (wer hat wann was von welchem auf welchen Wert geändert).
//
// Eine Zeile hier wird geschrieben, sobald eine bereits bestätigte (FIX)
// Schicht inhaltlich geändert wird (Zeit, Pause oder zugewiesene
// Assistenzkraft) — exakt dieselbe Bedingung, unter der der bestehende
// Rückfall FIX→ANGEBOTEN auslöst (s. shifts-crud.ts, `faelltZurueck`).
// Diese eine Tabelle deckt zwei Auslöser gleichzeitig ab:
//   - Planer ändert einen bestätigten Dienst direkt (der bisherige, stille
//     Überschreib-Pfad)
//   - Eine gemeldete Abweichung wird vom Planer angenommen (Abweichungsmodell)
//     und dadurch die Schicht auf die gemeldete Ist-Zeit aktualisiert
// Beide sind für diese Tabelle einfach "ein bestätigter Dienst wurde
// geändert" — welcher der beiden Wege es war, steht in changeSource.
//
// Append-only: Zeilen werden NIE geändert oder gelöscht (wie plan_changes,
// month_closings). before/after sind bewusst volle Snapshots der
// zeitrelevanten Felder statt einzelner Diff-Spalten — robust gegenüber
// künftig zusätzlich getrackten Feldern, ohne Schema-Änderung.
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftsTable } from "./shifts";

export const shiftChangeSourceEnum = pgEnum("shift_change_source", [
  // Planer/Admin hat Zeiten, Pause oder Assistenzkraft eines bestätigten
  // Dienstes direkt geändert (PATCH /shifts/:id).
  "planner_edit",
  // Assistenzkraft hat eine Abweichung gemeldet, Planer hat sie angenommen —
  // die Schicht übernimmt die gemeldete Ist-Zeit.
  "deviation_accepted",
  // Assistenzkraft hat einer Korrektur widersprochen, Planer hat sie
  // zurückgenommen — die Schicht steht wieder auf dem Wert VOR der Korrektur
  // (s. shift_correction_objections.ts). Auch das ist eine Änderung an einem
  // bereits gearbeiteten Dienst und gehört lückenlos in die Aufzeichnung.
  "correction_withdrawn",
]);

// Snapshot der zeitrelevanten Felder einer Schicht zu einem Zeitpunkt.
export type ShiftChangeSnapshot = {
  startTime: string; // ISO-Zeitstempel
  endTime: string;
  pauseMinutes: number;
  userId: number;
};

export const shiftChangesTable = pgTable(
  "shift_changes",
  {
    id: serial("id").primaryKey(),
    // Loeschschutz: der Dienst darf verschwinden, seine Aenderungshistorie
    // nicht. Frueher `cascade` — damit riss das Loeschen eines einzelnen
    // Dienstes genau die Nachweiszeilen mit, die Stufe 1 schuetzen sollte,
    // und der Vormonats-Export haette die Aenderung stillschweigend verloren.
    // `restrict` scheidet aus (dann liesse sich gar kein Dienst mehr
    // loeschen); `set null` haelt die Zeile am Leben. Die Auswertung braucht
    // den Fremdschluessel ohnehin nicht: before/after sind vollstaendige
    // Snapshots inklusive Zeitraum und Assistenzkraft.
    shiftId: integer("shift_id").references(() => shiftsTable.id, {
      onDelete: "set null",
    }),
    // Team zum Zeitpunkt der Änderung — eigene Spalte statt JOIN über shiftId,
    // damit team-gescopte Abfragen (Export, spätere Auswertung) ohne Join
    // filtern können (Muster wie überall sonst im Projekt).
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id),
    // Betroffene Assistenzkraft — zum Zeitpunkt DIESER Änderung, nicht
    // notwendigerweise die heutige shifts.user_id (ein Assistenten-Wechsel
    // ist selbst eine getrackte Änderung). Löschschutz konsistent mit
    // shifts/absence_requests/contracts/time_tracking (§ 16 ArbZG, § 17 MiLoG).
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    // Wer die Änderung ausgelöst hat — bei planner_edit der Planer, bei
    // deviation_accepted der Planer, der die Meldung angenommen hat. IMMER
    // aus req.session abgeleitet, nie aus dem Request-Body.
    changedBy: integer("changed_by")
      .notNull()
      .references(() => usersTable.id),
    changeSource: shiftChangeSourceEnum("change_source").notNull(),
    before: jsonb("before").$type<ShiftChangeSnapshot>().notNull(),
    after: jsonb("after").$type<ShiftChangeSnapshot>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("shift_changes_shift_id_idx").on(t.shiftId),
    index("shift_changes_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("shift_changes_team_id_created_at_idx").on(t.teamId, t.createdAt),
  ],
);

export type ShiftChange = typeof shiftChangesTable.$inferSelect;
