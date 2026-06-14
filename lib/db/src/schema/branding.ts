import { pgTable, integer, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
