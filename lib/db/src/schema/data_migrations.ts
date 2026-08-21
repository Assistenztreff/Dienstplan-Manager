import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Marker-Tabelle für Daten-Migrationen, die GENAU EINMAL pro Datenbank laufen
// dürfen (nicht bei jedem Deploy erneut) — z. B. weil ihre WHERE-Bedingung
// sich nicht sauber von einem später legitim entstehenden, gleich
// aussehenden Zustand unterscheiden lässt (s. backfill-partial-absence-flag.ts:
// eine Wiederholung nach dem ersten Rollout würde frisch angelegte,
// bewusst ganztägige Abwesenheiten mit geerbten Uhrzeiten erneut
// fälschlich als Teil-Tag umklassifizieren).
//
// WICHTIG: analog zur `session`-Tabelle (connect-pg-simple) MUSS diese
// Tabelle im Drizzle-Schema stehen, sonst hält `db push` sie für eine
// verwaiste Tabelle und schlägt vor, sie zu löschen.
//
// Nutzung: `INSERT INTO data_migrations (name) VALUES ($1) ON CONFLICT DO
// NOTHING RETURNING name` — nur bei tatsächlichem Insert (kein Konflikt)
// ausführen, sonst überspringen (bereits einmalig angewendet).
export const dataMigrationsTable = pgTable("data_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
});

export type DataMigration = typeof dataMigrationsTable.$inferSelect;
