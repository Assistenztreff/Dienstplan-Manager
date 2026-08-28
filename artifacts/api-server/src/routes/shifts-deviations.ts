// ---------------------------------------------------------------------------
// Abweichungsmodell: gegenseitige Bestätigung der tatsächlich geleisteten
// Arbeitszeit bei einem bereits vergangenen, bestätigten (FIX) Dienst.
// Siehe lib/db/src/schema/shift_deviation_reports.ts für das Regelwerk.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, shiftChangesTable, shiftDeviationReportsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  ListShiftDeviationsQueryParams,
  ReportShiftDeviationParams,
  ReportShiftDeviationBody,
  AcceptShiftDeviationParams,
  DisputeShiftDeviationParams,
  DisputeShiftDeviationBody,
} from "@workspace/api-zod";
import { requireAuth, requireTeamPlanningOrAdmin } from "../middleware/auth";
import {
  getAllowedTeamIds,
  getEffectiveAdminTeamIds,
  resolveReadTeamScope,
  parseTeamIdParam,
} from "../lib/teams";
import { isAbsenceType } from "../lib/shift-metrics-resolve";
import { storeShiftMetrics } from "./shifts";

const router = Router();

// Muss VOR /shifts/:id/deviation stehen — sonst würde Express "deviations"
// als :id-Parameter matchen.
router.get("/shifts/deviations", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftDeviationsQueryParams.safeParse({
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
    .select()
    .from(shiftDeviationReportsTable)
    .where(inArray(shiftDeviationReportsTable.teamId, teamScope));
  res.json(rows);
});

router.post("/shifts/:id/deviation", requireAuth, async (req, res): Promise<void> => {
  const params = ReportShiftDeviationParams.safeParse({ id: Number(req.params["id"]) });
  const body = ReportShiftDeviationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
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

  // Nur die eigene Schicht — 404 statt 403, damit fremde Schicht-IDs nicht
  // ausspähbar sind (Muster wie beim Löschen eigener Abwesenheiten).
  if (
    shift.userId !== req.session.userId ||
    shift.teamId == null ||
    !(await getAllowedTeamIds(req.session.userId!)).includes(shift.teamId)
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (shift.planningStatus !== "FIX" || isAbsenceType(shift.type) || shift.type === "team") {
    res.status(400).json({
      error: "Abweichungen können nur für bestätigte Arbeitsdienste gemeldet werden.",
      code: "deviation_invalid_shift",
    });
    return;
  }
  if (shift.endTime.getTime() >= Date.now()) {
    res.status(400).json({
      error: "Der Dienst liegt noch nicht in der Vergangenheit.",
      code: "deviation_not_past",
    });
    return;
  }

  // "Dienst ist ausgefallen": Server ignoriert das gemeldete Ende und
  // speichert eine Nulldauer-Meldung — läuft bei der Annahme ohne
  // Sonderfall durch die bestehende Stundenberechnung.
  const ausgefallen = body.data.ausgefallen === true;
  const reportedStart = new Date(body.data.startTime);
  const reportedEnd = ausgefallen ? reportedStart : new Date(body.data.endTime);

  try {
    const [inserted] = await db
      .insert(shiftDeviationReportsTable)
      .values({
        shiftId: shift.id,
        teamId: shift.teamId,
        userId: shift.userId,
        reportedStartTime: reportedStart,
        reportedEndTime: reportedEnd,
        reportedPauseMinutes: body.data.pauseMinutes ?? 0,
        reportedAusgefallen: ausgefallen,
      })
      .returning();
    res.status(201).json(inserted);
  } catch (err) {
    // Abbruchregel gegen Ping-Pong: genau eine Meldung pro Dienst
    // (UNIQUE(shift_id)) — ein zweiter Versuch ist ein sauberer 409.
    const pgCode =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "Für diesen Dienst wurde bereits eine Abweichung gemeldet." });
      return;
    }
    throw err;
  }
});

router.post(
  "/shifts/:id/deviation/accept",
  requireTeamPlanningOrAdmin,
  async (req, res): Promise<void> => {
    const params = AcceptShiftDeviationParams.safeParse({ id: Number(req.params["id"]) });
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
    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    if (shift.teamId == null || !allowedTeams.includes(shift.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [report] = await db
      .select()
      .from(shiftDeviationReportsTable)
      .where(eq(shiftDeviationReportsTable.shiftId, shift.id))
      .limit(1);
    if (!report) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (report.status !== "PENDING") {
      res.status(409).json({ error: "Meldung ist nicht mehr offen." });
      return;
    }

    // Transaktional: Schicht auf den gemeldeten Wert setzen, Änderungshistorie
    // schreiben, Kennzahlen neu berechnen, Meldung als angenommen markieren.
    const result = await db.transaction(async (tx) => {
      const [updatedShift] = await tx
        .update(shiftsTable)
        .set({
          startTime: report.reportedStartTime,
          endTime: report.reportedEndTime,
          pauseMinutes: report.reportedPauseMinutes,
        })
        .where(eq(shiftsTable.id, shift.id))
        .returning();

      await tx.insert(shiftChangesTable).values({
        shiftId: shift.id,
        teamId: shift.teamId,
        userId: shift.userId,
        changedBy: req.session.userId!,
        changeSource: "deviation_accepted",
        before: {
          startTime: shift.startTime.toISOString(),
          endTime: shift.endTime.toISOString(),
          pauseMinutes: shift.pauseMinutes,
          userId: shift.userId,
        },
        after: {
          startTime: updatedShift.startTime.toISOString(),
          endTime: updatedShift.endTime.toISOString(),
          pauseMinutes: updatedShift.pauseMinutes,
          userId: updatedShift.userId,
        },
      });

      await storeShiftMetrics(updatedShift, tx);

      const [updatedReport] = await tx
        .update(shiftDeviationReportsTable)
        .set({ status: "ACCEPTED", resolvedBy: req.session.userId!, resolvedAt: new Date() })
        .where(eq(shiftDeviationReportsTable.id, report.id))
        .returning();
      return updatedReport;
    });

    res.json(result);
  },
);

router.post(
  "/shifts/:id/deviation/dispute",
  requireTeamPlanningOrAdmin,
  async (req, res): Promise<void> => {
    const params = DisputeShiftDeviationParams.safeParse({ id: Number(req.params["id"]) });
    const body = DisputeShiftDeviationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid request" });
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
    const allowedTeams = await getEffectiveAdminTeamIds(req.session.userId!, req.session.role!);
    if (shift.teamId == null || !allowedTeams.includes(shift.teamId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [report] = await db
      .select()
      .from(shiftDeviationReportsTable)
      .where(eq(shiftDeviationReportsTable.shiftId, shift.id))
      .limit(1);
    if (!report) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (report.status !== "PENDING") {
      res.status(409).json({ error: "Meldung ist nicht mehr offen." });
      return;
    }

    // Planwert bleibt maßgeblich — die Schicht wird NICHT geändert, keine
    // Änderungshistorie-Zeile. Beide Werte (Plan/gemeldet) bleiben über den
    // Report selbst sichtbar.
    const [updatedReport] = await db
      .update(shiftDeviationReportsTable)
      .set({
        status: "DISPUTED",
        resolvedBy: req.session.userId!,
        resolvedAt: new Date(),
        disputeReason: body.data.reason,
      })
      .where(eq(shiftDeviationReportsTable.id, report.id))
      .returning();

    res.json(updatedReport);
  },
);

export default router;
