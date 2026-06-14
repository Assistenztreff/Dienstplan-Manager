import { pgTable, serial, integer, real, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { shiftModelsTable } from "./shift_models";
import { relations } from "drizzle-orm";

export const shiftTypeEnum = pgEnum("shift_type", ["active", "standby", "night", "full_day", "vacation", "sick", "work"]);

export const shiftsTable = pgTable("shifts", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  type: shiftTypeEnum("type").notNull().default("active"),
  shiftModelId: integer("shift_model_id").references(() => shiftModelsTable.id, { onDelete: "set null" }),
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
