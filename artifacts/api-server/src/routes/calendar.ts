import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable, shiftModelsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { requirePlanFeature } from "../lib/plan";
import { resolveReadTeamScope, parseTeamIdParam } from "../lib/teams";

const router = Router();

// ---------------------------------------------------------------------------
// Premium-Feature "calendarSync": Export des Dienstplans in die eigene
// Kalender-App als iCalendar-Datei (.ics). Serverseitig autoritativ gegated —
// Free-Konten erhalten 403 plan_feature_required. Es werden ausschließlich
// verbindliche (FIX) Schichten exportiert (Entwürfe/Vorschläge sind keine
// offiziellen Termine). Assistenten erhalten nur die EIGENEN Schichten,
// Admins alle Schichten im erlaubten Team-Scope.
// ---------------------------------------------------------------------------

/** Formatiert ein Datum als iCalendar-UTC-Zeitstempel (YYYYMMDDTHHMMSSZ). */
function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escaped Sonderzeichen in iCalendar-Textfeldern (RFC 5545 3.3.11). */
function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

router.get(
  "/calendar-export",
  requireAuth,
  requirePlanFeature("calendarSync"),
  async (req, res): Promise<void> => {
    const teamScope = await resolveReadTeamScope(
      req.session.userId!,
      parseTeamIdParam(req),
    );
    if (teamScope === null) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }

    const conditions = [eq(shiftsTable.planningStatus, "FIX")];
    if (req.session.role === "assistant") {
      // Assistenten exportieren ausschließlich die eigenen Schichten.
      conditions.push(eq(shiftsTable.userId, req.session.userId!));
    } else {
      if (teamScope.length === 0) {
        conditions.push(eq(shiftsTable.id, -1)); // leerer Scope => leerer Kalender
      } else {
        conditions.push(inArray(shiftsTable.teamId, teamScope));
      }
    }

    const rows = await db
      .select({
        id: shiftsTable.id,
        startTime: shiftsTable.startTime,
        endTime: shiftsTable.endTime,
        type: shiftsTable.type,
        notes: shiftsTable.notes,
        userName: usersTable.name,
        modelName: shiftModelsTable.name,
      })
      .from(shiftsTable)
      .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
      .leftJoin(shiftModelsTable, eq(shiftsTable.shiftModelId, shiftModelsTable.id))
      .where(and(...conditions));

    const now = icsDate(new Date());
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Dienstplan-App//Dienstplan//DE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Dienstplan",
    ];

    const typeLabel: Record<string, string> = {
      vacation: "Urlaub",
      sick: "Krankheit",
    };

    for (const row of rows) {
      const label =
        typeLabel[row.type] ?? row.modelName ?? "Dienst";
      const summary = row.userName ? `${label} – ${row.userName}` : label;
      lines.push(
        "BEGIN:VEVENT",
        `UID:shift-${row.id}@dienstplan-app`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsDate(new Date(row.startTime))}`,
        `DTEND:${icsDate(new Date(row.endTime))}`,
        `SUMMARY:${icsText(summary)}`,
      );
      if (row.notes) lines.push(`DESCRIPTION:${icsText(row.notes)}`);
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");

    res
      .status(200)
      .type("text/calendar; charset=utf-8")
      .setHeader("Content-Disposition", 'attachment; filename="dienstplan.ics"')
      .send(lines.join("\r\n") + "\r\n");
  },
);

export default router;
