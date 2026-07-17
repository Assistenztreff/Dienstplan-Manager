import { pgTable, serial, integer, real, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftModelsTable } from "./shift_models";
import { relations } from "drizzle-orm";

export const shiftTypeEnum = pgEnum("shift_type", ["active", "standby", "night", "full_day", "vacation", "sick", "work", "freizeitausgleich"]);

// Planungsstatus einer Schicht im Lebenszyklus: VORLAEUFIG = Entwurf (interne
// Planung), ANGEBOTEN = Vorschlag (dem Mitarbeiter angeboten), FIX = verbindlich
// bestätigt. Default FIX, damit Bestandsschichten beim Migrieren als verbindlich
// gelten (sie waren vor diesem Feature bereits "echte" Schichten).
export const shiftPlanningStatusEnum = pgEnum("shift_planning_status", ["VORLAEUFIG", "ANGEBOTEN", "FIX"]);

export const shiftsTable = pgTable("shifts", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  type: shiftTypeEnum("type").notNull().default("active"),
  planningStatus: shiftPlanningStatusEnum("planning_status").notNull().default("FIX"),
  shiftModelId: integer("shift_model_id").references(() => shiftModelsTable.id, { onDelete: "set null" }),
  // Aushilfe-Einsatz: Die Schicht liegt IMMER im Stammteam (team_id); dieses
  // optionale Feld markiert, FUER welches andere eigene Team der Einsatz
  // erfolgt. Auswertung/Stunden bleiben beim Stammteam; das Ziel-Team sieht
  // die Schicht nur als schreibgeschuetzten Spiegel-Eintrag im Kalender.
  einsatzTeamId: integer("einsatz_team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  // Berechnete Roh-Kennzahlen (beim Speichern ermittelt, Zuschlags-% erst bei Auswertung).
  valuedHours: real("valued_hours").notNull().default(0),
  nightHours: real("night_hours").notNull().default(0),
  sundayHours: real("sunday_hours").notNull().default(0),
  holidayHours: real("holiday_hours").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shiftsRelations = relations(shiftsTable, ({ one }) => ({
  user: one(usersTable, { fields: [shiftsTable.userId], references: [usersTable.id] }),
  shiftModel: one(shiftModelsTable, { fields: [shiftsTable.shiftModelId], references: [shiftModelsTable.id] }),
}));

export const insertShiftSchema = createInsertSchema(shiftsTable).omit({ id: true, createdAt: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shiftsTable.$inferSelect;
