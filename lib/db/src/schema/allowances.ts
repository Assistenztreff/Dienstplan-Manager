import { pgTable, integer, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const allowanceSettingsTable = pgTable(
  "allowance_settings",
  {
    id: integer("id").primaryKey().default(1),
    nightPercent: integer("night_percent").notNull().default(25),
    nightStart: text("night_start").notNull().default("23:00"),
    nightEnd: text("night_end").notNull().default("06:00"),
    sundayPercent: integer("sunday_percent").notNull().default(50),
    holidayPercent: integer("holiday_percent").notNull().default(100),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [check("allowance_settings_singleton", sql`${t.id} = 1`)]
);

export const insertAllowanceSettingsSchema = createInsertSchema(allowanceSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertAllowanceSettings = z.infer<typeof insertAllowanceSettingsSchema>;
export type AllowanceSettings = typeof allowanceSettingsTable.$inferSelect;
