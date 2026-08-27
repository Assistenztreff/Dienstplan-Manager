import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable, shiftModelsTable, teamsTable } from "@workspace/db";
import { eq, and, sql, notInArray, lt, gt, gte, inArray } from "drizzle-orm";
import {
  BulkCreateAbsenceBody,
  BulkCreateShiftsBody,
  BulkDeleteShiftsBody,
} from "@workspace/api-zod";
import { sendSickLeaveNotification } from "../lib/mailer";
import { getBaseUrl } from "../lib/base-url";
import { requireAuth, isAdminLikeRole } from "../middleware/auth";
import {
  resolveWriteTeamId,
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  getTeamIdsWithCapability,
  isUserMemberOfTeam,
  isKoordinatorUser,
  isShiftModelInTeam,
} from "../lib/teams";
import { isAbsenceType, resolveShiftMetrics } from "../lib/shift-metrics-resolve";
import { resolveVacationHours } from "../lib/vacation-hours";
import {
  activeContractFor,
  allowanceContext,
  applyVacationDelta,
  type BulkAbsenceCreationResult,
  dayKey,
  einsatzTeamsTable,
  forwardPlanningBlocked,
  homeTeamsTable,
  InvalidAbsenceDayError,
  InvalidShiftModelError,
  normalizeAbsenceDays,
  normalizeTeamEntryTimes,
  removeAbsenceTimeTracking,
  runBulkAbsenceCreation,
  SHIFT_SELECT,
  teamMeetingEnabledForTeam,
  VacationOutsideContractError,
  valuationPercentFor,
} from "./shifts";

const router = Router();

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

export default router;
