// Stundenbewertung von Urlaubs-/Abwesenheitstagen (Point 7: Urlaub wird
// stundengenau geführt) — geteilt zwischen der Schichten-Route (Buchung beim
// Anlegen/Ändern von Abwesenheiten) und der Verträge-Route (Neuberechnung des
// Urlaubszählers nach jedem Vertrags-Speichern).

import { db } from "@workspace/db";
import { contractsTable, shiftsTable, timeTrackingTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { isPlainFullDay, averageDailyHours } from "./shift-metrics-resolve";
import { resolveAllowanceOps } from "./allowance-resolve";

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
export async function bwavgDailyHours(userId: number, refDate: Date): Promise<number | null> {
  const end = new Date(refDate);
  const start = new Date(end.getTime() - 91 * 24 * 3_600_000); // 13 Wochen
  const startStr = start.toISOString();
  const endStr = end.toISOString();
  const [row] = await db
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

// Aktiver Vertrag des Nutzers IM TEAM der Schicht zum Stichtag (jüngster
// Beginn gewinnt). Team-gescoped, damit kein Vertrag eines fremden Teams die
// Urlaubsbewertung hier beeinflusst (Team-Scoping-Invariante).
async function activeTeamContractFor(
  userId: number,
  teamId: number,
  date: Date
): Promise<{ weeklyHours: number; workdaysPerWeek: number; startDate: string } | null> {
  const dateStr = date.toISOString().split("T")[0]!;
  const [contract] = await db
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
//   factor → Standardwert (der Anspruch baut sich stundenweise auf).
// Ersetzt die Abwesenheit einen konkreten Dienst (echte Zeiten), zählt immer
// dessen tatsächliche Dauer — unabhängig von der Methode.
export async function absenceHoursFor(
  userId: number,
  teamId: number | null,
  startTime: Date | string,
  endTime: Date | string,
  fallbackPerDay: number
): Promise<number> {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!isPlainFullDay(start, end)) {
    return vacationHoursForShift(start, end, fallbackPerDay);
  }
  const ops = await resolveAllowanceOps(teamId);
  let perDay = fallbackPerDay;
  if (ops.vacationMethod === "bwavg") {
    const contract =
      teamId != null ? await activeTeamContractFor(userId, teamId, start) : null;
    if (contract) {
      const avg = contractOlderThan13Weeks(contract.startDate, start)
        ? await bwavgDailyHours(userId, start)
        : null;
      if (avg != null) {
        perDay = avg;
      } else if (contract.weeklyHours > 0 && contract.workdaysPerWeek > 0) {
        perDay =
          Math.round((contract.weeklyHours / contract.workdaysPerWeek) * 100) / 100;
      }
    } else {
      // Ohne Vertrag: bisheriges Verhalten (Schnitt, falls Historie; sonst
      // Standardwert) — kein Verhaltensbruch für vertragslose Nutzer.
      perDay = (await bwavgDailyHours(userId, start)) ?? fallbackPerDay;
    }
  }
  return vacationHoursForShift(start, end, perDay);
}

// Löst die Urlaubs-Stunden eines Abwesenheits-Datums über die Einstellungen des
// Team-Eigentümers (Fallback-Kette) auf.
export async function resolveVacationHours(
  userId: number,
  teamId: number | null,
  startTime: Date | string,
  endTime: Date | string
): Promise<number> {
  const ops = await resolveAllowanceOps(teamId);
  return absenceHoursFor(userId, teamId, startTime, endTime, ops.vacationHoursPerDay);
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
