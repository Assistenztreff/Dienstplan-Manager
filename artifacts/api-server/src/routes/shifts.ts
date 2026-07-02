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
import { isAbsenceType, resolveShiftMetrics } from "../lib/shift-metrics-resolve";
import { userHasFeature, getUserLimit } from "../lib/plan";

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
  valuedHours: shiftsTable.valuedHours,
  nightHours: shiftsTable.nightHours,
  sundayHours: shiftsTable.sundayHours,
  holidayHours: shiftsTable.holidayHours,
  createdAt: shiftsTable.createdAt,
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

// Vertragliche Soll-Stunden des Tages (Wochenstunden / 5). Fallback 8h ohne Vertrag.
async function dailyTargetHours(userId: number, date: Date): Promise<number> {
  const contract = await activeContractFor(userId, date);
  return contract ? Math.round((contract.weeklyHours / 5) * 100) / 100 : 8;
}

// Bucht die Soll-Stunden des Tages als bestätigte Zeiterfassung (Lohnfortzahlung,
// keine Zuschläge), da Abwesenheiten kein Arbeits-Schichtmodell sind.
async function bookAbsenceTimeTracking(shift: AbsenceShift): Promise<void> {
  const dailyHours = await dailyTargetHours(shift.userId, new Date(shift.startTime));
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
  const dailyHours = await dailyTargetHours(shift.userId, new Date(shift.startTime));
  await db
    .update(timeTrackingTable)
    .set({ actualHours: dailyHours, actualStart: shift.startTime, actualEnd: shift.endTime })
    .where(eq(timeTrackingTable.shiftId, shift.id));
}

async function removeAbsenceTimeTracking(shiftId: number): Promise<void> {
  await db.delete(timeTrackingTable).where(eq(timeTrackingTable.shiftId, shiftId));
}

// Schreibt den genommenen Urlaub auf einem konkreten Vertrag fort. Geht nie unter null.
async function applyVacationDelta(
  contract: { id: number; vacationDaysUsed: number },
  delta: number
): Promise<void> {
  const next = contract.vacationDaysUsed + delta;
  await db
    .update(contractsTable)
    .set({ vacationDaysUsed: next < 0 ? 0 : next })
    .where(eq(contractsTable.id, contract.id));
}

// Bucht +1/-1 auf den Vertrag, der für (userId, Datum) gilt.
async function adjustVacationDaysUsed(userId: number, date: Date, delta: number): Promise<void> {
  const contract = await activeContractFor(userId, date);
  if (!contract) return;
  await applyVacationDelta(contract, delta);
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
  // Bei Abwesenheit zählen die geplanten Tagesstunden, sonst die Modell-Wertung.
  const plannedHours = absence
    ? await dailyTargetHours(shift.userId, new Date(shift.startTime))
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
    notInArray(shiftsTable.type, ["vacation", "sick"]),
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

  const conditions = [inArray(shiftsTable.teamId, teamScope)];
  if (effectiveUserId) conditions.push(eq(shiftsTable.userId, effectiveUserId));
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day" | "vacation" | "sick" | "work"));
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

router.post("/shifts", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateShiftBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Kollisionsprüfung: nur für reguläre Schichten und nur, wenn der Admin nicht
  // bewusst überschreibt (force). force kommt aus dem Roh-Body, nicht aus dem
  // validierten Schema, damit die OpenAPI-Spec unverändert bleibt.
  const force = req.body?.force === true;
  if (!isAbsenceType(body.data.type) && !force) {
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

  const write = await resolveWriteTeamId(req.session.userId!, body.data.teamId ?? undefined);
  if (!write.ok) {
    if (write.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team zugeordnet" });
    }
    return;
  }

  // Der zugeordnete Nutzer muss Mitglied des Ziel-Teams sein, sonst ließe sich
  // ein fremder userId ins Team verknüpfen (Cross-Team-PII-Leak).
  if (!(await isUserMemberOfTeam(body.data.userId, write.teamId))) {
    res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
    return;
  }

  // Free-Limit (historyMonths): Vorausplanung in zu weit entfernte Zukunfts-
  // Monate sperren (Plan des Team-Eigentuemers maßgeblich, Bestandsschutz).
  if (await forwardPlanningBlocked(write.teamId, req.session.userId!, body.data.startTime, res)) {
    return;
  }

  // Das verknüpfte Schichtmodell muss zum Ziel-Team gehören, sonst flössen die
  // Wertungs-/Zuschlagsparameter eines fremden Teams in die Auswertung ein.
  if (body.data.shiftModelId != null) {
    if (!(await isShiftModelInTeam(body.data.shiftModelId, write.teamId))) {
      res.status(403).json({ error: "Schichtmodell gehört nicht zu diesem Team" });
      return;
    }
  }

  const [shift] = await db.insert(shiftsTable).values({ ...body.data, teamId: write.teamId }).returning();

  await storeShiftMetrics(shift);

  if (isAbsenceType(shift.type)) {
    await bookAbsenceTimeTracking(shift);
    if (shift.type === "vacation") {
      await adjustVacationDaysUsed(shift.userId, new Date(shift.startTime), 1);
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
  if (!isAbsenceType(effectiveType) && !force) {
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

  // Wird das Schichtmodell geändert, muss das neue Modell zum Team der Schicht
  // gehören (oldShift.teamId, das Team bleibt bei PATCH unverändert), sonst
  // flössen fremde Wertungs-/Zuschlagsparameter in die Auswertung ein.
  if (body.data.shiftModelId != null) {
    if (!(await isShiftModelInTeam(body.data.shiftModelId, oldShift.teamId))) {
      res.status(403).json({ error: "Schichtmodell gehört nicht zu diesem Team" });
      return;
    }
  }

  const [updated] = await db
    .update(shiftsTable)
    .set(body.data)
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

  // Urlaubsanspruch rebalancieren: Ein Urlaubstag bucht genau 1 Tag auf den Vertrag,
  // der für (userId, Datum) gilt — vor und nach dem Update. Ändert sich der gültige
  // Vertrag (z.B. durch Datumswechsel über Vertragsgrenzen) oder der Typ, umbuchen.
  const oldVacationContract =
    oldType === "vacation"
      ? await activeContractFor(oldShift.userId, new Date(oldShift.startTime))
      : null;
  const newVacationContract =
    newType === "vacation"
      ? await activeContractFor(updated.userId, new Date(updated.startTime))
      : null;
  if (oldVacationContract?.id !== newVacationContract?.id) {
    if (oldVacationContract) await applyVacationDelta(oldVacationContract, -1);
    if (newVacationContract) await applyVacationDelta(newVacationContract, 1);
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
      await adjustVacationDaysUsed(shift.userId, new Date(shift.startTime), -1);
    }
  }

  await db.delete(shiftsTable).where(eq(shiftsTable.id, params.data.id));
  res.status(204).send();
});

export default router;
