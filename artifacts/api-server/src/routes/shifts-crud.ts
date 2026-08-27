import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable, timeTrackingTable, shiftModelsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  CreateShiftBody,
  GetShiftParams,
  UpdateShiftParams,
  UpdateShiftBody,
  DeleteShiftParams,
} from "@workspace/api-zod";
import { requireAuth, requireTeamPlanningOrAdmin, isAdminLikeRole } from "../middleware/auth";
import {
  resolveWriteTeamId,
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  getTeamIdsWithCapability,
  isUserMemberOfTeam,
  isKoordinatorUser,
  isShiftModelInTeam,
} from "../lib/teams";
import {
  isAbsenceType,
  isPlainFullDay,
  deriveDayWindowFromDefaults as shiftModelTimesForDay,
} from "../lib/shift-metrics-resolve";
import { resolveVacationHours } from "../lib/vacation-hours";
import { userHasFeature } from "../lib/plan";
import {
  activeContractFor,
  adjustVacationHours,
  applyVacationDelta,
  bookAbsenceTimeTracking,
  dayKey,
  duplicateAbsenceResponseBody,
  einsatzTeamsTable,
  findDuplicateAbsence,
  findDuplicateTeamEntry,
  findOverlappingShifts,
  findPlannedWorkShiftsForDay,
  forwardPlanningBlocked,
  homeTeamsTable,
  normalizeTeamEntryTimes,
  overlapResponseBody,
  removeAbsenceTimeTracking,
  SHIFT_SELECT,
  storeShiftMetrics,
  syncAbsenceTimeTracking,
  teamMeetingEnabledForTeam,
  vacationOutsideContractError,
} from "./shifts";

const router = Router();

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

export default router;
