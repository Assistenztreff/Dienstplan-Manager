import { pgTable, serial, integer, timestamp, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { teamsTable } from "./teams";
import { relations } from "drizzle-orm";

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
