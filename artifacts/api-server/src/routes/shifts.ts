import { db } from "@workspace/db";
import {
  shiftsTable,
  usersTable,
  contractsTable,
  timeTrackingTable,
  shiftModelsTable,
  allowanceSettingsTable,
  teamsTable,
  type NightWindow,
  type GermanState,
} from "@workspace/db";
import { eq, and, sql, or, isNull, ne, notInArray, lt, gt, gte, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Response } from "express";
import { isShiftModelInTeam } from "../lib/teams";
import {
  isAbsenceType,
  isPlainFullDay,
  resolveShiftMetrics,
  deriveDayWindowFromDefaults as shiftModelTimesForDay,
} from "../lib/shift-metrics-resolve";
import { absenceHoursFor } from "../lib/vacation-hours";
import { getUserLimit } from "../lib/plan";
import { resolveAllowanceOps } from "../lib/allowance-resolve";

// Aliase für die zwei Teamtabellen-JOINs im SHIFT_SELECT-Projektor.
// Ersetzen korrelierte Subqueries (einen Subselect pro Zeile) durch effiziente
// LEFT JOINs, die der Planer einmal ausführt und über alle Zeilen wiederverwendet.
export const einsatzTeamsTable = alias(teamsTable, "einsatz_teams");
export const homeTeamsTable = alias(teamsTable, "home_teams");
// Vertretung vormerken: Name der Standby-Person per eigenem JOIN auf
// usersTable (die "echte" usersTable ist bereits für den zugewiesenen
// Nutzer belegt). Alle Query-Sites müssen leftJoin(standbyUsersTable)
// ergänzen — genau wie bei einsatzTeamsTable/homeTeamsTable oben.
export const standbyUsersTable = alias(usersTable, "standby_users");

// Transaktions-Executor: Schreib-Helfer akzeptieren wahlweise die globale
// db-Instanz oder eine offene Drizzle-Transaktion (Sammel-Anlage, s. u.).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Dbx = typeof db | DbTx;

export const SHIFT_SELECT = {
  id: shiftsTable.id,
  userId: shiftsTable.userId,
  startTime: shiftsTable.startTime,
  endTime: shiftsTable.endTime,
  type: shiftsTable.type,
  planningStatus: shiftsTable.planningStatus,
  shiftModelId: shiftsTable.shiftModelId,
  notes: shiftsTable.notes,
  isVertretung: shiftsTable.isVertretung,
  standbyUserId: shiftsTable.standbyUserId,
  standbyUserName: standbyUsersTable.name,
  pauseMinutes: shiftsTable.pauseMinutes,
  isPartialAbsence: shiftsTable.isPartialAbsence,
  valuedHours: shiftsTable.valuedHours,
  nightHours: shiftsTable.nightHours,
  sundayHours: shiftsTable.sundayHours,
  holidayHours: shiftsTable.holidayHours,
  createdAt: shiftsTable.createdAt,
  // Aushilfe-Einsatz: Team-Namen über JOIN statt korrelierter Subselects
  // (ein JOIN pro Query statt eines Subselects pro Zeile).
  // Alle Query-Sites müssen leftJoin(einsatzTeamsTable) + leftJoin(homeTeamsTable) ergänzen.
  einsatzTeamId: shiftsTable.einsatzTeamId,
  einsatzTeamName: einsatzTeamsTable.name,
  homeTeamName: sql<string | null>`CASE WHEN ${shiftsTable.einsatzTeamId} IS NOT NULL THEN ${homeTeamsTable.name} END`,
  user: {
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    address: usersTable.address,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  },
};

export async function activeContractFor(userId: number, date: Date, dbx: Dbx = db) {
  const dateStr = date.toISOString().split("T")[0];
  const contracts = await dbx
    .select()
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.userId, userId),
        sql`${contractsTable.startDate} <= ${dateStr}`,
        or(
          isNull(contractsTable.endDate),
          sql`${contractsTable.endDate} >= ${dateStr}`
        )
      )
    )
    .orderBy(sql`${contractsTable.startDate} DESC`)
    .limit(1);
  return contracts[0] ?? null;
}

type AbsenceShift = {
  id: number;
  userId: number;
  teamId: number;
  startTime: Date;
  endTime: Date;
};

type BulkContract = {
  id: number;
  teamId: number;
  startDate: string;
  endDate: string | null;
  weeklyHours: number;
  workdaysPerWeek: number;
  vacationHoursUsed: number;
};

export function dayKey(value: Date | string): string {
  return new Date(value).toISOString().split("T")[0]!;
}

// Aktiver Vertrag zum Stichtag aus der einmalig geladenen Vertragsliste.
//
// ACHTUNG, bewusst gemischt gescoped — exakt wie der Einzelpfad:
//  • OHNE teamId (Aufruf für Tages-Soll-Stunden und Urlaubskonto-Buchung):
//    jüngster Beginn gewinnt, teamübergreifend — identisch zu
//    activeContractFor(userId, date), das ebenfalls nicht nach Team filtert.
//  • MIT teamId (Aufruf für die Abwesenheits-Stunden): team-gescoped, wie
//    activeTeamContractFor in vacation-hours.ts.
// Bei einer Person mit gleichzeitig aktiven Verträgen in zwei Teams entscheidet
// das, welches Urlaubskonto belastet wird. Nicht "vereinheitlichen" — das wäre
// eine stille Verhaltensänderung an Lohn-/Urlaubsdaten. Abgesichert durch
// dienstplan-bulk-absence-multiteam-vertrag-api.spec.ts.
function contractForDay(
  contracts: BulkContract[],
  day: Date,
  teamId?: number,
): BulkContract | null {
  const date = dayKey(day);
  return (
    contracts
      .filter(
        (contract) =>
          (teamId == null || contract.teamId === teamId) &&
          contract.startDate <= date &&
          (contract.endDate == null || contract.endDate >= date),
      )
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null
  );
}

function dailyTargetHoursFromContracts(contracts: BulkContract[], day: Date): number {
  const contract = contractForDay(contracts, day);
  if (!contract) return 8;
  const workdays = contract.workdaysPerWeek > 0 ? contract.workdaysPerWeek : 5;
  return Math.round((contract.weeklyHours / workdays) * 100) / 100;
}

function isContractOlderThan13Weeks(contract: BulkContract, refDate: Date): boolean {
  return (
    refDate.getTime() - new Date(`${contract.startDate}T00:00:00Z`).getTime() >=
    91 * 24 * 3_600_000
  );
}

// Vertragliche Soll-Stunden des Tages (Wochenstunden / Arbeitstage pro Woche,
// Fallback 5 Arbeitstage). Fallback 8h ohne Vertrag.
async function dailyTargetHours(userId: number, date: Date, dbx: Dbx = db): Promise<number> {
  const contract = await activeContractFor(userId, date, dbx);
  if (!contract) return 8;
  const workdays =
    contract.workdaysPerWeek > 0 ? contract.workdaysPerWeek : 5;
  return Math.round((contract.weeklyHours / workdays) * 100) / 100;
}

// Bucht die geplanten Stunden der Abwesenheit als bestätigte Zeiterfassung
// (Lohnausfallprinzip): ein 24h-Dienst schreibt 24h gut, ein normaler
// Abwesenheitstag die vertraglichen Tages-Soll-Stunden. Keine Zuschläge hier,
// da Abwesenheiten kein Arbeits-Schichtmodell sind.
export async function bookAbsenceTimeTracking(shift: AbsenceShift, dbx: Dbx = db): Promise<void> {
  const target = await dailyTargetHours(shift.userId, new Date(shift.startTime), dbx);
  const dailyHours = await absenceHoursFor(
    shift.userId,
    shift.teamId,
    shift.startTime,
    shift.endTime,
    target,
    dbx
  );
  await dbx.insert(timeTrackingTable).values({
    userId: shift.userId,
    teamId: shift.teamId,
    shiftId: shift.id,
    actualStart: shift.startTime,
    actualEnd: shift.endTime,
    actualHours: dailyHours,
    status: "confirmed",
  });
}

// Hält die gebuchte Zeiterfassung einer Abwesenheit synchron, wenn sich Datum,
// Zeiten oder der zugrundeliegende Vertrag geändert haben.
export async function syncAbsenceTimeTracking(shift: AbsenceShift, dbx: Dbx = db): Promise<void> {
  const target = await dailyTargetHours(shift.userId, new Date(shift.startTime), dbx);
  const dailyHours = await absenceHoursFor(
    shift.userId,
    shift.teamId,
    shift.startTime,
    shift.endTime,
    target,
    dbx
  );
  await dbx
    .update(timeTrackingTable)
    .set({ actualHours: dailyHours, actualStart: shift.startTime, actualEnd: shift.endTime })
    .where(eq(timeTrackingTable.shiftId, shift.id));
}

export async function removeAbsenceTimeTracking(
  shiftId: number | number[],
  dbx: Dbx = db
): Promise<void> {
  const ids = Array.isArray(shiftId) ? shiftId : [shiftId];
  if (ids.length === 0) return;
  await dbx.delete(timeTrackingTable).where(inArray(timeTrackingTable.shiftId, ids));
}

// Stundenbewertung von Urlaubs-/Abwesenheitstagen (vacationHoursForShift,
// bwavgDailyHours, absenceHoursFor, resolveVacationHours) lebt in
// ../lib/vacation-hours.ts — geteilt mit der Verträge-Route (Neuberechnung des
// Urlaubszählers nach jedem Vertrags-Speichern).

// Schreibt den genommenen Urlaub (in Stunden) auf einem konkreten Vertrag fort.
// Geht nie unter null. Atomarer SQL-Inkrement statt Read-Modify-Write in JS:
// gleichzeitige Buchungen (zwei Requests, Einzel- neben Sammel-Anlage) können
// so keine Updates verlieren.
export async function applyVacationDelta(
  contract: { id: number; vacationHoursUsed: number },
  deltaHours: number,
  dbx: Dbx = db
): Promise<void> {
  await dbx
    .update(contractsTable)
    .set({
      vacationHoursUsed: sql`GREATEST(0, ROUND((${contractsTable.vacationHoursUsed} + ${deltaHours})::numeric, 2))::double precision`,
    })
    .where(eq(contractsTable.id, contract.id));
}

// Bucht die Urlaubs-Stunden der Abwesenheit auf den Vertrag, der für
// (userId, Datum) gilt.
export async function adjustVacationHours(
  userId: number,
  date: Date,
  deltaHours: number,
  dbx: Dbx = db
): Promise<void> {
  const contract = await activeContractFor(userId, date, dbx);
  if (!contract) return;
  await applyVacationDelta(contract, deltaHours, dbx);
}

// Vertragszeitraum-Guard für URLAUB: Hat die Assistenzkraft mindestens einen
// Vertrag, muss der Urlaub (Start- UND End-Tag) komplett in EINEM Vertrags-
// zeitraum liegen — sonst würde adjustVacationHours keinen aktiven Vertrag
// finden und der Urlaubszähler (vacationHoursUsed) bliebe still falsch.
// Nutzer GANZ OHNE Vertrag (in keinem Team) bleiben ungeblockt (UI-Fallback
// zählt geplante Urlaubs-Schichten). Die DECKUNG zählt nur über Verträge des
// Schicht-Teams (teamId): ein Vertrag in einem ANDEREN Team erlaubt keinen
// Urlaub hier, und die „Vertrag ab/bis"-Hinweise leaken keine teamfremden
// Vertragsdaten. Liefert die deutsche Fehlermeldung oder null (= erlaubt).
export async function vacationOutsideContractError(
  userId: number,
  teamId: number,
  startTime: Date | string,
  endTime: Date | string
): Promise<string | null> {
  const allContracts = await db
    .select({
      startDate: contractsTable.startDate,
      endDate: contractsTable.endDate,
      teamId: contractsTable.teamId,
    })
    .from(contractsTable)
    .where(eq(contractsTable.userId, userId));
  if (allContracts.length === 0) return null;
  const contracts = allContracts.filter((c) => c.teamId === teamId);

  const startDay = new Date(startTime).toISOString().split("T")[0]!;
  // End-Tag über den letzten enthaltenen Moment bestimmen (Ende 00:00 des
  // Folgetags zählt nicht als zusätzlicher Urlaubstag).
  const endDay = new Date(new Date(endTime).getTime() - 1)
    .toISOString()
    .split("T")[0]!;
  const covered = contracts.some(
    (c) => c.startDate <= startDay && (c.endDate == null || c.endDate >= endDay)
  );
  if (covered) return null;

  const formatDe = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  };
  // Sprechender Hinweis: nächster Vertragsbeginn nach dem Urlaub bzw. letztes
  // Vertragsende davor.
  const futureStarts = contracts
    .map((c) => c.startDate)
    .filter((s) => s > startDay)
    .sort();
  if (futureStarts.length > 0) {
    return `Urlaub liegt außerhalb des Vertragszeitraums (Vertrag ab ${formatDe(futureStarts[0]!)}).`;
  }
  const pastEnds = contracts
    .map((c) => c.endDate)
    .filter((e): e is string => e != null && e < endDay)
    .sort();
  if (pastEnds.length > 0) {
    return `Urlaub liegt außerhalb des Vertragszeitraums (Vertrag bis ${formatDe(pastEnds[pastEnds.length - 1]!)}).`;
  }
  return "Urlaub liegt außerhalb des Vertragszeitraums.";
}

// Trägt den Vertrags-Guard des Sammelauftrags aus der Transaktion heraus: Die
// Prüfung braucht die Vertragsdaten, die erst im Advisory-Lock gelesen werden,
// muss aber weiterhin mit 400 (statt 500) antworten und dabei alles
// zurückrollen.
export class VacationOutsideContractError extends Error {}

// Varianten des Vertrags-Guards für Sammelanlagen: Die identische Fachlogik
// arbeitet mit dem bereits einmal geladenen Vertragsbestand statt N Reads.
function vacationOutsideContractErrorFromContracts(
  allContracts: BulkContract[],
  teamId: number,
  startTime: Date | string,
  endTime: Date | string,
): string | null {
  if (allContracts.length === 0) return null;
  const contracts = allContracts.filter((contract) => contract.teamId === teamId);
  const startDay = dayKey(startTime);
  const endDay = dayKey(new Date(new Date(endTime).getTime() - 1));
  if (
    contracts.some(
      (contract) =>
        contract.startDate <= startDay &&
        (contract.endDate == null || contract.endDate >= endDay),
    )
  ) {
    return null;
  }

  const formatDe = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  };
  const futureStarts = contracts
    .map((contract) => contract.startDate)
    .filter((date) => date > startDay)
    .sort();
  if (futureStarts.length > 0) {
    return `Urlaub liegt außerhalb des Vertragszeitraums (Vertrag ab ${formatDe(futureStarts[0]!)}).`;
  }
  const pastEnds = contracts
    .map((contract) => contract.endDate)
    .filter((date): date is string => date != null && date < endDay)
    .sort();
  if (pastEnds.length > 0) {
    return `Urlaub liegt außerhalb des Vertragszeitraums (Vertrag bis ${formatDe(pastEnds[pastEnds.length - 1]!)}).`;
  }
  return "Urlaub liegt außerhalb des Vertragszeitraums.";
}

// Prüft, ob für denselben Nutzer, Abwesenheitstyp und Kalendertag bereits eine
// Schicht existiert. Verhindert doppelte Urlaubs-/Krank-Einträge (und damit
// doppelte vacationDaysUsed-Abzüge), auch wenn der Frontend-Schutz umgangen wird.
// Tag-Vergleich über DATE() auf dem gespeicherten Zeitstempel, konsistent zur
// Frontend-Logik (startTime = Tagesbeginn, per toISOString gespeichert).
export async function findDuplicateAbsence(
  userId: number,
  type: string,
  date: Date,
  excludeShiftId: number | null
): Promise<{ id: number } | null> {
  // Sargable Tagesgrenze statt DATE(): ermöglicht Indexnutzung auf start_time.
  const dateStr = new Date(date).toISOString().split("T")[0];
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const conditions = [
    eq(shiftsTable.userId, userId),
    eq(shiftsTable.type, type as "vacation" | "sick"),
    gte(shiftsTable.startTime, dayStart),
    lt(shiftsTable.startTime, nextDay),
  ];
  if (excludeShiftId !== null) conditions.push(ne(shiftsTable.id, excludeShiftId));
  const [row] = await db
    .select({ id: shiftsTable.id })
    .from(shiftsTable)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

// Strukturierte 409-Antwort für eine bereits existierende Abwesenheit am selben Tag.
export function duplicateAbsenceResponseBody(existingId: number, type: string) {
  return {
    error:
      "Für diese Assistenzkraft besteht an diesem Tag bereits eine Abwesenheit dieses Typs.",
    code: "absence_duplicate" as const,
    existingShiftId: existingId,
    type,
  };
}

// Team-Dienst (Teamsitzung): Der Konto-Schalter des TEAM-EIGENTÜMERS
// (allowance_settings, Konto-Zeile team_id NULL, konto-global wie
// timeTrackingEnabled) muss AN sein, damit neue Team-Einträge angelegt werden
// dürfen. Bestehende Einträge bleiben unberührt (Bestandsschutz).
export async function teamMeetingEnabledForTeam(teamId: number): Promise<boolean> {
  const [row] = await db
    .select({ enabled: allowanceSettingsTable.teamMeetingEnabled })
    .from(teamsTable)
    .innerJoin(
      allowanceSettingsTable,
      and(
        eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
        isNull(allowanceSettingsTable.teamId)
      )
    )
    .where(eq(teamsTable.id, teamId));
  return row?.enabled === true;
}

// Verhindert einen zweiten Team-Eintrag (Teamsitzung) am selben Kalendertag im
// selben TEAM — ein Eintrag genügt (er schreibt allen Mitgliedern die Stunden
// gut); ein Duplikat würde die Gutschrift verdoppeln.
export async function findDuplicateTeamEntry(
  teamId: number,
  date: Date,
  excludeShiftId: number | null
): Promise<{ id: number } | null> {
  // Sargable Tagesgrenze statt DATE(): ermöglicht Indexnutzung auf start_time.
  const dateStr = new Date(date).toISOString().split("T")[0];
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const conditions = [
    eq(shiftsTable.teamId, teamId),
    eq(shiftsTable.type, "team" as const),
    gte(shiftsTable.startTime, dayStart),
    lt(shiftsTable.startTime, nextDay),
  ];
  if (excludeShiftId !== null) conditions.push(ne(shiftsTable.id, excludeShiftId));
  const [row] = await db
    .select({ id: shiftsTable.id })
    .from(shiftsTable)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

// Team-Einträge (Teamsitzung) sind produktseitig IMMER ganztägig — die Stunden-
// Gutschrift kommt aus den Konto-Einstellungen, nicht aus dem Zeitfenster.
// Der Server normalisiert deshalb IMMER autoritativ auf den vollen UTC-
// Kalendertag des übermittelten Starts (00:00:00–23:59:59) — dieselbe
// DATE(startTime)-UTC-Konvention wie der Duplikat-Check und die Auswertung.
// Kein Client (auch kein fremder API-Client) kann so einen Team-Eintrag mit
// abweichendem Zeitfenster persistieren.
export function normalizeTeamEntryTimes(startTime: Date): {
  startTime: Date;
  endTime: Date;
} {
  const dateStr = startTime.toISOString().split("T")[0];
  return {
    startTime: new Date(`${dateStr}T00:00:00.000Z`),
    endTime: new Date(`${dateStr}T23:59:59.000Z`),
  };
}

// Zeitwertung in Prozent: aus dem Schichtmodell (type "work"), sonst 100 (Legacy ohne Modell).
export async function valuationPercentFor(type: string, shiftModelId: number | null): Promise<number> {
  if (type === "work" && shiftModelId) {
    const [model] = await db
      .select({ valuationPercent: shiftModelsTable.valuationPercent })
      .from(shiftModelsTable)
      .where(eq(shiftModelsTable.id, shiftModelId));
    return model?.valuationPercent ?? 100;
  }
  return 100;
}

// Aktuelles Nachtfenster und gewähltes Bundesland aus den Zuschlags-Einstellungen
// des Teams der Schicht: zuerst der TEAM-OVERRIDE (team_id gesetzt), sonst die
// Konto-Zeile des TEAM-EIGENTÜMERS (team_id NULL). Fallback 23:00–06:00; ohne
// Bundesland nur bundesweite Feiertage.
//
// `dbx` erlaubt das Lesen INNERHALB einer offenen Transaktion: Sammelaufträge
// bewerten damit Stunden, die sie in derselben Transaktion schreiben.
export async function allowanceContext(
  teamId: number | null,
  dbx: Dbx = db
): Promise<{ window: NightWindow; state: GermanState | null }> {
  let settings: { nightStart: string; nightEnd: string; state: string | null } | undefined;
  if (teamId != null) {
    const [override] = await dbx
      .select({
        nightStart: allowanceSettingsTable.nightStart,
        nightEnd: allowanceSettingsTable.nightEnd,
        state: allowanceSettingsTable.state,
      })
      .from(allowanceSettingsTable)
      .where(eq(allowanceSettingsTable.teamId, teamId));
    settings = override;
    if (!settings) {
      const [row] = await dbx
        .select({
          nightStart: allowanceSettingsTable.nightStart,
          nightEnd: allowanceSettingsTable.nightEnd,
          state: allowanceSettingsTable.state,
        })
        .from(teamsTable)
        .innerJoin(
          allowanceSettingsTable,
          and(
            eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
            isNull(allowanceSettingsTable.teamId)
          )
        )
        .where(eq(teamsTable.id, teamId));
      settings = row;
    }
  }
  return {
    window: {
      nightStart: settings?.nightStart ?? "23:00",
      nightEnd: settings?.nightEnd ?? "06:00",
    },
    state: (settings?.state as GermanState | null) ?? null,
  };
}

// Ermittelt die Roh-Kennzahlen einer Schicht und speichert sie an der Schicht.
export async function storeShiftMetrics(shift: {
  id: number;
  userId: number;
  teamId: number | null;
  type: string;
  shiftModelId: number | null;
  startTime: Date;
  endTime: Date;
}, dbx: Dbx = db): Promise<void> {
  const absence = isAbsenceType(shift.type);
  // Bei Abwesenheit zählen die geplanten Schichtstunden (Lohnausfallprinzip):
  // 24h-Dienst → 24h, normaler Tag → vertragliche Tages-Soll-Stunden. Bei
  // Arbeitsschichten übernimmt computeShiftMetrics die Wertung.
  const plannedHours = absence
    ? await absenceHoursFor(
        shift.userId,
        shift.teamId,
        shift.startTime,
        shift.endTime,
        await dailyTargetHours(shift.userId, new Date(shift.startTime), dbx),
        dbx
      )
    : 0;
  const valuationPercent = absence
    ? 100
    : await valuationPercentFor(shift.type, shift.shiftModelId);
  const { window, state } = await allowanceContext(shift.teamId, dbx);
  // Schätzbasis für Nachtzuschlag nur bei ganz freien Ganztags-Abwesenheiten
  // relevant (s. resolveShiftMetrics); für Arbeitsschichten wird sie ignoriert,
  // daher hier ohne Sonderfall-Zweig geladen.
  const fallbackNightBasis = absence
    ? await firstActiveShiftModelDefaults(shift.teamId, dbx)
    : null;
  const metrics = resolveShiftMetrics(
    {
      type: shift.type,
      startTime: new Date(shift.startTime),
      endTime: new Date(shift.endTime),
      plannedHours,
      valuationPercent,
      fallbackNightBasis,
    },
    window,
    state
  );
  await dbx.update(shiftsTable).set(metrics).where(eq(shiftsTable.id, shift.id));
}

type ShiftConflict = {
  id: number;
  startTime: Date;
  endTime: Date;
  type: string;
  isPartialAbsence: boolean;
};

// Findet zeitlich überlappende Schichten desselben Assistenten. Überlappung gilt,
// wenn bestehende.start < neu.ende UND bestehende.ende > neu.start. Abwesenheiten
// (ganztägige Urlaub-/Krank-Einträge) werden ausgenommen, damit reguläre Schichten
// am selben Tag keine Falschwarnungen auslösen. Schichten über Mitternacht werden
// korrekt verglichen, da Start/Ende als echte Zeitstempel (Ende ggf. Folgetag) vorliegen.
export async function findOverlappingShifts(
  userId: number,
  startTime: Date,
  endTime: Date,
  excludeShiftId: number | null
): Promise<ShiftConflict[]> {
  const conditions = [
    eq(shiftsTable.userId, userId),
    // Abwesenheiten (außer ganztägigem Urlaub, s. u.) UND Team-Einträge
    // (Teamsitzungen) lösen keine Überschneidungswarnung mit regulären
    // Schichten aus.
    notInArray(shiftsTable.type, [
      "sick",
      "team",
      "kind_krank",
      "freistellung",
      "abgesagt_ag",
      "abgesagt_an",
      "urlaubsabgeltung",
    ]),
    lt(shiftsTable.startTime, endTime),
    gt(shiftsTable.endTime, startTime),
  ];
  if (excludeShiftId !== null) conditions.push(ne(shiftsTable.id, excludeShiftId));
  const rows = await db
    .select({
      id: shiftsTable.id,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      type: shiftsTable.type,
      isPartialAbsence: shiftsTable.isPartialAbsence,
    })
    .from(shiftsTable)
    .where(and(...conditions));
  // Halbtägiger Urlaub (#862) hat echte Uhrzeiten und muss wie ein Dienst
  // kollidieren können; ganztägiger Urlaub bleibt wie bisher von der
  // Kollisionsprüfung ausgenommen (das Anlegen wird bereits auf anderem Weg
  // verhindert/aufgelöst — Lohnausfallprinzip beim Ersetzen). Die Ganztags-
  // Erkennung läuft über das persistierte isPartialAbsence-Flag, NICHT über
  // isPlainFullDay(startTime, endTime): ein ganztägiger Eintrag, der einen
  // ersetzten Dienst geerbt hat, trägt echte (nicht-ganztägige) Uhrzeiten und
  // würde sonst fälschlich wie ein bewusst gewählter Teil-Tag kollidieren.
  return rows.filter((r) => r.type !== "vacation" || r.isPartialAbsence);
}

// Strukturierte 409-Antwort mit den kollidierenden Schichten (ISO-Zeitstempel,
// damit das Frontend zeitzonenkorrekt formatieren kann).
export function overlapResponseBody(conflicts: ShiftConflict[]) {
  return {
    error: "Diese Schicht überschneidet sich mit einer bestehenden Schicht derselben Assistenzkraft.",
    code: "shift_overlap" as const,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      startTime: c.startTime.toISOString(),
      endTime: c.endTime.toISOString(),
      type: c.type,
    })),
  };
}

// Anzahl Monate, die `target` in der Zukunft VOR `now` liegt (0 = selber Monat,
// negativ = Vergangenheit). Basis fuer das historyMonths-Vorausplanungs-Limit.
function monthsAhead(target: Date, now: Date): number {
  return (
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth())
  );
}

// Free-Limit (historyMonths) autoritativ durchsetzen: Die Vorausplanung wird auf
// `historyMonths` Monate in die Zukunft begrenzt (Free=1 → aktueller + naechster
// Monat). NUR das Planen in zu weit entfernten ZUKUNFTS-Monaten wird gesperrt
// (gilt fuer POST UND fuer ein PATCH, das eine Schicht weiter nach vorn schiebt);
// vergangene und aktuelle Monate bleiben uneingeschraenkt bebuchbar/editierbar
// (Bestandsschutz). `null` = unbegrenzt (Premium-Vorausschau via 12). Massgeblich
// ist der Plan des TEAM-EIGENTUEMERS (nicht des ggf. abweichenden Anfragers), damit
// ein Member-Admin das Limit eines fremden Free-Teams nicht ueber seinen eigenen
// Plan umgehen kann (analog zu maxAssistants). Liefert true, wenn die Aktion
// geblockt und bereits mit 403 beantwortet wurde.
export async function forwardPlanningBlocked(
  teamId: number,
  requesterId: number,
  startTime: Date,
  res: Response,
): Promise<boolean> {
  const [team] = await db
    .select({ ownerId: teamsTable.ownerId })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  const ownerId = team?.ownerId ?? requesterId;
  const forwardLimit = await getUserLimit(ownerId, "historyMonths");
  if (forwardLimit != null && monthsAhead(new Date(startTime), new Date()) > forwardLimit) {
    res.status(403).json({
      error:
        "Im Free-Tarif kann nur fuer den aktuellen und naechsten Monat geplant werden. Bitte upgrade auf Premium fuer eine laengere Vorausplanung.",
      code: "plan_limit_reached",
      limit: "historyMonths",
    });
    return true;
  }
  return false;
}

// HINWEIS (Produktentscheidung, Task #319): Das Abwesenheits-SYSTEM (Urlaub/
// Krankheit eintragen, anzeigen, loeschen) bleibt fuer ALLE Plaene frei —
// hier gibt es bewusst KEIN Plan-Gate. Premium ist nur das TRACKING
// (Resturlaub-Konto, Tage-Zaehlung), ein reines Anzeige-Feature im Frontend
// ("absenceTracking"). Die zugrunde liegenden Daten (contracts.vacationDays,
// vacationDaysUsed, Abwesenheits-Schichten) sind fuer Free-Konten legitim
// zugaenglich; die Buchhaltung (vacationDaysUsed) laeuft planunabhaengig
// weiter, damit beim Upgrade sofort korrekte Salden vorliegen.

// Alle geplanten Arbeitsschichten (keine Abwesenheiten) eines Assistenten, die
// am selben Kalendertag wie der Abwesenheits-Zeitraum BEGINNEN und sich
// ZEITLICH mit ihm überschneiden (AP 5: eine Von-bis-Abwesenheit darf einen
// Dienst außerhalb ihres Zeitfensters unberührt lassen, z. B. Urlaub 09–15 Uhr
// neben einem Dienst 15–21 Uhr). Die Tages-Grenze bleibt Pflicht (Produkt-
// entscheidung, s. dienstplan-vortags-nachtdienst-bleibt-bei-urlaub-api.spec.ts):
// ein Nachtdienst, der am VORTAG beginnt und in den Abwesenheitstag hineinragt,
// gehört zum Vortag und bleibt unberührt — nur DATE(startTime) = Abwesenheitstag
// kommt als Kandidat infrage, das Zeitfenster filtert innerhalb dieses Tages
// zusätzlich auf echte Überschneidung. Längste zuerst. Grundlage der Primary-
// Lookup-Ersetzung: eine neue Abwesenheit "überschreibt" den überlappenden
// Dienst und erbt dessen Zeiten (damit Stunden + Zuschlagspotenzial). Ein
// ganztägiger Eintrag (00:00–23:59) überschneidet sich weiterhin mit jedem
// Dienst des Tages — dafür ändert sich das Verhalten nicht.
export async function findPlannedWorkShiftsForDay(
  userId: number,
  teamId: number,
  rangeStart: Date,
  rangeEnd: Date
): Promise<
  { id: number; startTime: Date; endTime: Date; type: string; shiftModelId: number | null; standbyUserId: number | null }[]
> {
  const dayStart = new Date(
    `${rangeStart.toISOString().split("T")[0]}T00:00:00.000Z`
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: shiftsTable.id,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      // Werden für den Vertretungs-Aktivierungs-Vorschlag gebraucht (Original-
      // Dienstart/-Modell, bevor die Schicht gleich als "ersetzt" gilt — s.
      // buildVertretungsVorschlag in shifts-crud.ts).
      type: shiftsTable.type,
      shiftModelId: shiftsTable.shiftModelId,
      standbyUserId: shiftsTable.standbyUserId,
    })
    .from(shiftsTable)
    .where(
      and(
        eq(shiftsTable.userId, userId),
        eq(shiftsTable.teamId, teamId),
        notInArray(shiftsTable.type, [
          "vacation",
          "sick",
          "freizeitausgleich",
          "team",
          "kind_krank",
          "freistellung",
          "abgesagt_ag",
          "abgesagt_an",
          "urlaubsabgeltung",
          "wunschfrei",
        ]),
        gte(shiftsTable.startTime, dayStart),
        lt(shiftsTable.startTime, dayEnd),
        lt(shiftsTable.startTime, rangeEnd),
        gt(shiftsTable.endTime, rangeStart),
      )
    );
  return rows.sort(
    (a, b) =>
      b.endTime.getTime() -
      b.startTime.getTime() -
      (a.endTime.getTime() - a.startTime.getTime())
  );
}

// Vertretungs-Aktivierungs-Vorschlag: nur ein Antwort-Feld, kein gespeicherter
// Wert. Wird aufgerufen, wenn ein Arbeitsdienst MIT vorgemerkter Vertretung
// gerade zu einer Abwesenheit wird/wurde (POST ersetzt+löscht den Original-
// Dienst, PATCH ändert ihn in-place) — der Aufrufer muss die Original-Werte
// (Zeiten/Typ/Modell) VOR der Umwandlung übergeben, da sie danach überschrieben
// bzw. gelöscht sind. Liefert null ohne standbyUserId oder wenn die Person
// zwischenzeitlich gelöscht wurde.
export async function buildVertretungsVorschlag(params: {
  teamId: number;
  standbyUserId: number | null;
  startTime: Date;
  endTime: Date;
  type: string;
  shiftModelId: number | null;
}): Promise<{
  userId: number;
  userName: string;
  teamId: number;
  startTime: Date;
  endTime: Date;
  type: string;
  shiftModelId: number | null;
} | null> {
  if (params.standbyUserId == null) return null;
  const [standby] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, params.standbyUserId))
    .limit(1);
  if (!standby) return null;
  return {
    userId: params.standbyUserId,
    userName: standby.name,
    teamId: params.teamId,
    startTime: params.startTime,
    endTime: params.endTime,
    type: params.type,
    shiftModelId: params.shiftModelId,
  };
}

// Entfernt eine geplante Arbeitsschicht samt zugehöriger Zeiterfassung. Wird eine
// Abwesenheit angelegt, die sie "überschreibt", bliebe der Dienst sonst als
// Doppelbuchung in Soll/Zuschlägen stehen.
async function deleteReplacedWorkShift(shiftId: number, dbx: Dbx = db): Promise<void> {
  await dbx.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, shiftId));
  await dbx.delete(shiftsTable).where(eq(shiftsTable.id, shiftId));
}

// Standardzeiten des ersten aktiven Schichtmodells eines Teams (sortOrder ASC,
// id ASC — dieselbe Konvention wie beim Vorbelegen einer neuen Schicht ohne
// Auswahl, s. shift-dialog.tsx). Dient als Team-weite Schätzbasis für den
// Nachtzuschlag ganz freier Ganztags-Abwesenheiten (kein ersetzter Dienst, kein
// gewähltes Schichtmodell) — es gibt kein persönliches Standard-Schichtmodell.
async function firstActiveShiftModelDefaults(
  teamId: number | null,
  dbx: Dbx = db
): Promise<{ defaultStartTime: string; defaultEndTime: string } | null> {
  if (teamId == null) return null;
  const [model] = await dbx
    .select({
      defaultStartTime: shiftModelsTable.defaultStartTime,
      defaultEndTime: shiftModelsTable.defaultEndTime,
    })
    .from(shiftModelsTable)
    .where(and(eq(shiftModelsTable.teamId, teamId), eq(shiftModelsTable.isActive, true)))
    .orderBy(shiftModelsTable.sortOrder, shiftModelsTable.id)
    .limit(1);
  if (!model?.defaultStartTime || !model?.defaultEndTime) return null;
  return { defaultStartTime: model.defaultStartTime, defaultEndTime: model.defaultEndTime };
}

// ---------------------------------------------------------------------------
// Geteilte Sammel-Anlage-Logik (#887): POST /shifts/bulk-absence UND die
// Bestätigung eines Urlaubs-/Krankheitsantrags (routes/absence-requests.ts)
// rufen EXAKT dieselbe Funktion. Parität ist Pflicht — s. Gedächtnis "bwavg
// dropped from single-shift path": Einzel- und Sammelpfad sind bereits einmal
// auseinandergelaufen, weil dieselbe Prüfung zweimal implementiert war.
// ---------------------------------------------------------------------------

export class InvalidAbsenceDayError extends Error {}
export class InvalidShiftModelError extends Error {}

// Validiert/dedupliziert rohe Tageseinträge (ein UTC-Kalendertag pro Eintrag,
// Ende nach Beginn) und liefert sie nach Kalendertag sortiert zurück. Wird
// sowohl bei der Sammel-Anlage als auch bei der Antragstellung
// (POST /absence-requests) verwendet, damit ein Antrag beim Anlegen bereits
// dieselben Regeln erfüllt wie die spätere Genehmigung.
export function normalizeAbsenceDays(
  rawDays: { startTime: Date; endTime: Date }[],
): [string, { startTime: Date; endTime: Date }][] {
  const dayMap = new Map<string, { startTime: Date; endTime: Date }>();
  for (const d of rawDays) {
    const durationMs = d.endTime.getTime() - d.startTime.getTime();
    if (durationMs <= 0) {
      throw new InvalidAbsenceDayError(
        "Ungültiger Tageseintrag: Ende muss nach dem Beginn liegen.",
      );
    }
    const startDay = d.startTime.toISOString().split("T")[0]!;
    const endDay = d.endTime.toISOString().split("T")[0]!;
    if (startDay !== endDay) {
      throw new InvalidAbsenceDayError(
        "Ungültiger Tageseintrag: Start und Ende müssen auf demselben UTC-Kalendertag liegen.",
      );
    }
    const key = startDay;
    if (!dayMap.has(key)) dayMap.set(key, { startTime: d.startTime, endTime: d.endTime });
  }
  if (dayMap.size === 0) {
    throw new InvalidAbsenceDayError("Mindestens ein Tag ist erforderlich.");
  }
  return [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export type BulkAbsenceType =
  | "vacation"
  | "sick"
  | "freizeitausgleich"
  | "kind_krank"
  | "freistellung"
  | "abgesagt_ag"
  | "abgesagt_an"
  | "wunschfrei"
  | "urlaubsabgeltung";

export type BulkAbsenceCreationInput = {
  userId: number;
  teamId: number;
  type: BulkAbsenceType;
  days: [string, { startTime: Date; endTime: Date }][];
  shiftModelId?: number | null;
  notes?: string | null;
};

export type BulkAbsenceCreationResult = {
  created: (typeof shiftsTable.$inferSelect)[];
  replaced: number[];
  skippedDates: string[];
};

// Wirft InvalidShiftModelError (Schichtmodell gehört nicht zum Team) oder
// VacationOutsideContractError (Urlaub außerhalb jedes Vertragszeitraums) —
// beide werden vom jeweiligen Aufrufer (Route/Antrags-Bestätigung) auf die
// passende HTTP-Antwort abgebildet.
//
// `outerTx` (Code-Review #887): wenn der Aufrufer bereits eine offene
// Transaktion hält (z. B. die Antrags-Bestätigung unter ihrem eigenen
// Advisory-Lock), MUSS die gesamte Anlage darin laufen — sonst könnte diese
// Funktion auf einer eigenen Pool-Verbindung committen, während die äußere
// Transaktion (Status-Update) anschließend scheitert/zurückrollt. Ergebnis
// wären verwaiste Schichten zu einem PENDING/REJECTED-Antrag. Ohne `outerTx`
// (Einzel-Route POST /shifts/bulk-absence) öffnet die Funktion wie bisher
// ihre eigene Transaktion inkl. Advisory-Lock.
export async function runBulkAbsenceCreation(
  input: BulkAbsenceCreationInput,
  outerTx?: Dbx,
): Promise<BulkAbsenceCreationResult> {
  const { userId, teamId, type, days, notes } = input;
  const shiftModelId = input.shiftModelId ?? null;
  const firstDay = days[0]![0];
  const lastDay = days[days.length - 1]![0];
  const firstDayStart = new Date(`${firstDay}T00:00:00.000Z`);
  const dayAfterLast = new Date(`${lastDay}T00:00:00.000Z`);
  dayAfterLast.setUTCDate(dayAfterLast.getUTCDate() + 1);

  // Schichtmodell muss zum Ziel-Team gehören; Standardzeiten einmal laden.
  let modelDefaults: { start: string; end: string } | null = null;
  if (shiftModelId != null) {
    if (!(await isShiftModelInTeam(shiftModelId, teamId))) {
      throw new InvalidShiftModelError("Schichtmodell gehört nicht zu diesem Team");
    }
    const [model] = await db
      .select({
        defaultStartTime: shiftModelsTable.defaultStartTime,
        defaultEndTime: shiftModelsTable.defaultEndTime,
      })
      .from(shiftModelsTable)
      .where(eq(shiftModelsTable.id, shiftModelId));
    if (model?.defaultStartTime && model?.defaultEndTime) {
      modelDefaults = { start: model.defaultStartTime, end: model.defaultEndTime };
    }
  }
  // Team-weite Schätzbasis für Nachtzuschlag bei ganz freien Ganztags-Tagen
  // (kein ersetzter Dienst, kein gewähltes Schichtmodell) — einmal für den
  // gesamten Zeitraum geladen, s. resolveShiftMetrics/firstActiveShiftModelDefaults.
  const fallbackNightBasis = await firstActiveShiftModelDefaults(teamId);

  // Duplikat-Prüfung UND Anlage laufen unter einem Advisory-Lock pro
  // Zielperson race-sicher in EINER Transaktion: Zwei gleichzeitige identische
  // Aufträge (z. B. Doppelklick in zwei Fenstern) würden sonst beide "Tag ist
  // frei" sehen und die Abwesenheit doppelt buchen — inkl. doppeltem
  // Urlaubsabzug. Der zweite Auftrag wartet am Lock und überspringt die Tage
  // dann als Duplikate (Frontend-Verhalten der bisherigen Schleife).
  //
  // Läuft eine äußere Transaktion mit (outerTx), wird KEINE neue Transaktion
  // geöffnet — Lock, Prüfung und Anlage laufen direkt darin, damit sie mit
  // dem äußeren Status-Update atomar committen/zurückrollen (s. Kommentar
  // oben an der Funktionssignatur).
  const body = async (tx: Dbx): Promise<BulkAbsenceCreationResult> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"shifts-bulk:user:" + userId}))`,
    );

    // Zeitraumdaten NACH dem Lock laden: parallele identische Aufträge sehen
    // damit zuverlässig die Einträge des zuerst abgeschlossenen Auftrags.
    // Ein Request mit vielen Tagen bleibt bei wenigen Reads statt einer
    // sequenziellen Abfragekette pro Kalendertag.
    //
    // Die Verträge gehören ausdrücklich dazu: sie speisen den Vertrags-Guard,
    // die Tages-Soll-Stunden UND die Urlaubskonto-Buchung. Vor dem Lock
    // gelesen, könnte eine parallele Vertragsänderung dazwischenliegen und der
    // Auftrag mit veralteten Vertragsgrenzen anlegen bzw. auf einen nicht mehr
    // passenden Vertrag buchen (Lohn-/Urlaubsdaten).
    const [existingAbsences, plannedWork, ops, allowance, contracts] = await Promise.all([
      tx
        .select({ startTime: shiftsTable.startTime })
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.userId, userId),
            eq(shiftsTable.type, type as "vacation" | "sick"),
            // Sargable Bereichsprädikat aktiviert den (user_id, start_time)-Index.
            gte(shiftsTable.startTime, firstDayStart),
            lt(shiftsTable.startTime, dayAfterLast),
          ),
        ),
      tx
        .select({
          id: shiftsTable.id,
          startTime: shiftsTable.startTime,
          endTime: shiftsTable.endTime,
        })
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.userId, userId),
            eq(shiftsTable.teamId, teamId),
            notInArray(shiftsTable.type, [
              "vacation",
              "sick",
              "freizeitausgleich",
              "team",
              "kind_krank",
              "freistellung",
              "abgesagt_ag",
              "abgesagt_an",
              "urlaubsabgeltung",
              "wunschfrei",
            ]),
            // Sargable Bereichsprädikat aktiviert den (user_id, start_time)-Index.
            gte(shiftsTable.startTime, firstDayStart),
            lt(shiftsTable.startTime, dayAfterLast),
          ),
        ),
      resolveAllowanceOps(teamId, tx),
      allowanceContext(teamId, tx),
      tx
        .select({
          id: contractsTable.id,
          teamId: contractsTable.teamId,
          startDate: contractsTable.startDate,
          endDate: contractsTable.endDate,
          weeklyHours: contractsTable.weeklyHours,
          workdaysPerWeek: contractsTable.workdaysPerWeek,
          vacationHoursUsed: contractsTable.vacationHoursUsed,
        })
        .from(contractsTable)
        .where(eq(contractsTable.userId, userId)),
    ]);

    // URLAUB außerhalb des Vertragszeitraums: pro Tag prüfen (gleiche Semantik
    // wie N Einzel-POSTs, deckt auch Zeiträume über einen Vertragswechsel ab).
    // Läuft im Lock gegen genau die Vertragsdaten, die anschließend gebucht
    // werden; ein Verstoß rollt die Transaktion zurück (ganz oder gar nicht).
    if (type === "vacation") {
      for (const [, t] of days) {
        const msg = vacationOutsideContractErrorFromContracts(
          contracts,
          teamId,
          t.startTime,
          t.endTime,
        );
        if (msg) throw new VacationOutsideContractError(msg);
      }
    }

    const existingDates = new Set(existingAbsences.map((shift) => dayKey(shift.startTime)));
    const plannedByDay = new Map<string, typeof plannedWork>();
    for (const shift of plannedWork) {
      const key = dayKey(shift.startTime);
      const planned = plannedByDay.get(key) ?? [];
      planned.push(shift);
      plannedByDay.set(key, planned);
    }
    for (const planned of plannedByDay.values()) {
      planned.sort(
        (a, b) =>
          b.endTime.getTime() -
          b.startTime.getTime() -
          (a.endTime.getTime() - a.startTime.getTime()),
      );
    }

    const skipped = days.filter(([key]) => existingDates.has(key)).map(([key]) => key);
    const toCreate = days.filter(([key]) => !existingDates.has(key));

    // Zeiten je Tag auflösen wie beim Einzel-POST (Lohnausfallprinzip):
    // geplanter Dienst am Tag → Zeiten erben; sonst optionale Modell-
    // Standardzeiten; sonst ganztägig. Ersetzt werden NUR Dienste an Tagen,
    // die auch wirklich angelegt werden (übersprungene Tage bleiben unberührt).
    //
    // Halbtägiger Urlaub (#862): ein Tageseintrag mit echten (nicht-
    // ganztägigen) Uhrzeiten gilt als bewusst gewählter Zeitraum — die
    // Uhrzeiten kommen vom Nutzer und werden NICHT durch einen geplanten
    // Dienst überschrieben (kein Zeiten-Erben). Ersetzt wird nur, was sich
    // ECHT zeitlich überschneidet; ein Dienst außerhalb des Zeitfensters
    // bleibt unangetastet (anders als beim ganztägigen Fall, der den ganzen
    // Kalendertag beansprucht).
    const resolved = toCreate.map(([key, day]) => {
      const candidates = plannedByDay.get(key) ?? [];
      // Nutzer-Absicht (isPartialAbsence) aus den ROHEN Tages-Uhrzeiten,
      // bevor eine etwaige Erbschaft sie überschreibt (identisch zum
      // Einzel-POST) — sonst sähe ein ganztägiger Eintrag, der die
      // Uhrzeiten eines ersetzten Dienstes erbt, wie ein bewusst gewählter
      // Teil-Tag aus.
      const isPartial = !isPlainFullDay(day.startTime, day.endTime);
      if (isPartial) {
        const overlapping = candidates.filter(
          (s) =>
            s.startTime.getTime() < day.endTime.getTime() &&
            s.endTime.getTime() > day.startTime.getTime(),
        );
        return { times: day, planned: overlapping, isPartialAbsence: true };
      }
      const inherited = candidates[0];
      const times = inherited
        ? { startTime: inherited.startTime, endTime: inherited.endTime }
        : modelDefaults
          ? shiftModelTimesForDay(day.startTime, modelDefaults.start, modelDefaults.end)
          : day;
      return { times, planned: candidates, isPartialAbsence: false };
    });

    const replaced = resolved.flatMap(({ planned }) => planned.map((shift) => shift.id));

    // REIHENFOLGE: Löschen der ersetzten Dienste läuft VOR der Berechnung —
    // exakt wie der Einzelpfad, der deleteReplacedWorkShift ebenfalls vor
    // storeShiftMetrics aufruft. Relevant wird das im Sammelauftrag, weil der
    // ersetzte Dienst eines FRÜHEREN Tages im 13-Wochen-Fenster eines
    // SPÄTEREN Tages liegt: Bei N Einzel-Requests ist er dann bereits
    // gelöscht. Würde hier zuerst gerechnet, zählte er noch mit und der
    // Sammelweg käme auf einen anderen Durchschnitt. (Der ersetzte Dienst des
    // eigenen Tages liegt ohnehin außerhalb — das Fenster endet am Stichtag.)
    // Abgesichert durch dienstplan-bulk-absence-bwavg-ersetzung-api.spec.ts.
    if (replaced.length > 0) {
      await tx.delete(timeTrackingTable).where(inArray(timeTrackingTable.shiftId, replaced));
      await tx.delete(shiftsTable).where(inArray(shiftsTable.id, replaced));
    }

    const prepared = resolved.map(({ times, isPartialAbsence }) => {
      const targetHours = dailyTargetHoursFromContracts(contracts, times.startTime);
      const teamContract = contractForDay(contracts, times.startTime, teamId);
      const contractHours =
        teamContract && teamContract.weeklyHours > 0 && teamContract.workdaysPerWeek > 0
          ? Math.round((teamContract.weeklyHours / teamContract.workdaysPerWeek) * 100) / 100
          : null;
      const isFullDay = isPlainFullDay(times.startTime, times.endTime);
      const durationHours =
        Math.round(((times.endTime.getTime() - times.startTime.getTime()) / 3_600_000) * 100) /
        100;
      const absenceHours = (fallback: number) =>
        !isFullDay
          ? durationHours
          : contractHours ?? fallback;
      const plannedHours = absenceHours(targetHours);
      const metrics = resolveShiftMetrics(
        {
          type,
          startTime: times.startTime,
          endTime: times.endTime,
          plannedHours,
          valuationPercent: 100,
          fallbackNightBasis,
        },
        allowance.window,
        allowance.state,
      );
      return {
        ...times,
        plannedHours,
        vacationHours: absenceHours(ops.vacationHoursPerDay),
        metrics,
        isPartialAbsence,
      };
    });

    const created =
      prepared.length > 0
        ? await tx
            .insert(shiftsTable)
            .values(
              prepared.map((shift) => ({
                userId,
                teamId,
                startTime: shift.startTime,
                endTime: shift.endTime,
                type,
                shiftModelId: shiftModelId ?? null,
                notes: notes ?? null,
                planningStatus: "FIX" as const,
                isVertretung: false,
                pauseMinutes: 0,
                isPartialAbsence: shift.isPartialAbsence,
                ...shift.metrics,
              })),
            )
            .returning()
        : [];
    if (created.length > 0) {
      await tx.insert(timeTrackingTable).values(
        created.map((shift, index) => ({
          userId: shift.userId,
          teamId: shift.teamId!,
          shiftId: shift.id,
          actualStart: shift.startTime,
          actualEnd: shift.endTime,
          actualHours: prepared[index]!.plannedHours,
          status: "confirmed" as const,
        })),
      );
    }

    // Urlaubszähler EINMAL fortschreiben: Stunden je Tag auflösen, aber je
    // aktivem Vertrag bündeln (ein Zeitraum kann einen Vertragswechsel
    // überspannen — jeder Tag bucht auf SEINEN Vertrag, wie N Einzel-POSTs).
    if (type === "vacation" && created.length > 0) {
      const byContract = new Map<
        number,
        { contract: { id: number; vacationHoursUsed: number }; delta: number }
      >();
      for (const [index, shift] of created.entries()) {
        const hours = prepared[index]!.vacationHours;
        const contract = contractForDay(contracts, new Date(shift.startTime));
        if (!contract) continue;
        const entry = byContract.get(contract.id) ?? { contract, delta: 0 };
        entry.delta += hours;
        byContract.set(contract.id, entry);
      }
      for (const { contract, delta } of byContract.values()) {
        await applyVacationDelta(contract, delta, tx);
      }
    }
    return { created, replaced, skippedDates: skipped };
  };

  return outerTx ? body(outerTx) : db.transaction(body);
}
