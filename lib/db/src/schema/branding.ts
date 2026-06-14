import { pgTable, integer, text, timestamp, check, serial, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

export const brandingSettingsTable = pgTable(
  "branding_settings",
  {
    id: integer("id").primaryKey().default(1),
    logoPath: text("logo_path"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [check("branding_settings_singleton", sql`${t.id} = 1`)]
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
