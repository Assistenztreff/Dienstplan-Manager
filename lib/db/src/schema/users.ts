import { pgTable, serial, text, boolean, timestamp, date, pgEnum, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleEnum = pgEnum("role", ["admin", "assistant", "superadmin"]);
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
  // Geheimer Abo-Token fuer den oeffentlichen Kalender-Feed (ICS-Abo in
  // Google/Apple/Outlook). Kalender-Clients koennen keine Session-Cookies
  // senden, daher authentifiziert der Token die Feed-URL. NULL = kein Abo.
  calendarToken: text("calendar_token").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  passwordHash: true,
  inviteToken: true,
  inviteTokenExpiry: true,
  calendarToken: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
