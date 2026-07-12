import { pgTable, serial, integer, real, date, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { relations } from "drizzle-orm";

// Abrechnungsart: SOLL = Abrechnung nach Plan (geplante FIX-Schichten), IST =
// Abrechnung nach den tatsächlich erfassten Zeiten (Stunden UND Zuschläge werden
// aus den Ist-Zeiten berechnet). NULL auf einer Zeile bedeutet "erben": die
// wirksame Art ergibt sich aus der Kette Assistent → Team → Konto → SOLL.
export const billingMethodEnum = pgEnum("billing_method", ["SOLL", "IST"]);

export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  weeklyHours: real("weekly_hours").notNull(),
  vacationDays: integer("vacation_days").notNull().default(30),
  // Stundengenaue Urlaubsbuchhaltung (Point 7): verbrauchte Urlaubsstunden.
  // Pool = vacationDays * vacationHoursPerDay; Anzeige in Tagen = Stunden / 8.
  // (Der Alt-Zaehler vacation_days_used wurde entfernt — Tage sind IMMER
  // abgeleitet: vacationHoursUsed / vacationHoursPerDay.)
  vacationHoursUsed: real("vacation_hours_used").notNull().default(0),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  notes: text("notes"),
  // Abrechnungsart pro Assistenzkraft; NULL = erbt von Team/Konto.
  billingMethod: billingMethodEnum("billing_method"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contractsRelations = relations(contractsTable, ({ one }) => ({
  user: one(usersTable, { fields: [contractsTable.userId], references: [usersTable.id] }),
}));

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, createdAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;
