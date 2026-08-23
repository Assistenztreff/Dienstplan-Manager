import { bigint, integer, pgTable } from "drizzle-orm/pg-core";

/**
 * Gemeinsame Generation für den prozesslokalen Stundenbilanz-Cache.
 *
 * Genau eine Zeile (id=1) wird von der API nach erfolgreichen, fachlich
 * relevanten Schreibzugriffen atomar hochgezählt. So erkennen alle
 * API-Instanzen beim nächsten Read, dass ihre lokale Kopie veraltet ist.
 */
export const hoursBalanceCacheVersionsTable = pgTable(
  "hours_balance_cache_versions",
  {
    id: integer("id").primaryKey().default(1),
    version: bigint("version", { mode: "number" }).notNull().default(0),
  },
);

export type HoursBalanceCacheVersion =
  typeof hoursBalanceCacheVersionsTable.$inferSelect;