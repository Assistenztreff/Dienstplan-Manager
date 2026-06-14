import { Router } from "express";
import { db } from "@workspace/db";
import {
  shiftsTable,
  usersTable,
  contractsTable,
  timeTrackingTable,
  shiftModelsTable,
  allowanceSettingsTable,
  computeShiftMetrics,
  type NightWindow,
  type GermanState,
} from "@workspace/db";
import { eq, and, sql, or, isNull, ne, notInArray, lt, gt, inArray } from "drizzle-orm";
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

const router = Router();

const SHIFT_SELECT = {
  id: shiftsTable.id,
  userId: shiftsTable.userId,
  startTime: shiftsTable.startTime,
  endTime: shiftsTable.endTime,
  type: shiftsTable.type,
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

// Urlaub und Krankheit sind Abwesenheiten: sie referenzieren kein Schichtmodell
// und lösen keine Zuschlagsberechnung aus.
function isAbsenceType(type: string): boolean {
  return type === "vacation" || type === "sick";
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
// (Fallback 23:00–06:00; ohne Bundesland nur bundesweite Feiertage).
async function allowanceContext(): Promise<{ window: NightWindow; state: GermanState | null }> {
  const [settings] = await db
    .select()
    .from(allowanceSettingsTable)
    .where(eq(allowanceSettingsTable.id, 1));
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
  type: string;
  shiftModelId: number | null;
  startTime: Date;
  endTime: Date;
}): Promise<void> {
  let metrics;
  if (isAbsenceType(shift.type)) {
    // Urlaub/Krankheit: die vollen geplanten Tagesstunden gelten als erfüllt
    // (gewertete Stunden = Vertrags-Soll des Tages). Keine Zuschläge.
    const planned = await dailyTargetHours(shift.userId, new Date(shift.startTime));
    metrics = { valuedHours: planned, nightHours: 0, sundayHours: 0, holidayHours: 0 };
  } else {
    const valuationPercent = await valuationPercentFor(shift.type, shift.shiftModelId);
    const { window, state } = await allowanceContext();
    metrics = computeShiftMetrics(
      {
        startTime: new Date(shift.startTime),
        endTime: new Date(shift.endTime),
        isAbsence: false,
        valuationPercent,
      },
      window,
      state
    );
  }
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

  // Kollisionsprüfung mit den effektiven (ggf. teil-aktualisierten) Werten, die
  // eigene Schicht ausgenommen. force überschreibt bewusst, ohne Schema-Änderung.
  const force = req.body?.force === true;
  const effectiveType = body.data.type ?? oldShift.type;
  const effectiveStart = body.data.startTime ?? oldShift.startTime;
  const effectiveEnd = body.data.endTime ?? oldShift.endTime;
  if (!isAbsenceType(effectiveType) && !force) {
    const conflicts = await findOverlappingShifts(
      oldShift.userId,
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
  // excludeShiftId ausgenommen.
  if (isAbsenceType(effectiveType)) {
    const duplicate = await findDuplicateAbsence(
      oldShift.userId,
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
