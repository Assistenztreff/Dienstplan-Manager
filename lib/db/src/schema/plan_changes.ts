// ---------------------------------------------------------------------------
// Audit-Log fuer manuelle Plan-Umschaltungen (Operator-Dashboard).
// ---------------------------------------------------------------------------
// Jeder Plan-Flip (PATCH /api/operator/accounts/:id/plan) schreibt hier eine
// Zeile: welches Konto, alter/neuer Plan, welcher superadmin, wann. Damit ist
// bei Zahlungs-/Kundenstreitigkeiten belegbar, wann ein Konto auf Premium
// bzw. zurueck auf Free gestellt wurde. Eintraege werden NIE geaendert oder
// geloescht (Append-only-Historie).
// ---------------------------------------------------------------------------

import { pgTable, serial, integer, timestamp, text, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  // Trigram-GIN-Index auf note: haelt die ILIKE-Volltextsuche der Betreiber
  // (Operator-Dashboard, "%begriff%") auch bei stark wachsendem Audit-Log
  // schnell. Setzt die Extension pg_trgm voraus (wird in post-merge.sh VOR
  // db push idempotent angelegt).
  (table) => [
    index("plan_changes_note_trgm_idx").using(
      "gin",
      sql`${table.note} gin_trgm_ops`,
    ),
  ],
);

export type PlanChange = typeof planChangesTable.$inferSelect;
