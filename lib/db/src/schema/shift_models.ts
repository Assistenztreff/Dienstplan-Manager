import { pgTable, serial, integer, text, boolean, date, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

// Vergütungstyp eines Dienstes (betrifft die GELD-Berechnung, nicht die
// Stunden-Zählung — dafür ist valuationPercent zuständig):
//   regular    = regulärer Stundenlohn (100% des Basis-Stundenlohns)
//   percentage = prozentualer Stundenlohn (compensationPercent % des Basislohns
//                für die Dauer der Schicht, z. B. Bereitschaft 50%)
//   flat       = Festbetrag pro Schicht (compensationFlatCents, dauerunabhängig)
export const compensationTypeEnum = pgEnum("compensation_type", ["regular", "percentage", "flat"]);

export const shiftModelsTable = pgTable("shift_models", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id),
  name: text("name").notNull(),
  valuationPercent: integer("valuation_percent").notNull().default(100),
  color: text("color").notNull().default("slate"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Standard-Start-/Endzeit im Format "HH:MM"; füllt beim Auswählen des Dienstes
  // im Kalender die Zeiten vor (überschreibbar). Gleicher Start = Ende ⇒ 24h-Dienst.
  defaultStartTime: text("default_start_time").notNull().default("08:00"),
  defaultEndTime: text("default_end_time").notNull().default("16:00"),
  // Standard-Wochentage als Zahlen 1 (Montag) bis 7 (Sonntag).
  defaultWeekdays: integer("default_weekdays").array().notNull().default([1, 2, 3, 4, 5]),
  // Vergütung (Geld). compensationPercent nur bei "percentage", compensationFlatCents
  // (Cent, dauerunabhängig) nur bei "flat" gesetzt.
  compensationType: compensationTypeEnum("compensation_type").notNull().default("regular"),
  compensationPercent: integer("compensation_percent"),
  compensationFlatCents: integer("compensation_flat_cents"),
  // ── Dienstgerüst (Kay-Entscheidung 01.09.2026) ────────────────────────────
  // Gehört dieser Dienst zum REGELPLAN? Dann zeichnet das Monatsraster an
  // jedem passenden Tag einen offenen Platz — ohne dafür eine Zeile anzulegen.
  // Das Gerüst wird ausschliesslich BERECHNET (Wochentag + gültig-ab), es gibt
  // keine Platzhalter-Datensätze. Für PDF-Export, Stundenliste, Auswertung und
  // Zeitkonto existiert ein offener Platz deshalb gar nicht; sie lesen weiter
  // nur echte Schichten.
  //
  // Standard FALSE = Bestandsschutz: Bestandsteams sehen nach dem Update
  // exakt dasselbe wie vorher, bis jemand den Schalter bewusst umlegt.
  //
  // Bewusst ein JA/NEIN statt eines Zählers: Die Zahl der Plätze pro Tag ergibt
  // sich aus der Zahl der Dienste im Regelplan (1×24h = ein Platz, 3×8h = drei),
  // nicht aus einer Menge am einzelnen Dienst.
  imRegelplan: boolean("im_regelplan").notNull().default(false),
  // Ab wann gilt die Regel? NULL = seit jeher. Vor diesem Datum zeichnet das
  // Raster keinen Platz — damit lässt sich ein neuer Regeldienst einführen,
  // ohne rückwirkend Lücken in bereits abgeschlossene Monate zu reissen.
  validFrom: date("valid_from"),
  // Sieht dieser Dienst eine vorgemerkte Vertretung vor? Dann erscheint unter
  // der besetzten Dienstpille eine flachere Vertretungspille. Sie hängt an
  // shifts.standby_user_id und kann es deshalb erst geben, wenn die Assistenz
  // steht — vorher gibt es die Zeile schlicht nicht.
  standbySlot: boolean("standby_slot").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShiftModelSchema = createInsertSchema(shiftModelsTable).omit({ id: true, createdAt: true });
export type InsertShiftModel = z.infer<typeof insertShiftModelSchema>;
export type ShiftModel = typeof shiftModelsTable.$inferSelect;
