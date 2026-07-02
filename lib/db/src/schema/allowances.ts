import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";

// Zuschlags-Einstellungen sind PRO KONTO (Team-Eigentümer) gespeichert — früher
// eine globale Singleton-Zeile (id=1), was in einem Multi-Tenant-SaaS ein
// Daten-Leck war: ein Konto konnte die Prozente aller anderen mitändern.
// Bestandsdaten wurden per Migration (scripts/migrate-allowance-settings) aus
// der globalen Zeile auf alle vorhandenen Admin-Konten übernommen.
//
// Zusätzlich kann ein Dienstleister PRO TEAM eine abweichende Regelung
// hinterlegen (team_id gesetzt = Team-Override, team_id NULL = Konto-Zeile).
// Fallback-Kette: Team-Override → Konto-Zeile des Team-Eigentümers → Defaults.
export const allowanceSettingsTable = pgTable(
  "allowance_settings",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // NULL = Konto-weite Einstellungen des Eigentümers; gesetzt = Override für
    // genau dieses Team (Team-Löschung räumt den Override mit ab).
    teamId: integer("team_id")
      .unique()
      .references(() => teamsTable.id, { onDelete: "cascade" }),
    nightPercent: integer("night_percent").notNull().default(25),
    nightStart: text("night_start").notNull().default("23:00"),
    nightEnd: text("night_end").notNull().default("06:00"),
    sundayPercent: integer("sunday_percent").notNull().default(50),
    holidayPercent: integer("holiday_percent").notNull().default(100),
    state: text("state"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Genau EINE Konto-Zeile pro Eigentümer (Team-Overrides sind über die
    // UNIQUE-Spalte team_id begrenzt und zählen hier nicht mit).
    uniqueIndex("allowance_settings_owner_account_unique")
      .on(t.ownerId)
      .where(sql`${t.teamId} IS NULL`),
  ]
);

export const insertAllowanceSettingsSchema = createInsertSchema(allowanceSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertAllowanceSettings = z.infer<typeof insertAllowanceSettingsSchema>;
export type AllowanceSettings = typeof allowanceSettingsTable.$inferSelect;
