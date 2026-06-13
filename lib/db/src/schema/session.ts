import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

export const sessionTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("idx_session_expire").on(table.expire)],
);

export type Session = typeof sessionTable.$inferSelect;
