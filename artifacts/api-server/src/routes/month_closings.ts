// ---------------------------------------------------------------------------
// Monatsabschluss der Lohnauswertung mit Nachberechnung im Folgemonat.
// ---------------------------------------------------------------------------
// - POST /month-closings: friert die aktuelle Lohnauswertung (hours-balance)
//   eines VERGANGENEN Monats als append-only Referenz ein. Ein erneuter
//   Abschluss ersetzt die Referenz (neue Zeile), Historie bleibt.
// - GET /month-closings: Abschluss-Status + Historie + Plausibilitätszahl
//   offener IST-Einträge des Monats.
// - GET /month-closings/diff: Nachberechnung — Differenz zwischen der
//   eingefrorenen Referenz und dem aktuellen Stand (nur echte Abweichungen).
// Soft-Close: Bearbeitungen bleiben erlaubt; der Client zeigt nur Warnungen.
// Premium-Gate wie die Lohnauswertung selbst (advancedAnalytics); Team-Scoping
// wie alle Domänen-Routen (fremdes Team → 403, Abschlüsse team-gebunden).
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "@workspace/db";
import {
  monthClosingsTable,
  timeTrackingTable,
  usersTable,
  type MonthClosingEntry,
} from "@workspace/db";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { CreateMonthClosingBody } from "@workspace/api-zod";
import { requireAdmin } from "../middleware/auth";
import { requirePlanFeature } from "../lib/plan";
import { parseTeamIdParam, resolveWriteTeamId } from "../lib/teams";
import { computeHoursBalances } from "../lib/hours-balance-service";
import { computeMonthClosingDiff } from "../lib/month-closing-diff";
import type { HoursBalanceRow } from "../lib/dashboard-hours-balance";
import type { Request, Response } from "express";

const router = Router();

// Abschlüsse sind IMMER einem konkreten Team zugeordnet (team_id NOT NULL).
// Auflösung wie bei Schreibzugriffen: explizites teamId muss im erlaubten
// Scope liegen (sonst 403), ohne teamId greift das Standard-Team des Kontos.
async function resolveClosingTeam(
  req: Request,
  res: Response,
  requestedTeamId?: number,
): Promise<number | null> {
  const resolved = await resolveWriteTeamId(req.session.userId!, requestedTeamId);
  if (!resolved.ok) {
    if (resolved.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team vorhanden" });
    }
    return null;
  }
  return resolved.teamId;
}

function parseMonthYear(req: Request, res: Response): { month: number; year: number } | null {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    res.status(400).json({ error: "Ungültiger Monat/Jahr" });
    return null;
  }
  return { month, year };
}

/** Liegt (year, month) strikt VOR dem laufenden Monat? (Abschluss erst ab dem 1. des Folgemonats.) */
function isPastMonth(month: number, year: number): boolean {
  const now = new Date();
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
}

type MetaRow = {
  id: number;
  teamId: number;
  month: number;
  year: number;
  closedBy: number;
  closedByName: string | null;
  closedAt: Date;
};

function toMeta(r: MetaRow) {
  return {
    id: r.id,
    teamId: r.teamId,
    month: r.month,
    year: r.year,
    closedBy: r.closedBy,
    closedByName: r.closedByName ?? "",
    closedAt: r.closedAt.toISOString(),
  };
}

async function loadClosings(teamId: number, month: number, year: number): Promise<MetaRow[]> {
  return db
    .select({
      id: monthClosingsTable.id,
      teamId: monthClosingsTable.teamId,
      month: monthClosingsTable.month,
      year: monthClosingsTable.year,
      closedBy: monthClosingsTable.closedBy,
      closedByName: usersTable.name,
      closedAt: monthClosingsTable.closedAt,
    })
    .from(monthClosingsTable)
    .leftJoin(usersTable, eq(usersTable.id, monthClosingsTable.closedBy))
    .where(
      and(
        eq(monthClosingsTable.teamId, teamId),
        eq(monthClosingsTable.month, month),
        eq(monthClosingsTable.year, year),
      ),
    )
    // Jüngster Abschluss zuerst — er ist die maßgebliche Referenz.
    .orderBy(desc(monthClosingsTable.closedAt), desc(monthClosingsTable.id));
}

// Schnappschuss-Zeile aus der Live-Auswertung: nur die für die Nachberechnung
// relevanten Felder (Stunden + Geldwerte), stabiler eigener Typ.
function toEntry(row: HoursBalanceRow): MonthClosingEntry {
  return {
    userId: row.userId,
    userName: row.userName,
    plannedHours: row.plannedHours,
    totalFulfilledHours: row.totalFulfilledHours,
    billingMethod: row.billingMethod,
    hourlyWage: row.hourlyWage ?? null,
    basePay: row.basePay ?? null,
    nightSurchargePay: row.nightSurchargePay ?? null,
    sundaySurchargePay: row.sundaySurchargePay ?? null,
    holidaySurchargePay: row.holidaySurchargePay ?? null,
    totalPay: row.totalPay ?? null,
  };
}

router.get(
  "/month-closings",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const my = parseMonthYear(req, res);
    if (!my) return;
    const teamId = await resolveClosingTeam(req, res, parseTeamIdParam(req));
    if (teamId == null) return;

    const closings = await loadClosings(teamId, my.month, my.year);

    // Plausibilitätswarnung: offene (unbestätigte) IST-Einträge des Monats im Team.
    const [pending] = await db
      .select({ n: count() })
      .from(timeTrackingTable)
      .where(
        and(
          eq(timeTrackingTable.teamId, teamId),
          eq(timeTrackingTable.status, "pending"),
          sql`EXTRACT(MONTH FROM ${timeTrackingTable.actualStart}) = ${my.month}`,
          sql`EXTRACT(YEAR FROM ${timeTrackingTable.actualStart}) = ${my.year}`,
        ),
      );

    const history = closings.map(toMeta);
    res.json({
      closed: history.length > 0,
      ...(history.length > 0 ? { latest: history[0] } : {}),
      history,
      pendingTimeEntries: pending?.n ?? 0,
    });
  },
);

router.post(
  "/month-closings",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const parsed = CreateMonthClosingBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { month, year, teamId: requestedTeamId } = parsed.data;

    // Abschluss erst ab dem 1. des Folgemonats — der laufende (oder ein
    // zukünftiger) Monat kann sich noch ändern und wäre keine belastbare Referenz.
    if (!isPastMonth(month, year)) {
      res.status(400).json({
        error: "Der Monat kann erst ab dem 1. des Folgemonats abgeschlossen werden.",
        code: "month_not_closable",
      });
      return;
    }

    const teamId = await resolveClosingTeam(req, res, requestedTeamId);
    if (teamId == null) return;

    // Einzufrierende Zahlen: exakt die Lohnauswertung dieses Teams.
    const rows = await computeHoursBalances(req.session.userId!, month, year, teamId);
    if (rows === null) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }

    const [created] = await db
      .insert(monthClosingsTable)
      .values({
        teamId,
        month,
        year,
        entries: rows.map(toEntry),
        // Ausführender Admin SERVERSEITIG aus der Session (nie aus dem Body).
        closedBy: req.session.userId!,
      })
      .returning();

    const [closer] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, created.closedBy));

    res.status(201).json(
      toMeta({
        id: created.id,
        teamId: created.teamId,
        month: created.month,
        year: created.year,
        closedBy: created.closedBy,
        closedByName: closer?.name ?? "",
        closedAt: created.closedAt,
      }),
    );
  },
);

router.get(
  "/month-closings/diff",
  requireAdmin,
  requirePlanFeature("advancedAnalytics"),
  async (req, res): Promise<void> => {
    const my = parseMonthYear(req, res);
    if (!my) return;
    const teamId = await resolveClosingTeam(req, res, parseTeamIdParam(req));
    if (teamId == null) return;

    // Maßgebliche Referenz = jüngster Abschluss dieses Monats.
    const [latest] = await db
      .select()
      .from(monthClosingsTable)
      .where(
        and(
          eq(monthClosingsTable.teamId, teamId),
          eq(monthClosingsTable.month, my.month),
          eq(monthClosingsTable.year, my.year),
        ),
      )
      .orderBy(desc(monthClosingsTable.closedAt), desc(monthClosingsTable.id))
      .limit(1);

    if (!latest) {
      res.json({ closed: false, rows: [] });
      return;
    }

    const current = await computeHoursBalances(req.session.userId!, my.month, my.year, teamId);
    if (current === null) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }

    const rows = computeMonthClosingDiff(
      latest.entries,
      current.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        totalFulfilledHours: r.totalFulfilledHours,
        totalPay: r.totalPay ?? null,
      })),
    );

    res.json({ closed: true, closedAt: latest.closedAt.toISOString(), rows });
  },
);

export default router;
