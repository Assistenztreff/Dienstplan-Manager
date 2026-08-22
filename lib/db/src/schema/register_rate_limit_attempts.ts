// ---------------------------------------------------------------------------
// Registrierungs-Rate-Limit-Versuche pro IP.
// ---------------------------------------------------------------------------
// Sliding-Window-Zaehler fuer POST /auth/register (Task #600). Eine Zeile
// pro Versuch, gezaehlt per Fenster-Abfrage, alte Zeilen werden beim
// naechsten Versuch bereinigt. Autoscale-sicher (gemeinsame DB).
//
// Wichtig: diese Tabelle wurde ursprünglich nur per Raw-SQL in index.ts
// (ensureRequiredTables) angelegt, ohne im Drizzle-Schema deklariert zu
// sein — dadurch wollte `drizzle-kit push` sie bei jedem Prod-Sync als
// "nicht im Schema" DROPpen (Task #842, Publish-Probelauf). Tabellen- und
// Indexname müssen exakt mit index.ts übereinstimmen.
// ---------------------------------------------------------------------------

import { pgTable, serial, timestamp, text, index } from "drizzle-orm/pg-core";

export const registerRateLimitAttemptsTable = pgTable(
  "register_rate_limit_attempts",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
  },
  (t) => [index("register_rl_attempts_ip_attempted_at_idx").on(t.ip, t.attemptedAt)],
);

export type RegisterRateLimitAttempt = typeof registerRateLimitAttemptsTable.$inferSelect;
