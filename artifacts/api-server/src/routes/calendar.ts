import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { shiftsTable, usersTable, shiftModelsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import {
  requirePlanFeatureViaTeamOwner,
  userHasFeatureViaTeamOwner,
} from "../lib/plan";
import { resolveReadTeamScope, parseTeamIdParam } from "../lib/teams";

const router = Router();

// ---------------------------------------------------------------------------
// Premium-Feature "calendarSync": Export des Dienstplans in die eigene
// Kalender-App als iCalendar-Datei (.ics). Serverseitig autoritativ gegated —
// Free-Konten erhalten 403 plan_feature_required. Für ASSISTENTEN hängt das
// Feature am Plan des TEAM-EIGENTÜMERS (Arbeitgebers), nicht am eigenen —
// Assistenten-Konten sind praktisch immer "free" (nur Admin-Konten sind
// zahlende Konten), analog zu strictTimeTracking. Es werden ausschließlich
// verbindliche (FIX) Schichten exportiert (Entwürfe/Vorschläge sind keine
// offiziellen Termine). Assistenten erhalten nur die EIGENEN Schichten,
// Admins alle Schichten im erlaubten Team-Scope.
//
// Zusätzlich zum Einmal-Download gibt es einen ABO-Feed: Kalender-Apps
// (Google/Apple/Outlook) können eine ICS-URL abonnieren und aktualisieren sich
// dann automatisch. Da Kalender-Clients keine Session-Cookies senden können,
// authentifiziert ein geheimer, pro Nutzer generier- und widerrufbarer Token
// (`users.calendar_token`) die öffentliche Feed-URL /calendar-feed/:token.
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

/**
 * Baut den iCalendar-Inhalt (nur FIX-Schichten) für einen Nutzer.
 * Assistenten sehen ausschließlich die eigenen Schichten, Admins alle
 * Schichten im übergebenen (bereits autorisierten) Team-Scope.
 */
async function buildIcs(
  viewer: { userId: number; role: string },
  teamScope: number[],
): Promise<string> {
  const conditions = [eq(shiftsTable.planningStatus, "FIX")];
  if (viewer.role === "assistant") {
    // Assistenten exportieren ausschließlich die eigenen Schichten.
    conditions.push(eq(shiftsTable.userId, viewer.userId));
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
    const label = typeLabel[row.type] ?? row.modelName ?? "Dienst";
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
  return lines.join("\r\n") + "\r\n";
}

/** Relativer Pfad der Abo-URL (das Frontend hängt die eigene Origin davor). */
function feedPathFor(token: string): string {
  return `/api/calendar-feed/${token}`;
}

router.get(
  "/calendar-export",
  requireAuth,
  requirePlanFeatureViaTeamOwner("calendarSync"),
  async (req, res): Promise<void> => {
    const teamScope = await resolveReadTeamScope(
      req.session.userId!,
      parseTeamIdParam(req),
    );
    if (teamScope === null) {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
      return;
    }

    const ics = await buildIcs(
      { userId: req.session.userId!, role: req.session.role ?? "assistant" },
      teamScope,
    );

    res
      .status(200)
      .type("text/calendar; charset=utf-8")
      .setHeader("Content-Disposition", 'attachment; filename="dienstplan.ics"')
      .send(ics);
  },
);

// --- Abo-Token-Verwaltung (session-gebunden) -------------------------------

router.get(
  "/calendar-token",
  requireAuth,
  requirePlanFeatureViaTeamOwner("calendarSync"),
  async (req, res): Promise<void> => {
    const [row] = await db
      .select({ calendarToken: usersTable.calendarToken })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId!));
    const token = row?.calendarToken ?? null;
    res.json({ token, feedPath: token ? feedPathFor(token) : null });
    return;
  },
);

router.post(
  "/calendar-token",
  requireAuth,
  requirePlanFeatureViaTeamOwner("calendarSync"),
  async (req, res): Promise<void> => {
    // Erzeugen UND Erneuern: ein bestehender Token wird ersetzt, die alte
    // Feed-URL ist damit sofort ungültig (Widerruf durch Rotation).
    const token = randomBytes(32).toString("hex");
    await db
      .update(usersTable)
      .set({ calendarToken: token })
      .where(eq(usersTable.id, req.session.userId!));
    res.json({ token, feedPath: feedPathFor(token) });
    return;
  },
);

router.delete(
  "/calendar-token",
  requireAuth,
  // Bewusst KEIN Plan-Gate: das Widerrufen eines Zugriffs muss immer möglich
  // sein, auch nach einem Downgrade auf Free.
  async (req, res): Promise<void> => {
    await db
      .update(usersTable)
      .set({ calendarToken: null })
      .where(eq(usersTable.id, req.session.userId!));
    res.status(204).end();
    return;
  },
);

// --- Öffentlicher Abo-Feed (Token statt Session) ----------------------------

router.get(
  "/calendar-feed/:token",
  async (req, res): Promise<void> => {
    const token = req.params.token;
    // Nur echte Geheim-Token akzeptieren (64 Hex-Zeichen); alles andere ist
    // sicher unbekannt und vermeidet unnötige DB-Roundtrips.
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      res.status(404).json({ error: "Unbekannter Kalender-Token" });
      return;
    }

    const [owner] = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.calendarToken, token));
    if (!owner || !owner.isActive) {
      res.status(404).json({ error: "Unbekannter Kalender-Token" });
      return;
    }

    // Premium-Gate über den Token-EIGENTÜMER (es gibt keine Session): nach
    // einem Downgrade auf Free liefert der Feed 403 statt weiter Daten.
    // Für Assistenten-Token zählt der Plan des ARBEITGEBERS (Team-Eigentümer):
    // ein Downgrade des Arbeitgebers sperrt auch den Assistenten-Feed.
    if (!(await userHasFeatureViaTeamOwner(owner.id, "calendarSync"))) {
      res.status(403).json({
        error: "Diese Funktion ist im Premium-Tarif enthalten.",
        code: "plan_feature_required",
        feature: "calendarSync",
      });
      return;
    }

    // Scope wie beim Export: Assistenten die eigenen Schichten, Admins der
    // volle erlaubte Team-Scope (kein teamId-Parameter — die Abo-URL soll
    // stabil bleiben und immer alles Erlaubte enthalten).
    const teamScope = await resolveReadTeamScope(owner.id, undefined);
    const ics = await buildIcs(
      { userId: owner.id, role: owner.role },
      teamScope ?? [],
    );

    res
      .status(200)
      .type("text/calendar; charset=utf-8")
      .send(ics);
  },
);

export default router;
