import { Router } from "express";
import { db } from "@workspace/db";
import { hourBudgetsTable, shiftsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  ListHourBudgetsQueryParams,
  CreateHourBudgetBody,
  UpdateHourBudgetParams,
  UpdateHourBudgetBody,
  DeleteHourBudgetParams,
  GetHourBudgetBalanceQueryParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middleware/auth";
import { requirePlanFeature } from "../lib/plan";
import {
  resolveReadTeamScope,
  resolveWriteTeamId,
  getEffectiveAdminTeamIds,
  parseTeamIdParam,
} from "../lib/teams";
import {
  computeHourBudgetBalance,
  findOverlappingBudget,
  monthStartDate,
  monthEndDate,
  type BudgetPeriod,
  type BudgetShift,
} from "../lib/hour-budget-balance";

// ---------------------------------------------------------------------------
// Zielvereinbarungen (Monatsbudget genehmigter Assistenzstunden) — Bedarfsseite.
// ---------------------------------------------------------------------------
// Premium-Feature: Das komplette Feature (CRUD + Bilanz-Endpunkt) haengt an
// "advancedAnalytics" — demselben Gate wie die uebrigen Auswertungen
// (Soll/Ist-Berechnung, Krankmeldungs-Kachel). Die Rohdaten der Dienste
// bleiben davon unberuehrt (Bestandsschutz); gesperrt ist nur die Budget-
// Verwaltung und die abgeleitete Bilanz.
//
// Zugriff: Admins (inkl. superadmin) — Zielvereinbarungen gehoeren zur
// Einstellungs-/Bedarfsverwaltung des Assistenznehmers, nicht zum
// Lohn-/Payroll-Bereich der Teamleiter. Team-Scoping exakt wie bei
// Vertraegen: Lese-Scope ueber resolveReadTeamScope, Schreib-Scope ueber
// resolveWriteTeamId, By-Id-Zugriffe strikt per inArray(teamId, scope)
// (404 statt Orakel bei fremden IDs).
const router = Router();

const BUDGET_SELECT = {
  id: hourBudgetsTable.id,
  teamId: hourBudgetsTable.teamId,
  monthlyHours: hourBudgetsTable.monthlyHours,
  startDate: hourBudgetsTable.startDate,
  endDate: hourBudgetsTable.endDate,
  notes: hourBudgetsTable.notes,
  createdAt: hourBudgetsTable.createdAt,
};

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

// Validierte month/year-Query-Parameter (Default: aktueller Monat) —
// lokale Kopie des Musters aus dashboard.ts (dort bewusst nicht exportiert).
function parseMonthYear(query: { month?: number; year?: number }): { month: number; year: number } | null {
  const now = new Date();
  const month = query.month ?? now.getMonth() + 1;
  const year = query.year ?? now.getFullYear();
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return { month, year };
}

router.get(
  "/hour-budgets",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const query = ListHourBudgetsQueryParams.safeParse({
      teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
    });
    if (!query.success) {
      res.status(400).json({ error: "Invalid query parameters" });
      return;
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
    const rows = await db
      .select(BUDGET_SELECT)
      .from(hourBudgetsTable)
      .where(inArray(hourBudgetsTable.teamId, teamScope))
      .orderBy(hourBudgetsTable.startDate);
    res.json(rows);
  },
);

router.post(
  "/hour-budgets",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const body = CreateHourBudgetBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
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
    const startDate = toDateString(body.data.startDate);
    const endDate = body.data.endDate ? toDateString(body.data.endDate) : null;
    if (endDate != null && startDate > endDate) {
      res.status(400).json({ error: "Das Beginndatum darf nicht nach dem Enddatum liegen." });
      return;
    }
    // Zeitraeume eines Teams duerfen sich nicht ueberlappen — eine neue
    // Zielvereinbarung loest die alte zeitraumbezogen AB (Historie bleibt),
    // sie darf sie aber nicht schneiden (Nachberechnungen waeren mehrdeutig).
    const existing = await db
      .select()
      .from(hourBudgetsTable)
      .where(eq(hourBudgetsTable.teamId, write.teamId));
    if (findOverlappingBudget(existing, { startDate, endDate })) {
      res.status(409).json({
        error: "Der Zeitraum überlappt eine bestehende Zielvereinbarung.",
        code: "budget_overlap",
      });
      return;
    }
    const [created] = await db
      .insert(hourBudgetsTable)
      .values({
        teamId: write.teamId,
        monthlyHours: body.data.monthlyHours,
        startDate,
        endDate,
        notes: body.data.notes,
      })
      .returning();
    res.status(201).json(created);
  },
);

router.patch(
  "/hour-budgets/:id",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const params = UpdateHourBudgetParams.safeParse({ id: Number(req.params["id"]) });
    const body = UpdateHourBudgetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    const [existing] = await db
      .select()
      .from(hourBudgetsTable)
      .where(and(eq(hourBudgetsTable.id, params.data.id), inArray(hourBudgetsTable.teamId, allowedTeams)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Beginn/Ende kombiniert validieren — auch wenn nur eines der Felder kommt.
    const effectiveStart =
      body.data.startDate !== undefined ? toDateString(body.data.startDate) : existing.startDate;
    const effectiveEnd =
      body.data.endDate !== undefined
        ? body.data.endDate === null
          ? null
          : toDateString(body.data.endDate)
        : existing.endDate;
    if (effectiveEnd != null && effectiveStart > effectiveEnd) {
      res.status(400).json({ error: "Das Beginndatum darf nicht nach dem Enddatum liegen." });
      return;
    }
    // Ueberlappungs-Check gegen die anderen Zeitraeume desselben Teams
    // (der eigene Datensatz ist ausgenommen).
    const siblings = await db
      .select()
      .from(hourBudgetsTable)
      .where(eq(hourBudgetsTable.teamId, existing.teamId));
    if (findOverlappingBudget(siblings, { startDate: effectiveStart, endDate: effectiveEnd }, existing.id)) {
      res.status(409).json({
        error: "Der Zeitraum überlappt eine bestehende Zielvereinbarung.",
        code: "budget_overlap",
      });
      return;
    }
    const updateValues: Record<string, unknown> = {};
    if (body.data.monthlyHours !== undefined) updateValues["monthlyHours"] = body.data.monthlyHours;
    if (body.data.startDate !== undefined) updateValues["startDate"] = effectiveStart;
    if (body.data.endDate !== undefined) updateValues["endDate"] = effectiveEnd;
    if (body.data.notes !== undefined) updateValues["notes"] = body.data.notes;
    const [updated] = await db
      .update(hourBudgetsTable)
      .set(updateValues)
      .where(and(eq(hourBudgetsTable.id, params.data.id), inArray(hourBudgetsTable.teamId, allowedTeams)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  },
);

router.delete(
  "/hour-budgets/:id",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const params = DeleteHourBudgetParams.safeParse({ id: Number(req.params["id"]) });
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    const deleted = await db
      .delete(hourBudgetsTable)
      .where(and(eq(hourBudgetsTable.id, params.data.id), inArray(hourBudgetsTable.teamId, allowedTeams)))
      .returning({ id: hourBudgetsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  },
);

// Bilanz-Endpunkt: genehmigt / verbraucht / verbleibend fuer den Monat plus
// laufender Jahressaldo und Warnschwelle. Verbrauch zaehlt nur echte
// Arbeitsdienste (Abwesenheiten sind im Budget bereits enthalten) — die
// Berechnung lebt DB-frei in lib/hour-budget-balance.ts.
router.get(
  "/dashboard/hour-budget-balance",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const query = GetHourBudgetBalanceQueryParams.safeParse({
      month: req.query.month != null && req.query.month !== "" ? Number(req.query.month) : undefined,
      year: req.query.year != null && req.query.year !== "" ? Number(req.query.year) : undefined,
      teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
    });
    if (!query.success) {
      res.status(400).json({ error: "Ungültiger month-/year-Parameter" });
      return;
    }
    const monthYear = parseMonthYear(query.data);
    if (!monthYear) {
      res.status(400).json({ error: "Ungültiger month-/year-Parameter" });
      return;
    }
    const { month, year } = monthYear;

    const teamScope = await resolveReadTeamScope(req.session.userId!, parseTeamIdParam(req));
    if (teamScope === null) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }

    // Zeitraum: Jahresanfang bis Ende des Auswertungsmonats (Jahressaldo +
    // Monatsbilanz in einem Daten-Zugriff).
    const rangeStart = `${year}-01-01`;
    const rangeEnd = monthEndDate(month, year);

    // Alle Budgets des Scopes (kein Datumsfilter): compute filtert fachlich
    // nach Gültigkeit, und hasBudgets im Ergebnis braucht die volle Liste
    // (Dashboard-Kachel erscheint erst, sobald ein Budget existiert).
    const budgets: BudgetPeriod[] = teamScope.length
      ? await db
          .select({
            monthlyHours: hourBudgetsTable.monthlyHours,
            startDate: hourBudgetsTable.startDate,
            endDate: hourBudgetsTable.endDate,
          })
          .from(hourBudgetsTable)
          .where(inArray(hourBudgetsTable.teamId, teamScope))
      : [];

    const shifts: BudgetShift[] = teamScope.length
      ? await db
          .select({
            type: shiftsTable.type,
            startTime: shiftsTable.startTime,
            endTime: shiftsTable.endTime,
            valuedHours: shiftsTable.valuedHours,
          })
          .from(shiftsTable)
          .where(
            and(
              inArray(shiftsTable.teamId, teamScope),
              sql`${shiftsTable.startTime} >= ${rangeStart}`,
              sql`${shiftsTable.startTime} < ${monthEndDate(month, year)}::date + 1`,
            ),
          )
      : [];

    res.json(computeHourBudgetBalance({ budgets, shifts, month, year }));
  },
);

export default router;
