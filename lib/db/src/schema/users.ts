import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  date,
  pgEnum,
  real,
  integer,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// "koordinator" = Verwaltungsperson eines Dienstleister-Kontos (Unternehmens-
// Teamleiter laut Konzeptpapier): bekommt Teamleiter-Rechte über zugewiesene
// team_members-Zeilen (is_teamleiter=true), ist aber KEINE Assistenzkraft —
// alle role="assistant"-Filter (Karten, Picker, Auswertungen) schließen sie
// dadurch automatisch aus.
export const roleEnum = pgEnum("role", ["admin", "assistant", "superadmin", "koordinator"]);
export const accountTypeEnum = pgEnum("account_type", ["privat", "dienstleister"]);
// SaaS-Abo-Stufe pro Konto. "free" = abgespeckte Gratis-Version, "premium" =
// voller Funktionsumfang. Aktivierung erfolgt vorerst manuell ueber das
// Operator-Dashboard (manuelles Lexware-Billing), daher Default "free".
export const planEnum = pgEnum("plan", ["free", "premium"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("assistant"),
  accountType: accountTypeEnum("account_type").notNull().default("privat"),
  plan: planEnum("plan").notNull().default("free"),
  phone: text("phone"),
  address: text("address"),
  birthDate: date("birth_date"),
  socialSecurityNumber: text("social_security_number"),
  taxId: text("tax_id"),
  taxClass: text("tax_class"),
  healthInsurance: text("health_insurance"),
  iban: text("iban"),
  // Bruttostundenlohn in Euro (Teil der erweiterten Personalakte, premium-gated);
  // NULL = nicht erfasst.
  hourlyWage: real("hourly_wage"),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash"),
  inviteToken: text("invite_token"),
  inviteTokenExpiry: timestamp("invite_token_expiry"),
  // Passwort-Reset per E-Mail: zufälliger Token + Ablaufzeit.
  passwordResetToken: text("password_reset_token"),
  passwordResetTokenExpiry: timestamp("password_reset_token_expiry"),
  // E-Mail-Verifizierung: false = noch nicht bestätigt (nur gesetzt wenn RESEND_API_KEY aktiv).
  // Default true damit bestehende Accounts weiter funktionieren.
  emailVerified: boolean("email_verified").notNull().default(true),
  emailVerificationToken: text("email_verification_token"),
  // Geheimer Abo-Token fuer den oeffentlichen Kalender-Feed (ICS-Abo in
  // Google/Apple/Outlook). Kalender-Clients koennen keine Session-Cookies
  // senden, daher authentifiziert der Token die Feed-URL. NULL = kein Abo.
  calendarToken: text("calendar_token").unique(),
  // Konto-Verknüpfung für Koordinatoren: das Dienstleister-Konto, das diesen
  // Koordinator angelegt hat und verwaltet. Nur für role="koordinator" gesetzt.
  // Nötig, weil GET /users mitgliedschafts-gescoped ist — ein Koordinator ohne
  // zugewiesene Teams wäre sonst für den Inhaber unsichtbar (und Einladung/
  // Team-Zuweisung ließen sich nicht sauber autorisieren).
  // ON DELETE CASCADE: Ohne das verwaltende Konto ist ein Koordinator
  // funktionslos — und ein NO-ACTION-FK würde jede Löschung des
  // Dienstleister-Kontos blockieren, solange Koordinatoren existieren.
  managedByUserId: integer("managed_by_user_id").references((): AnyPgColumn => usersTable.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  passwordHash: true,
  inviteToken: true,
  inviteTokenExpiry: true,
  calendarToken: true,
  passwordResetToken: true,
  passwordResetTokenExpiry: true,
  emailVerificationToken: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
