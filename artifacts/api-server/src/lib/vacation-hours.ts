// Stundenbewertung von Urlaubs-/Abwesenheitstagen (Point 7: Urlaub wird
// stundengenau geführt) — geteilt zwischen der Schichten-Route (Buchung beim
// Anlegen/Ändern von Abwesenheiten) und der Verträge-Route (Neuberechnung des
// Urlaubszählers nach jedem Vertrags-Speichern).

import { db } from "@workspace/db";
import { contractsTable, shiftsTable, timeTrackingTable, isGermanHoliday, type GermanState } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { isPlainFullDay, averageDailyHours } from "./shift-metrics-resolve";
import { resolveAllowanceOps, type ResolvedAllowanceOps } from "./allowance-resolve";

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

const DAY_MS = 24 * 60 * 60 * 1_000;

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nextUtcDay(date: Date): Date {
  return new Date(utcDayStart(date).getTime() + DAY_MS);
}

function contractStartInstant(startDate: string): Date {
  return new Date(`${startDate}T00:00:00.000Z`);
}

function contractEndExclusive(endDate: string | null | undefined): Date | null {
  return endDate ? new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + DAY_MS) : null;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthlyActualHoursWithinContract(
  entries: ReadonlyArray<{ day: string; actualHours: number }>,
  contract: { startDate: string; endDate?: string | null },
): Map<string, number> {
  const monthly = new Map<string, number>();
  for (const entry of entries) {
    if (
      entry.day < contract.startDate ||
      (contract.endDate != null && entry.day > contract.endDate)
    ) {
      continue;
    }
    const key = entry.day.slice(0, 7);
    monthly.set(key, (monthly.get(key) ?? 0) + entry.actualHours);
  }
  return monthly;
}

/**
 * Tatsächliche Mehrarbeit eines Zeitraums, monatlich abgerechnet.
 *
 * Jeder Kalendermonat wird separat gegen das zeitanteilige Vertragssoll
 * gestellt. Dadurch erzeugen nur bestätigte Stunden oberhalb des Solls
 * zusätzliches Urlaubsguthaben; Minderstunden senken den garantierten Sockel
 * nie. Der Aufrufer begrenzt den Zeitraum bereits auf Vertrag und Kalenderjahr.
 */
export function monthlyOvertimeHours(
  weeklyHours: number,
  activeStart: Date,
  activeEndExclusive: Date,
  actualHoursByMonth: ReadonlyMap<string, number>,
): number {
  if (weeklyHours <= 0 || activeEndExclusive <= activeStart) return 0;

  let overtime = 0;
  let cursor = new Date(Date.UTC(activeStart.getUTCFullYear(), activeStart.getUTCMonth(), 1));
  while (cursor < activeEndExclusive) {
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const overlapStart = new Date(Math.max(cursor.getTime(), activeStart.getTime()));
    const overlapEnd = new Date(Math.min(nextMonth.getTime(), activeEndExclusive.getTime()));
    if (overlapEnd > overlapStart) {
      const daysInMonth = (nextMonth.getTime() - cursor.getTime()) / DAY_MS;
      const activeDays = (overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS;
      const monthlyTarget = weeklyHours * (WEEKS_PER_YEAR / 12) * (activeDays / daysInMonth);
      const actual = actualHoursByMonth.get(monthKey(cursor)) ?? 0;
      overtime += Math.max(0, actual - monthlyTarget);
    }
    cursor = nextMonth;
  }
  return Math.round(overtime * 100) / 100;
}

function currentYearContractWindow(
  contract: { startDate: string; endDate?: string | null },
  refDate: Date,
): { start: Date; endExclusive: Date } | null {
  const yearStart = new Date(Date.UTC(refDate.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(refDate.getUTCFullYear() + 1, 0, 1));
  const start = new Date(Math.max(yearStart.getTime(), contractStartInstant(contract.startDate).getTime()));
  const endByContract = contractEndExclusive(contract.endDate);
  const endExclusive = new Date(
    Math.min(
      yearEnd.getTime(),
      nextUtcDay(refDate).getTime(),
      endByContract?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  );
  return endExclusive > start ? { start, endExclusive } : null;
}

async function earnedVacationFromMonthlyOvertime(
  userId: number,
  teamId: number,
  contract: {
    vacationDays: number;
    weeklyHours: number;
    startDate: string;
    endDate?: string | null;
  },
  ops: { fulltimeWorkdaysPerWeek: number },
  refDate: Date,
  dbx: VacationDbx,
): Promise<{ overtimeHours: number; vacationHours: number }> {
  const window = currentYearContractWindow(contract, refDate);
  if (!window) return { overtimeHours: 0, vacationHours: 0 };

  const monthExpr = sql<string>`TO_CHAR(DATE_TRUNC('month', ${timeTrackingTable.actualStart} AT TIME ZONE 'UTC'), 'YYYY-MM')`;
  const rows = await dbx
    .select({
      month: monthExpr,
      actualHours: sql<number>`COALESCE(SUM(${timeTrackingTable.actualHours}), 0)`,
    })
    .from(timeTrackingTable)
    .innerJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
    .where(
      and(
        eq(timeTrackingTable.userId, userId),
        eq(timeTrackingTable.teamId, teamId),
        eq(timeTrackingTable.status, "confirmed"),
        eq(shiftsTable.type, "work"),
        sql`${timeTrackingTable.actualStart} >= ${window.start.toISOString()}`,
        sql`${timeTrackingTable.actualStart} < ${window.endExclusive.toISOString()}`,
      ),
    )
    .groupBy(monthExpr);

  const actualByMonth = new Map(
    rows.map((row) => [row.month, Number(row.actualHours ?? 0)] as const),
  );
  return earnedVacationHoursFromMonthlyTotals(contract, ops, refDate, actualByMonth);
}

export function earnedVacationHoursFromMonthlyTotals(
  contract: {
    vacationDays: number;
    weeklyHours: number;
    startDate: string;
    endDate?: string | null;
  },
  ops: { fulltimeWorkdaysPerWeek: number },
  refDate: Date,
  actualByMonth: ReadonlyMap<string, number>,
): { overtimeHours: number; vacationHours: number } {
  const window = currentYearContractWindow(contract, refDate);
  if (!window) return { overtimeHours: 0, vacationHours: 0 };
  const overtimeHours = monthlyOvertimeHours(
    contract.weeklyHours,
    window.start,
    window.endExclusive,
    actualByMonth,
  );
  const factor = vacationFactorFor(contract.vacationDays, ops.fulltimeWorkdaysPerWeek);
  return {
    overtimeHours,
    vacationHours: Math.round(overtimeHours * factor * 100) / 100,
  };
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
  contract: {
    vacationDays: number;
    weeklyHours: number;
    startDate: string;
    endDate?: string | null;
  },
  ops: { fulltimeWorkdaysPerWeek: number },
  earnedVacationHours: number,
  refDate: Date,
  dbx: VacationDbx = db
): Promise<{
  sockel: number;
  aufbau: number;
  prognose: number | null;
  avgWeeklyHours: number | null;
}> {
  const end = new Date(refDate);
  const start = new Date(end.getTime() - 91 * 24 * 3_600_000); // 13 Wochen
  const sockel = vacationPoolHours(contract, ops);
  if (end.getTime() - contractStartInstant(contract.startDate).getTime() < 91 * DAY_MS) {
    return { sockel, aufbau: earnedVacationHours, prognose: null, avgWeeklyHours: null };
  }
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
  if (avgWeeklyHours == null) {
    return { sockel, aufbau: earnedVacationHours, prognose: null, avgWeeklyHours: null };
  }

  const yearEnd = new Date(Date.UTC(refDate.getUTCFullYear() + 1, 0, 1));
  const endByContract = contractEndExclusive(contract.endDate);
  const projectionEnd = new Date(
    Math.min(yearEnd.getTime(), endByContract?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  const projectionStart = nextUtcDay(refDate);
  const remainingWeeks = Math.max(
    0,
    (projectionEnd.getTime() - projectionStart.getTime()) / (7 * DAY_MS),
  );
  const projectedOvertime = Math.max(0, avgWeeklyHours - contract.weeklyHours) * remainingWeeks;
  const factor = vacationFactorFor(contract.vacationDays, ops.fulltimeWorkdaysPerWeek);
  const projectedVacationHours = Math.round(projectedOvertime * factor * 100) / 100;
  const prognose = Math.round((sockel + earnedVacationHours + projectedVacationHours) * 100) / 100;
  return { sockel, aufbau: earnedVacationHours, prognose, avgWeeklyHours };
}

// Vollständige Resturlaub-Bilanz EINES Vertrags (inkl. Ersatzruhetag-Konto und
// Jahresprognose) — geteilt zwischen der Einzel-Route (GET
// /contracts/:id/vacation-balance) und der Batch-Route (GET
// /vacation-balances?teamId=), damit beide exakt dieselbe Rechnung liefern.
// `ops` wird vom Aufrufer übergeben (nicht hier aufgelöst), damit die
// Batch-Route sie einmal pro Team statt einmal pro Vertrag lädt.
export interface VacationBalanceResult {
  contractId: number;
  userId: number;
  vacationDays: number;
  vacationDaysUsed: number;
  vacationDaysRemaining: number;
  vacationHoursTotal: number;
  vacationHoursUsed: number;
  vacationHoursRemaining: number;
  hoursPerDay: number;
  method: ResolvedAllowanceOps["vacationMethod"];
  restDaysEarned: number;
  restDaysRedeemed: number;
  restDaysBalance: number;
  ersatzruhetagEnabled: boolean;
  dailyHoursSource: DailyRateSource;
  dailyHours: number;
  contractWorkdaysPerWeek: number | null;
  contractWeeklyHours: number | null;
  vacationSockelHours: number;
  vacationAufbauHours: number;
  vacationForecastHours: number | null;
  vacationForecastEnabled: boolean;
  avgWeeklyHours: number | null;
}

export async function computeVacationBalanceForContract(
  contract: {
    id: number;
    userId: number;
    teamId: number;
    vacationDays: number;
    vacationHoursUsed: number;
    weeklyHours: number;
    workdaysPerWeek: number;
    startDate: string;
    endDate?: string | null;
  },
  ops: ResolvedAllowanceOps,
  dbx: VacationDbx = db
): Promise<VacationBalanceResult> {
  const hoursPerDay = typicalShiftHours(contract, ops.vacationHoursPerDay);
  const sockel = vacationPoolHours(contract, ops);
  const earned = await earnedVacationFromMonthlyOvertime(
    contract.userId,
    contract.teamId,
    contract,
    ops,
    new Date(),
    dbx,
  );
  const vacationHoursTotal = Math.round((sockel + earned.vacationHours) * 100) / 100;
  const vacationHoursUsed = Math.round(contract.vacationHoursUsed * 100) / 100;
  const vacationHoursRemaining = Math.round((vacationHoursTotal - vacationHoursUsed) * 100) / 100;
  const daysUsed = Math.round((vacationHoursUsed / hoursPerDay) * 10) / 10;

  // Ersatzruhetag-Konto (§ 11 Abs. 3 ArbZG): siehe Einzel-Route für die
  // ausführliche Begründung — Logik 1:1 übernommen.
  const restState = (ops.state as GermanState | null) ?? null;
  const workedHolidayDates = await dbx
    .selectDistinct({
      day: sql<string>`TO_CHAR(${timeTrackingTable.actualStart} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    })
    .from(timeTrackingTable)
    .innerJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
    .where(
      and(
        eq(timeTrackingTable.userId, contract.userId),
        eq(shiftsTable.teamId, contract.teamId),
        eq(timeTrackingTable.status, "confirmed"),
        eq(shiftsTable.type, "work")
      )
    );
  const restDaysEarned = ops.ersatzruhetagEnabled
    ? workedHolidayDates.filter((r) => {
        const holidayDate = new Date(`${r.day}T12:00:00Z`);
        return holidayDate.getUTCDay() !== 0 && isGermanHoliday(holidayDate, restState);
      }).length
    : 0;
  const [redeemedRow] = await dbx
    .select({ count: sql<number>`COUNT(*)` })
    .from(shiftsTable)
    .where(
      and(
        eq(shiftsTable.userId, contract.userId),
        eq(shiftsTable.teamId, contract.teamId),
        eq(shiftsTable.type, "freizeitausgleich")
      )
    );
  const restDaysRedeemed = Number(redeemedRow?.count ?? 0);
  const restDaysBalance = restDaysEarned - restDaysRedeemed;

  const rateInfo = await resolveDailyRateInfo(
    contract.userId,
    contract.teamId,
    new Date(),
    hoursPerDay,
    dbx,
    ops
  );
  const forecast = ops.vacationForecastEnabled
    ? await vacationForecastHours(
        contract.userId,
        contract.teamId,
        contract,
        ops,
        earned.vacationHours,
        new Date(),
        dbx,
      )
    : {
        sockel,
        aufbau: earned.vacationHours,
        prognose: null,
        avgWeeklyHours: null,
      };

  return {
    contractId: contract.id,
    userId: contract.userId,
    vacationDays: Math.round((vacationHoursTotal / hoursPerDay) * 10) / 10,
    vacationDaysUsed: daysUsed,
    vacationDaysRemaining: Math.round((vacationHoursRemaining / hoursPerDay) * 10) / 10,
    vacationHoursTotal,
    vacationHoursUsed,
    vacationHoursRemaining,
    hoursPerDay,
    method: ops.vacationMethod,
    restDaysEarned,
    restDaysRedeemed,
    restDaysBalance,
    ersatzruhetagEnabled: ops.ersatzruhetagEnabled,
    dailyHoursSource: rateInfo.source,
    dailyHours: Math.round(rateInfo.dailyHours * 100) / 100,
    contractWorkdaysPerWeek: rateInfo.workdaysPerWeek,
    contractWeeklyHours: rateInfo.weeklyHours,
    vacationSockelHours: forecast.sockel,
    vacationAufbauHours: forecast.aufbau,
    vacationForecastHours: forecast.prognose,
    vacationForecastEnabled: ops.vacationForecastEnabled,
    avgWeeklyHours: forecast.avgWeeklyHours,
  };
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
export type DailyRateSource = "contract" | "default";
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
  dbx: VacationDbx = db,
  // Optionaler, bereits aufgelöster ops-Wert (Batch-Route: einmal pro Team
  // statt einmal pro Vertrag laden) — ohne Übergabe unverändertes Verhalten
  // (löst selbst auf, z. B. für die Einzelaufrufe in absenceHoursFor).
  _resolvedOps?: ResolvedAllowanceOps
): Promise<DailyRateInfo> {
  const contract =
    teamId != null ? await activeTeamContractFor(userId, teamId, refDate, dbx) : null;
  const info: DailyRateInfo = {
    dailyHours: fallbackPerDay,
    source: "default",
    workdaysPerWeek: contract?.workdaysPerWeek ?? null,
    weeklyHours: contract?.weeklyHours ?? null,
  };
  if (contract && contract.weeklyHours > 0 && contract.workdaysPerWeek > 0) {
    info.dailyHours = typicalShiftHours(contract, fallbackPerDay);
    info.source = "contract";
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
