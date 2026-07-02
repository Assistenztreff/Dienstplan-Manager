import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Zuschlags-Einstellungen sind PRO KONTO (Team-Eigentümer) gespeichert — früher
// eine globale Singleton-Zeile (id=1), was in einem Multi-Tenant-SaaS ein
// Daten-Leck war: ein Konto konnte die Prozente aller anderen mitändern.
// Bestandsdaten wurden per Migration (scripts/migrate-allowance-settings) aus
// der globalen Zeile auf alle vorhandenen Admin-Konten übernommen.
export const allowanceSettingsTable = pgTable("allowance_settings", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  nightPercent: integer("night_percent").notNull().default(25),
  nightStart: text("night_start").notNull().default("23:00"),
  nightEnd: text("night_end").notNull().default("06:00"),
  sundayPercent: integer("sunday_percent").notNull().default(50),
  holidayPercent: integer("holiday_percent").notNull().default(100),
  state: text("state"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAllowanceSettingsSchema = createInsertSchema(allowanceSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertAllowanceSettings = z.infer<typeof insertAllowanceSettingsSchema>;
export type AllowanceSettings = typeof allowanceSettingsTable.$inferSelect;
