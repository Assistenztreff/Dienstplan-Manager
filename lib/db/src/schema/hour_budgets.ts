import { pgTable, serial, integer, real, date, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

// ---------------------------------------------------------------------------
// Zielvereinbarungen (Stundenbudget) — Bedarfsseite, Premium-Feature.
// ---------------------------------------------------------------------------
// Genehmigte Assistenzstunden pro Monat (z. B. laut Zielvereinbarung mit dem
// Kostenträger). Bewusst PRO TEAM (Assistenznehmer-Seite) und NICHT pro
// Assistenzkraft/Vertrag: Das Budget beschreibt den Bedarf, die Verträge die
// Arbeitsseite — beide bleiben getrennt.
//
// Gültigkeitszeitraum (startDate/endDate, endDate NULL = unbefristet) nach dem
// Vertragsmuster: Eine neue Zielvereinbarung löst die alte ZEITRAUMBEZOGEN ab,
// statt sie zu überschreiben (Historie bleibt für Nachberechnungen und
// Monatsabschlüsse erhalten). Zeiträume eines Teams dürfen sich nicht
// überlappen — das prüft die API (409 budget_overlap), da Überlappungen mit
// offenem Ende per UNIQUE-Constraint nicht abbildbar sind.
//
// team_id referenziert MIT Cascade (anders als shifts/contracts — dort fehlt
// sie historisch): Budgets sind reine Einstellungsdaten ohne eigenständige
// Historie außerhalb ihres Teams; beim Team-Löschen werden sie mitgeräumt.
export const hourBudgetsTable = pgTable("hour_budgets", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references(() => teamsTable.id, { onDelete: "cascade" }),
  // Genehmigte Stunden pro Monat (Dezimalwerte erlaubt, z. B. 46,5 h).
  monthlyHours: real("monthly_hours").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertHourBudgetSchema = createInsertSchema(hourBudgetsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertHourBudget = z.infer<typeof insertHourBudgetSchema>;
export type HourBudget = typeof hourBudgetsTable.$inferSelect;
