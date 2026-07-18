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

// Effektive Tages-Stunden einer GANZTÄGIGEN Abwesenheit (kein zugrundeliegender
// Dienst), abhängig von der aktiven Urlaubsmethode des Team-Eigentümers:
//   bwavg  → §11-BUrlG-Durchschnitt der letzten 13 Wochen (Fallback = übergebener
//            Standardwert, wenn keine bestätigte Arbeitshistorie existiert);
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
    perDay = (await bwavgDailyHours(userId, start)) ?? fallbackPerDay;
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
