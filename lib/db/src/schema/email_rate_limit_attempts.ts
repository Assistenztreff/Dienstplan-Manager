// ---------------------------------------------------------------------------
// E-Mail-Rate-Limit-Versuche pro IP (Passwort-Vergessen & Verifizierung).
// ---------------------------------------------------------------------------
// Sliding-Window-Zaehler fuer die Endpunkte POST /auth/forgot-password und
// POST /auth/resend-verification. Analog zu register_attempts (Task #600):
// eine Zeile pro Versuch, gezaehlt per Fenster-Abfrage, alte Zeilen
// werden beim naechsten Versuch bereinigt. Autoscale-sicher (gemeinsame DB).
// ---------------------------------------------------------------------------

import { pgTable, serial, timestamp, text, index } from "drizzle-orm/pg-core";

export const emailRateLimitAttemptsTable = pgTable(
  "email_rate_limit_attempts",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
  },
  (t) => [index("email_rl_attempts_ip_attempted_at_idx").on(t.ip, t.attemptedAt)],
);

export type EmailRateLimitAttempt = typeof emailRateLimitAttemptsTable.$inferSelect;
