// ---------------------------------------------------------------------------
// Audit-Log fuer manuelle Plan-Umschaltungen (Operator-Dashboard).
// ---------------------------------------------------------------------------
// Jeder Plan-Flip (PATCH /api/operator/accounts/:id/plan) schreibt hier eine
// Zeile: welches Konto, alter/neuer Plan, welcher superadmin, wann. Damit ist
// bei Zahlungs-/Kundenstreitigkeiten belegbar, wann ein Konto auf Premium
// bzw. zurueck auf Free gestellt wurde. Eintraege werden NIE geaendert oder
// geloescht (Append-only-Historie).
//
// Indizes (#383):
//   - account_id   → Filtern nach Konto (häufigster WHERE-Anker)
//   - changed_by   → JOIN auf den ausfuehrenden Superadmin
//   - created_at   → ORDER BY + Datumsbereichs-Filter
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, text, index } from "drizzle-orm/pg-core";
import { usersTable, planEnum } from "./users";

export const planChangesTable = pgTable(
  "plan_changes",
  {
    id: serial("id").primaryKey(),
    // Betroffenes Admin-Konto
    accountId: integer("account_id")
      .notNull()
      .references(() => usersTable.id),
    oldPlan: planEnum("old_plan").notNull(),
    newPlan: planEnum("new_plan").notNull(),
    // Optionale Rechnungs-/Zahlungsreferenz (z. B. Lexware-Belegnummer) oder
    // Notiz zum Grund des Flips — dokumentiert Zahlungs-Streitfaelle vollstaendig.
    note: text("note"),
    // Ausfuehrender superadmin
    changedBy: integer("changed_by")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("plan_changes_account_id_idx").on(t.accountId),
    index("plan_changes_changed_by_idx").on(t.changedBy),
    index("plan_changes_created_at_idx").on(t.createdAt),
  ],
);

export type PlanChange = typeof planChangesTable.$inferSelect;
