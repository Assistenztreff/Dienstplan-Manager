import { Router } from "express";
import { db } from "@workspace/db";
import {
  contractsTable,
  usersTable,
  shiftsTable,
  timeTrackingTable,
  isGermanHoliday,
  type GermanState,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  ListContractsQueryParams,
  CreateContractBody,
  GetContractParams,
  UpdateContractParams,
  UpdateContractBody,
  DeleteContractParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth, requireTeamPlanningOrAdmin, isAdminLikeRole } from "../middleware/auth";
import { recalcVacationHoursUsed, resolveDailyRateInfo } from "../lib/vacation-hours";
import { requirePlanFeatureViaTeamOwner } from "../lib/plan";
import { resolveAllowanceOps } from "../lib/allowance-resolve";
import { round2 } from "../lib/dashboard-hours-balance";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  getTeamleiterTeamIds,
  canViewPayrollInTeam,
  parseTeamIdParam,
  isUserMemberOfTeam,
} from "../lib/teams";

const router = Router();

const CONTRACT_SELECT = {
  id: contractsTable.id,
  userId: contractsTable.userId,
  weeklyHours: contractsTable.weeklyHours,
  workdaysPerWeek: contractsTable.workdaysPerWeek,
  workdaysConfirmedAt: contractsTable.workdaysConfirmedAt,
  vacationDays: contractsTable.vacationDays,
  vacationHoursUsed: contractsTable.vacationHoursUsed,
  startDate: contractsTable.startDate,
  endDate: contractsTable.endDate,
  notes: contractsTable.notes,
  createdAt: contractsTable.createdAt,
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

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

router.get("/contracts", requireAuth, async (req, res): Promise<void> => {
  const query = ListContractsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  // Admins: voller Zugriff per Query-Parameter.
  // Teamleiter mit canViewPayroll: dürfen alle Verträge im Team einsehen.
  // Alle anderen (Assistenten, Teamleiter ohne canViewPayroll): nur eigener Vertrag.
  let filterUserId: number | undefined;
  if (isAdminLikeRole(req.session.role)) {
    filterUserId = query.data.userId;
  } else {
    // Prüfen ob Teamleiter mit Payroll-Freigabe für das angefragte Team.
    const requestedTeamId = parseTeamIdParam(req);
    let hasPayroll = false;
    if (requestedTeamId) {
      hasPayroll = await canViewPayrollInTeam(req.session.userId!, requestedTeamId);
    } else {
      // Kein explizites Team: canViewPayroll in IRGEND einem Teamleiter-Team reicht.
      const tlTeams = await getTeamleiterTeamIds(req.session.userId!);
      if (tlTeams.length > 0) {
        const checks = await Promise.all(tlTeams.map((id) => canViewPayrollInTeam(req.session.userId!, id)));
        hasPayroll = checks.some(Boolean);
      }
    }
    filterUserId = hasPayroll ? query.data.userId : req.session.userId;
  }

  const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  const conditions = [inArray(contractsTable.teamId, teamScope)];
  if (filterUserId) conditions.push(eq(contractsTable.userId, filterUserId));
  const rows = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(and(...conditions));
  res.json(rows);
});

router.post("/contracts", requireTeamPlanningOrAdmin, async (req, res): Promise<void> => {
  const body = CreateContractBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  // Teamleiter benötigen canViewPayroll um Verträge anderer Mitglieder anzulegen.
  if (!isAdminLikeRole(req.session.role!)) {
    const targetTeamId = body.data.teamId ?? undefined;
    const tlTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    const checkTeamIds = targetTeamId ? [targetTeamId] : tlTeams;
    const checks = await Promise.all(checkTeamIds.map((id) => canViewPayrollInTeam(req.session.userId!, id)));
    if (!checks.some(Boolean)) {
      res.status(403).json({ error: "Ohne canViewPayroll können keine Verträge angelegt werden" });
      return;
    }
  }
  const effectiveTeams = isAdminLikeRole(req.session.role!)
    ? undefined
    : (await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!));
  const write = await resolveWriteTeamId(
    req.session.userId!,
    body.data.teamId ?? undefined,
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
  // Der zugeordnete Nutzer muss Mitglied des Ziel-Teams sein, sonst ließe sich
  // ein fremder userId ins Team verknüpfen (Cross-Team-PII-Leak).
  if (!(await isUserMemberOfTeam(body.data.userId, write.teamId))) {
    res.status(403).json({ error: "Nutzer gehört nicht zu diesem Team" });
    return;
  }
  const [contract] = await db
    .insert(contractsTable)
    .values({
      ...body.data,
      teamId: write.teamId,
      // Explizit gesetzte Arbeitstage zählen als bewusste Festlegung
      // (Datenpflege-Hinweis entfällt dann).
      ...(body.data.workdaysPerWeek != null
        ? { workdaysConfirmedAt: new Date() }
        : {}),
      startDate: toDateString(body.data.startDate),
      endDate: body.data.endDate ? toDateString(body.data.endDate) : undefined,
    })
    .returning();
  // Urlaubszähler aus den tatsächlich vorhandenen Urlaubs-Schichten aufbauen:
  // erfasst auch Alt-Urlaube, die vor der Vertragsanlage nie verbucht wurden.
  await recalcVacationHoursUsed(contract);
  const [withUser] = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, contract.id));
  res.status(201).json(withUser);
});

router.get("/contracts/:id", requireTeamPlanningOrAdmin, async (req, res): Promise<void> => {
  const params = GetContractParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
  const [row] = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Teamleiter ohne canViewPayroll dürfen nur ihren eigenen Vertrag lesen.
  if (!isAdminLikeRole(req.session.role!) && row.userId !== req.session.userId) {
    // teamId direkt aus DB lesen (CONTRACT_SELECT enthält es nicht).
    const [contractMeta] = await db
      .select({ teamId: contractsTable.teamId })
      .from(contractsTable)
      .where(eq(contractsTable.id, params.data.id));
    const hasPayroll = contractMeta
      ? await canViewPayrollInTeam(req.session.userId!, contractMeta.teamId)
      : false;
    if (!hasPayroll) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  res.json(row);
});

router.patch("/contracts/:id", requireTeamPlanningOrAdmin, async (req, res): Promise<void> => {
  const params = UpdateContractParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateContractBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const updateValues: Record<string, unknown> = { ...body.data };
  // workdaysConfirm ist kein Spaltenwert: true = bestehende Arbeitstage als
  // geprüft bestätigen (nur Zeitstempel setzen, kein Wert wird angetastet —
  // konfliktfest gegenüber parallelen Wert-Updates).
  delete updateValues["workdaysConfirm"];
  // Jede bewusste Arbeitstage-Änderung (Formular, Rechner-Dialog) oder
  // Bestätigung (Hinweis-Schließen) bestätigt den Wert.
  if (body.data.workdaysPerWeek !== undefined || body.data.workdaysConfirm === true) {
    updateValues["workdaysConfirmedAt"] = new Date();
  }
  if (body.data.startDate !== undefined) {
    updateValues["startDate"] = toDateString(body.data.startDate);
  }
  if (body.data.endDate !== undefined && body.data.endDate !== null) {
    updateValues["endDate"] = toDateString(body.data.endDate);
  }

  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);

  // Teamleiter ohne canViewPayroll dürfen nur den eigenen Vertrag bearbeiten.
  if (!isAdminLikeRole(req.session.role!)) {
    const [contractMeta] = await db
      .select({ teamId: contractsTable.teamId, userId: contractsTable.userId })
      .from(contractsTable)
      .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)));
    if (contractMeta && contractMeta.userId !== req.session.userId) {
      const hasPayroll = await canViewPayrollInTeam(req.session.userId!, contractMeta.teamId);
      if (!hasPayroll) {
        res.status(403).json({ error: "Ohne canViewPayroll können nur eigene Verträge bearbeitet werden" });
        return;
      }
    }
  }

  // Bestehenden Vertrag laden (team-gescoped, IDOR-sicher), um Beginn/Ende
  // kombiniert validieren zu können — auch wenn nur eines der Felder kommt.
  const [existing] = await db
    .select()
    .from(contractsTable)
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const effectiveStart =
    updateValues["startDate"] !== undefined
      ? String(updateValues["startDate"])
      : existing.startDate;
  const effectiveEnd =
    body.data.endDate !== undefined
      ? (updateValues["endDate"] as string | null | undefined) ?? null
      : existing.endDate;
  if (effectiveEnd != null && effectiveStart > effectiveEnd) {
    res.status(400).json({
      error: "Das Beginndatum darf nicht nach dem Enddatum liegen.",
    });
    return;
  }

  const [updated] = await db
    .update(contractsTable)
    .set(updateValues)
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Nach JEDER Vertragsänderung den Urlaubszähler aus den tatsächlich
  // vorhandenen Urlaubs-Schichten im (ggf. neuen) Vertragszeitraum neu
  // aufbauen — ein vorgezogener Beginn erfasst bereits eingetragene Urlaube,
  // ein zurückgeschobener entlastet den Zähler. Schichten bleiben unberührt.
  await recalcVacationHoursUsed(updated);
  const [withUser] = await db
    .select(CONTRACT_SELECT)
    .from(contractsTable)
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .where(eq(contractsTable.id, params.data.id));
  res.json(withUser);
});

router.delete("/contracts/:id", requireTeamPlanningOrAdmin, async (req, res): Promise<void> => {
  const params = DeleteContractParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);

  // Teamleiter ohne canViewPayroll dürfen nur ihren eigenen Vertrag löschen.
  if (!isAdminLikeRole(req.session.role!)) {
    const [contractMeta] = await db
      .select({ teamId: contractsTable.teamId, userId: contractsTable.userId })
      .from(contractsTable)
      .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)));
    if (contractMeta && contractMeta.userId !== req.session.userId) {
      const hasPayroll = await canViewPayrollInTeam(req.session.userId!, contractMeta.teamId);
      if (!hasPayroll) {
        res.status(403).json({ error: "Ohne canViewPayroll können nur eigene Verträge gelöscht werden" });
        return;
      }
    }
  }

  const deleted = await db
    .delete(contractsTable)
    .where(and(eq(contractsTable.id, params.data.id), inArray(contractsTable.teamId, allowedTeams)))
    .returning({ id: contractsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

// Resturlaub-Bilanz ist Teil des Premium-Features "absenceTracking":
// Das Frontend-Gate in abwesenheiten.tsx ist reine UX — hier wird das Feature
// serverseitig autoritativ durchgesetzt (403 plan_feature_required fuer Free).
// Die Rohdaten (contracts.vacationDays/vacationHoursUsed) bleiben ueber
// GET /contracts fuer alle Plaene zugaenglich (Buchhaltung laeuft plan-
// unabhaengig weiter, Bestandsschutz).
//
// Zugriff: Admins wie bisher (eigener Plan massgeblich, Team-Scope). Zusaetzlich
// duerfen ASSISTENTEN ihre EIGENE Bilanz abrufen — das Plan-Gate laeuft dann
// ueber den Plan des ARBEITGEBERS (Team-Eigentuemers), analog calendarSync:
// Assistenten-Konten sind praktisch immer Free, das Feature haengt am zahlenden
// Admin-Konto. Fremde Vertraege bleiben fuer Assistenten 404 (kein PII-Leak,
// auch nicht innerhalb des eigenen Teams).
router.get(
  "/contracts/:id/vacation-balance",
  requireAuth,
  requirePlanFeatureViaTeamOwner("absenceTracking"),
  async (req, res): Promise<void> => {
    const id = Number(req.params["id"]);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const allowedTeams = await getAllowedTeamIds(req.session.userId!);
    const [contract] = await db
      .select()
      .from(contractsTable)
      .where(and(eq(contractsTable.id, id), inArray(contractsTable.teamId, allowedTeams)))
      .limit(1);
    if (!contract) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Assistenten: strikt nur der eigene Vertrag (Team-Scope allein wuerde
    // Vertraege von Team-Kollegen sichtbar machen).
    if (!isAdminLikeRole(req.session.role) && contract.userId !== req.session.userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Urlaub wird stundengenau gefuehrt (Point 7): Pool = vacationDays *
    // vacationHoursPerDay (Standard 8h/Tag), Verbrauch stundenweise in
    // vacationHoursUsed. Ein 24h-Dienst verbraucht 24h = 3,0 Tage. Der
    // Umrechnungsfaktor und die Berechnungsmethode kommen aus den
    // Einstellungen des Team-Eigentuemers (Fallback-Kette).
    const ops = await resolveAllowanceOps(contract.teamId);
    const hoursPerDay = ops.vacationHoursPerDay;
    const vacationHoursTotal = round2(contract.vacationDays * hoursPerDay);
    const vacationHoursUsed = round2(contract.vacationHoursUsed);
    const vacationHoursRemaining = round2(vacationHoursTotal - vacationHoursUsed);
    const daysUsed = Math.round((vacationHoursUsed / hoursPerDay) * 10) / 10;

    // Ersatzruhetag-Konto (§ 11 Abs. 3 ArbZG): Wer an einem gesetzlichen
    // Feiertag TATSAECHLICH arbeitet (bestaetigte IST-Zeit auf einer
    // Arbeitsschicht), hat Anspruch auf einen Ausgleichs-Ruhetag. Das Konto
    // ist vollstaendig aus den Schichten ableitbar (kein separater Zaehler):
    //   verdient   = Anzahl DISTINCT Feiertage mit bestaetigter Arbeit
    //   eingeloest = Anzahl "freizeitausgleich"-Tage
    const restState = (ops.state as GermanState | null) ?? null;
    // UTC-Kalendertag als garantierte "YYYY-MM-DD"-Zeichenkette (isGermanHoliday
    // und die Zuschlagsberechnung interpretieren Zeitstempel in UTC).
    const workedHolidayDates = await db
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
          eq(shiftsTable.type, "work"),
        ),
      );
    // Werktags-Regel (§ 11 Abs. 3 ArbZG): Nur Feiertage auf einem Werktag (Mo–Sa)
    // verdienen einen Ersatzruhetag. Faellt der Feiertag auf einen Sonntag,
    // entstehen nur Sonntags-/Feiertagszuschlaege, aber KEIN zusaetzlicher
    // Ausgleichs-Ruhetag. Ist das Konto deaktiviert, wird nichts gutgeschrieben
    // (bereits eingeloeste Tage bleiben unberuehrt).
    const restDaysEarned = ops.ersatzruhetagEnabled
      ? workedHolidayDates.filter((r) => {
          const holidayDate = new Date(`${r.day}T12:00:00Z`);
          return holidayDate.getUTCDay() !== 0 && isGermanHoliday(holidayDate, restState);
        }).length
      : 0;
    const [redeemedRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(shiftsTable)
      .where(
        and(
          eq(shiftsTable.userId, contract.userId),
          eq(shiftsTable.teamId, contract.teamId),
          eq(shiftsTable.type, "freizeitausgleich"),
        ),
      );
    const restDaysRedeemed = Number(redeemedRow?.count ?? 0);
    const restDaysBalance = restDaysEarned - restDaysRedeemed;

    // Bewertungsquelle eines (hypothetischen) ganztägigen Urlaubstags HEUTE:
    // bwavg-Schnitt, Vertragsdaten (Wochenstunden ÷ Arbeitstage/Woche) oder
    // Standardwert. Die UI zeigt bei "contract" einen Datenpflege-Hinweis —
    // Bestandsverträge stehen nach der Migration oft pauschal auf 5 Arbeits-
    // tage/Woche, was 7-Tage-Modelle in der Assistenz falsch bewertet.
    const rateInfo = await resolveDailyRateInfo(
      contract.userId,
      contract.teamId,
      new Date(),
      hoursPerDay,
    );

    res.json({
      contractId: contract.id,
      userId: contract.userId,
      vacationDays: contract.vacationDays,
      vacationDaysUsed: daysUsed,
      vacationDaysRemaining: Math.round((contract.vacationDays - daysUsed) * 10) / 10,
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
      dailyHours: round2(rateInfo.dailyHours),
      contractWorkdaysPerWeek: rateInfo.workdaysPerWeek,
      contractWeeklyHours: rateInfo.weeklyHours,
    });
  },
);

export default router;
