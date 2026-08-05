// ---------------------------------------------------------------------------
// Operator-Endpunkte (Betreiber-Konsole, NUR Rolle "superadmin")
// ---------------------------------------------------------------------------
// Serverseitige Autorisierung via requireSuperadmin (Rolle frisch aus der DB).
// Der Plan-Flip wirkt sofort, weil getUserPlan (lib/plan.ts) users.plan pro
// Request frisch liest — kein Neustart/Re-Login nötig.
// ---------------------------------------------------------------------------

import { Router } from "express";
import fs from "fs";
import path from "path";
import { db, usersTable, planChangesTable, platformErrorsTable } from "@workspace/db";
import { eq, sql, asc, desc, or, and, gte, lte, ilike } from "drizzle-orm";
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
import { MAX_STORED_ERRORS } from "../lib/platform-errors";
import { getLexwareClient } from "../lib/lexware";

const router = Router();

// Escaped LIKE-Sonderzeichen (\ % _), damit ein Suchbegriff sie als Literale
// und nicht als Wildcards behandelt. Drizzles ilike() bindet den Wert als
// Parameter (kein SQL-Injection-Risiko); das Escaping betrifft nur die
// LIKE-Muster-Semantik.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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
    // Optionaler Suchbegriff: filtert nach Konto (Name/E-Mail) oder Inhalt der
    // Referenz/Notiz. Groß-/Kleinschreibung ignoriert (ILIKE), Wildcards im
    // Begriff werden escaped, damit % und _ als Literale gesucht werden.
    const search = queryResult.data.search?.trim();
    const searchFilter =
      search && search.length > 0
        ? or(
            ilike(usersTable.name, `%${escapeLike(search)}%`),
            ilike(usersTable.email, `%${escapeLike(search)}%`),
            ilike(planChangesTable.note, `%${escapeLike(search)}%`),
          )
        : undefined;

    // Optionaler Zeitraum-Filter (von/bis) über den Zeitstempel — jeweils
    // einschließlich. Kombinierbar mit der Textsuche; and() ignoriert
    // undefined-Bedingungen, sodass fehlende Grenzen einfach entfallen.
    const from = queryResult.data.from?.trim();
    const to = queryResult.data.to?.trim();
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      (fromDate && Number.isNaN(fromDate.getTime())) ||
      (toDate && Number.isNaN(toDate.getTime()))
    ) {
      res.status(400).json({ error: "Ungültiges Datum im Zeitraum-Filter" });
      return;
    }
    const fromFilter = fromDate
      ? gte(planChangesTable.createdAt, fromDate)
      : undefined;
    const toFilter = toDate
      ? lte(planChangesTable.createdAt, toDate)
      : undefined;
    const whereFilter = and(searchFilter, fromFilter, toFilter);

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
      .where(whereFilter)
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
// try/catch-Stellen; Aufbewahrung serverseitig begrenzt. Die Antwort
// liefert zusaetzlich totalStored (Gesamtzahl gespeicherter Eintraege)
// und retentionLimit (MAX_STORED_ERRORS), damit das Dashboard warnen
// kann, wenn aelteste Eintraege wegen des Limits bereits verworfen wurden.
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

    // Optionaler Zeitraum (from/to, ISO-8601): filtert nach dem LETZTEN
    // Auftreten (lastSeenAt) — bewusste Entscheidung, denn die Liste ist
    // ebenfalls nach lastSeenAt sortiert und die Frage des Betreibers ist
    // "welche Fehler traten an Tag X auf?" (gebuendelte Eintraege werden bei
    // Wiederauftreten mit lastSeenAt aktualisiert; firstSeenAt/createdAt
    // wuerde alte Dauerbrenner dem falschen Tag zuordnen).
    const from = queryResult.data.from?.trim();
    const to = queryResult.data.to?.trim();
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      (fromDate && Number.isNaN(fromDate.getTime())) ||
      (toDate && Number.isNaN(toDate.getTime()))
    ) {
      res.status(400).json({ error: "Ungültige Parameter" });
      return;
    }
    const fromFilter = fromDate
      ? gte(platformErrorsTable.lastSeenAt, fromDate)
      : undefined;
    const toFilter = toDate
      ? lte(platformErrorsTable.lastSeenAt, toDate)
      : undefined;

    // Optionaler Suchbegriff: filtert case-insensitiv (ILIKE) über die Meldung
    // (message) und den Kontext/Route (context). Wildcards im Begriff werden
    // escaped, damit % und _ als Literale gesucht werden. Kombinierbar mit
    // dem Zeitraum-Filter (and() ignoriert undefined-Bedingungen).
    const search = queryResult.data.search?.trim();
    const searchFilter =
      search && search.length > 0
        ? or(
            ilike(platformErrorsTable.message, `%${escapeLike(search)}%`),
            ilike(platformErrorsTable.context, `%${escapeLike(search)}%`),
          )
        : undefined;

    const whereFilter = and(fromFilter, toFilter, searchFilter);

    const errors = await db
      .select({
        id: platformErrorsTable.id,
        level: platformErrorsTable.level,
        message: platformErrorsTable.message,
        context: platformErrorsTable.context,
        resolved: platformErrorsTable.resolved,
        count: platformErrorsTable.count,
        lastStack: platformErrorsTable.lastStack,
        lastSeenAt: platformErrorsTable.lastSeenAt,
        createdAt: platformErrorsTable.createdAt,
      })
      .from(platformErrorsTable)
      .where(whereFilter)
      .orderBy(desc(platformErrorsTable.lastSeenAt), desc(platformErrorsTable.id))
      .limit(limit);

    // Gesamtzahl UNABHAENGIG vom limit-Parameter: nur so laesst sich
    // erkennen, ob die Tabelle am Aufbewahrungslimit steht (= aelteste
    // Eintraege wurden beim Beschneiden bereits verworfen).
    const [{ totalStored }] = await db
      .select({ totalStored: sql<number>`count(*)::int` })
      .from(platformErrorsTable);

    res.json({
      errors,
      totalStored,
      retentionLimit: MAX_STORED_ERRORS,
    });
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
        lastStack: platformErrorsTable.lastStack,
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

// GET /operator/lexware/bookings — Buchungs-Log aus Lexware (Rechnungs-
// entwuerfe + Zahlungseingaenge, neueste zuerst). Anbindung ueber das
// austauschbare Adapter-Interface LexwareClient (lib/lexware.ts): ohne
// Secret LEXWARE_API_KEY antwortet der Mock-Adapter mit Beispieldaten
// (source = "demo"); der echte Client kommt nach der Server-Migration und
// liefert dieselbe Form (source = "live") — kein Frontend-/Schema-Umbau.
router.get(
  "/operator/lexware/bookings",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    const client = getLexwareClient();
    const bookings = await client.listBookings();
    res.json({ source: client.source, bookings });
    return;
  },
);

// GET /operator/handbuch-pdf — komplettes Benutzerhandbuch als PDF.
// Bewusst NICHT öffentlich (kein public/-Verzeichnis, keine statische Route):
// nur Superadmins können das PDF über das Operator-Dashboard herunterladen.
// Die Datei wird per Script (scripts/generate-handbuch-pdf.mjs) erzeugt.
router.get(
  "/operator/handbuch-pdf",
  requireSuperadmin,
  (_req, res): void => {
    const pdfPath = path.resolve(process.cwd(), "assets/handbuch.pdf");
    if (!fs.existsSync(pdfPath)) {
      res.status(404).json({
        message:
          "Handbuch-PDF nicht gefunden. Bitte per 'node scripts/generate-handbuch-pdf.mjs' neu erzeugen.",
      });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="handbuch-assistenzplaner.pdf"');
    res.sendFile(pdfPath);
  },
);

export default router;
