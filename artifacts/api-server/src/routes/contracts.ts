import { Router } from "express";
import { db } from "@workspace/db";
import {
  contractsTable,
  usersTable,
  shiftsTable,
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
import {
  recalcVacationHoursUsed,
  computeVacationBalanceForContract,
} from "../lib/vacation-hours";
import { requirePlanFeatureViaTeamOwner } from "../lib/plan";
import { resolveAllowanceOps } from "../lib/allowance-resolve";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  getTeamleiterTeamIds,
  canViewPayrollInTeam,
  parseTeamIdParam,
  isUserMemberOfTeam,
  isKoordinatorUser,
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
  // Koordinatoren sind Verwaltungspersonen, nie Personal: Ein Vertrag würde
  // sie in Stunden-/Lohnauswertungen als Pseudo-Assistenzkraft auftauchen lassen.
  if (await isKoordinatorUser(body.data.userId)) {
    res.status(403).json({
      error: "Für Teamkoordinatoren können keine Verträge angelegt werden.",
    });
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

  if (Object.keys(updateValues).length === 0) {
    res.status(400).json({ error: "Keine änderbaren Felder angegeben." });
    return;
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

    // Urlaub wird stundengenau gefuehrt (Point 7): Verbrauch stundenweise in
    // vacationHoursUsed. Ein 24h-Dienst verbraucht 24h = 3,0 Tage. Der
    // Umrechnungsfaktor und die Berechnungsmethode kommen aus den
    // Einstellungen des Team-Eigentuemers (Fallback-Kette). Die eigentliche
    // Rechnung (inkl. Ersatzruhetag-Konto und Jahresprognose) ist mit der
    // Batch-Route (GET /vacation-balances) geteilt.
    const ops = await resolveAllowanceOps(contract.teamId);
    res.json(await computeVacationBalanceForContract(contract, ops));
  },
);

// Batch-Variante der obigen Bilanz: liefert die Resturlaub-Bilanz ALLER (im
// Aufrufer-Scope sichtbaren) Vertraege eines Teams in EINEM Request — ersetzt
// die N Einzelaufrufe, die abwesenheiten.tsx frueher pro Assistenzkraft
// abgesetzt hat. `ops` wird einmal pro Team geladen (nicht pro Vertrag), das
// ist der eigentliche Performance-Gewinn gegenueber einer bloss
// serverseitig gebündelten Schleife über die Einzel-Route.
//
// Zugriff/Scope identisch zur Einzel-Route: Plan-Gate ueber den Team-
// Eigentuemer, Admins sehen alle Vertraege ihrer erlaubten Teams, Assistenten
// NUR den eigenen Vertrag (kein Cross-User-PII-Leak innerhalb des Teams).
router.get(
  "/vacation-balances",
  requireAuth,
  requirePlanFeatureViaTeamOwner("absenceTracking"),
  async (req, res): Promise<void> => {
    const allowedTeams = await getAllowedTeamIds(req.session.userId!);
    const teamIdParam = parseTeamIdParam(req);
    let scopeTeams = allowedTeams;
    if (teamIdParam !== undefined) {
      if (!allowedTeams.includes(teamIdParam)) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      scopeTeams = [teamIdParam];
    }
    if (scopeTeams.length === 0) {
      res.json([]);
      return;
    }

    const isAssistant = !isAdminLikeRole(req.session.role);
    const contracts = await db
      .select()
      .from(contractsTable)
      .where(
        and(
          inArray(contractsTable.teamId, scopeTeams),
          // Assistenten: strikt nur der eigene Vertrag (Team-Scope allein
          // wuerde Vertraege von Team-Kollegen sichtbar machen — identisch
          // zur Einzel-Route).
          isAssistant ? eq(contractsTable.userId, req.session.userId!) : sql`TRUE`,
        ),
      );

    // ops einmal PRO TEAM auflösen statt pro Vertrag (der eigentliche
    // Batch-Gewinn) — die meisten Aufrufe betreffen ohnehin genau ein Team.
    // Erst alle beteiligten Teams auflösen (parallel, jedes Team nur einmal),
    // DANACH die pro-Vertrag-Berechnungen parallel starten (Promise.all statt
    // einer seriellen for-await-Schleife) — die einzelnen Verträge sind
    // voneinander unabhängig, serielles Warten würde die Latenzen nur
    // aneinanderreihen statt sie zu überlappen.
    const distinctTeamIds = [...new Set(contracts.map((c) => c.teamId))];
    const opsEntries = await Promise.all(
      distinctTeamIds.map(async (teamId) => [teamId, await resolveAllowanceOps(teamId)] as const),
    );
    const opsByTeam = new Map(opsEntries);
    const results = await Promise.all(
      contracts.map((contract) =>
        computeVacationBalanceForContract(contract, opsByTeam.get(contract.teamId)!),
      ),
    );
    res.json(results);
  },
);

export default router;
