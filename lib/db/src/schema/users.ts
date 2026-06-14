import { pgTable, serial, text, boolean, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleEnum = pgEnum("role", ["admin", "assistant"]);
export const accountTypeEnum = pgEnum("account_type", ["privat", "dienstleister"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("assistant"),
  accountType: accountTypeEnum("account_type").notNull().default("privat"),
  phone: text("phone"),
  address: text("address"),
  birthDate: date("birth_date"),
  socialSecurityNumber: text("social_security_number"),
  taxId: text("tax_id"),
  taxClass: text("tax_class"),
  healthInsurance: text("health_insurance"),
  iban: text("iban"),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash"),
  inviteToken: text("invite_token"),
  inviteTokenExpiry: timestamp("invite_token_expiry"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  passwordHash: true,
  inviteToken: true,
  inviteTokenExpiry: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
