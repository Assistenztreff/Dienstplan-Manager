import { pgTable, serial, integer, real, date, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { relations } from "drizzle-orm";

export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  weeklyHours: real("weekly_hours").notNull(),
  vacationDays: integer("vacation_days").notNull().default(30),
  vacationDaysUsed: integer("vacation_days_used").notNull().default(0),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contractsRelations = relations(contractsTable, ({ one }) => ({
  user: one(usersTable, { fields: [contractsTable.userId], references: [usersTable.id] }),
}));

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, createdAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;
