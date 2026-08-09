import { pgTable, serial, integer, timestamp, unique, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { relations } from "drizzle-orm";

/**
 * Gestufte Team-Freischaltung für Assistenznehmer beim Dienstleister.
 * Bewusst GETRENNT von is_teamleiter (Unternehmens-Teamleiter des
 * Dienstleisters) — fachlich eine andere Rolle mit anderen Grenzen:
 *
 * - "keine"  — Standard. Keine Team-Rechte (normale Assistenzkraft).
 * - "basis"  — Lese-Übersicht über das ganze Team (Dienstplan, Abwesenheiten).
 * - "stufe1" — zusätzlich Dienste/Abwesenheiten planen, Assistenzkräfte
 *              pflegen, PDF-Export.
 * - "stufe2" — zusätzlich Team-Verwaltung und Zeiterfassung.
 *
 * Stufe 2 schließt Stufe 1 immer ein. Keine Stufe gewährt jemals Lohndaten
 * (can_view_payroll) oder Rechte außerhalb des freigegebenen Teams.
 */
export const teamAccessLevelEnum = pgEnum("team_access_level", [
  "keine",
  "basis",
  "stufe1",
  "stufe2",
]);

export const teamMembersTable = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Teamleiter-Flag: Gibt dem Mitglied Admin-Level-Zugriff auf genau dieses
     * Team (Schichten, Zeiterfassung, Mitglieder verwalten) — teambeschränkt,
     * kein globaler Admin-Zugriff. Default false; gesetzt vom Konto-Admin.
     */
    isTeamleiter: boolean("is_teamleiter").notNull().default(false),
    /**
     * Lohndaten-Sichtbarkeit: Erlaubt dem Teamleiter den Zugriff auf
     * Stundenlöhne, Abrechnungsauswertungen und sensible Personalfelder
     * (SV-Nummer, Steuer-ID, Bankdaten) der Teammitglieder. Default false.
     * Bei gewerblichen Dienstleistern beim Ernennen zum Teamleiter auf true
     * gesetzt; bei Privatpersonen standardmäßig aus (Assistenznehmer entscheidet).
     */
    canViewPayroll: boolean("can_view_payroll").notNull().default(false),
    /**
     * Gestufte Freischaltung für Assistenznehmer beim Dienstleister
     * (siehe teamAccessLevelEnum). Default "keine" — Rechte müssen pro Team
     * ausdrücklich vergeben werden und wirken nur in diesem Team.
     */
    accessLevel: teamAccessLevelEnum("access_level").notNull().default("keine"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    teamUserUnique: unique("team_members_team_id_user_id_unique").on(t.teamId, t.userId),
  }),
);

export const teamMembersRelations = relations(teamMembersTable, ({ one }) => ({
  team: one(teamsTable, { fields: [teamMembersTable.teamId], references: [teamsTable.id] }),
  user: one(usersTable, { fields: [teamMembersTable.userId], references: [usersTable.id] }),
}));

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, createdAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
