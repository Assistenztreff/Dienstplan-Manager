// ---------------------------------------------------------------------------
// Urlaubs-/Krankheitsanträge mit Bestätigungspflicht (#887).
// ---------------------------------------------------------------------------
// Reine Assistenzkräfte legen Urlaub/Krank nicht mehr direkt an (s. Guard in
// routes/shifts.ts, POST /shifts & /shifts/bulk-absence). Stattdessen stellen
// sie hier einen Antrag; ein Planer (Admin/Teamleiter/Koordinator mit
// Planungsrecht) bestätigt oder lehnt ab. Bestätigung ruft dieselbe
// Sammel-Anlage-Logik wie POST /shifts/bulk-absence auf (runBulkAbsenceCreation
// in routes/shifts.ts) — Parität ist Pflicht, s. Kommentar dort.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "@workspace/db";
import { absenceRequestsTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray, sql, type SQL } from "drizzle-orm";
import {
  CreateAbsenceRequestBody,
  ListAbsenceRequestsQueryParams,
  ApproveAbsenceRequestParams,
  RejectAbsenceRequestParams,
} from "@workspace/api-zod";
import { requireAuth, isAdminLikeRole } from "../middleware/auth";
import {
  resolveWriteTeamId,
  isKoordinatorUser,
  getEffectiveAdminTeamIds,
} from "../lib/teams";
import {
  runBulkAbsenceCreation,
  normalizeAbsenceDays,
  forwardPlanningBlocked,
  InvalidAbsenceDayError,
  InvalidShiftModelError,
  VacationOutsideContractError,
} from "./shifts";
import { sendSickLeaveNotification } from "../lib/mailer";
import { teamsTable } from "@workspace/db";
import { getTeamIdsWithCapability } from "../lib/teams";
import { getBaseUrl } from "../lib/base-url";

const router = Router();

async function canManageAbsenceRequests(
  userId: number,
  role: string,
  teamId: number,
): Promise<boolean> {
  const allowedTeams = await getEffectiveAdminTeamIds(userId, role);
  return allowedTeams.includes(teamId);
}

function serializeRequest(
  row: typeof absenceRequestsTable.$inferSelect,
  userName: string | null,
) {
  return {
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    userName,
    type: row.type,
    status: row.status,
    days: row.days,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    resultShiftIds: row.resultShiftIds,
  };
}

// POST /absence-requests — Selbsteintragung: legt einen PENDING Antrag an,
// OHNE Schichten/Urlaubskonto zu berühren. Immer für die eigene Person (kein
// userId im Body) — Planer/Admins, die für JEMAND ANDEREN eintragen, nutzen
// weiterhin POST /shifts bzw. /shifts/bulk-absence direkt (sofortige Wirkung).
router.post("/absence-requests", requireAuth, async (req, res): Promise<void> => {
  const body = CreateAbsenceRequestBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const userId = req.session.userId!;

  // Koordinatoren sind Verwaltungspersonen, nie Personal (wie die Schicht-Routen).
  if (await isKoordinatorUser(userId)) {
    res.status(403).json({
      error: "Für Teamkoordinatoren können keine Abwesenheitsanträge gestellt werden.",
    });
    return;
  }

  const write = await resolveWriteTeamId(userId, body.data.teamId);
  if (!write.ok) {
    if (write.reason === "forbidden") {
      res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    } else {
      res.status(400).json({ error: "Kein Team zugeordnet" });
    }
    return;
  }

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

  const [created] = await db
    .insert(absenceRequestsTable)
    .values({
      teamId: write.teamId,
      userId,
      type: body.data.type,
      status: "PENDING",
      days: days.map(([, d]) => ({
        startTime: d.startTime.toISOString(),
        endTime: d.endTime.toISOString(),
      })),
    })
    .returning();

  // Krankmeldungs-Benachrichtigung: der Team-Eigentümer soll SOFORT beim
  // Einreichen erfahren, dass sich eine Assistenzkraft krank gemeldet hat —
  // nicht erst, wenn ein Planer den Antrag später bestätigt (das kann
  // Stunden dauern; die Fürsorgepflicht beginnt mit der Meldung). Nur für
  // die echte Selbsteintragung nicht-privilegierter Personen (Planer/Admins
  // legen Krankheit für andere weiterhin direkt über POST /shifts an, das
  // dortige Benachrichtigungs-Fire-and-Forget bleibt für diesen Pfad
  // zuständig). Fire-and-forget, blockiert die Antwort nicht.
  if (body.data.type === "sick") {
    const isAdmin = isAdminLikeRole(req.session.role!);
    const teamleiterTeams = isAdmin ? [] : await getTeamIdsWithCapability(userId, "plan");
    const isPrivileged = isAdmin || teamleiterTeams.length > 0;
    if (!isPrivileged) {
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
              days.map(([, d]) => d.startTime),
              getBaseUrl(),
              "pending",
            );
          }
        } catch (err) {
          console.warn("Krankmeldungs-Benachrichtigung (Antrag) fehlgeschlagen:", err);
        }
      })();
    }
  }

  res.status(201).json(serializeRequest(created!, null));
});

// GET /absence-requests — Assistenzkräfte sehen NUR eigene Anträge; Planer
// (Admin/Teamleiter/Koordinator mit Planungsrecht) sehen alle Anträge ihrer
// erlaubten Teams, optional gefiltert über status/teamId.
router.get("/absence-requests", requireAuth, async (req, res): Promise<void> => {
  const query = ListAbsenceRequestsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const userId = req.session.userId!;
  const role = req.session.role!;
  const allowedTeams = await getEffectiveAdminTeamIds(userId, role);
  const isManager = allowedTeams.length > 0;

  if (query.data.teamId != null && isManager && !allowedTeams.includes(query.data.teamId)) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }

  const conditions: SQL[] = [];
  if (isManager) {
    conditions.push(
      query.data.teamId != null
        ? eq(absenceRequestsTable.teamId, query.data.teamId)
        : inArray(absenceRequestsTable.teamId, allowedTeams),
    );
  } else {
    conditions.push(eq(absenceRequestsTable.userId, userId));
  }
  if (query.data.status != null) {
    conditions.push(eq(absenceRequestsTable.status, query.data.status));
  }

  const rows = await db
    .select({
      request: absenceRequestsTable,
      userName: usersTable.name,
    })
    .from(absenceRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, absenceRequestsTable.userId))
    .where(and(...conditions))
    .orderBy(desc(absenceRequestsTable.createdAt));

  res.json(rows.map((r) => serializeRequest(r.request, r.userName ?? null)));
});

type ApproveOutcome =
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "responded" } // forwardPlanningBlocked hat bereits geantwortet
  | { kind: "ok"; updated: typeof absenceRequestsTable.$inferSelect };

// POST /absence-requests/:id/approve — legt die beantragten Tage über
// runBulkAbsenceCreation an (identische Logik zu POST /shifts/bulk-absence).
// Prüft ausdrücklich gegen den AKTUELLEN Datenstand, nicht gegen den Stand
// zum Zeitpunkt der Antragstellung (Konflikte können inzwischen entstanden sein).
//
// Race-Sicherheit (Code-Review #887): Prüfung (PENDING?), Schicht-Anlage UND
// Status-Update laufen unter EINEM Advisory-Lock pro Antrags-ID in EINER
// äußeren Transaktion. Ohne das könnten gleichzeitige approve/reject-Aufrufe
// beide PENDING lesen und sich gegenseitig überschreiben — z. B. Reject
// gewinnt den Datensatz, aber ein zeitgleiches Approve legt trotzdem
// Schichten an und überschreibt REJECTED wieder mit APPROVED. Ein zweiter
// Aufruf wartet am Lock, bis der erste committed/rollbacked hat, und sieht
// danach den finalen Status (→ 409 statt Doppel-Entscheidung). Schlägt die
// Anlage fehl (z. B. Vertrags-Guard), wirft der Callback und die äußere
// Transaktion macht das Status-Update rückgängig — der Antrag bleibt
// unverändert PENDING und ist erneut bestätigbar.
router.post("/absence-requests/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const params = ApproveAbsenceRequestParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  let outcome: ApproveOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<ApproveOutcome> => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"absence-request:" + params.data.id}))`,
      );
      const [request] = await tx
        .select()
        .from(absenceRequestsTable)
        .where(eq(absenceRequestsTable.id, params.data.id))
        .limit(1);
      if (!request) {
        return { kind: "not_found" };
      }
      const canManage = await canManageAbsenceRequests(
        req.session.userId!,
        req.session.role!,
        request.teamId,
      );
      if (!canManage) {
        return { kind: "not_found" };
      }
      if (request.status !== "PENDING") {
        return { kind: "conflict" };
      }

      const days = normalizeAbsenceDays(
        request.days.map((d) => ({
          startTime: new Date(d.startTime),
          endTime: new Date(d.endTime),
        })),
      );

      // Free-Limit (historyMonths) gilt auch hier: sonst könnte eine Assistenzkraft
      // beliebig weit in der Zukunft liegende Tage beantragen und ein Planer sie
      // per Bestätigung anlegen lassen, obwohl POST /shifts/bulk-absence denselben
      // Zeitraum direkt ablehnen würde (Umgehung des Plan-Limits über den
      // Antrags-Umweg). Prüft — wie dort — gegen den SPÄTESTEN Tag.
      const latest = days[days.length - 1]![1].startTime;
      if (await forwardPlanningBlocked(request.teamId, req.session.userId!, latest, res)) {
        return { kind: "responded" };
      }

      // outerTx=tx (Code-Review #887): läuft in DERSELBEN Transaktion wie der
      // Advisory-Lock und das anschließende Status-Update, statt auf einer
      // eigenen Pool-Verbindung zu committen. Sonst könnten Schichten fest
      // angelegt bleiben, obwohl das Status-Update danach scheitert/zurückrollt.
      const result = await runBulkAbsenceCreation(
        {
          userId: request.userId,
          teamId: request.teamId,
          type: request.type,
          days,
        },
        tx,
      );

      const [updated] = await tx
        .update(absenceRequestsTable)
        .set({
          status: "APPROVED",
          resolvedAt: new Date(),
          resolvedByUserId: req.session.userId!,
          resultShiftIds: result.created.map((s) => s.id),
        })
        .where(eq(absenceRequestsTable.id, request.id))
        .returning();

      return { kind: "ok", updated: updated! };
    });
  } catch (err) {
    if (err instanceof VacationOutsideContractError) {
      res.status(400).json({ error: err.message, code: "vacation_outside_contract" });
      return;
    }
    if (err instanceof InvalidShiftModelError || err instanceof InvalidAbsenceDayError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (outcome.kind === "not_found") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "Antrag wurde bereits bearbeitet" });
    return;
  }
  if (outcome.kind === "responded") {
    return;
  }
  res.json(serializeRequest(outcome.updated, null));
});

type RejectOutcome =
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "ok"; updated: typeof absenceRequestsTable.$inferSelect };

// POST /absence-requests/:id/reject — beendet den Antrag ohne Seiteneffekte.
// Nutzt denselben Advisory-Lock-Schlüssel wie approve (siehe dort): ein
// zeitgleicher approve-Aufruf auf DIESELBE Antrags-ID serialisiert sich über
// dieselbe Sperre, sodass reject niemals einen bereits genehmigten (und mit
// Schichten belegten) Antrag stillschweigend überschreibt.
router.post("/absence-requests/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const params = RejectAbsenceRequestParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const outcome = await db.transaction(async (tx): Promise<RejectOutcome> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"absence-request:" + params.data.id}))`,
    );
    const [request] = await tx
      .select()
      .from(absenceRequestsTable)
      .where(eq(absenceRequestsTable.id, params.data.id))
      .limit(1);
    if (!request) {
      return { kind: "not_found" };
    }
    const canManage = await canManageAbsenceRequests(
      req.session.userId!,
      req.session.role!,
      request.teamId,
    );
    if (!canManage) {
      return { kind: "not_found" };
    }
    if (request.status !== "PENDING") {
      return { kind: "conflict" };
    }

    const [updated] = await tx
      .update(absenceRequestsTable)
      .set({
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: req.session.userId!,
      })
      .where(eq(absenceRequestsTable.id, request.id))
      .returning();

    return { kind: "ok", updated: updated! };
  });

  if (outcome.kind === "not_found") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "Antrag wurde bereits bearbeitet" });
    return;
  }
  res.json(serializeRequest(outcome.updated, null));
});

export default router;
