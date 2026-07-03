// ---------------------------------------------------------------------------
// Operator-Endpunkte (Betreiber-Konsole, NUR Rolle "superadmin")
// ---------------------------------------------------------------------------
// Serverseitige Autorisierung via requireSuperadmin (Rolle frisch aus der DB).
// Der Plan-Flip wirkt sofort, weil getUserPlan (lib/plan.ts) users.plan pro
// Request frisch liest — kein Neustart/Re-Login nötig.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db, usersTable, planChangesTable, platformErrorsTable } from "@workspace/db";
import { eq, sql, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  UpdateOperatorAccountPlanParams,
  UpdateOperatorAccountPlanBody,
  ListOperatorPlanChangesQueryParams,
  ListOperatorErrorsQueryParams,
  UpdateOperatorErrorParams,
  UpdateOperatorErrorBody,
} from "@workspace/api-zod";
import { requireSuperadmin } from "../middleware/auth";

const router = Router();

// Aggregat-Auswahl für ein Konto: Anzahl besessener Teams + Anzahl
// unterschiedlicher Assistenten in diesen Teams (plattformweit, NICHT
// team-gescoped — genau dafür ist der superadmin-Zugriff da).
const ACCOUNT_SELECT = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  accountType: usersTable.accountType,
  plan: usersTable.plan,
  teams: sql<number>`(
    SELECT count(*)::int FROM teams t WHERE t.owner_id = users.id
  )`,
  assistants: sql<number>`(
    SELECT count(DISTINCT tm.user_id)::int
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    JOIN users u2 ON u2.id = tm.user_id
    WHERE t.owner_id = users.id AND u2.role = 'assistant'
  )`,
  createdAt: usersTable.createdAt,
};

// GET /operator/accounts — alle Admin-Konten mit Aggregaten
router.get(
  "/operator/accounts",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    const accounts = await db
      .select(ACCOUNT_SELECT)
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .orderBy(asc(usersTable.createdAt));
    res.json(accounts);
    return;
  },
);

// PATCH /operator/accounts/:id/plan — manuelle Premium-Freischaltung/Rückstufung
router.patch(
  "/operator/accounts/:id/plan",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const paramsResult = UpdateOperatorAccountPlanParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }
    const bodyResult = UpdateOperatorAccountPlanBody.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: "Ungültiger Plan" });
      return;
    }
    const { id } = paramsResult.data;
    const { plan, note } = bodyResult.data;
    // Leere/Whitespace-Notizen als NULL speichern (kein Pflichtfeld).
    const trimmedNote = note?.trim() ? note.trim() : null;

    // Nur Admin-Konten haben einen Plan; Assistenten/Superadmins sind keine
    // zahlenden Konten.
    const [target] = await db
      .select({ id: usersTable.id, role: usersTable.role, plan: usersTable.plan })
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!target || target.role !== "admin") {
      res.status(404).json({ error: "Konto nicht gefunden" });
      return;
    }

    await db.update(usersTable).set({ plan }).where(eq(usersTable.id, id));

    // Audit-Eintrag: JEDER Plan-Flip wird protokolliert (auch No-Op-Flips,
    // z. B. premium→premium — auch die belegen, dass der Betreiber die
    // Freischaltung zu dem Zeitpunkt ausgeführt hat). Append-only.
    await db.insert(planChangesTable).values({
      accountId: id,
      oldPlan: target.plan,
      newPlan: plan,
      // Optionale Rechnungs-/Zahlungsreferenz (z. B. Lexware-Belegnummer)
      note: trimmedNote,
      changedBy: req.session.userId!,
    });

    const [account] = await db
      .select(ACCOUNT_SELECT)
      .from(usersTable)
      .where(eq(usersTable.id, id));
    req.log.info({ accountId: id, plan }, "Operator hat Plan umgeschaltet");
    res.json(account);
    return;
  },
);

// GET /operator/plan-changes — Audit-Log der Plan-Umschaltungen (neueste
// zuerst). Join auf users zweimal: betroffenes Konto + ausführender
// superadmin.
const changedByUser = alias(usersTable, "changed_by_user");

router.get(
  "/operator/plan-changes",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const queryResult = ListOperatorPlanChangesQueryParams.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: "Ungültige Parameter" });
      return;
    }
    const limit = queryResult.data.limit ?? 50;

    const changes = await db
      .select({
        id: planChangesTable.id,
        accountId: planChangesTable.accountId,
        accountName: usersTable.name,
        accountEmail: usersTable.email,
        oldPlan: planChangesTable.oldPlan,
        newPlan: planChangesTable.newPlan,
        note: planChangesTable.note,
        changedByName: changedByUser.name,
        createdAt: planChangesTable.createdAt,
      })
      .from(planChangesTable)
      .innerJoin(usersTable, eq(planChangesTable.accountId, usersTable.id))
      .innerJoin(changedByUser, eq(planChangesTable.changedBy, changedByUser.id))
      .orderBy(desc(planChangesTable.createdAt), desc(planChangesTable.id))
      .limit(limit);

    res.json(changes);
    return;
  },
);

// GET /operator/errors — Fehler-Tracking der Plattform. Wiederkehrende
// Fehler (gleiche Meldung + Kontext) sind zu EINEM Eintrag gebuendelt
// (count + lastSeenAt, Upsert in lib/platform-errors.ts); sortiert nach
// letztem Auftreten, neueste zuerst. Befuellt vom zentralen
// Express-Error-Handler (app.ts) bzw. per recordPlatformError aus
// try/catch-Stellen; Aufbewahrung serverseitig begrenzt.
router.get(
  "/operator/errors",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const queryResult = ListOperatorErrorsQueryParams.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: "Ungültige Parameter" });
      return;
    }
    const limit = queryResult.data.limit ?? 50;

    const errors = await db
      .select({
        id: platformErrorsTable.id,
        level: platformErrorsTable.level,
        message: platformErrorsTable.message,
        context: platformErrorsTable.context,
        resolved: platformErrorsTable.resolved,
        count: platformErrorsTable.count,
        lastSeenAt: platformErrorsTable.lastSeenAt,
        createdAt: platformErrorsTable.createdAt,
      })
      .from(platformErrorsTable)
      .orderBy(desc(platformErrorsTable.lastSeenAt), desc(platformErrorsTable.id))
      .limit(limit);

    res.json(errors);
    return;
  },
);

// POST /operator/errors/resolve-all — ALLE offenen Fehler-Eintraege in einem
// Schritt abhaken (z. B. nach einem Vorfall mit vielen gleichartigen
// Eintraegen). Erledigte Eintraege bleiben unveraendert; das
// Aufbewahrungslimit (lib/platform-errors.ts) gilt weiterhin.
router.post(
  "/operator/errors/resolve-all",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const updated = await db
      .update(platformErrorsTable)
      .set({ resolved: true })
      .where(eq(platformErrorsTable.resolved, false))
      .returning({ id: platformErrorsTable.id });

    req.log.info(
      { resolvedCount: updated.length },
      "Operator hat alle offenen Fehler abgehakt",
    );
    res.json({ resolvedCount: updated.length });
    return;
  },
);

// PATCH /operator/errors/:id — Fehler-Eintrag als erledigt abhaken bzw.
// wieder auf offen setzen. Wirkt auf die ganze Gruppe (gebuendelte
// Wiederholungen); tritt der Fehler danach erneut auf, setzt der Upsert in
// lib/platform-errors.ts den Eintrag wieder auf offen. Erledigte Eintraege
// bleiben erhalten (Aufbewahrungslimit unveraendert), werden im Dashboard
// aber ausgegraut bzw. per Filter ausgeblendet.
router.patch(
  "/operator/errors/:id",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const paramsResult = UpdateOperatorErrorParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }
    const bodyResult = UpdateOperatorErrorBody.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    const { id } = paramsResult.data;
    const { resolved } = bodyResult.data;

    const [updated] = await db
      .update(platformErrorsTable)
      .set({ resolved })
      .where(eq(platformErrorsTable.id, id))
      .returning({
        id: platformErrorsTable.id,
        level: platformErrorsTable.level,
        message: platformErrorsTable.message,
        context: platformErrorsTable.context,
        resolved: platformErrorsTable.resolved,
        count: platformErrorsTable.count,
        lastSeenAt: platformErrorsTable.lastSeenAt,
        createdAt: platformErrorsTable.createdAt,
      });
    if (!updated) {
      res.status(404).json({ error: "Fehler-Eintrag nicht gefunden" });
      return;
    }

    res.json(updated);
    return;
  },
);

export default router;
