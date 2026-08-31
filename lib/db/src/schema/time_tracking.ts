import { pgTable, serial, integer, real, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftsTable } from "./shifts";
import { relations } from "drizzle-orm";

export const timeEntryStatusEnum = pgEnum("time_entry_status", ["pending", "confirmed", "rejected"]);

export const timeTrackingTable = pgTable("time_tracking", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  // Löschschutz: KEIN CASCADE, siehe shifts.ts (Ist-Zeiten sind der direkteste
  // aufzeichnungspflichtige Nachweis, gleiche Aufbewahrungspflicht).
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  shiftId: integer("shift_id").references(() => shiftsTable.id, { onDelete: "set null" }),
  actualStart: timestamp("actual_start").notNull(),
  actualEnd: timestamp("actual_end").notNull(),
  actualHours: real("actual_hours"),
  // Unbezahlte Pausenminuten des Ist-Eintrags (Vorbefüllung gemäß Pausenregel,
  // pro Eintrag überschreibbar). Reduziert die gewerteten Stunden nur, wenn
  // der Konto-Schalter deduct_pauses_enabled aktiv ist.
  pauseMinutes: integer("pause_minutes").notNull().default(0),
  status: timeEntryStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  confirmedBy: integer("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Monatslisten-Abfragen (Dashboard, hours-balance):
  // WHERE team_id IN (...) AND actual_start >= ? AND actual_start < ?
  index("time_tracking_team_id_actual_start_idx").on(t.teamId, t.actualStart),
  // Benutzer-spezifische Abfragen (Dashboard-Assistenten-Branch):
  // WHERE user_id = ? AND actual_start >= ? AND actual_start < ?
  index("time_tracking_user_id_actual_start_idx").on(t.userId, t.actualStart),
]);

export const timeTrackingRelations = relations(timeTrackingTable, ({ one }) => ({
  user: one(usersTable, { fields: [timeTrackingTable.userId], references: [usersTable.id] }),
  shift: one(shiftsTable, { fields: [timeTrackingTable.shiftId], references: [shiftsTable.id] }),
  confirmedByUser: one(usersTable, { fields: [timeTrackingTable.confirmedBy], references: [usersTable.id] }),
}));

export const insertTimeEntrySchema = createInsertSchema(timeTrackingTable).omit({ id: true, createdAt: true, actualHours: true });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeTrackingTable.$inferSelect;
