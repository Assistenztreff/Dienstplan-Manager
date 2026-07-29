// ---------------------------------------------------------------------------
// Registrierungsversuche pro IP (Rate-Limit der oeffentlichen Registrierung).
// ---------------------------------------------------------------------------
// Der Sliding-Window-Zaehler des Registrierungs-Rate-Limits (Task #553) lag
// urspruenglich im Arbeitsspeicher EINES API-Prozesses. Das Deployment-Target
// ist aber Autoscale — es koennen mehrere Instanzen parallel laufen, und jede
// haette dann separat gezaehlt (Bremse wird durchlaessiger). Deshalb wandert
// der Zaehler in die gemeinsame DB (Task #600): eine Zeile pro Versuch,
// gezaehlt wird per Fenster-Abfrage. Alte Zeilen ausserhalb des Fensters
// werden bei jedem Versuch mit geloescht (die Tabelle bleibt winzig — es geht
// um wenige Registrierungen, nicht um High-Traffic-Endpunkte).
// ---------------------------------------------------------------------------

import { pgTable, serial, timestamp, text, index } from "drizzle-orm/pg-core";

export const registerAttemptsTable = pgTable(
  "register_attempts",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
  },
  (t) => [index("register_attempts_ip_attempted_at_idx").on(t.ip, t.attemptedAt)],
);

export type RegisterAttempt = typeof registerAttemptsTable.$inferSelect;
