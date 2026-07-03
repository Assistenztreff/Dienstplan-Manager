import { pgTable, integer, text, timestamp, serial, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";
import { usersTable } from "./users";

// Branding-Einstellungen sind PRO KONTO (Team-Eigentümer) gespeichert — früher
// eine globale Singleton-Zeile (id=1), was in einem Multi-Tenant-SaaS ein
// Daten-Leck war: jeder Admin konnte das Logo aller anderen Konten überschreiben
// (via PUT /branding-settings ohne teamId). Analog zu allowance_settings ist
// jede Zeile jetzt an genau einen Eigentümer (Admin-Konto) gebunden.
// Team-spezifische Overrides bleiben in `team_branding_settings` (unverändert).
export const brandingSettingsTable = pgTable(
  "branding_settings",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    logoPath: text("logo_path"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  }
);

export const insertBrandingSettingsSchema = createInsertSchema(brandingSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertBrandingSettings = z.infer<typeof insertBrandingSettingsSchema>;
export type BrandingSettings = typeof brandingSettingsTable.$inferSelect;

/**
 * Logo je Team (für Dienstleister mit mehreren Klienten/Teams). Eine Zeile pro
 * Team; das globale Logo in `branding_settings` bleibt der Fallback. Wird mit dem
 * Team gelöscht (Cascade), damit keine verwaisten Logos zurückbleiben.
 */
export const teamBrandingSettingsTable = pgTable(
  "team_branding_settings",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teamsTable.id, { onDelete: "cascade" }),
    logoPath: text("logo_path"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    teamUnique: unique("team_branding_settings_team_id_unique").on(t.teamId),
  })
);

export const insertTeamBrandingSettingsSchema = createInsertSchema(teamBrandingSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertTeamBrandingSettings = z.infer<typeof insertTeamBrandingSettingsSchema>;
export type TeamBrandingSettings = typeof teamBrandingSettingsTable.$inferSelect;
