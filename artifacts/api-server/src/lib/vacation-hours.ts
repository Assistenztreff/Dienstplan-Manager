// Stundenbewertung von Urlaubs-/Abwesenheitstagen (Point 7: Urlaub wird
// stundengenau geführt) — geteilt zwischen der Schichten-Route (Buchung beim
// Anlegen/Ändern von Abwesenheiten) und der Verträge-Route (Neuberechnung des
// Urlaubszählers nach jedem Vertrags-Speichern).

import { db } from "@workspace/db";
import { contractsTable, shiftsTable, timeTrackingTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { isPlainFullDay, averageDailyHours } from "./shift-metrics-resolve";
import { resolveAllowanceOps } from "./allowance-resolve";

// Globale db-Instanz ODER eine offene Drizzle-Transaktion.
type VacationDbx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Typische Dienstlänge einer Assistenzkraft: Wochenstunden ÷ Arbeitstage/Woche
// des Vertrags. Ohne (nutzbaren) Vertrag greift der übergebene Standardwert
// (Stunden je Urlaubstag der Konto-Einstellungen, Bestandsschutz-Default 8h).
export function typicalShiftHours(
  contract: { weeklyHours: number; workdaysPerWeek: number } | null,
  fallbackPerDay: number,
): number {
  if (contract && contract.weeklyHours > 0 && contract.workdaysPerWeek > 0) {
    return Math.round((contract.weeklyHours / contract.workdaysPerWeek) * 100) / 100;
  }
  return fallbackPerDay;
}

// Urlaubswochen aus dem Vollzeit-Anspruch (AP 2): "30 Tage Urlaub" im
// Arbeitsvertrag meint immer eine Vollzeitstelle — z. B. 30 / 5 = 6 Wochen.
export function vacationWeeks(vacationDays: number, fulltimeWorkdaysPerWeek: number): number {
  if (fulltimeWorkdaysPerWeek <= 0) return 0;
  return vacationDays / fulltimeWorkdaysPerWeek;
}

// 52 Wochen / 12 Monate * 12. Nur für Urlaubsrechnungen. Bewusst abweichend
// von WEEKS_PER_MONTH (4,35) im Arbeitstage-Rechner — nicht angleichen.
export const WEEKS_PER_YEAR = 51.96;

// Stunden-Faktor der Mehrarbeits-Aufbaukomponente (AP 4): je bezahlter Stunde
// über die Vertragsstunden des Jahres hinaus wächst der Urlaubsanspruch um
// diesen Faktor — hergeleitet aus dem Vollzeit-Anspruch (z. B. 30 Tage / 5
// Arbeitstage / 51,96 Wochen ≈ 0,1155 h Urlaub je bezahlter Stunde).
export function vacationFactorFor(vacationDays: number, fulltimeWorkdaysPerWeek: number): number {
  if (fulltimeWorkdaysPerWeek <= 0) return 0;
  const weeks = vacationWeeks(vacationDays, fulltimeWorkdaysPerWeek);
  return Math.round((weeks / WEEKS_PER_YEAR) * 10_000) / 10_000;
}

// Urlaubstopf einer Assistenzkraft in Stunden (AP 2 + AP 4): Sockel aus den
// Urlaubswochen (aus dem Vollzeit-Anspruch) mal den TATSÄCHLICHEN
// Wochenstunden der Person — ersetzt die alte Rechnung vacationDays ×
// globale Stunden/Tag, die Teilzeit systematisch benachteiligte.
//
// Mit optionalem paidHoursYear (AP 4) kommt ein Mehrarbeits-Aufbau hinzu: der
// Anspruch wächst über die Vertragsstunden des Jahres hinaus mit tatsächlich
// geleisteter (bezahlter) Arbeit. Der Sockel ist dabei eine Untergrenze —
// liegt paidHoursYear unter den Vertragsstunden, bleibt es beim Sockel. Ohne
// Übergabe verhält sich die Funktion exakt wie in AP 2.
export function vacationPoolHours(
  contract: { vacationDays: number; weeklyHours: number },
  ops: { fulltimeWorkdaysPerWeek: number },
  paidHoursYear?: number,
): number {
  if (ops.fulltimeWorkdaysPerWeek <= 0 || contract.weeklyHours <= 0) return 0;
  const weeks = vacationWeeks(contract.vacationDays, ops.fulltimeWorkdaysPerWeek);
  const sockel = weeks * contract.weeklyHours;
  if (paidHoursYear == null) return Math.round(sockel * 100) / 100;
  const factor = vacationFactorFor(contract.vacationDays, ops.fulltimeWorkdaysPerWeek);
  const aufbau = Math.max(0, (paidHoursYear - contract.weeklyHours * WEEKS_PER_YEAR) * factor);
  return Math.round((sockel + aufbau) * 100) / 100;
}

// Ein ganztägiger Urlaubstag (00:00–23:59, kein zugrundeliegender Dienst)
// verbraucht hoursPerDay (Standard 8h). Ersetzt der Urlaub einen konkret
// geplanten Dienst (echte Schichtzeiten — vom Primary-Lookup geerbt oder aus
// einem Schichtmodell abgeleitet), zählt dessen tatsächliche Dauer
// (ein 24h-Dienst = 24h = 3,0 Tage).
export function vacationHoursForShift(
  startTime: Date | string,
  endTime: Date | string,
  hoursPerDay: number
): number {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isPlainFullDay(start, end)) return hoursPerDay;
  const durationH = (end.getTime() - start.getTime()) / 3_600_000;
  return Math.round(durationH * 100) / 100;
}

// §11-BUrlG-Durchschnitt: mittlere Tages-Stunden der letzten 13 Wochen aus
// BESTÄTIGTEN Arbeits-IST-Zeiten (nur type "work", Abwesenheits-Buchungen
// ausgenommen, sonst zirkulär). Ohne Historie → null (Aufrufer nutzt Fallback).
// `dbx` erlaubt das Lesen innerhalb einer offenen Transaktion (gleiche Semantik
// wie bwavgDailyHoursForDates).
export async function bwavgDailyHours(
  userId: number,
  refDate: Date,
  dbx: VacationDbx = db
): Promise<number | null> {
  const end = new Date(refDate);
  const start = new Date(end.getTime() - 91 * 24 * 3_600_000); // 13 Wochen
  const startStr = start.toISOString();
  const endStr = end.toISOString();
  const [row] = await dbx
    .select({
      total: sql<number>`COALESCE(SUM(${timeTrackingTable.actualHours}), 0)`,
      days: sql<number>`COUNT(DISTINCT DATE(${timeTrackingTable.actualStart}))`,
    })
    .from(timeTrackingTable)
    .innerJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        eq(timeTrackingTable.status, "confirmed"),
        eq(shiftsTable.type, "work"),
        sql`${timeTrackingTable.actualStart} >= ${startStr}`,
        sql`${timeTrackingTable.actualStart} < ${endStr}`
      )
    );
  return averageDailyHours(Number(row?.total ?? 0), Number(row?.days ?? 0));
}

// Batch-Variante für Sammelaufträge: liefert den §11-BUrlG-Durchschnitt für
// MEHRERE Stichtage aus EINER Abfrage. Fachlich identisch zu bwavgDailyHours
// (rollierendes 13-Wochen-Fenster je Stichtag, gleiche Grenzen und Rundung) —
// nur ohne eine eigene Abfrage pro Kalendertag. Schlüssel der Rückgabe ist der
// ISO-Zeitstempel des jeweiligen Stichtags.
//
// `dbx` erlaubt das Lesen INNERHALB einer offenen Transaktion. Wichtig: Der
// Durchschnitt speist sich aus bestätigten Arbeitszeiten — ersetzt ein
// Sammelauftrag Dienste, MUSS dieser Read vor dem Löschen laufen, sonst fehlen
// die ersetzten Dienste im Fenster (der Einzelpfad rechnet ebenfalls vorher).
export async function bwavgDailyHoursForDates(
  userId: number,
  refDates: Date[],
  dbx: VacationDbx = db
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (refDates.length === 0) return result;

  const WINDOW_MS = 91 * 24 * 3_600_000; // 13 Wochen
  const refTimes = refDates.map((date) => date.getTime());
  const windowStart = new Date(Math.min(...refTimes) - WINDOW_MS);
  const windowEnd = new Date(Math.max(...refTimes));
  const rows = await dbx
    .select({
      actualStart: timeTrackingTable.actualStart,
      actualHours: timeTrackingTable.actualHours,
    })
    .from(timeTrackingTable)
    .innerJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        eq(timeTrackingTable.status, "confirmed"),
        eq(shiftsTable.type, "work"),
        sql`${timeTrackingTable.actualStart} >= ${windowStart.toISOString()}`,
        sql`${timeTrackingTable.actualStart} < ${windowEnd.toISOString()}`
      )
    );

  for (const refDate of refDates) {
    const end = refDate.getTime();
    const start = end - WINDOW_MS;
    let total = 0;
    const days = new Set<string>();
    for (const row of rows) {
      const startedAt = new Date(row.actualStart).getTime();
      if (startedAt < start || startedAt >= end) continue;
      total += row.actualHours ?? 0;
      days.add(new Date(row.actualStart).toISOString().split("T")[0]!);
    }
    result.set(refDate.toISOString(), averageDailyHours(total, days.size));
  }
  return result;
}

// Jahresprognose des Urlaubsanspruchs (AP 4): Sockel + Mehrarbeits-Aufbau, der
// Aufbau-Anteil hochgerechnet aus dem §11-BUrlG-Durchschnitt der letzten 13
// Wochen (dieselbe Datenquelle wie bwavgDailyHours, aber als Wochen- statt
// Tages-Durchschnitt — ohne Division durch die Anzahl gearbeiteter Tage).
// Ohne Historie fällt die Prognose auf die Vertragsstunden zurück (entspricht
// dann dem heutigen Sockel + Aufbau bei genau Vertragsstunden geleisteter
// Arbeit, also Sockel).
export async function vacationForecastHours(
  userId: number,
  teamId: number,
  contract: { vacationDays: number; weeklyHours: number },
  ops: { fulltimeWorkdaysPerWeek: number },
  refDate: Date,
  dbx: VacationDbx = db
): Promise<{ sockel: number; aufbau: number; prognose: number; avgWeeklyHours: number | null }> {
  const end = new Date(refDate);
  const start = new Date(end.getTime() - 91 * 24 * 3_600_000); // 13 Wochen
  const [row] = await dbx
    .select({
      total: sql<number>`COALESCE(SUM(${timeTrackingTable.actualHours}), 0)`,
      days: sql<number>`COUNT(DISTINCT DATE(${timeTrackingTable.actualStart}))`,
    })
    .from(timeTrackingTable)
    .innerJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        eq(timeTrackingTable.teamId, teamId),
        eq(timeTrackingTable.status, "confirmed"),
        eq(shiftsTable.type, "work"),
        sql`${timeTrackingTable.actualStart} >= ${start.toISOString()}`,
        sql`${timeTrackingTable.actualStart} < ${end.toISOString()}`
      )
    );
  const workedDays = Number(row?.days ?? 0);
  const avgWeeklyHours =
    workedDays > 0 ? Math.round((Number(row?.total ?? 0) / 13) * 100) / 100 : null;
  const paidHoursYear = (avgWeeklyHours ?? contract.weeklyHours) * WEEKS_PER_YEAR;
  const sockel = vacationPoolHours(contract, ops);
  const prognose = vacationPoolHours(contract, ops, paidHoursYear);
  const aufbau = Math.round((prognose - sockel) * 100) / 100;
  return { sockel, aufbau, prognose, avgWeeklyHours };
}

// Aktiver Vertrag des Nutzers IM TEAM der Schicht zum Stichtag (jüngster
// Beginn gewinnt). Team-gescoped, damit kein Vertrag eines fremden Teams die
// Urlaubsbewertung hier beeinflusst (Team-Scoping-Invariante).
async function activeTeamContractFor(
  userId: number,
  teamId: number,
  date: Date,
  dbx: VacationDbx = db
): Promise<{ weeklyHours: number; workdaysPerWeek: number; startDate: string } | null> {
  const dateStr = date.toISOString().split("T")[0]!;
  const [contract] = await dbx
    .select({
      weeklyHours: contractsTable.weeklyHours,
      workdaysPerWeek: contractsTable.workdaysPerWeek,
      startDate: contractsTable.startDate,
    })
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.userId, userId),
        eq(contractsTable.teamId, teamId),
        sql`${contractsTable.startDate} <= ${dateStr}`,
        sql`(${contractsTable.endDate} IS NULL OR ${contractsTable.endDate} >= ${dateStr})`
      )
    )
    .orderBy(sql`${contractsTable.startDate} DESC`)
    .limit(1);
  return contract ?? null;
}

// Liegt der Vertragsbeginn mindestens 13 Wochen (91 Tage) vor dem Stichtag?
// Erst dann kann das 13-Wochen-Fenster überhaupt vollständig gefüllt sein.
// Grenzfall exakt 91 Tage zählt bereits als "erfüllt" (>=), identisch zum
// Sammelauftrags-Pfad (isContractOlderThan13Weeks in routes/shifts.ts).
function contractOlderThan13Weeks(startDate: string, refDate: Date): boolean {
  const start = new Date(`${startDate}T00:00:00Z`);
  return refDate.getTime() - start.getTime() >= 91 * 24 * 3_600_000;
}

// Effektive Tages-Stunden einer GANZTÄGIGEN Abwesenheit (kein zugrundeliegender
// Dienst), abhängig von der aktiven Urlaubsmethode des Team-Eigentümers:
//   bwavg  → Kette:
//            1. Vertragsbeginn ≥ 13 Wochen vor dem Stichtag UND bestätigte
//               Arbeits-IST-Historie im Fenster → §11-BUrlG-Durchschnitt.
//            2. Sonst, aktiver team-gescopter Vertrag mit Wochenstunden und
//               Arbeitstagen → Wochenstunden ÷ Arbeitstage pro Woche.
//            3. Sonst → übergebener Standardwert („Stunden pro Urlaubstag");
//               ganz ohne Vertrag zählt eine vorhandene Historie weiter wie
//               bisher (Bestandsschutz).
//   factor → immer Vertrag/Standard (kein 13-Wochen-Schnitt).
// Ersetzt die Abwesenheit einen konkreten Dienst (echte Zeiten), zählt immer
// dessen tatsächliche Dauer — unabhängig von der Methode.
export async function absenceHoursFor(
  userId: number,
  teamId: number | null,
  startTime: Date | string,
  endTime: Date | string,
  fallbackPerDay: number,
  dbx: VacationDbx = db
): Promise<number> {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!isPlainFullDay(start, end)) {
    return vacationHoursForShift(start, end, fallbackPerDay);
  }
  const info = await resolveDailyRateInfo(userId, teamId, start, fallbackPerDay, dbx);
  return vacationHoursForShift(start, end, info.dailyHours);
}

// Löst die Tages-Stunden-Kette (bwavg → Vertrag → Standard) für einen Stichtag
// auf und benennt zusätzlich die verwendete Quelle — damit die UI anzeigen
// kann, WENN ein Urlaubstag aus Vertragsdaten (statt 13-Wochen-Schnitt)
// bewertet wurde, inkl. der verwendeten Arbeitstage/Woche (Datenpflege-Hinweis:
// Bestandsverträge stehen nach der Migration oft pauschal auf 5).
export type DailyRateSource = "bwavg" | "contract" | "default";
export interface DailyRateInfo {
  dailyHours: number;
  source: DailyRateSource;
  // Vertragsdaten, sofern ein aktiver team-gescopter Vertrag existiert
  // (unabhängig davon, ob er die Quelle war — die UI zeigt die Werte im
  // Hinweis an).
  workdaysPerWeek: number | null;
  weeklyHours: number | null;
}

export async function resolveDailyRateInfo(
  userId: number,
  teamId: number | null,
  refDate: Date,
  fallbackPerDay: number,
  dbx: VacationDbx = db
): Promise<DailyRateInfo> {
  const ops = await resolveAllowanceOps(teamId, dbx);
  const contract =
    teamId != null ? await activeTeamContractFor(userId, teamId, refDate, dbx) : null;
  const info: DailyRateInfo = {
    dailyHours: fallbackPerDay,
    source: "default",
    workdaysPerWeek: contract?.workdaysPerWeek ?? null,
    weeklyHours: contract?.weeklyHours ?? null,
  };
  if (ops.vacationMethod !== "bwavg") {
    if (contract && contract.weeklyHours > 0 && contract.workdaysPerWeek > 0) {
      info.dailyHours = typicalShiftHours(contract, fallbackPerDay);
      info.source = "contract";
    }
    return info;
  }
  if (contract) {
    const avg = contractOlderThan13Weeks(contract.startDate, refDate)
      ? await bwavgDailyHours(userId, refDate, dbx)
      : null;
    if (avg != null) {
      info.dailyHours = avg;
      info.source = "bwavg";
    } else if (contract.weeklyHours > 0 && contract.workdaysPerWeek > 0) {
      info.dailyHours = typicalShiftHours(contract, fallbackPerDay);
      info.source = "contract";
    }
  } else {
    // Ohne Vertrag: bisheriges Verhalten (Schnitt, falls Historie; sonst
    // Standardwert) — kein Verhaltensbruch für vertragslose Nutzer.
    const avg = await bwavgDailyHours(userId, refDate, dbx);
    if (avg != null) {
      info.dailyHours = avg;
      info.source = "bwavg";
    }
  }
  return info;
}

// Löst die Urlaubs-Stunden eines Abwesenheits-Datums über die Einstellungen des
// Team-Eigentümers (Fallback-Kette) auf.
export async function resolveVacationHours(
  userId: number,
  teamId: number | null,
  startTime: Date | string,
  endTime: Date | string,
  dbx: VacationDbx = db
): Promise<number> {
  const ops = await resolveAllowanceOps(teamId, dbx);
  return absenceHoursFor(userId, teamId, startTime, endTime, ops.vacationHoursPerDay, dbx);
}

// Berechnet den Urlaubszähler (vacationHoursUsed) eines Vertrags komplett neu
// aus den tatsächlich vorhandenen Urlaubs-Schichten: Summe der Urlaubsstunden
// aller Urlaubs-Schichten des Nutzers IM TEAM DES VERTRAGS, deren Datum
// (Start- UND End-Tag) im Vertragszeitraum liegt. Gleiche Stundenlogik wie beim
// Anlegen (ersetzter Dienst → dessen Dauer, sonst Stunden/Tag bzw. bwavg).
// Die Urlaubs-Schichten selbst werden dabei NIE verändert — nur der Zähler.
// Repariert damit auch historisch nie verbuchte Alt-Urlaube beim nächsten
// Speichern des Vertrags.
export async function recalcVacationHoursUsed(contract: {
  id: number;
  userId: number;
  teamId: number;
  startDate: string;
  endDate: string | null;
}): Promise<number> {
  const vacations = await db
    .select({
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
    })
    .from(shiftsTable)
    .where(
      and(
        eq(shiftsTable.userId, contract.userId),
        eq(shiftsTable.teamId, contract.teamId),
        eq(shiftsTable.type, "vacation")
      )
    );

  let total = 0;
  for (const v of vacations) {
    const startDay = new Date(v.startTime).toISOString().split("T")[0]!;
    // End-Tag über den letzten enthaltenen Moment (Ende 00:00 des Folgetags
    // zählt nicht als zusätzlicher Urlaubstag) — konsistent zum Vertrags-Guard.
    const endDay = new Date(new Date(v.endTime).getTime() - 1)
      .toISOString()
      .split("T")[0]!;
    const inRange =
      contract.startDate <= startDay &&
      (contract.endDate == null || contract.endDate >= endDay);
    if (!inRange) continue;
    total += await resolveVacationHours(
      contract.userId,
      contract.teamId,
      v.startTime,
      v.endTime
    );
  }

  const rounded = Math.round(total * 100) / 100;
  await db
    .update(contractsTable)
    .set({ vacationHoursUsed: rounded })
    .where(eq(contractsTable.id, contract.id));
  return rounded;
}
