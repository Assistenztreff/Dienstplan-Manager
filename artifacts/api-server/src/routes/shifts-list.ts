import { Router } from "express";
import { db } from "@workspace/db";
import { shiftsTable, usersTable } from "@workspace/db";
import { eq, and, sql, or, lt, gte, inArray } from "drizzle-orm";
import { ListShiftsQueryParams } from "@workspace/api-zod";
import { requireAuth, isAdminLikeRole } from "../middleware/auth";
import { resolveReadTeamScope, getTeamIdsWithCapability, parseTeamIdParam } from "../lib/teams";
import { einsatzTeamsTable, homeTeamsTable, standbyUsersTable, SHIFT_SELECT } from "./shifts";

const router = Router();

router.get("/shifts", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftsQueryParams.safeParse({
    userId: req.query.userId ? Number(req.query.userId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    type: req.query.type,
    // Bewusst NICHT zod.coerce.boolean() vertrauen (Boolean("false") === true);
    // nur der literale String "true" schaltet den Zeitraum-Default ab.
    all: req.query.all === "true" ? true : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  // Team-Freigeschaltete (assistant-Rolle mit is_teamleiter=true ODER
  // gestufter Freischaltung ab Basis) erhalten die team-weite Sicht auf alle
  // Dienste dieser Teams — nicht nur die eigenen.
  const tlTeamIds = isAdminLikeRole(req.session.role!)
    ? null
    : await getTeamIdsWithCapability(req.session.userId!, "read");
  const isTeamleiterUser = tlTeamIds != null && tlTeamIds.length > 0;

  const effectiveUserId =
    req.session.role === "assistant" && !isTeamleiterUser ? req.session.userId! : query.data.userId;

  const teamScope = await resolveReadTeamScope(
    req.session.userId!,
    parseTeamIdParam(req),
    isTeamleiterUser ? tlTeamIds! : undefined,
  );
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  // Aushilfe-Spiegel: Schichten anderer (eigener) Teams, die als "Einsatz für"
  // ein Team im Scope markiert sind, erscheinen zusätzlich in dessen Kalender
  // (dort schreibgeschützt; Stunden zählen weiterhin nur im Stammteam).
  // Task #793: Abwesenheits-Zeilen von Aushilfe-Nutzern ebenfalls mitliefern,
  // damit der Kalender das Ausfall-Icon auch für Fremdeinsätze korrekt zeigt.
  // Abwesenheiten können kein einsatzTeamId tragen (Validierung schlägt das
  // fehl, ~Z. 1015), daher erkennt das EXISTS die Nutzer über ihren Aushilfe-
  // Arbeitsdienst im Ziel-Team am selben Kalendertag.
  const aushilfeTeamScopeAny = sql`ANY(ARRAY[${sql.join(teamScope.map((id) => sql`${id}`), sql`, `)}]::int[])`;
  const conditions = [
    or(
      inArray(shiftsTable.teamId, teamScope),
      inArray(shiftsTable.einsatzTeamId, teamScope),
      and(
        sql`${shiftsTable.type} IN ('vacation','sick','freizeitausgleich','kind_krank','freistellung','abgesagt_ag','abgesagt_an','urlaubsabgeltung')`,
        sql`EXISTS (
          SELECT 1 FROM shifts a
          WHERE a.user_id = ${shiftsTable.userId}
            AND a.einsatz_team_id = ${aushilfeTeamScopeAny}
            AND a.start_time::date = ${shiftsTable.startTime}::date
        )`
      )
    )!,
  ];
  if (effectiveUserId) conditions.push(eq(shiftsTable.userId, effectiveUserId));
  if (query.data.type) conditions.push(eq(shiftsTable.type, query.data.type as "active" | "standby" | "night" | "full_day" | "vacation" | "sick" | "work" | "freizeitausgleich" | "team" | "kind_krank" | "freistellung" | "abgesagt_ag" | "abgesagt_an" | "urlaubsabgeltung"));
  // Zeitraum-Default: ohne month/year UND ohne explizites all=true liefert die
  // Route nicht mehr die gesamte Historie, sondern nur den aktuellen
  // Kalendermonat (Performance). year allein (ohne month) filtert auf das
  // ganze Jahr — deckt Jahreskalender wie AbwesenheitsKalender ab. all=true
  // ist der bewusste Opt-out für Team-Übersichten/Exporte, die tatsächlich
  // die volle Historie brauchen (z. B. die Abwesenheiten-Seite). Bereits auf
  // eine einzelne Person eingegrenzte Abfragen (effectiveUserId gesetzt —
  // explizit oder durch die Assistenz-Selbstsicht erzwungen) sind naturgemäß
  // klein und bleiben unbegrenzt, damit z. B. die Duplikat-Prüfung über
  // Jahresgrenzen hinweg weiterhin funktioniert.
  const now = new Date();
  let rangeStart: Date | undefined;
  let rangeEnd: Date | undefined;
  if (query.data.month && query.data.year) {
    // Sargable Monatsgrenze statt EXTRACT(): ermöglicht Indexnutzung auf start_time.
    rangeStart = new Date(Date.UTC(query.data.year, query.data.month - 1, 1));
    rangeEnd = new Date(Date.UTC(query.data.year, query.data.month, 1));
  } else if (query.data.year) {
    rangeStart = new Date(Date.UTC(query.data.year, 0, 1));
    rangeEnd = new Date(Date.UTC(query.data.year + 1, 0, 1));
  } else if (!query.data.all && !effectiveUserId) {
    rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  if (rangeStart && rangeEnd) {
    conditions.push(gte(shiftsTable.startTime, rangeStart));
    conditions.push(lt(shiftsTable.startTime, rangeEnd));
  }

  const rows = await db
    .select(SHIFT_SELECT)
    .from(shiftsTable)
    .leftJoin(usersTable, eq(shiftsTable.userId, usersTable.id))
    .leftJoin(einsatzTeamsTable, eq(einsatzTeamsTable.id, shiftsTable.einsatzTeamId))
    .leftJoin(homeTeamsTable, eq(homeTeamsTable.id, shiftsTable.teamId))
    .leftJoin(standbyUsersTable, eq(standbyUsersTable.id, shiftsTable.standbyUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(rows);
});

export default router;
