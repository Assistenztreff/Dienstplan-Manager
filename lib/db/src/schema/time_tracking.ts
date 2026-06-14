import { pgTable, serial, integer, real, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
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
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id").references(() => shiftsTable.id, { onDelete: "set null" }),
  actualStart: timestamp("actual_start").notNull(),
  actualEnd: timestamp("actual_end").notNull(),
  actualHours: real("actual_hours"),
  status: timeEntryStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  confirmedBy: integer("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const timeTrackingRelations = relations(timeTrackingTable, ({ one }) => ({
  user: one(usersTable, { fields: [timeTrackingTable.userId], references: [usersTable.id] }),
  shift: one(shiftsTable, { fields: [timeTrackingTable.shiftId], references: [shiftsTable.id] }),
  confirmedByUser: one(usersTable, { fields: [timeTrackingTable.confirmedBy], references: [usersTable.id] }),
}));

export const insertTimeEntrySchema = createInsertSchema(timeTrackingTable).omit({ id: true, createdAt: true, actualHours: true });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeTrackingTable.$inferSelect;
