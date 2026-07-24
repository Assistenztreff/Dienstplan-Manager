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
import { eq, and, sql, or, isNull, ne, notInArray, lt, gt, inArray } from "drizzle-orm";
import type { Response } from "express";
import {
  ListShiftsQueryParams,
  CreateShiftBody,
  GetShiftParams,
  UpdateShiftParams,
  UpdateShiftBody,
  DeleteShiftParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  parseTeamIdParam,
  isUserMemberOfTeam,
  isShiftModelInTeam,
} from "../lib/teams";
import {
  isAbsenceType,
  isPlainFullDay,
  resolveShiftMetrics,
} from "../lib/shift-metrics-resolve";
import {
  absenceHoursFor,
  resolveVacationHours,
} from "../lib/vacation-hours";
import { userHasFeature, getUserLimit } from "../lib/plan";
import { resolveAllowanceOps } from "../lib/allowance-resolve";

const router = Router();

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
  valuedHours: shiftsTable.valuedHours,
  nightHours: shiftsTable.nightHours,
  sundayHours: shiftsTable.sundayHours,
  holidayHours: shiftsTable.holidayHours,
  createdAt: shiftsTable.createdAt,
  // Aushilfe-Einsatz: Team-Namen als korrelierte Subselects (explizit
  // qualifizierte Spalten, s. Drizzle-Eigenheit bei sql`` in Projektionen).
  einsatzTeamId: shiftsTable.einsatzTeamId,
  einsatzTeamName: sql<string | null>`(SELECT t.name FROM teams t WHERE t.id = shifts.einsatz_team_id)`,
  homeTeamName: sql<string | null>`(CASE WHEN shifts.einsatz_team_id IS NOT NULL THEN (SELECT t.name FROM teams t WHERE t.id = shifts.team_id) END)`,
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

async function activeContractFor(userId: number, date: Date) {
  const dateStr = date.toISOString().split("T")[0];
  const contracts = await db
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

// Vertragliche Soll-Stunden des Tages (Wochenstunden / Arbeitstage pro Woche,
// Fallback 5 Arbeitstage). Fallback 8h ohne Vertrag.
async function dailyTargetHours(userId: number, date: Date): Promise<number> {
  const contract = await activeContractFor(userId, date);
  if (!contract) return 8;
  const workdays =
    contract.workdaysPerWeek > 0 ? contract.workdaysPerWeek : 5;
  return Math.round((contract.weeklyHours / workdays) * 100) / 100;
}

// Bucht die geplanten Stunden der Abwesenheit als bestätigte Zeiterfassung
// (Lohnausfallprinzip): ein 24h-Dienst schreibt 24h gut, ein normaler
// Abwesenheitstag die vertraglichen Tages-Soll-Stunden. Keine Zuschläge hier,
// da Abwesenheiten kein Arbeits-Schichtmodell sind.
async function bookAbsenceTimeTracking(shift: AbsenceShift): Promise<void> {
  const target = await dailyTargetHours(shift.userId, new Date(shift.startTime));
  const dailyHours = await absenceHoursFor(
    shift.userId,
    shift.teamId,
    shift.startTime,
    shift.endTime,
    target
  );
  await db.insert(timeTrackingTable).values({
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
async function syncAbsenceTimeTracking(shift: AbsenceShift): Promise<void> {
  const target = await dailyTargetHours(shift.userId, new Date(shift.startTime));
  const dailyHours = await absenceHoursFor(
    shift.userId,
    shift.teamId,
    shift.startTime,
    shift.endTime,
    target
  );
  await db
    .update(timeTrackingTable)
    .set({ actualHours: dailyHours, actualStart: shift.startTime, actualEnd: shift.endTime })
    .where(eq(timeTrackingTable.shiftId, shift.id));
}

async function removeAbsenceTimeTracking(shiftId: number): Promise<void> {
  await db.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, shiftId));
}

// Stundenbewertung von Urlaubs-/Abwesenheitstagen (vacationHoursForShift,
// bwavgDailyHours, absenceHoursFor, resolveVacationHours) lebt in
// ../lib/vacation-hours.ts — geteilt mit der Verträge-Route (Neuberechnung des
// Urlaubszählers nach jedem Vertrags-Speichern).

// Schreibt den genommenen Urlaub (in Stunden) auf einem konkreten Vertrag fort.
// Geht nie unter null.
async function applyVacationDelta(
  contract: { id: number; vacationHoursUsed: number },
  deltaHours: number
): Promise<void> {
  const next = contract.vacationHoursUsed + deltaHours;
  await db
    .update(contractsTable)
    .set({ vacationHoursUsed: next < 0 ? 0 : Math.round(next * 100) / 100 })
    .where(eq(contractsTable.id, contract.id));
}

// Bucht die Urlaubs-Stunden der Abwesenheit auf den Vertrag, der für
// (userId, Datum) gilt.
async function adjustVacationHours(
  userId: number,
  date: Date,
  deltaHours: number
): Promise<void> {
  const contract = await activeContractFor(userId, date);
  if (!contract) return;
  await applyVacationDelta(contract, deltaHours);
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
  const dateStr = new Date(date).toISOString().split("T")[0];
  const conditions = [
    eq(shiftsTable.userId, userId),
    eq(shiftsTable.type, type as "vacation" | "sick"),
    sql`DATE(${shiftsTable.startTime}) = ${dateStr}`,
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
      "Für diesen Assistenten besteht an diesem Tag bereits eine Abwesenheit dieses Typs.",
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
  const dateStr = new Date(date).toISOString().split("T")[0];
  const conditions = [
    eq(shiftsTable.teamId, teamId),
    eq(shiftsTable.type, "team" as const),
    sql`DATE(${shiftsTable.startTime}) = ${dateStr}`,
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
async function allowanceContext(
  teamId: number | null
): Promise<{ window: NightWindow; state: GermanState | null }> {
  let settings: { nightStart: string; nightEnd: string; state: string | null } | undefined;
  if (teamId != null) {
    const [override] = await db
      .select({
        nightStart: allowanceSettingsTable.nightStart,
        nightEnd: allowanceSettingsTable.nightEnd,
        state: allowanceSettingsTable.state,
      })
      .from(allowanceSettingsTable)
      .where(eq(allowanceSettingsTable.teamId, teamId));
    settings = override;
    if (!settings) {
      const [row] = await db
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
}): Promise<void> {
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
        await dailyTargetHours(shift.userId, new Date(shift.startTime))
      )
    : 0;
  const valuationPercent = absence
    ? 100
    : await valuationPercentFor(shift.type, shift.shiftModelId);
  const { window, state } = await allowanceContext(shift.teamId);
  const metrics = resolveShiftMetrics(
    {
      type: shift.type,
      startTime: new Date(shift.startTime),
      endTime: new Date(shift.endTime),
      plannedHours,
      valuationPercent,
    },
    window,
    state
  );
  await db.update(shiftsTable).set(metrics).where(eq(shiftsTable.id, shift.id));
}

type ShiftConflict = {
  id: number;
  startTime: Date;
  endTime: Date;
  type: string;
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
    // Abwesenheiten UND Team-Einträge (Teamsitzungen) lösen keine
    // Überschneidungswarnung mit regulären Schichten aus.
    notInArray(shiftsTable.type, [
      "vacation",
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
  return db
    .select({
      id: shiftsTable.id,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
      type: shiftsTable.type,
    })
    .from(shiftsTable)
    .where(and(...conditions));
}

// Strukturierte 409-Antwort mit den kollidierenden Schichten (ISO-Zeitstempel,
// damit das Frontend zeitzonenkorrekt formatieren kann).
function overlapResponseBody(conflicts: ShiftConflict[]) {
  return {
    error: "Diese Schicht überschneidet sich mit einer bestehenden Schicht desselben Assistenten.",
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
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const effectiveUserId =
    req.session.role === "assistant" ? req.session.userId! : query.data.userId;

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
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
  const conditions = [
    or(
      inArray(shiftsTable.teamId, teamScope),
      inArray(shiftsTable.einsatzTeamId, teamScope)
    )!,
  ];
  if (effectiveUserId) conditions.push(eq(shiftsTable.userId, effectiveUserId));
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day" | "vacation" | "sick" | "work" | "freizeitausgleich" | "team" | "kind_krank" | "freistellung" | "abgesagt_ag" | "abgesagt_an" | "urlaubsabgeltung"));
  if (query.data.month && query.data.year) {
    conditions.push(sql`EXTRACT(MONTH FROM ${shiftsTable.startTime}) = ${query.data.month}`);
    conditions.push(sql`EXTRACT(YEAR FROM ${shiftsTable.startTime}) = ${query.data.year}`);
  }

  const rows = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
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
async function forwardPlanningBlocked(
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

// Alle geplanten Arbeitsschichten (keine Abwesenheiten) eines Assistenten an
// einem Kalendertag im angegebenen Team — längste zuerst. Grundlage der
// Primary-Lookup-Ersetzung: eine neue Abwesenheit "überschreibt" den an dem Tag
// geplanten Dienst und erbt dessen Zeiten (damit Stunden + Zuschlagspotenzial).
async function findPlannedWorkShiftsForDay(
  userId: number,
  teamId: number,
  day: Date
): Promise<{ id: number; startTime: Date; endTime: Date }[]> {
  const dateStr = day.toISOString().split("T")[0];
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
        sql`DATE(${shiftsTable.startTime}) = ${dateStr}`
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
async function deleteReplacedWorkShift(shiftId: number): Promise<void> {
  await db.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, shiftId));
  await db.delete(shiftsTable).where(eq(shiftsTable.id, shiftId));
}

// Leitet Start/Ende eines Abwesenheits-Datums aus den Standardzeiten eines
// Schichtmodells ab (Fallback-Lookup bei leerem Dienstplan). Liegt das Ende vor
// oder gleich der Startzeit, endet die Schicht am Folgetag (Nacht-/24h-Dienst).
function shiftModelTimesForDay(
  day: Date,
  startHHMM: string,
  endHHMM: string
): { startTime: Date; endTime: Date } {
  const dateStr = day.toISOString().split("T")[0];
  const startTime = new Date(`${dateStr}T${startHHMM}:00Z`);
  let endTime = new Date(`${dateStr}T${endHHMM}:00Z`);
  if (endTime.getTime() <= startTime.getTime()) {
    endTime = new Date(endTime.getTime() + 24 * 3_600_000);
  }
  return { startTime, endTime };
}

router.post("/shifts", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateShiftBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Team-Scope + Member-Invariante MÜSSEN vor allen inhaltlichen Prüfungen
  // stehen (Überschneidung/Doppel-Abwesenheit), sonst könnte ein fremder Admin
  // per 409-Antwort Schichtzeiten/Abwesenheiten teamfremder Nutzer ausspähen.
  const write = await resolveWriteTeamId(req.session.userId!, body.data.teamId ?? undefined);
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
    const allowedForEinsatz = await getAllowedTeamIds(req.session.userId!);
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
  const insertValues = {
    ...body.data,
    teamId: write.teamId,
    // Abwesenheiten UND Team-Einträge sind produktseitig immer verbindlich.
    // Vertretungs-Markierung und Pausenminuten sind reine Arbeitsdienst-Infos
    // und werden dort serverseitig zurückgesetzt.
    ...(isAbsenceType(body.data.type) || body.data.type === "team"
      ? { planningStatus: "FIX" as const, isVertretung: false, pauseMinutes: 0 }
      : {}),
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
  if (isAbsenceType(body.data.type)) {
    const planned = await findPlannedWorkShiftsForDay(
      body.data.userId,
      write.teamId,
      new Date(body.data.startTime)
    );
    if (planned.length > 0) {
      insertValues.startTime = planned[0]!.startTime;
      insertValues.endTime = planned[0]!.endTime;
      for (const p of planned) {
        await deleteReplacedWorkShift(p.id);
      }
    } else if (body.data.shiftModelId != null) {
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

  const [shift] = await db.insert(shiftsTable).values(insertValues).returning();

  await storeShiftMetrics(shift);

  if (isAbsenceType(shift.type)) {
    await bookAbsenceTimeTracking(shift);
    if (shift.type === "vacation") {
      const hours = await resolveVacationHours(
        shift.userId,
        shift.teamId,
        shift.startTime,
        shift.endTime
      );
      await adjustVacationHours(shift.userId, new Date(shift.startTime), hours);
    }
  }

  const [withUser] = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(eq(shiftsTable.id, shift.id));
  res.status(201).json(withUser);
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

router.patch("/shifts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateShiftParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateShiftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
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

  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
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
          "Das Tauschen des Assistenten (Massenbearbeitung) ist im Premium-Tarif enthalten.",
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
  };

  // Team-Einträge ganztägig erzwingen — auch beim Bearbeiten (Typwechsel zu
  // team oder Zeitänderung eines Team-Eintrags), serverseitig autoritativ.
  if (effectiveType === "team") {
    const normalized = normalizeTeamEntryTimes(new Date(effectiveStart));
    updateValues.startTime = normalized.startTime;
    updateValues.endTime = normalized.endTime;
  }
  const [updated] = await db
    .update(shiftsTable)
    .set(updateValues)
    .where(eq(shiftsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const newType = updated.type;
  const oldType = oldShift.type;
  const wasAbsence = isAbsenceType(oldType);
  const isAbsence = isAbsenceType(newType);

  // Zeiterfassung an den Typ-Übergang anpassen.
  if (wasAbsence && !isAbsence) {
    await removeAbsenceTimeTracking(updated.id);
  } else if (!wasAbsence && isAbsence) {
    await bookAbsenceTimeTracking(updated);
  } else if (wasAbsence && isAbsence) {
    // Bleibt Abwesenheit: Buchung mit Datum/Zeiten/Vertrag synchron halten.
    await syncAbsenceTimeTracking(updated);
  }

  // Urlaubsanspruch rebalancieren (stundengenau): Ein Urlaubstag bucht seine
  // Urlaubs-Stunden auf den Vertrag, der für (userId, Datum) gilt — vor und nach
  // dem Update. Ändert sich der gültige Vertrag (z.B. Datumswechsel über
  // Vertragsgrenzen), der Typ ODER die Stundenzahl (z.B. Zeit-Edit von/zu 24h),
  // wird umgebucht.
  const oldVacationContract =
    oldType === "vacation"
      ? await activeContractFor(oldShift.userId, new Date(oldShift.startTime))
      : null;
  const newVacationContract =
    newType === "vacation"
      ? await activeContractFor(updated.userId, new Date(updated.startTime))
      : null;
  const oldVacationHours = oldVacationContract
    ? await resolveVacationHours(
        oldShift.userId,
        oldShift.teamId,
        oldShift.startTime,
        oldShift.endTime
      )
    : 0;
  const newVacationHours = newVacationContract
    ? await resolveVacationHours(
        updated.userId,
        updated.teamId,
        updated.startTime,
        updated.endTime
      )
    : 0;
  if (oldVacationContract?.id !== newVacationContract?.id) {
    if (oldVacationContract) await applyVacationDelta(oldVacationContract, -oldVacationHours);
    if (newVacationContract) await applyVacationDelta(newVacationContract, newVacationHours);
  } else if (newVacationContract && oldVacationHours !== newVacationHours) {
    // Gleicher Vertrag, aber geänderte Stundenzahl: Differenz umbuchen.
    await applyVacationDelta(newVacationContract, newVacationHours - oldVacationHours);
  }

  // Kennzahlen nach der Änderung (Zeiten/Typ/Modell) neu berechnen und speichern.
  await storeShiftMetrics(updated);

  const [withUser] = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .where(eq(shiftsTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/shifts/:id", requireAdmin, async (req, res): Promise<void> => {
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

  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  if (shift.teamId == null || !allowedTeams.includes(shift.teamId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (isAbsenceType(shift.type)) {
    await removeAbsenceTimeTracking(shift.id);
    if (shift.type === "vacation") {
      const hours = await resolveVacationHours(
        shift.userId,
        shift.teamId,
        shift.startTime,
        shift.endTime
      );
      await adjustVacationHours(shift.userId, new Date(shift.startTime), -hours);
    }
  }

  await db.delete(shiftsTable).where(eq(shiftsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
