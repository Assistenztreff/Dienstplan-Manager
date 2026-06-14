import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

export const shiftModelsTable = pgTable("shift_models", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  name: text("name").notNull(),
  valuationPercent: integer("valuation_percent").notNull().default(100),
  color: text("color").notNull().default("slate"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShiftModelSchema = createInsertSchema(shiftModelsTable).omit({ id: true, createdAt: true });
export type InsertShiftModel = z.infer<typeof insertShiftModelSchema>;
export type ShiftModel = typeof shiftModelsTable.$inferSelect;
