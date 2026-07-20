// ---------------------------------------------------------------------------
// Monatsabschluss der Lohnauswertung (Task: Monatsabschluss mit Nachberechnung).
// ---------------------------------------------------------------------------
// Ein Admin friert die Lohnauswertung eines Monats als Schnappschuss ein:
// `entries` enthaelt die kompletten HoursBalance-Zeilen (Stunden UND Geldwerte
// je Assistenzkraft) exakt so, wie GET /dashboard/hours-balance sie zum
// Zeitpunkt des Abschlusses geliefert hat. Aendert sich der Monat spaeter,
// weist die Auswertung des Folgemonats die Differenz als "Nachberechnung" aus.
//
// Append-only: Ein erneuter Abschluss legt eine NEUE Zeile an; die juengste
// Zeile (hoechste closedAt/id) ist die massgebliche Referenz, aeltere bleiben
// als Historie erhalten. Zeilen werden NIE geaendert oder geloescht.
// Team-gebunden wie alle Domaenendaten (team_id NOT NULL).
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { teamsTable } from "./teams";

// Eingefrorene Auswertungszeile einer Assistenzkraft. Bewusst als eigener Typ
// (nicht der Live-Response-Typ), damit der Schnappschuss stabil bleibt, auch
// wenn die Live-API spaeter Felder hinzubekommt.
export type MonthClosingEntry = {
  userId: number;
  userName: string;
  plannedHours: number;
  totalFulfilledHours: number;
  billingMethod: "SOLL" | "IST";
  hourlyWage: number | null;
  basePay: number | null;
  nightSurchargePay: number | null;
  sundaySurchargePay: number | null;
  holidaySurchargePay: number | null;
  totalPay: number | null;
};

export const monthClosingsTable = pgTable("month_closings", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references(() => teamsTable.id),
  // Abgeschlossener Monat (1-12) und Jahr.
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  // Eingefrorene Auswertung: eine Zeile je Assistenzkraft.
  entries: jsonb("entries").$type<MonthClosingEntry[]>().notNull(),
  // Beim Abschluss verwendeter Stundenlohn-Parameter (Transparenz/Nachvollzug).
  hourlyWage: real("hourly_wage"),
  // Ausfuehrender Admin — SERVERSEITIG aus der Session, nie aus dem Request.
  closedBy: integer("closed_by")
    .notNull()
    .references(() => usersTable.id),
  closedAt: timestamp("closed_at").notNull().defaultNow(),
});

export type MonthClosing = typeof monthClosingsTable.$inferSelect;
