import { pgTable, serial, integer, real, text, boolean, timestamp, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { billingMethodEnum } from "./contracts";

// Urlaubs-Berechnungsmethode (Point 7):
//   bwavg  = Gesetzlicher 13-Wochen-Durchschnitt (§ 11 BUrlG); ein Urlaubstag
//            wird mit dem Ø der letzten 13 Wochen als bezahlte Freizeit gutgeschrieben.
//   factor = Prozentualer Stunden-Faktor; je bestätigter Arbeitsstunde werden
//            vacationFactor Urlaubsstunden aufgebaut.
export const vacationMethodEnum = pgEnum("vacation_method", ["bwavg", "factor"]);

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
    // Abrechnungsart auf Konto- (team_id NULL) bzw. Team-Override-Ebene (team_id
    // gesetzt); NULL = erbt (Team-Override → Konto → SOLL). Vorrang vor beidem hat
    // eine am Vertrag der Assistenzkraft gesetzte Abrechnungsart.
    billingMethod: billingMethodEnum("billing_method"),
    // Stundenzettel automatisch genehmigen: eingereichte Zeiteinträge werden
    // sofort auf "confirmed" gesetzt (Fallback-Kette wie oben).
    autoApproveTimesheets: boolean("auto_approve_timesheets").notNull().default(false),
    // Zeiterfassung (IST-Zeiten) pro Konto ein-/ausschaltbar; Standard AUS.
    // KONTO-GLOBAL (nur die Konto-Zeile team_id NULL ist maßgeblich, kein
    // Team-Override). Bei AUS blocken die Zeiterfassungs-Schreibrouten mit 403;
    // GET bleibt erlaubt, Bestandsdaten bleiben unangetastet.
    timeTrackingEnabled: boolean("time_tracking_enabled").notNull().default(false),
    // Urlaubs-Berechnung (Point 7).
    vacationMethod: vacationMethodEnum("vacation_method").notNull().default("bwavg"),
    vacationHoursPerDay: real("vacation_hours_per_day").notNull().default(8),
    vacationFactor: real("vacation_factor").notNull().default(0.0941),
    // Ersatzruhetag-Konto (§ 11 Abs. 3 ArbZG): steuert, ob Feiertagsarbeit einen
    // Ausgleichs-Ruhetag verdient. Aus Förder-/Kostenträger-Gründen abschaltbar;
    // Default true = Bestandsschutz (bisheriges Verhalten bleibt gleich).
    ersatzruhetagEnabled: boolean("ersatzruhetag_enabled").notNull().default(true),
    // Team-Dienst (Teamsitzung): KONTO-GLOBAL (nur Konto-Zeile team_id NULL
    // maßgeblich, kein Team-Override). Bei AN kann im Dienstplan ein Eintrag
    // vom Typ "team" angelegt werden; ein Team-Eintrag pro Tag schreibt ALLEN
    // Assistenzkräften des Teams teamMeetingHours als Arbeitszeit gut.
    teamMeetingEnabled: boolean("team_meeting_enabled").notNull().default(false),
    teamMeetingHours: real("team_meeting_hours").notNull().default(1),
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
