import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

// Wiederkehrende Arbeitszeit-Vorlagen (z. B. "Frühdienst Mo–Fr"). Eigenständiges
// Konzept neben den Schichtmodellen (shift_models): eine Vorlage belegt beim
// Anlegen einer Schicht nur die Zeiten vor, sie ist kein Schicht-Typ.
export const shiftTemplatesTable = pgTable("shift_templates", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  name: text("name").notNull(),
  // Start-/Endzeit im Format "HH:MM".
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  // Gültige Wochentage als Zahlen von 1 (Montag) bis 7 (Sonntag).
  weekdays: integer("weekdays").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShiftTemplateSchema = createInsertSchema(shiftTemplatesTable).omit({ id: true, createdAt: true });
export type InsertShiftTemplate = z.infer<typeof insertShiftTemplateSchema>;
export type ShiftTemplate = typeof shiftTemplatesTable.$inferSelect;
