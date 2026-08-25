import { Router } from "express";
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
import {
  ListShiftsQueryParams,
  CreateShiftBody,
  BulkCreateAbsenceBody,
  BulkCreateShiftsBody,
  BulkDeleteShiftsBody,
  SendShiftProposalsBody,
  BulkConfirmOwnShiftsBody,
  BulkConfirmShiftsBody,
  GetShiftParams,
  UpdateShiftParams,
  UpdateShiftBody,
  DeleteShiftParams,
} from "@workspace/api-zod";
import { sendProposalEmail, sendSickLeaveNotification } from "../lib/mailer";
import { getBaseUrl } from "../lib/base-url";
import { requireAuth, requireAdmin, requireTeamPlanningOrAdmin, isAdminLikeRole } from "../middleware/auth";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  getTeamIdsWithCapability,
  parseTeamIdParam,
  isUserMemberOfTeam,
  isKoordinatorUser,
  isShiftModelInTeam,
} from "../lib/teams";
import {
  isAbsenceType,
  isPlainFullDay,
  resolveShiftMetrics,
  deriveDayWindowFromDefaults as shiftModelTimesForDay,
} from "../lib/shift-metrics-resolve";
import {
  absenceHoursFor,
  resolveVacationHours,
} from "../lib/vacation-hours";
import { userHasFeature, getUserLimit } from "../lib/plan";
import { resolveAllowanceOps } from "../lib/allowance-resolve";

const router = Router();

// Aliase für die zwei Teamtabellen-JOINs im SHIFT_SELECT-Projektor.
// Ersetzen korrelierte Subqueries (einen Subselect pro Zeile) durch effiziente
// LEFT JOINs, die der Planer einmal ausführt und über alle Zeilen wiederverwendet.
const einsatzTeamsTable = alias(teamsTable, "einsatz_teams");
const homeTeamsTable = alias(teamsTable, "home_teams");

// Transaktions-Executor: Schreib-Helfer akzeptieren wahlweise die globale
// db-Instanz oder eine offene Drizzle-Transaktion (Sammel-Anlage, s. u.).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Dbx = typeof db | DbTx;

const SHIFT_SELECT = {
  id: shiftsTable.id,
  userId: shiftsTable.userId,
  startTime: shiftsTable.startTime,
  endTime: shiftsTable.endTime,
  type: shiftsTable.type,
  planningStatus: shiftsTable.planningStatus,
  shiftModelId: shiftsTable.shiftModelId,
  notes: shiftsTable.notes,
  isVertretung: shiftsTable.isVertretung,
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

async function activeContractFor(userId: number, date: Date, dbx: Dbx = db) {
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

function dayKey(value: Date | string): string {
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
async function bookAbsenceTimeTracking(shift: AbsenceShift, dbx: Dbx = db): Promise<void> {
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
async function syncAbsenceTimeTracking(shift: AbsenceShift, dbx: Dbx = db): Promise<void> {
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

async function removeAbsenceTimeTracking(
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
async function applyVacationDelta(
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
async function adjustVacationHours(
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
async function vacationOutsideContractError(
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
async function findDuplicateAbsence(
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
function duplicateAbsenceResponseBody(existingId: number, type: string) {
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
async function teamMeetingEnabledForTeam(teamId: number): Promise<boolean> {
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
async function findDuplicateTeamEntry(
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
function normalizeTeamEntryTimes(startTime: Date): {
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
async function valuationPercentFor(type: string, shiftModelId: number | null): Promise<number> {
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
async function allowanceContext(
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
async function storeShiftMetrics(shift: {
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
async function findOverlappingShifts(
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
function overlapResponseBody(conflicts: ShiftConflict[]) {
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

router.get("/shifts", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    type: req.query.type,
    // Bewusst NICHT zod.coerce.boolean() vertrauen (Boolean("false") === true);
    // nur der literale String "true" schaltet den Zeitraum-Default ab.
    all: req.query.all === "true" ? true : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  // Team-Freigeschaltete (assistant-Rolle mit is_teamleiter=true ODER
  // gestufter Freischaltung ab Basis) erhalten die team-weite Sicht auf alle
  // Dienste dieser Teams — nicht nur die eigenen.
  const tlTeamIds = isAdminLikeRole(req.session.role!)
    ? null
    : await getTeamIdsWithCapability(req.session.userId!, "read");
  const isTeamleiterUser = tlTeamIds != null && tlTeamIds.length > 0;

  const effectiveUserId =
    req.session.role === "assistant" && !isTeamleiterUser ? req.session.userId! : query.data.userId;

  const teamScope = await resolveReadTeamScope(
    req.session.userId!,
    parseTeamIdParam(req),
    isTeamleiterUser ? tlTeamIds! : undefined,
  );
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  // Aushilfe-Spiegel: Schichten anderer (eigener) Teams, die als "Einsatz für"
  // ein Team im Scope markiert sind, erscheinen zusätzlich in dessen Kalender
  // (dort schreibgeschützt; Stunden zählen weiterhin nur im Stammteam).
  // Task #793: Abwesenheits-Zeilen von Aushilfe-Nutzern ebenfalls mitliefern,
  // damit der Kalender das Ausfall-Icon auch für Fremdeinsätze korrekt zeigt.
  // Abwesenheiten können kein einsatzTeamId tragen (Validierung schlägt das
  // fehl, ~Z. 1015), daher erkennt das EXISTS die Nutzer über ihren Aushilfe-
  // Arbeitsdienst im Ziel-Team am selben Kalendertag.
  const aushilfeTeamScopeAny = sql`ANY(ARRAY[${sql.join(teamScope.map((id) => sql`${id}`), sql`, `)}]::int[])`;
  const conditions = [
    or(
      inArray(shiftsTable.teamId, teamScope),
      inArray(shiftsTable.einsatzTeamId, teamScope),
      and(
        sql`${shiftsTable.type} IN ('vacation','sick','freizeitausgleich','kind_krank','freistellung','abgesagt_ag','abgesagt_an','urlaubsabgeltung')`,
        sql`EXISTS (
          SELECT 1 FROM shifts a
          WHERE a.user_id = ${shiftsTable.userId}
            AND a.einsatz_team_id = ${aushilfeTeamScopeAny}
            AND a.start_time::date = ${shiftsTable.startTime}::date
        )`
      )
    )!,
  ];
  if (effectiveUserId) conditions.push(eq(shiftsTable.userId, effectiveUserId));
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day" | "vacation" | "sick" | "work" | "freizeitausgleich" | "team" | "kind_krank" | "freistellung" | "abgesagt_ag" | "abgesagt_an" | "urlaubsabgeltung"));
  // Zeitraum-Default: ohne month/year UND ohne explizites all=true liefert die
  // Route nicht mehr die gesamte Historie, sondern nur den aktuellen
  // Kalendermonat (Performance). year allein (ohne month) filtert auf das
  // ganze Jahr — deckt Jahreskalender wie AbwesenheitsKalender ab. all=true
  // ist der bewusste Opt-out für Team-Übersichten/Exporte, die tatsächlich
  // die volle Historie brauchen (z. B. die Abwesenheiten-Seite). Bereits auf
  // eine einzelne Person eingegrenzte Abfragen (effectiveUserId gesetzt —
  // explizit oder durch die Assistenz-Selbstsicht erzwungen) sind naturgemäß
  // klein und bleiben unbegrenzt, damit z. B. die Duplikat-Prüfung über
  // Jahresgrenzen hinweg weiterhin funktioniert.
  const now = new Date();
  let rangeStart: Date | undefined;
  let rangeEnd: Date | undefined;
  if (query.data.month && query.data.year) {
    // Sargable Monatsgrenze statt EXTRACT(): ermöglicht Indexnutzung auf start_time.
    rangeStart = new Date(Date.UTC(query.data.year, query.data.month - 1, 1));
    rangeEnd = new Date(Date.UTC(query.data.year, query.data.month, 1));
  } else if (query.data.year) {
    rangeStart = new Date(Date.UTC(query.data.year, 0, 1));
    rangeEnd = new Date(Date.UTC(query.data.year + 1, 0, 1));
  } else if (!query.data.all && !effectiveUserId) {
    rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  if (rangeStart && rangeEnd) {
    conditions.push(gte(shiftsTable.startTime, rangeStart));
    conditions.push(lt(shiftsTable.startTime, rangeEnd));
  }

  const rows = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
    .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(rows);
});

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
async function findPlannedWorkShiftsForDay(
  userId: number,
  teamId: number,
  rangeStart: Date,
  rangeEnd: Date
): Promise<{ id: number; startTime: Date; endTime: Date }[]> {
  const dayStart = new Date(
    `${rangeStart.toISOString().split("T")[0]}T00:00:00.000Z`
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const rows = await db
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
export async function runBulkAbsenceCreation(
  input: BulkAbsenceCreationInput,
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
  return db.transaction(async (tx) => {
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
  });
}

router.post("/shifts", requireAuth, async (req, res): Promise<void> => {
  const body = CreateShiftBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Berechtigungsstufen: Admins und Teamleiter dürfen Schichten UND
  // Abwesenheiten für ihren Scope anlegen. Reine Assistenzkräfte dürfen seit
  // der Menü-Neustrukturierung (§3) AUSSCHLIESSLICH eigene Abwesenheiten
  // (Urlaub/Krank) eintragen — alles andere bleibt 403. Dieser Authz-Check
  // steht bewusst VOR jeder inhaltlichen Prüfung (kein Daten-Orakel).
  const isAdmin = isAdminLikeRole(req.session.role!);
  const teamleiterTeams = isAdmin
    ? []
    : await getTeamIdsWithCapability(req.session.userId!, "plan");
  const isPrivileged = isAdmin || teamleiterTeams.length > 0;
  if (!isPrivileged) {
    if (!isAbsenceType(body.data.type) || body.data.userId !== req.session.userId) {
      res.status(403).json({ error: "Keine Berechtigung" });
      return;
    }
    // #887: reine Assistenzkräfte legen Urlaub/Krank NICHT mehr direkt an —
    // die Selbsteintragung läuft ausschließlich über POST /absence-requests
    // (Bestätigungspflicht durch einen Planer). Andere Abwesenheitsarten
    // (freizeitausgleich, kind_krank, ...) bleiben von #887 unberührt.
    if (body.data.type === "vacation" || body.data.type === "sick") {
      res.status(403).json({
        error: "Bitte über den Urlaubs-/Krankheitsantrag einreichen.",
        code: "absence_requires_request",
      });
      return;
    }
  }

  // Team-Scope + Member-Invariante MÜSSEN vor allen inhaltlichen Prüfungen
  // stehen (Überschneidung/Doppel-Abwesenheit), sonst könnte ein fremder Admin
  // per 409-Antwort Schichtzeiten/Abwesenheiten teamfremder Nutzer ausspähen.
  // Teamleiter erhalten nur Zugriff auf ihre Teamleiter-Teams (effectiveTeams).
  // Für reine Assistenzkräfte bleibt effectiveTeams leer → resolveWriteTeamId
  // fällt auf ihre Mitglieds-Teams (getAllowedTeamIds) bzw. das Standard-Team
  // zurück; die Ziel-Person ist oben bereits auf sie selbst fixiert.
  const effectiveTeams = isAdmin ? undefined : teamleiterTeams;

  // Mehr-Team-Assistenzkräfte (§3): Ohne explizite teamId würde die Abwesenheit
  // sonst stumpf im ERSTEN Mitglieds-Team landen. Ist ein Schichtmodell gewählt,
  // ist dessen Team die eindeutig gemeinte Ziel-Absicht — wir leiten die teamId
  // daraus ab (nur wenn die Assistenzkraft dort wirklich Mitglied ist; sonst
  // greift unten die normale forbidden/Modell-Team-Prüfung).
  let requestedTeamId = body.data.teamId ?? undefined;
  if (!isPrivileged && requestedTeamId == null && body.data.shiftModelId != null) {
    const [model] = await db
      .select({ teamId: shiftModelsTable.teamId })
      .from(shiftModelsTable)
      .where(eq(shiftModelsTable.id, body.data.shiftModelId))
      .limit(1);
    if (model && (await getAllowedTeamIds(req.session.userId!)).includes(model.teamId)) {
      requestedTeamId = model.teamId;
    }
  }

  const write = await resolveWriteTeamId(
    req.session.userId!,
    requestedTeamId,
    effectiveTeams?.length ? effectiveTeams : undefined,
  );
  if (!write.ok) {
    if (write.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team zugeordnet" });
    }
    return;
  }

  // Member-of-Team-Invariante (wie contracts/time_tracking): Der zugeordnete
  // Nutzer muss Mitglied des ZIEL-Teams sein — sonst ließe sich ein teamfremder
  // userId in ein erlaubtes Team verknüpfen und dessen PII über gescopte Listen
  // auslesen.
  if (!(await isUserMemberOfTeam(body.data.userId, write.teamId))) {
    res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
    return;
  }

  // Koordinatoren sind Verwaltungspersonen, nie Personal: Für sie werden
  // keine Dienste oder Abwesenheiten geplant (sonst tauchten sie im
  // Dienstplan und in Stundenauswertungen als Pseudo-Assistenzkraft auf).
  if (await isKoordinatorUser(body.data.userId)) {
    res.status(403).json({
      error: "Für Teamkoordinatoren können keine Dienste geplant werden.",
    });
    return;
  }

  // Team-Dienst (Teamsitzung): nur erlaubt, wenn der Konto-Schalter des
  // Team-Eigentümers AN ist (Bestandsschutz: bestehende Einträge bleiben).
  if (body.data.type === "team") {
    if (!(await teamMeetingEnabledForTeam(write.teamId))) {
      res.status(400).json({
        error:
          "Der Team-Dienst (Teamsitzung) ist in den Einstellungen deaktiviert.",
        code: "team_meeting_disabled",
      });
      return;
    }
    // Ein Team-Eintrag pro Tag und Team genügt — Duplikate würden die
    // Stunden-Gutschrift verdoppeln.
    const duplicate = await findDuplicateTeamEntry(
      write.teamId,
      new Date(body.data.startTime),
      null
    );
    if (duplicate) {
      res.status(409).json({
        error: "Für dieses Team besteht an diesem Tag bereits ein Team-Eintrag.",
        code: "team_meeting_duplicate" as const,
        existingShiftId: duplicate.id,
      });
      return;
    }
  }

  // Kollisionsprüfung: nur für reguläre Schichten und nur, wenn der Admin nicht
  // bewusst überschreibt (force). force kommt aus dem Roh-Body, nicht aus dem
  // validierten Schema, damit die OpenAPI-Spec unverändert bleibt.
  const force = req.body?.force === true;
  if (!isAbsenceType(body.data.type) && body.data.type !== "team" && !force) {
    const conflicts = await findOverlappingShifts(
      body.data.userId,
      body.data.startTime,
      body.data.endTime,
      null
    );
    if (conflicts.length > 0) {
      res.status(409).json(overlapResponseBody(conflicts));
      return;
    }
  }

  // Doppelte Abwesenheit am selben Tag serverseitig verhindern: sonst entstünde
  // ein zweiter Urlaubs-/Krank-Eintrag und vacationDaysUsed würde erneut erhöht.
  if (isAbsenceType(body.data.type)) {
    const duplicate = await findDuplicateAbsence(
      body.data.userId,
      body.data.type,
      body.data.startTime,
      null
    );
    if (duplicate) {
      res.status(409).json(duplicateAbsenceResponseBody(duplicate.id, body.data.type));
      return;
    }
  }

  // Free-Limit (historyMonths): Vorausplanung in zu weit entfernte Zukunfts-
  // Monate sperren (Plan des Team-Eigentuemers maßgeblich, Bestandsschutz).
  if (await forwardPlanningBlocked(write.teamId, req.session.userId!, body.data.startTime, res)) {
    return;
  }

  // URLAUB außerhalb des Vertragszeitraums blockieren (VOR allen Seiteneffekten
  // wie dem Löschen ersetzter Dienste): sonst zählt der Urlaubszähler still falsch.
  if (body.data.type === "vacation") {
    const msg = await vacationOutsideContractError(
      body.data.userId,
      write.teamId,
      body.data.startTime,
      body.data.endTime
    );
    if (msg) {
      res.status(400).json({ error: msg, code: "vacation_outside_contract" });
      return;
    }
  }

  // Aushilfe-Einsatz: Ziel muss ein ANDERES erlaubtes Team des Aufrufers sein;
  // Abwesenheiten können kein Einsatz sein (Urlaub/Krankheit "für" ein anderes
  // Team ergibt keinen Sinn und würde den Spiegel-Eintrag verfälschen).
  if (body.data.einsatzTeamId != null) {
    if (isAbsenceType(body.data.type) || body.data.type === "team") {
      res.status(400).json({ error: "Abwesenheiten und Team-Einträge können kein Aushilfe-Einsatz sein" });
      return;
    }
    if (body.data.einsatzTeamId === write.teamId) {
      res.status(400).json({ error: "Einsatz-Team muss ein anderes Team sein" });
      return;
    }
    const allowedForEinsatz = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    if (!allowedForEinsatz.includes(body.data.einsatzTeamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
  }

  // Das verknüpfte Schichtmodell muss zum Ziel-Team gehören, sonst flössen die
  // Wertungs-/Zuschlagsparameter eines fremden Teams in die Auswertung ein.
  if (body.data.shiftModelId != null) {
    if (!(await isShiftModelInTeam(body.data.shiftModelId, write.teamId))) {
      res.status(403).json({ error: "Schichtmodell gehört nicht zu diesem Team" });
      return;
    }
  }

  // Abwesenheiten (Urlaub/Krankheit) sind produktseitig IMMER verbindlich: Der
  // Planungsstatus wird serverseitig autoritativ auf FIX gesetzt, unabhängig vom
  // Client und vom Erstellungsweg (Abwesenheiten-Seite ODER Kalender-Schicht-
  // Dialog). Sonst entstünde eine VORLAEUFIG-Abwesenheit als Sackgasse: Sie
  // zählt nicht in den Auswertungen und lässt sich über die Kalender-
  // Sammelbestätigung (die Abwesenheiten bewusst ausschließt) nie bestätigen.
  // Halbtägiger Urlaub (#862): die NUTZER-ABSICHT (ganztägig vs. bewusst
  // gewählter Teil-Zeitraum) muss VOR jeder Zeiten-Auflösung (Lohnausfall-
  // Erbschaft weiter unten) aus den ROHEN Eingabewerten bestimmt werden — der
  // Frontend-Vertrag sendet für "ganztägig" immer den 00:00–23:59-Sentinel,
  // für einen Teil-Tag echte, unterschiedliche Uhrzeiten. Nach der Erbschaft
  // sähen beide Fälle gleich aus (echte Uhrzeiten), s. isPartialAbsence-Spalte.
  const isPartialAbsence =
    isAbsenceType(body.data.type) &&
    !isPlainFullDay(new Date(body.data.startTime), new Date(body.data.endTime));

  const insertValues = {
    ...body.data,
    teamId: write.teamId,
    // Abwesenheiten UND Team-Einträge sind produktseitig immer verbindlich.
    // Vertretungs-Markierung und Pausenminuten sind reine Arbeitsdienst-Infos
    // und werden dort serverseitig zurückgesetzt.
    ...(isAbsenceType(body.data.type) || body.data.type === "team"
      ? { planningStatus: "FIX" as const, isVertretung: false, pauseMinutes: 0 }
      : {}),
    ...(isAbsenceType(body.data.type) ? { isPartialAbsence } : {}),
  };

  // Team-Einträge ganztägig erzwingen (serverseitig autoritativ, s. Helper).
  if (body.data.type === "team") {
    const normalized = normalizeTeamEntryTimes(insertValues.startTime);
    insertValues.startTime = normalized.startTime;
    insertValues.endTime = normalized.endTime;
  }

  // Abwesenheits-Zeiten auflösen (Lohnausfallprinzip, Punkt 2 & 3):
  //  • Primary: existiert am Tag bereits ein geplanter Dienst, "überschreibt" die
  //    Abwesenheit ihn — sie erbt dessen exakte Start-/Endzeit (und damit Stunden
  //    + Zuschlagspotenzial); der Dienst wird entfernt (keine Doppelbuchung).
  //  • Fallback (leerer Tag): ist optional ein Schichtmodell verknüpft, gelten
  //    dessen Standardzeiten. Sonst bleibt es ein ganztägiger Eintrag (00:00–23:59
  //    aus dem Frontend → vertragliche Tages-Soll-Stunden, keine Zuschläge).
  // Abwesenheits-Zeiten auflösen: vorher geplante Arbeitsdienste lesen (Read
  // außerhalb der Transaktion, rein lesend) — IDs werden innerhalb der
  // Transaktion per Batch-Delete ersetzt.
  // Halbtägiger Urlaub (#862): ein Eintrag mit echten (nicht-ganztägigen)
  // Uhrzeiten gilt als bewusst gewählter Zeitraum — die Uhrzeiten kommen vom
  // Nutzer und werden NICHT durch einen geplanten Dienst oder Modell-
  // Standardzeiten überschrieben (kein Zeiten-Erben, identisch zum
  // Bulk-Pfad). Ersetzt (gelöscht) wird trotzdem nur, was sich ECHT zeitlich
  // mit dem gewählten Fenster überschneidet — findPlannedWorkShiftsForDay
  // filtert das bereits serverseitig.
  let plannedForDelete: number[] = [];
  if (isAbsenceType(body.data.type)) {
    const planned = await findPlannedWorkShiftsForDay(
      body.data.userId,
      write.teamId,
      new Date(body.data.startTime),
      new Date(body.data.endTime)
    );
    if (planned.length > 0) {
      plannedForDelete = planned.map((p) => p.id);
      if (!isPartialAbsence) {
        insertValues.startTime = planned[0]!.startTime;
        insertValues.endTime = planned[0]!.endTime;
      }
    } else if (!isPartialAbsence && body.data.shiftModelId != null) {
      const [model] = await db
        .select({
          defaultStartTime: shiftModelsTable.defaultStartTime,
          defaultEndTime: shiftModelsTable.defaultEndTime,
        })
        .from(shiftModelsTable)
        .where(eq(shiftModelsTable.id, body.data.shiftModelId));
      if (model?.defaultStartTime && model?.defaultEndTime) {
        const t = shiftModelTimesForDay(
          new Date(body.data.startTime),
          model.defaultStartTime,
          model.defaultEndTime
        );
        insertValues.startTime = t.startTime;
        insertValues.endTime = t.endTime;
      }
    }
  }

  // Alle Schreiboperationen transaktional: Batch-Delete ersetzte Arbeitsdienste
  // (inkl. Zeiterfassungs-Einträge), INSERT, Kennzahlen, TT-Buchung und
  // Urlaubskonto-Fortschreibung in einem atomaren Block.
  const withUser = await db.transaction(async (tx) => {
    // Batch-delete ersetzte Arbeitsdienste in zwei inArray-Statements statt
    // N+1 sequenzieller Einzellöschungen (identisches Muster wie bulk-absence).
    if (plannedForDelete.length > 0) {
      await tx.delete(timeTrackingTable).where(inArray(timeTrackingTable.shiftId, plannedForDelete));
      await tx.delete(shiftsTable).where(inArray(shiftsTable.id, plannedForDelete));
    }

    const [shift] = await tx.insert(shiftsTable).values(insertValues).returning();

    await storeShiftMetrics(shift, tx);

    if (isAbsenceType(shift.type)) {
      await bookAbsenceTimeTracking(shift, tx);
      if (shift.type === "vacation") {
        const hours = await resolveVacationHours(
          shift.userId,
          shift.teamId,
          shift.startTime,
          shift.endTime,
          tx
        );
        await adjustVacationHours(shift.userId, new Date(shift.startTime), hours, tx);
      }
    }

    const [row] = await tx
      .select(SHIFT_SELECT)
      .from(shiftsTable)
      .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
      .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
      .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
      .where(eq(shiftsTable.id, shift.id));
    return row;
  });
  res.status(201).json(withUser);
});

// Sammel-Anlage eines Abwesenheits-Zeitraums (Task #715): legt N Kalendertage
// derselben Abwesenheitsart transaktional in EINEM Request an. Motivation:
// Die Einzel-Anlage kostet pro Tag einen vollen Request inkl. Urlaubskonto-
// Fortschreibung (~Sekunden), ein mehrwöchiger Urlaub dauerte Minuten und
// konnte bei Netzwerkfehlern halb angelegt liegen bleiben. Regeln identisch
// zum Einzel-POST; Unterschiede bewusst:
//  • Duplikate (vorhandene Abwesenheit desselben Typs am Tag) werden
//    ÜBERSPRUNGEN und gemeldet statt mit 409 abzubrechen.
//  • Der Urlaubszähler wird EINMAL am Ende fortgeschrieben (gebündelt je
//    aktivem Vertrag), nicht pro Tag.
//  • Scheitert irgendein Tag (z. B. Urlaub außerhalb des Vertrags), wird
//    NICHTS angelegt (Transaktion, kein Teil-Zeitraum).
router.post("/shifts/bulk-absence", requireAuth, async (req, res): Promise<void> => {
  const body = BulkCreateAbsenceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { userId, type, shiftModelId } = body.data;

  // Authz identisch zum Einzel-POST — VOR jeder inhaltlichen Prüfung (kein
  // Daten-Orakel): reine Assistenzkräfte dürfen nur EIGENE Abwesenheiten
  // eintragen (der Typ ist per Schema bereits auf Abwesenheiten beschränkt).
  const isAdmin = isAdminLikeRole(req.session.role!);
  const teamleiterTeams = isAdmin
    ? []
    : await getTeamIdsWithCapability(req.session.userId!, "plan");
  const isPrivileged = isAdmin || teamleiterTeams.length > 0;
  if (!isPrivileged && userId !== req.session.userId) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  // #887: reine Assistenzkräfte legen Urlaub/Krank NICHT mehr direkt an —
  // die Selbsteintragung läuft ausschließlich über POST /absence-requests
  // (Bestätigungspflicht durch einen Planer). Dieser Endpunkt bleibt für
  // Planer/Admins (fremde Person) UND für die interne Antrags-Bestätigung
  // (die runBulkAbsenceCreation direkt aufruft, ohne über HTTP zu gehen)
  // unverändert nutzbar.
  if (!isPrivileged && (type === "vacation" || type === "sick")) {
    res.status(403).json({
      error: "Bitte über den Urlaubs-/Krankheitsantrag einreichen.",
      code: "absence_requires_request",
    });
    return;
  }
  const effectiveTeams = isAdmin ? undefined : teamleiterTeams;

  // teamId-Ableitung aus dem Schichtmodell (Mehr-Team-Assistenzkräfte, §3) —
  // gleiche Logik wie beim Einzel-POST.
  let requestedTeamId = body.data.teamId ?? undefined;
  if (!isPrivileged && requestedTeamId == null && shiftModelId != null) {
    const [model] = await db
      .select({ teamId: shiftModelsTable.teamId })
      .from(shiftModelsTable)
      .where(eq(shiftModelsTable.id, shiftModelId))
      .limit(1);
    if (model && (await getAllowedTeamIds(req.session.userId!)).includes(model.teamId)) {
      requestedTeamId = model.teamId;
    }
  }

  const write = await resolveWriteTeamId(
    req.session.userId!,
    requestedTeamId,
    effectiveTeams?.length ? effectiveTeams : undefined,
  );
  if (!write.ok) {
    if (write.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team zugeordnet" });
    }
    return;
  }
  if (!(await isUserMemberOfTeam(userId, write.teamId))) {
    res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
    return;
  }

  // Koordinatoren sind Verwaltungspersonen, nie Personal (wie Einzel-Route).
  if (await isKoordinatorUser(userId)) {
    res.status(403).json({
      error: "Für Teamkoordinatoren können keine Dienste geplant werden.",
    });
    return;
  }

  // Kalendertage normalisieren und deduplizieren (ein Eintrag pro Tag,
  // aufsteigend). Ohne Dedupe würden doppelte Tage im selben Request den
  // Duplikatschutz umgehen (die Vorprüfung sieht nur Bestandsdaten). Jeder
  // Eintrag muss genau einen UTC-Kalendertag umfassen — DST-neutral (s.
  // normalizeAbsenceDays).
  let days: [string, { startTime: Date; endTime: Date }][];
  try {
    days = normalizeAbsenceDays(body.data.days);
  } catch (err) {
    if (err instanceof InvalidAbsenceDayError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Free-Limit (historyMonths) gegen den SPÄTESTEN Tag — ein Verstoß blockt
  // den gesamten Zeitraum (kein Teil-Zeitraum).
  const latest = days[days.length - 1]![1].startTime;
  if (await forwardPlanningBlocked(write.teamId, req.session.userId!, latest, res)) {
    return;
  }

  let txResult: BulkAbsenceCreationResult;
  try {
    txResult = await runBulkAbsenceCreation({
      userId,
      teamId: write.teamId,
      type,
      days,
      shiftModelId,
      notes: body.data.notes,
    });
  } catch (err) {
    // Vertrags-Guard aus der gesperrten Transaktion: nichts wurde geschrieben.
    if (err instanceof VacationOutsideContractError) {
      res.status(400).json({ error: err.message, code: "vacation_outside_contract" });
      return;
    }
    if (err instanceof InvalidShiftModelError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
  const {
    created: createdShifts,
    replaced: replacedShiftIds,
    skippedDates,
  } = txResult;

  // Krankmeldungs-Benachrichtigung: wenn sich eine Assistenzkraft selbst krank
  // meldet (nicht privilegiert, Typ = sick, mind. ein Tag angelegt), bekommt
  // der Team-Eigentümer per E-Mail Bescheid. Fire-and-forget — blockiert die
  // Antwort nicht und scheitert still (nur console.warn bei Fehler).
  if (type === "sick" && !isPrivileged && createdShifts.length > 0) {
    void (async () => {
      try {
        const [team] = await db
          .select({ ownerId: teamsTable.ownerId })
          .from(teamsTable)
          .where(eq(teamsTable.id, write.teamId))
          .limit(1);
        if (!team?.ownerId) return;
        const [ownerRow, assistantRow] = await Promise.all([
          db
            .select({ email: usersTable.email })
            .from(usersTable)
            .where(eq(usersTable.id, team.ownerId))
            .limit(1)
            .then((r) => r[0]),
          db
            .select({ name: usersTable.name })
            .from(usersTable)
            .where(eq(usersTable.id, userId))
            .limit(1)
            .then((r) => r[0]),
        ]);
        if (ownerRow?.email && assistantRow?.name) {
          await sendSickLeaveNotification(
            ownerRow.email,
            assistantRow.name,
            createdShifts.map((s) => new Date(s.startTime)),
            getBaseUrl(),
          );
        }
      } catch (err) {
        console.warn("Krankmeldungs-Benachrichtigung fehlgeschlagen:", err);
      }
    })();
  }

  // Angelegte Einträge in Listen-Form (wie GET /shifts) mitliefern: der Client
  // fügt sie direkt in den Cache ein, statt auf einen Monats-Reload zu warten.
  const createdRows =
    createdShifts.length > 0
      ? await db
          .select(SHIFT_SELECT)
          .from(shiftsTable)
          .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
          .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
          .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
          .where(inArray(shiftsTable.id, createdShifts.map((s) => s.id)))
      : [];

  res.status(201).json({
    teamId: write.teamId,
    createdCount: createdShifts.length,
    skippedCount: skippedDates.length,
    skippedDates,
    shiftIds: createdShifts.map((s) => s.id),
    shifts: createdRows,
    replacedShiftIds,
  });
});

// Sammel-Anlage von Diensten: legt dieselbe Schicht für N Kalendertage
// transaktional in EINEM Request an (ganz oder gar nicht). Motivation: Die
// Mehrfachauswahl im Dienstplan schickte bisher pro Tag einen sequenziellen
// Einzel-POST — viele Tage bedeuteten viele Wartezeiten und konnten bei
// Netzwerkfehlern halb angelegt liegen bleiben. Regeln identisch zum
// Einzel-POST; Unterschiede bewusst:
//  • Nur Arbeitsdienste und Team-Einträge — Abwesenheiten laufen über
//    /shifts/bulk-absence (eigene Ersetzungs-/Urlaubskonto-Logik).
//  • Überschneidungen werden VOR dem Anlegen für ALLE Tage geprüft: ohne
//    force wird bei Konflikten NICHTS angelegt und die betroffenen Tage
//    werden gemeldet (409, conflictDates) — der Client bietet dann wie beim
//    Einzel-Anlegen "Trotzdem anlegen" an.
router.post("/shifts/bulk", requireAuth, async (req, res): Promise<void> => {
  const body = BulkCreateShiftsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { userId, type, shiftModelId } = body.data;

  // Authz VOR jeder inhaltlichen Prüfung (kein Daten-Orakel): Arbeitsdienste
  // sind nie Selbstservice — nur Admins und Teamleiter mit Planungsrecht.
  const isAdmin = isAdminLikeRole(req.session.role!);
  const teamleiterTeams = isAdmin
    ? []
    : await getTeamIdsWithCapability(req.session.userId!, "plan");
  const isPrivileged = isAdmin || teamleiterTeams.length > 0;
  if (!isPrivileged) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  const effectiveTeams = isAdmin ? undefined : teamleiterTeams;

  // ── Gruppe 1 (parallel): Team-Auflösung + Koordinator-Check ────────────────
  // isKoordinatorUser hängt nur von userId ab — kann gleichzeitig mit
  // resolveWriteTeamId laufen, das teamId nicht kennt.
  const [write, isKoordinator] = await Promise.all([
    resolveWriteTeamId(
      req.session.userId!,
      body.data.teamId ?? undefined,
      effectiveTeams?.length ? effectiveTeams : undefined,
    ),
    isKoordinatorUser(userId),
  ]);
  if (!write.ok) {
    if (write.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team zugeordnet" });
    }
    return;
  }
  // Koordinatoren sind Verwaltungspersonen, nie Personal (wie Einzel-Route).
  if (isKoordinator) {
    res.status(403).json({
      error: "Für Teamkoordinatoren können keine Dienste geplant werden.",
    });
    return;
  }

  // Kalendertage normalisieren und deduplizieren (ein Eintrag pro Tag) — rein
  // rechnerisch, kein DB-Zugriff, daher hier vor Gruppe 2.
  // Team-Einträge: UTC-Tagesgrenz-Prüfung wie bulk-absence (DST-neutral;
  //   T00:00:00Z–T23:59:59Z besteht immer, 25-h-Berliner-Mitternacht wird
  //   abgelehnt, weil sie zwei UTC-Tage überspannt).
  // Reguläre Dienste: strikt ≤ 24 h, damit kein Mehrtages-Dienst als
  //   einzelner Tag durchrutscht.
  const dayMap = new Map<string, { startTime: Date; endTime: Date }>();
  for (const d of body.data.days) {
    const durationMs = d.endTime.getTime() - d.startTime.getTime();
    if (durationMs <= 0) {
      res.status(400).json({
        error: "Ungültiger Tageseintrag: Ende muss nach dem Beginn liegen.",
      });
      return;
    }
    const startDay = d.startTime.toISOString().split("T")[0]!;
    const endDay = d.endTime.toISOString().split("T")[0]!;
    if (type === "team") {
      if (startDay !== endDay) {
        res.status(400).json({
          error:
            "Ungültiger Tageseintrag: Start und Ende müssen auf demselben UTC-Kalendertag liegen.",
        });
        return;
      }
    } else {
      if (durationMs > 24 * 60 * 60 * 1000) {
        res.status(400).json({
          error:
            "Ungültiger Tageseintrag: Ende muss nach dem Beginn liegen und innerhalb eines Kalendertags enden.",
        });
        return;
      }
    }
    const key = startDay;
    if (!dayMap.has(key)) dayMap.set(key, { startTime: d.startTime, endTime: d.endTime });
  }
  const days = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const latest = days[days.length - 1]![1].startTime;

  // ── Gruppe 2 (parallel): Mitgliedschaft, Modell-Scope, Teamsitzungs-Schalter ─
  // Alle drei brauchen write.teamId (→ nach Gruppe 1) und keinen DB-Wert des
  // jeweils anderen — laufen also gleichzeitig.
  const [isMember, modelBelongsToTeam, teamMeetingOk] = await Promise.all([
    isUserMemberOfTeam(userId, write.teamId),
    shiftModelId != null
      ? isShiftModelInTeam(shiftModelId, write.teamId)
      : Promise.resolve(true),
    type === "team"
      ? teamMeetingEnabledForTeam(write.teamId)
      : Promise.resolve(true),
  ]);
  if (!isMember) {
    res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
    return;
  }
  if (!modelBelongsToTeam) {
    res.status(403).json({ error: "Schichtmodell gehört nicht zu diesem Team" });
    return;
  }
  if (!teamMeetingOk) {
    res.status(400).json({
      error: "Der Team-Dienst (Teamsitzung) ist in den Einstellungen deaktiviert.",
      code: "team_meeting_disabled",
    });
    return;
  }

  // Free-Limit (historyMonths) gegen den SPÄTESTEN Tag — ein Verstoß blockt
  // den gesamten Auftrag (kein Teil-Zeitraum). Sendet die Antwort selbst →
  // bleibt sequenziell nach Gruppe 2.
  if (await forwardPlanningBlocked(write.teamId, req.session.userId!, latest, res)) {
    return;
  }

  // Aushilfe-Einsatz: gleiche Regeln wie beim Einzel-POST.
  if (body.data.einsatzTeamId != null) {
    if (type === "team") {
      res.status(400).json({ error: "Team-Einträge können kein Aushilfe-Einsatz sein" });
      return;
    }
    if (body.data.einsatzTeamId === write.teamId) {
      res.status(400).json({ error: "Einsatz-Team muss ein anderes Team sein" });
      return;
    }
    const allowedForEinsatz = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    if (!allowedForEinsatz.includes(body.data.einsatzTeamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
  }

  // Überschneidungen INNERHALB des Auftrags (Tagesübergänge können sich in
  // Nachbartage schieben) sofort melden — reine Rechenprüfung ohne DB. Die
  // Prüfung gegen den BESTAND läuft race-sicher in der Transaktion unten.
  const force = body.data.force === true;
  if (type !== "team" && !force) {
    const pairConflicts = new Set<string>();
    for (let i = 0; i < days.length; i++) {
      for (let j = i + 1; j < days.length; j++) {
        const a = days[i]![1];
        const b = days[j]![1];
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          pairConflicts.add(days[i]![0]);
          pairConflicts.add(days[j]![0]);
        }
      }
    }
    if (pairConflicts.size > 0) {
      const sorted = [...pairConflicts].sort();
      res.status(409).json({
        error: `Überschneidung mit bestehenden Diensten an ${sorted.length === 1 ? "einem Tag" : `${sorted.length} Tagen`}.`,
        code: "shift_overlap" as const,
        conflictDates: sorted,
      });
      return;
    }
  }

  // Transaktional prüfen UND anlegen — unter einem Advisory-Lock pro
  // Zielperson bzw. (bei Team-Einträgen) pro Team: Zwei GLEICHZEITIGE
  // Aufträge (z. B. Doppelklick in zwei Fenstern) würden sonst beide einen
  // konfliktfreien Bestand sehen und doppelt buchen. Der zweite Auftrag
  // wartet am Lock auf den Commit des ersten und sieht dessen Einträge dann
  // bei seiner eigenen Prüfung (→ 409 statt Doppelbuchung). Team-Einträge
  // werden wie beim Einzel-POST ganztägig normalisiert und sind immer FIX;
  // Vertretungs-Markierung und Pausenminuten sind reine Arbeitsdienst-Infos.
  const txResult = await db.transaction(async (tx) => {
    const lockKey =
      type === "team" ? `shifts-bulk:team:${write.teamId}` : `shifts-bulk:user:${userId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    // ── Batch-Duplikat-/Überschneidungsprüfung (1 Query statt N) ────────────
    if (type === "team") {
      // Eine Query für alle Team-Einträge im Datumsbereich, Auswertung in-memory.
      const firstDayStart = new Date(`${days[0]![0]}T00:00:00.000Z`);
      const lastDayEnd = new Date(
        `${days[days.length - 1]![0]}T00:00:00.000Z`
      );
      lastDayEnd.setUTCDate(lastDayEnd.getUTCDate() + 1);
      const existingTeamRows = await tx
        .select({ startTime: shiftsTable.startTime })
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.teamId, write.teamId),
            eq(shiftsTable.type, "team" as const),
            gte(shiftsTable.startTime, firstDayStart),
            lt(shiftsTable.startTime, lastDayEnd),
          ),
        );
      const existingTeamDays = new Set(
        existingTeamRows.map((r) => r.startTime.toISOString().split("T")[0]!),
      );
      const duplicateDates = days
        .filter(([key]) => existingTeamDays.has(key))
        .map(([key]) => key);
      if (duplicateDates.length > 0) {
        return { kind: "team_duplicate" as const, conflictDates: duplicateDates };
      }
    } else if (!force) {
      // Eine Query über das gesamte Zeitfenster aller Tage, Zuordnung in-memory.
      const minStart = days[0]![1].startTime;
      const maxEnd = days.reduce(
        (acc, [, t]) => (t.endTime > acc ? t.endTime : acc),
        days[0]![1].endTime,
      );
      const existing = await tx
        .select({
          startTime: shiftsTable.startTime,
          endTime: shiftsTable.endTime,
        })
        .from(shiftsTable)
        .where(
          and(
            eq(shiftsTable.userId, userId),
            notInArray(shiftsTable.type, [
              "vacation",
              "sick",
              "team",
              "kind_krank",
              "freistellung",
              "abgesagt_ag",
              "abgesagt_an",
              "urlaubsabgeltung",
              "freizeitausgleich",
            ]),
            lt(shiftsTable.startTime, maxEnd),
            gt(shiftsTable.endTime, minStart),
          ),
        );
      const conflictDates = new Set<string>();
      for (const [key, t] of days) {
        if (existing.some((c) => c.startTime < t.endTime && c.endTime > t.startTime)) {
          conflictDates.add(key);
        }
      }
      if (conflictDates.size > 0) {
        return { kind: "overlap" as const, conflictDates: [...conflictDates].sort() };
      }
    }

    // ── Batch-INSERT (1 Query statt N) ───────────────────────────────────────
    const insertValues = days.map(([, t]) => {
      let { startTime, endTime } = t;
      if (type === "team") {
        const normalized = normalizeTeamEntryTimes(startTime);
        startTime = normalized.startTime;
        endTime = normalized.endTime;
      }
      return {
        userId,
        teamId: write.teamId,
        startTime,
        endTime,
        type,
        shiftModelId: shiftModelId ?? null,
        notes: body.data.notes ?? null,
        ...(type === "team"
          ? { planningStatus: "FIX" as const, isVertretung: false, pauseMinutes: 0 }
          : {
              ...(body.data.planningStatus ? { planningStatus: body.data.planningStatus } : {}),
              isVertretung: body.data.isVertretung ?? false,
              pauseMinutes: Math.max(0, body.data.pauseMinutes ?? 0),
              einsatzTeamId: body.data.einsatzTeamId ?? null,
            }),
      };
    });
    const inserted = await tx.insert(shiftsTable).values(insertValues).returning();

    // ── Batch-Metriken (3 Queries statt N×4) ─────────────────────────────────
    // Geteilte Werte einmal lesen; resolveShiftMetrics ist rein rechnerisch.
    const [valuationPct, ctx] = await Promise.all([
      valuationPercentFor(type, shiftModelId ?? null),
      allowanceContext(write.teamId, tx),
    ]);
    const metricsRows = inserted.map((shift) => ({
      id: shift.id,
      m: resolveShiftMetrics(
        {
          type: shift.type,
          startTime: shift.startTime,
          endTime: shift.endTime,
          plannedHours: 0, // bulk-route ist nie Abwesenheit → kein Lohnausfall-Lookup nötig
          valuationPercent: valuationPct,
        },
        ctx.window,
        ctx.state,
      ),
    }));
    // Ein UPDATE … FROM (VALUES …) für alle Zeilen
    if (metricsRows.length > 0) {
      await tx.execute(sql`
        UPDATE ${shiftsTable} AS s
        SET valued_hours  = v.vh,
            night_hours   = v.nh,
            sunday_hours  = v.sh,
            holiday_hours = v.hh
        FROM (VALUES ${sql.join(
          metricsRows.map(
            (r) =>
              sql`(${r.id}::int, ${r.m.valuedHours}::numeric, ${r.m.nightHours}::numeric, ${r.m.sundayHours}::numeric, ${r.m.holidayHours}::numeric)`,
          ),
          sql`, `,
        )}) AS v(id, vh, nh, sh, hh)
        WHERE s.id = v.id
      `);
    }

    return { kind: "created" as const, ids: inserted.map((s) => s.id) };
  });

  if (txResult.kind === "team_duplicate") {
    res.status(409).json({
      error: `Für dieses Team besteht an ${txResult.conflictDates.length === 1 ? "einem der Tage" : `${txResult.conflictDates.length} der Tage`} bereits ein Team-Eintrag.`,
      code: "team_meeting_duplicate" as const,
      conflictDates: txResult.conflictDates,
    });
    return;
  }
  if (txResult.kind === "overlap") {
    res.status(409).json({
      error: `Überschneidung mit bestehenden Diensten an ${txResult.conflictDates.length === 1 ? "einem Tag" : `${txResult.conflictDates.length} Tagen`}.`,
      code: "shift_overlap" as const,
      conflictDates: txResult.conflictDates,
    });
    return;
  }
  const createdIds = txResult.ids;

  // Angelegte Einträge in Listen-Form (wie GET /shifts) zurückgeben: der
  // Client fügt sie direkt in den Cache ein (kein Warten auf Monats-Reload).
  const rows = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
    .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
    .where(inArray(shiftsTable.id, createdIds));

  res.status(201).json({
    teamId: write.teamId,
    createdCount: rows.length,
    shifts: rows,
  });
});

router.get("/shifts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetShiftParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select({ ...SHIFT_SELECT, teamId: shiftsTable.teamId })
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
    .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
    .where(eq(shiftsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.session.role === "assistant") {
    if (row.userId !== req.session.userId!) {
      res.status(403).json({ error: "Keine Berechtigung" });
      return;
    }
  } else {
    const allowedTeams = await getAllowedTeamIds(req.session.userId!);
    if (row.teamId == null || !allowedTeams.includes(row.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const { teamId: _teamId, ...shiftDto } = row;
  res.json(shiftDto);
});

router.patch("/shifts/:id", requireTeamPlanningOrAdmin, async (req, res): Promise<void> => {
  const params = UpdateShiftParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateShiftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  // Leere Anfragen sofort ablehnen — bevor abgeleitete Felder (z.B.
  // planningStatus FIX bei Abwesenheiten) hinzugefügt werden. Die
  // Server-seitig ergänzten Felder sind kein Ersatz für Client-Eingaben:
  // hat der Client nichts gesendet, gibt es keine Änderung zu speichern.
  if (Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "Keine änderbaren Felder angegeben." });
    return;
  }

  const [oldShift] = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id))
    .limit(1);
  if (!oldShift) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  if (oldShift.teamId == null || !allowedTeams.includes(oldShift.teamId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Wechsel des zugewiesenen Assistenten (Massen-Ändern): Der neue Nutzer muss
  // Mitglied des Teams der Schicht sein — sonst ließe sich eine Schicht einem
  // teamfremden Nutzer zuordnen und dessen PII über die user-gejointe Antwort
  // auslesen (identische Member-of-Team-Invariante wie bei POST). Das Team der
  // Schicht (oldShift.teamId) bleibt bei PATCH unverändert.
  const effectiveUserId = body.data.userId ?? oldShift.userId;
  if (body.data.userId != null && body.data.userId !== oldShift.userId) {
    // Der Assistenten-Wechsel an einer bestehenden Schicht (ShiftUpdate.userId)
    // existiert AUSSCHLIESSLICH für die Massenbearbeitung ("Mehrere bearbeiten",
    // Assistent tauschen) — der Einzel-Schicht-Dialog sendet beim Bearbeiten nie
    // userId. Massenbearbeitung ist ein Premium-Feature; daher wird der Wechsel
    // serverseitig autoritativ gegen das bulkEdit-Entitlement geprüft (nicht nur
    // im Frontend, der Client ist nicht vertrauenswürdig). Das wiederholte
    // Bearbeiten EINZELNER bestehender Schichten (Zeiten/Notiz/Typ ohne
    // Assistenten-Wechsel) bleibt bewusst frei — Bestandsschutz erlaubt Free-
    // Konten, ihre vorhandenen Daten zu pflegen.
    if (!(await userHasFeature(req.session.userId!, "bulkEdit"))) {
      res.status(403).json({
        error:
          "Das Tauschen der Assistenzkraft (Massenbearbeitung) ist im Premium-Tarif enthalten.",
        code: "plan_feature_required",
        feature: "bulkEdit",
      });
      return;
    }
    // Auch beim Assistenten-Wechsel gilt strikt die Member-of-Team-Invariante:
    // Der neue Nutzer muss Mitglied des Teams der Schicht sein.
    if (!(await isUserMemberOfTeam(body.data.userId, oldShift.teamId))) {
      res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
      return;
    }
    // Koordinatoren sind Verwaltungspersonen, nie Personal (wie beim Anlegen).
    if (await isKoordinatorUser(body.data.userId)) {
      res.status(403).json({
        error: "Für Teamkoordinatoren können keine Dienste geplant werden.",
      });
      return;
    }
  }

  // Kollisionsprüfung mit den effektiven (ggf. teil-aktualisierten) Werten, die
  // eigene Schicht ausgenommen. force überschreibt bewusst, ohne Schema-Änderung.
  // Bei Assistenten-Wechsel gegen den NEUEN Nutzer prüfen.
  const force = req.body?.force === true;
  const effectiveType = body.data.type ?? oldShift.type;
  const effectiveStart = body.data.startTime ?? oldShift.startTime;
  const effectiveEnd = body.data.endTime ?? oldShift.endTime;

  // Free-Limit (historyMonths): Verhindert, dass eine erlaubt angelegte Schicht
  // per PATCH weit in die Zukunft verschoben wird und so das POST-Gate umgeht.
  // Nur prüfen, wenn der Start tatsächlich geändert wird (sonst bleiben Bestands-
  // Schichten unverändert editierbar — Bestandsschutz). Plan des Team-Eigentuemers
  // (oldShift.teamId; Team bleibt bei PATCH unverändert) ist maßgeblich.
  if (body.data.startTime != null && oldShift.teamId != null) {
    if (await forwardPlanningBlocked(oldShift.teamId, req.session.userId!, effectiveStart, res)) {
      return;
    }
  }

  // Team-Dienst (Teamsitzung) beim Bearbeiten: Typwechsel ZU team unterliegt
  // demselben Konto-Schalter wie das Anlegen; Datums-/Typänderungen dürfen kein
  // Tages-Duplikat im Team erzeugen. Reine Edits bestehender Team-Einträge
  // (Notiz etc.) bleiben erlaubt (Bestandsschutz).
  if (effectiveType === "team") {
    if (oldShift.type !== "team" && !(await teamMeetingEnabledForTeam(oldShift.teamId))) {
      res.status(400).json({
        error: "Der Team-Dienst (Teamsitzung) ist in den Einstellungen deaktiviert.",
        code: "team_meeting_disabled",
      });
      return;
    }
    const duplicate = await findDuplicateTeamEntry(
      oldShift.teamId,
      new Date(effectiveStart),
      oldShift.id
    );
    if (duplicate) {
      res.status(409).json({
        error: "Für dieses Team besteht an diesem Tag bereits ein Team-Eintrag.",
        code: "team_meeting_duplicate" as const,
        existingShiftId: duplicate.id,
      });
      return;
    }
  }

  if (!isAbsenceType(effectiveType) && effectiveType !== "team" && !force) {
    const conflicts = await findOverlappingShifts(
      effectiveUserId,
      effectiveStart,
      effectiveEnd,
      oldShift.id
    );
    if (conflicts.length > 0) {
      res.status(409).json(overlapResponseBody(conflicts));
      return;
    }
  }

  // Doppelte Abwesenheit am selben Tag auch beim Bearbeiten verhindern: sonst
  // entstünde durch eine Datums-/Typ-Änderung ein zweiter Urlaubs-/Krank-Eintrag
  // und vacationDaysUsed würde erneut belastet. Die eigene Schicht ist via
  // excludeShiftId ausgenommen. Bei Assistenten-Wechsel gegen den NEUEN Nutzer prüfen.
  if (isAbsenceType(effectiveType)) {
    const duplicate = await findDuplicateAbsence(
      effectiveUserId,
      effectiveType,
      effectiveStart,
      oldShift.id
    );
    if (duplicate) {
      res.status(409).json(duplicateAbsenceResponseBody(duplicate.id, effectiveType));
      return;
    }
  }

  // URLAUB außerhalb des Vertragszeitraums blockieren — nur wenn die Änderung
  // die Deckung berühren kann (Datum/Zeit, Typwechsel zu Urlaub oder
  // Assistenten-Wechsel). Reine Notiz-/Status-Edits bestehender Urlaube bleiben
  // erlaubt (Bestandsschutz für Alt-Einträge außerhalb von Verträgen).
  if (
    effectiveType === "vacation" &&
    (body.data.startTime != null ||
      body.data.endTime != null ||
      (body.data.type === "vacation" && oldShift.type !== "vacation") ||
      (body.data.userId != null && body.data.userId !== oldShift.userId))
  ) {
    const msg = await vacationOutsideContractError(
      effectiveUserId,
      oldShift.teamId,
      effectiveStart,
      effectiveEnd
    );
    if (msg) {
      res.status(400).json({ error: msg, code: "vacation_outside_contract" });
      return;
    }
  }

  // Aushilfe-Einsatz setzen/ändern: gleiche Regeln wie beim Anlegen — anderes
  // eigenes Team, keine Abwesenheit. Entfernen (null) ist immer erlaubt.
  if (body.data.einsatzTeamId != null) {
    if (isAbsenceType(effectiveType) || effectiveType === "team") {
      res.status(400).json({ error: "Abwesenheiten und Team-Einträge können kein Aushilfe-Einsatz sein" });
      return;
    }
    if (body.data.einsatzTeamId === oldShift.teamId) {
      res.status(400).json({ error: "Einsatz-Team muss ein anderes Team sein" });
      return;
    }
    if (!allowedTeams.includes(body.data.einsatzTeamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
  }

  // Wird das Schichtmodell geändert, muss das neue Modell zum Team der Schicht
  // gehören (oldShift.teamId, das Team bleibt bei PATCH unverändert), sonst
  // flössen fremde Wertungs-/Zuschlagsparameter in die Auswertung ein.
  if (body.data.shiftModelId != null) {
    if (!(await isShiftModelInTeam(body.data.shiftModelId, oldShift.teamId))) {
      res.status(403).json({ error: "Schichtmodell gehört nicht zu diesem Team" });
      return;
    }
  }

  // Abwesenheiten bleiben verbindlich: Wird eine Schicht zu Urlaub/Krankheit
  // (oder bleibt sie es), setzt der Server den Planungsstatus autoritativ auf
  // FIX — analog zum POST, damit kein Weg eine vorläufige Abwesenheit erzeugt.
  // Halbtägiger Urlaub (#862): der Bearbeiten-Dialog bietet KEINE eigene
  // Zeitraum-Auswahl (s. shift-dialog.tsx) — er sendet beim Speichern immer
  // die bereits gespeicherten Original-Uhrzeiten (ggf. auf ein neues Datum
  // übertragen). Der Ganztags-/Teil-Modus einer BEREITS bestehenden Abwesenheit
  // bleibt deshalb beim Bearbeiten unverändert; ein PATCH kann ihn nicht aus
  // den (evtl. geerbten) Uhrzeiten neu ableiten, ohne den bekannten
  // Ganztag/Teil-Ambiguitätsfehler zu wiederholen. Nur beim ECHTEN Übergang
  // zu einer Abwesenheit (vorher kein Abwesenheits-Typ, z. B. Massen-
  // Typwechsel) gibt es noch keinen Bestandswert — dort aus den effektiven
  // Uhrzeiten neu bestimmen (kein Erbschafts-Pfad wie bei POST betroffen).
  const isPartialAbsence = isAbsenceType(effectiveType)
    ? isAbsenceType(oldShift.type)
      ? oldShift.isPartialAbsence
      : !isPlainFullDay(new Date(effectiveStart), new Date(effectiveEnd))
    : false;

  // Nachträgliche Änderung eines bereits bestätigten Dienstes: Der Dienst
  // fällt auf ANGEBOTEN zurück und muss von der Assistenzkraft neu bestätigt
  // werden. Ohne diesen Rückfall wäre eine bestätigte Zeit einseitig änderbar.
  //
  // WICHTIG: Der Bearbeiten-Dialog sendet planningStatus IMMER mit, vorbelegt
  // mit dem alten Wert (shift-dialog.tsx: `planningStatus: isAbsence ? "FIX" :
  // form.planningStatus`). Ein mitgesendeter, UNVERÄNDERTER Status ist deshalb
  // keine bewusste Status-Entscheidung und verhindert den Rückfall nicht.
  // startTime/endTime sind durch zod.coerce.date() bereits Date-Objekte.
  const zeitGeaendert =
    (body.data.startTime !== undefined &&
      body.data.startTime.getTime() !== oldShift.startTime.getTime()) ||
    (body.data.endTime !== undefined &&
      body.data.endTime.getTime() !== oldShift.endTime.getTime());
  // #869: Ein reiner Schichtmodell-Wechsel (z. B. beim Massen-Modellwechsel im
  // bulk-edit-dialog, der je Schicht nur { type, shiftModelId, force: true }
  // sendet) ändert weder die tatsächlich gearbeitete Zeit noch die zugewiesene
  // Person — nur die administrative Einordnung/Bewertung. Das reale Zeit-
  // Commitment der Assistenzkraft bleibt identisch, eine erneute Bestätigung
  // ist dafür sachlich nicht nötig. Nur Zeit- oder Nutzer-Änderungen (die das
  // tatsächliche "wann"/"wer" verschieben) lösen den Rückfall auf ANGEBOTEN
  // aus; ein alleiniger shiftModelId-Wechsel tut es nicht mehr.
  const substanzGeaendert =
    zeitGeaendert ||
    (body.data.userId !== undefined && body.data.userId !== oldShift.userId) ||
    (body.data.pauseMinutes !== undefined &&
      body.data.pauseMinutes !== oldShift.pauseMinutes);
  const faelltZurueck =
    oldShift.planningStatus === "FIX" &&
    !isAbsenceType(effectiveType) &&
    effectiveType !== "team" &&
    (body.data.planningStatus === undefined ||
      body.data.planningStatus === oldShift.planningStatus) &&
    substanzGeaendert;

  const updateValues = {
    ...body.data,
    // Wird die Schicht zur Abwesenheit oder zum Team-Eintrag, verliert sie
    // einen etwaigen Aushilfe-Einsatz (Spiegel-Eintrag wäre irreführend);
    // beide sind immer verbindlich (FIX).
    // Vertretungs-Markierung und Pausenminuten gehören nur zu Arbeitsdiensten
    // und werden bei Abwesenheit/Team-Eintrag serverseitig zurückgesetzt.
    ...(isAbsenceType(effectiveType) || effectiveType === "team"
      ? {
          planningStatus: "FIX" as const,
          einsatzTeamId: null,
          isVertretung: false,
          pauseMinutes: 0,
        }
      : {}),
    ...(isAbsenceType(effectiveType) ? { isPartialAbsence } : {}),
    ...(faelltZurueck ? { planningStatus: "ANGEBOTEN" as const } : {}),
  };

  // Team-Einträge ganztägig erzwingen — auch beim Bearbeiten (Typwechsel zu
  // team oder Zeitänderung eines Team-Eintrags), serverseitig autoritativ.
  if (effectiveType === "team") {
    const normalized = normalizeTeamEntryTimes(new Date(effectiveStart));
    updateValues.startTime = normalized.startTime;
    updateValues.endTime = normalized.endTime;
  }
  // Alle Schreiboperationen transaktional: UPDATE, Zeiterfassung-Sync,
  // Urlaubs-Rebalancierung und Kennzahlen in einem atomaren Block.
  // Sentinel für parallele Löschung zwischen Vorab-Read und UPDATE (Race).
  const notFoundError = new Error("patch-shift-not-found");
  let patchResult;
  try {
    patchResult = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(shiftsTable)
        .set(updateValues)
        .where(eq(shiftsTable.id, params.data.id))
        .returning();
      if (!updated) throw notFoundError;

      const newType = updated.type;
      const oldType = oldShift.type;
      const wasAbsence = isAbsenceType(oldType);
      const isAbsence = isAbsenceType(newType);

      // Zeiterfassung an den Typ-Übergang anpassen.
      if (wasAbsence && !isAbsence) {
        await removeAbsenceTimeTracking(updated.id, tx);
      } else if (!wasAbsence && isAbsence) {
        await bookAbsenceTimeTracking(updated, tx);
      } else if (wasAbsence && isAbsence) {
        // Bleibt Abwesenheit: Buchung mit Datum/Zeiten/Vertrag synchron halten.
        await syncAbsenceTimeTracking(updated, tx);
      }

      // Urlaubsanspruch rebalancieren (stundengenau): Ein Urlaubstag bucht seine
      // Urlaubs-Stunden auf den Vertrag, der für (userId, Datum) gilt — vor und nach
      // dem Update. Ändert sich der gültige Vertrag (z.B. Datumswechsel über
      // Vertragsgrenzen), der Typ ODER die Stundenzahl (z.B. Zeit-Edit von/zu 24h),
      // wird umgebucht.
      // Erste Promise.all-Gruppe: beide Contract-Reads parallel (über tx).
      const [oldVacationContract, newVacationContract] = await Promise.all([
        oldType === "vacation"
          ? activeContractFor(oldShift.userId, new Date(oldShift.startTime), tx)
          : Promise.resolve(null),
        newType === "vacation"
          ? activeContractFor(updated.userId, new Date(updated.startTime), tx)
          : Promise.resolve(null),
      ]);
      // Zweite Promise.all-Gruppe: Stunden-Reads nur wenn ein Contract vorliegt (über tx).
      const [oldVacationHours, newVacationHours] = await Promise.all([
        oldVacationContract
          ? resolveVacationHours(
              oldShift.userId,
              oldShift.teamId,
              oldShift.startTime,
              oldShift.endTime,
              tx
            )
          : Promise.resolve(0),
        newVacationContract
          ? resolveVacationHours(
              updated.userId,
              updated.teamId,
              updated.startTime,
              updated.endTime,
              tx
            )
          : Promise.resolve(0),
      ]);
      if (oldVacationContract?.id !== newVacationContract?.id) {
        if (oldVacationContract) await applyVacationDelta(oldVacationContract, -oldVacationHours, tx);
        if (newVacationContract) await applyVacationDelta(newVacationContract, newVacationHours, tx);
      } else if (newVacationContract && oldVacationHours !== newVacationHours) {
        // Gleicher Vertrag, aber geänderte Stundenzahl: Differenz umbuchen.
        await applyVacationDelta(newVacationContract, newVacationHours - oldVacationHours, tx);
      }

      // Kennzahlen nach der Änderung (Zeiten/Typ/Modell) neu berechnen und
      // speichern — aber nur, wenn sich ein für die Berechnung relevantes Feld
      // geändert hat. Reine Status- oder Notiz-Änderungen (Massen-Bestätigung,
      // Notiz-Edit) ändern weder Stunden noch Zuschläge und sparen sich damit
      // den teuren Kontext-Reload (Vertrag, Zuschlagssätze, Schichtmodell).
      const onlyStatusOrNotesChanged = Object.keys(body.data).every(
        (key) => key === "planningStatus" || key === "notes"
      );
      if (!onlyStatusOrNotesChanged) {
        await storeShiftMetrics(updated, tx);
      }

      const [row] = await tx
        .select(SHIFT_SELECT)
        .from(shiftsTable)
        .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
        .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
        .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
        .where(eq(shiftsTable.id, params.data.id));
      return row;
    });
  } catch (err) {
    if (err === notFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    throw err;
  }
  res.json(patchResult);
});

router.delete("/shifts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteShiftParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [shift] = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id))
    .limit(1);

  if (!shift) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Admins/Teamleiter: Löschrecht im Admin-Scope (wie bisher). Reine
  // Assistenzkräfte dürfen seit der Menü-Neustrukturierung (§3) NUR eigene
  // Abwesenheiten (Urlaub/Krank) entfernen — konsistent 404 statt 403, damit
  // fremde Schicht-IDs nicht ausspähbar sind.
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  const isPrivilegedForTeam =
    shift.teamId != null && allowedTeams.includes(shift.teamId);
  if (!isPrivilegedForTeam) {
    const ownAbsence =
      isAbsenceType(shift.type) &&
      shift.userId === req.session.userId &&
      shift.teamId != null &&
      (await getAllowedTeamIds(req.session.userId!)).includes(shift.teamId);
    if (!ownAbsence) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }

  // #887: vergangene Abwesenheiten sind unveränderlich — unabhängig davon, wer
  // den Löschversuch unternimmt (auch Admin/Planer). Motivation: bereits
  // vergangene Urlaubs-/Krankheitstage sind abgerechnet (Zeiterfassung,
  // Urlaubskonto); ein nachträgliches Löschen würde diese Werte rückwirkend
  // verfälschen.
  if (isAbsenceType(shift.type) && dayKey(shift.startTime) < dayKey(new Date())) {
    res.status(400).json({
      error: "Vergangene Abwesenheiten können nicht mehr gelöscht werden.",
      code: "absence_delete_past_blocked",
    });
    return;
  }

  // Alle Schreiboperationen transaktional: Zeiterfassung-Entfernung,
  // Urlaubs-Rückbuchung und Schicht-Löschung atomar. Das DELETE mit
  // .returning() erkennt einen Race (parallele Löschung zwischen
  // Vorab-Read und Transaktion).
  const raceError = new Error("delete-shift-race");
  try {
    await db.transaction(async (tx) => {
      if (isAbsenceType(shift.type)) {
        await removeAbsenceTimeTracking(shift.id, tx);
        if (shift.type === "vacation") {
          const hours = await resolveVacationHours(
            shift.userId,
            shift.teamId,
            shift.startTime,
            shift.endTime,
            tx
          );
          await adjustVacationHours(shift.userId, new Date(shift.startTime), -hours, tx);
        }
      }
      const deleted = await tx
        .delete(shiftsTable)
        .where(eq(shiftsTable.id, params.data.id))
        .returning({ id: shiftsTable.id });
      if (deleted.length === 0) throw raceError;
    });
  } catch (err) {
    if (err === raceError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    throw err;
  }
  res.status(204).send();
});

// Sammel-Löschung (Task #751): löscht mehrere Einträge transaktional in EINEM
// Request statt N Einzel-DELETEs (spürbar schneller bei Mehrfachauswahl und
// mehrtägigen Abwesenheiten). Spiegelt die Einzel-Route exakt:
// - Authz je Eintrag VOR jeder Aktion: Admin/Teamleiter im Team-Scope dürfen
//   alles, reine Assistenzkräfte nur EIGENE Abwesenheiten — konsistent 404
//   statt 403 (fremde Schicht-IDs bleiben nicht ausspähbar).
// - Ganz oder gar nicht: fehlt ein Eintrag oder ist einer unzulässig, wird
//   NICHTS gelöscht (404).
// - Abwesenheiten: verknüpfte Zeiterfassung mit löschen; Urlaub: Stunden wie
//   beim Einzel-Löschen auflösen, aber je Vertrag gebündelt zurückbuchen (ein
//   Zeitraum kann einen Vertragswechsel überspannen — jeder Tag bucht auf
//   SEINEN Vertrag, wie N Einzel-DELETEs).
router.post("/shifts/bulk-delete", requireAuth, async (req, res): Promise<void> => {
  const body = BulkDeleteShiftsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  // Batch-interne Duplikate tolerieren (doppelte ID = derselbe Eintrag).
  const ids = [...new Set(body.data.ids)];

  const shifts = await db.select().from(shiftsTable).where(inArray(shiftsTable.id, ids));
  if (shifts.length !== ids.length) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  let memberTeams: number[] | null = null;
  for (const shift of shifts) {
    const isPrivilegedForTeam = shift.teamId != null && allowedTeams.includes(shift.teamId);
    if (isPrivilegedForTeam) continue;
    const ownAbsence =
      isAbsenceType(shift.type) && shift.userId === req.session.userId && shift.teamId != null;
    if (!ownAbsence) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    memberTeams ??= await getAllowedTeamIds(req.session.userId!);
    if (!memberTeams.includes(shift.teamId!)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }

  // #887: vergangene Abwesenheiten sind unveränderlich (s. Einzel-DELETE) —
  // ganz oder gar nicht: ein einziger vergangener Eintrag blockt den gesamten
  // Sammel-Löschauftrag.
  const pastAbsence = shifts.find(
    (s) => isAbsenceType(s.type) && dayKey(s.startTime) < dayKey(new Date()),
  );
  if (pastAbsence) {
    res.status(400).json({
      error: "Vergangene Abwesenheiten können nicht mehr gelöscht werden.",
      code: "absence_delete_past_blocked",
    });
    return;
  }

  // Urlaubs-Rückbuchung vorbereiten: Contracts und Stunden für alle
  // Urlaubsschichten parallel lesen (Batch statt N×2 sequenzielle Reads),
  // Writes folgen in der Transaktion.
  const vacationShifts = shifts.filter((s) => s.type === "vacation");
  const byContract = new Map<
    number,
    { contract: { id: number; vacationHoursUsed: number }; delta: number }
  >();
  if (vacationShifts.length > 0) {
    const [contracts, hoursArr] = await Promise.all([
      Promise.all(
        vacationShifts.map((s) => activeContractFor(s.userId, new Date(s.startTime)))
      ),
      Promise.all(
        vacationShifts.map((s) =>
          resolveVacationHours(s.userId, s.teamId, s.startTime, s.endTime)
        )
      ),
    ]);
    for (let i = 0; i < vacationShifts.length; i++) {
      const contract = contracts[i];
      if (!contract) continue;
      const hours = hoursArr[i]!;
      const entry = byContract.get(contract.id) ?? { contract, delta: 0 };
      entry.delta -= hours;
      byContract.set(contract.id, entry);
    }
  }

  const absenceIds = shifts.filter((s) => isAbsenceType(s.type)).map((s) => s.id);
  // Ganz-oder-gar-nicht auch unter Nebenläufigkeit: Verschwindet eine Schicht
  // zwischen Vorab-Read und Transaktion (paralleler Lösch-Request), liefert
  // das DELETE weniger Zeilen als angefordert — dann wird ALLES zurückgerollt,
  // sonst würde z. B. Urlaub doppelt zurückgebucht.
  const raceLost = new Error("bulk-delete-race");
  try {
    await db.transaction(async (tx) => {
      await removeAbsenceTimeTracking(absenceIds, tx);
      const deleted = await tx
        .delete(shiftsTable)
        .where(inArray(shiftsTable.id, ids))
        .returning({ id: shiftsTable.id });
      if (deleted.length !== ids.length) throw raceLost;
      for (const { contract, delta } of byContract.values()) {
        await applyVacationDelta(contract, delta, tx);
      }
    });
  } catch (err) {
    if (err === raceLost) {
      // Gleiche Antwort wie „ID unbekannt" — kein Orakel, kein Teil-Erfolg.
      res.status(404).json({ error: "Not found" });
      return;
    }
    throw err;
  }

  res.json({ deletedIds: ids });
});

// POST /shifts/send-proposals — setzt VORLAEUFIG→ANGEBOTEN und versendet
// pro Assistenzkraft eine E-Mail mit allen vorgeschlagenen Diensten des Monats.
// Falls userId angegeben ist, werden nur diese Person's Dienste versendet.
router.post("/shifts/send-proposals", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const body = SendShiftProposalsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { month, year, teamId, userId, userIds } = body.data;

  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);

  let teamScope: number[];
  if (teamId != null) {
    if (!allowedTeams.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    teamScope = [teamId];
  } else {
    teamScope = allowedTeams;
  }

  if (teamScope.length === 0) {
    res.json({ updated: 0, emailsSent: 0, emailsFailed: 0 });
    return;
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const conditions = [
    inArray(shiftsTable.teamId, teamScope),
    eq(shiftsTable.planningStatus, "VORLAEUFIG"),
    gte(shiftsTable.startTime, monthStart),
    lt(shiftsTable.startTime, monthEnd),
    // Keine Abwesenheiten — nur buchbare Arbeitsdienste senden
    // (Abwesenheiten sind serveitig immer FIX und landen nie als Entwurf)
  ] as ReturnType<typeof and>[];
  if (userIds != null && userIds.length > 0) {
    conditions.push(inArray(shiftsTable.userId, userIds));
  } else if (userId != null) {
    conditions.push(eq(shiftsTable.userId, userId));
  }

  const shifts = await db
    .select({
      id: shiftsTable.id,
      userId: shiftsTable.userId,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      type: shiftsTable.type,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(and(...conditions));

  if (shifts.length === 0) {
    res.json({ updated: 0, emailsSent: 0, emailsFailed: 0 });
    return;
  }

  // Alle gefundenen Dienste auf ANGEBOTEN setzen
  const shiftIds = shifts.map((s) => s.id);
  await db
    .update(shiftsTable)
    .set({ planningStatus: "ANGEBOTEN" })
    .where(inArray(shiftsTable.id, shiftIds));

  // Pro Assistenzkraft eine E-Mail versenden
  const byUser = new Map<number, { name: string; email: string; shifts: typeof shifts }>();
  for (const s of shifts) {
    if (!s.userEmail || !s.userName) continue;
    const existing = byUser.get(s.userId) ?? { name: s.userName, email: s.userEmail, shifts: [] };
    existing.shifts.push(s);
    byUser.set(s.userId, existing);
  }

  // Die Status-Änderung (VORLAEUFIG→ANGEBOTEN) ist bereits gespeichert — das
  // ist das für die Nutzer sichtbare Ergebnis. Der Mailversand ist reine
  // Benachrichtigung und muss die Antwort nicht blockieren: die Anfrage
  // antwortet sofort, die Mails gehen fire-and-forget danach raus (analog zur
  // Krankmeldungs-Benachrichtigung oben). Da vorab nicht mehr auf den
  // tatsächlichen Sendeerfolg gewartet wird, meldet die Antwort nur noch die
  // Anzahl der Empfänger, an die versendet wird — nicht mehr sent/failed.
  const loginUrl = `${getBaseUrl()}/dienstplan`;
  const recipients = [...byUser.values()];

  res.json({ updated: shifts.length, emailsSent: recipients.length, emailsFailed: 0 });

  void (async () => {
    const results = await Promise.allSettled(
      recipients.map(({ name, email, shifts: userShifts }) =>
        sendProposalEmail(
          email,
          name,
          userShifts.map((s) => ({
            startTime: new Date(s.startTime),
            endTime: new Date(s.endTime),
            type: s.type,
          })),
          loginUrl,
        ),
      ),
    );
    const failed = results.filter(
      (r) => r.status === "rejected" || r.value !== true,
    ).length;
    if (failed > 0) {
      console.warn(
        `Vorschlag-Versand: ${failed}/${recipients.length} E-Mail(s) fehlgeschlagen.`,
      );
    }
  })();
});

// POST /shifts/bulk-confirm-own — Assistenzkraft bestätigt alle ihre
// ANGEBOTEN-Dienste eines Monats auf einmal (→ FIX).
router.post("/shifts/bulk-confirm-own", requireAuth, async (req, res): Promise<void> => {
  const body = BulkConfirmOwnShiftsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { month, year, teamId } = body.data;
  const userId = req.session.userId!;

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const conditions = [
    eq(shiftsTable.userId, userId),
    eq(shiftsTable.planningStatus, "ANGEBOTEN"),
    gte(shiftsTable.startTime, monthStart),
    lt(shiftsTable.startTime, monthEnd),
  ] as ReturnType<typeof and>[];

  if (teamId != null) {
    const memberTeams = await getAllowedTeamIds(userId);
    if (!memberTeams.includes(teamId)) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }
    conditions.push(eq(shiftsTable.teamId, teamId));
  }

  const updated = await db
    .update(shiftsTable)
    .set({ planningStatus: "FIX" })
    .where(and(...conditions))
    .returning({ id: shiftsTable.id });

  res.json({ confirmed: updated.length });
});

// POST /shifts/bulk-confirm — Admin/Teamleiter bestätigt alle ANGEBOTEN-
// Dienste eines Monats im eigenen Scope auf einmal (→ FIX). Pendant zu
// bulk-confirm-own, aber über den Admin-/Teamleiter-Scope statt nur die
// eigenen Dienste.
router.post(
  "/shifts/bulk-confirm",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = BulkConfirmShiftsBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { month, year, teamId } = body.data;

    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    let teamScope: number[];
    if (teamId != null) {
      if (!allowedTeams.includes(teamId)) {
        res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
        return;
      }
      teamScope = [teamId];
    } else {
      teamScope = allowedTeams;
    }
    if (teamScope.length === 0) {
      res.json({ confirmed: 0 });
      return;
    }

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const updated = await db
      .update(shiftsTable)
      .set({ planningStatus: "FIX" })
      .where(
        and(
          inArray(shiftsTable.teamId, teamScope),
          eq(shiftsTable.planningStatus, "ANGEBOTEN"),
          gte(shiftsTable.startTime, monthStart),
          lt(shiftsTable.startTime, monthEnd)
        )
      )
      .returning({ id: shiftsTable.id });

    res.json({ confirmed: updated.length });
  }
);

export default router;
