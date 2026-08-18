import { pgTable, serial, integer, real, date, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { relations } from "drizzle-orm";

// Abrechnungsart: SOLL = Abrechnung nach Plan (geplante FIX-Schichten), IST =
// Abrechnung nach den tatsächlich erfassten Zeiten (Stunden UND Zuschläge werden
// aus den Ist-Zeiten berechnet). Gilt einheitlich pro Team/Konto: die wirksame
// Art ergibt sich aus der Kette Team-Override → Konto → SOLL.
export const billingMethodEnum = pgEnum("billing_method", ["SOLL", "IST"]);

export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  weeklyHours: real("weekly_hours").notNull(),
  // Arbeitstage pro Woche (0,1–7, Dezimalwerte erlaubt, z. B. 1,15 bei
  // wöchentlichen bzw. 0,23 bei monatlichen 24-h-Diensten): Basis für den
  // Vertrags-Fallback bei der
  // bwavg-Urlaubsbewertung (Tageswert = weeklyHours / workdaysPerWeek), solange
  // noch kein 13-Wochen-Schnitt existiert. Default 5 (klassische 5-Tage-Woche).
  workdaysPerWeek: real("workdays_per_week").notNull().default(5),
  // Zeitpunkt der letzten BEWUSSTEN Arbeitstage-Festlegung (Formular,
  // Rechner-Dialog oder Hinweis-Bestätigung). NULL = Wert stammt noch aus dem
  // Migrations-Default → der Datenpflege-Hinweis wird eingeblendet.
  workdaysConfirmedAt: timestamp("workdays_confirmed_at"),
  vacationDays: integer("vacation_days").notNull().default(30),
  // Stundengenaue Urlaubsbuchhaltung (Point 7): verbrauchte Urlaubsstunden.
  // Pool = vacationDays * vacationHoursPerDay; Anzeige in Tagen = Stunden / 8.
  // (Der Alt-Zaehler vacation_days_used wurde entfernt — Tage sind IMMER
  // abgeleitet: vacationHoursUsed / vacationHoursPerDay.)
  vacationHoursUsed: real("vacation_hours_used").notNull().default(0),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  notes: text("notes"),
  // VERALTET (bewusst behalten, um einen destruktiven Spalten-Drop bei
  // nicht-interaktivem db push zu vermeiden): Der Vertrags-Override der
  // Abrechnungsart wurde entfernt — die Spalte wird NIRGENDS mehr gelesen,
  // Alt-Werte werden per pre-push-SQL auf NULL bereinigt. Die Abrechnungsart
  // kommt ausschließlich aus allowance_settings (Team-Override → Konto → SOLL).
  billingMethod: billingMethodEnum("billing_method"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Monatsüberschneidungs-Abfragen (contractForMonth, activeContractsForUsers):
  // WHERE user_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
  index("contracts_user_id_start_date_idx").on(t.userId, t.startDate),
  index("contracts_user_id_end_date_idx").on(t.userId, t.endDate),
]);

export const contractsRelations = relations(contractsTable, ({ one }) => ({
  user: one(usersTable, { fields: [contractsTable.userId], references: [usersTable.id] }),
}));

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, createdAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;
