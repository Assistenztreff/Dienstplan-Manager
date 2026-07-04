import { pgTable, serial, integer, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

// Vergütungstyp eines Dienstes (betrifft die GELD-Berechnung, nicht die
// Stunden-Zählung — dafür ist valuationPercent zuständig):
//   regular    = regulärer Stundenlohn (100% des Basis-Stundenlohns)
//   percentage = prozentualer Stundenlohn (compensationPercent % des Basislohns
//                für die Dauer der Schicht, z. B. Bereitschaft 50%)
//   flat       = Festbetrag pro Schicht (compensationFlatCents, dauerunabhängig)
export const compensationTypeEnum = pgEnum("compensation_type", ["regular", "percentage", "flat"]);

export const shiftModelsTable = pgTable("shift_models", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  name: text("name").notNull(),
  valuationPercent: integer("valuation_percent").notNull().default(100),
  color: text("color").notNull().default("slate"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Standard-Start-/Endzeit im Format "HH:MM"; füllt beim Auswählen des Dienstes
  // im Kalender die Zeiten vor (überschreibbar). Gleicher Start = Ende ⇒ 24h-Dienst.
  defaultStartTime: text("default_start_time").notNull().default("08:00"),
  defaultEndTime: text("default_end_time").notNull().default("16:00"),
  // Standard-Wochentage als Zahlen 1 (Montag) bis 7 (Sonntag).
  defaultWeekdays: integer("default_weekdays").array().notNull().default([1, 2, 3, 4, 5]),
  // Vergütung (Geld). compensationPercent nur bei "percentage", compensationFlatCents
  // (Cent, dauerunabhängig) nur bei "flat" gesetzt.
  compensationType: compensationTypeEnum("compensation_type").notNull().default("regular"),
  compensationPercent: integer("compensation_percent"),
  compensationFlatCents: integer("compensation_flat_cents"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShiftModelSchema = createInsertSchema(shiftModelsTable).omit({ id: true, createdAt: true });
export type InsertShiftModel = z.infer<typeof insertShiftModelSchema>;
export type ShiftModel = typeof shiftModelsTable.$inferSelect;
