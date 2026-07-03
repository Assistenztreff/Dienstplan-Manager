// ---------------------------------------------------------------------------
// Fehler-Tracking der Plattform (Operator-Dashboard, nur superadmin).
// ---------------------------------------------------------------------------
// Jeder unbehandelte Serverfehler (zentraler Express-Error-Handler) und
// gezielt gemeldete kritische Fehler aus try/catch-Stellen landen hier als
// eine Zeile: Schweregrad, Meldung, Kontext (Route), Zeitstempel. Der
// Betreiber sieht die neuesten Eintraege im Operator-Dashboard und erhaelt
// bei Level "error" eine (gedrosselte) Warn-E-Mail. Die Aufbewahrung ist
// begrenzt (Pruning in recordPlatformError), damit die Tabelle nicht
// unbegrenzt waechst.
// ---------------------------------------------------------------------------

import {
  pgTable,
  serial,
  timestamp,
  text,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";

export const platformErrorLevelEnum = pgEnum("platform_error_level", [
  "error",
  "warning",
]);

export const platformErrorsTable = pgTable("platform_errors", {
  id: serial("id").primaryKey(),
  level: platformErrorLevelEnum("level").notNull(),
  message: text("message").notNull(),
  // Kontext = Route/Stelle, z. B. "GET /api/shifts" oder "billing/createDraft"
  context: text("context").notNull(),
  // Vom Betreiber als erledigt abgehakt (Quittierung im Operator-Dashboard).
  // Erledigte Eintraege bleiben erhalten (Aufbewahrungslimit unveraendert),
  // werden aber im Dashboard ausgegraut bzw. per Filter ausgeblendet.
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlatformError = typeof platformErrorsTable.$inferSelect;
