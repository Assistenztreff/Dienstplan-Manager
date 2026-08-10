import { Router } from "express";
import { db } from "@workspace/db";
import { teamsTable, teamMembersTable, usersTable } from "@workspace/db";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import {
  CreateKoordinatorBody,
  SetKoordinatorTeamsBody,
  UpdateKoordinatorBody,
} from "@workspace/api-zod";
import { requireDienstleister } from "../middleware/auth";
import { requirePlanFeature } from "../lib/plan";

/**
 * Teamkoordinatoren (Unternehmens-Teamleiter laut Konzeptpapier
 * docs/features/teamleiter-konzept.md): Verwaltungspersonen eines
 * Dienstleister-Kontos, die einem oder mehreren Teams zugewiesen werden und
 * dort Teamleiter-Rechte haben — aber KEINE Assistenzkräfte sind (kein
 * Vertrag, keine Dienste, keine Auswertung der eigenen Person).
 *
 * Modellierung:
 * - users.role = "koordinator" + users.managedByUserId = Konto-Inhaber.
 *   Die Konto-Verknüpfung ist nötig, weil GET /users mitgliedschafts-gescoped
 *   ist — ein Koordinator ohne Team wäre für den Inhaber sonst unsichtbar.
 * - Team-Zuweisung = team_members-Zeile mit isTeamleiter=true. Damit greift
 *   die GESAMTE bestehende Teamleiter-Maschinerie (Team-Scoping, Schreib-
 *   rechte, Zeiterfassungs-Bestätigung, Zugriffsstufen-Vergabe aus Task
 *   "Teamleiter dürfen Zugriffsrechte vergeben") ohne Sonderpfade.
 *
 * Autorisierung: ausschließlich der Konto-Inhaber (requireDienstleister)
 * verwaltet seine Koordinatoren; fremde Koordinatoren/Teams antworten 404
 * (kein Daten-Orakel).
 */

const router = Router();

type KoordinatorDto = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  hasLogin: boolean;
  teamIds: number[];
  createdAt: Date;
};

/**
 * Lädt die Koordinatoren eines Kontos inkl. der zugewiesenen Teams.
 * teamIds werden bewusst auf Teams DIESES Kontos gefiltert — Mitgliedschaften
 * in fremden Konten kann es zwar nicht geben (Annexions-Schutz beim
 * Hinzufügen), aber der Filter hält die Antwort auch dann korrekt, falls
 * sich das je ändert.
 */
async function loadKoordinatoren(ownerId: number, onlyId?: number): Promise<KoordinatorDto[]> {
  const baseWhere = and(
    eq(usersTable.managedByUserId, ownerId),
    eq(usersTable.role, "koordinator"),
  );
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      isActive: usersTable.isActive,
      passwordHash: usersTable.passwordHash,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(onlyId != null ? and(baseWhere, eq(usersTable.id, onlyId)) : baseWhere)
    .orderBy(asc(usersTable.name));
  if (rows.length === 0) return [];

  const memberships = await db
    .select({ userId: teamMembersTable.userId, teamId: teamMembersTable.teamId })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .where(
      and(
        inArray(
          teamMembersTable.userId,
          rows.map((r) => r.id),
        ),
        eq(teamsTable.ownerId, ownerId),
      ),
    );
  const teamsByUser = new Map<number, number[]>();
  for (const m of memberships) {
    const list = teamsByUser.get(m.userId) ?? [];
    list.push(m.teamId);
    teamsByUser.set(m.userId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    isActive: r.isActive,
    hasLogin: r.passwordHash != null,
    teamIds: teamsByUser.get(r.id) ?? [],
    createdAt: r.createdAt,
  }));
}

/**
 * Autorisierung VOR Inhaltsprüfung: Der Koordinator muss existieren UND
 * diesem Konto gehören — sonst einheitlich 404 (keine Enumeration).
 * Gibt die geprüfte ID zurück oder null, wenn bereits geantwortet wurde.
 */
async function resolveOwnedKoordinatorId(
  rawId: string | string[] | undefined,
  ownerId: number,
  res: import("express").Response,
): Promise<number | null> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Ungültige ID" });
    return null;
  }
  const [target] = await db
    .select({ role: usersTable.role, managedByUserId: usersTable.managedByUserId })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!target || target.role !== "koordinator" || target.managedByUserId !== ownerId) {
    res.status(404).json({ error: "Koordinator nicht gefunden" });
    return null;
  }
  return id;
}

router.get("/koordinatoren", requireDienstleister, async (req, res): Promise<void> => {
  res.json(await loadKoordinatoren(req.session.userId!));
});

/**
 * POST /koordinatoren — legt eine Verwaltungsperson an (Name + E-Mail).
 * Premium-Gate "caregiverLogin": Ein Koordinator ist nur mit eigenem Login
 * nutzbar, und Einladungslinks sind ein Premium-Feature — daher ist bereits
 * das Anlegen premium-gegated statt erst die Einladung (klarere UX).
 */
router.post(
  "/koordinatoren",
  requireDienstleister,
  requirePlanFeature("caregiverLogin"),
  async (req, res): Promise<void> => {
    const body = CreateKoordinatorBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const name = body.data.name.trim();
    const email = body.data.email.trim();

    // E-Mail-Kollision als lesbarer 409 (analog POST /users) statt 500 durch
    // den UNIQUE-Constraint.
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${email})`);
    if (existing) {
      res.status(409).json({
        error: "Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.",
      });
      return;
    }

    let user;
    try {
      [user] = await db
        .insert(usersTable)
        .values({
          name,
          email,
          role: "koordinator",
          managedByUserId: req.session.userId!,
        })
        .returning({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          isActive: usersTable.isActive,
          createdAt: usersTable.createdAt,
        });
    } catch (err) {
      // Sicherheitsnetz gegen Race: UNIQUE-Verletzung (23505) sauber als 409.
      const pgCode =
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
        (err as { code?: string })?.code;
      if (pgCode === "23505") {
        res.status(409).json({
          error: "Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.",
        });
        return;
      }
      throw err;
    }

    res.status(201).json({
      id: user!.id,
      name: user!.name,
      email: user!.email,
      isActive: user!.isActive,
      hasLogin: false,
      teamIds: [],
      createdAt: user!.createdAt,
    });
  },
);

/**
 * PUT /koordinatoren/:id/teams — ersetzt die Team-Zuweisungen deklarativ
 * (Vollabgleich): fehlende Mitgliedschaften werden mit isTeamleiter=true
 * angelegt, nicht mehr gewünschte entfernt. Ein Koordinator ohne Teams ist
 * gültig (sichtbar bleibt er über managedByUserId).
 */
router.put(
  "/koordinatoren/:id/teams",
  requireDienstleister,
  async (req, res): Promise<void> => {
    const ownerId = req.session.userId!;
    const id = await resolveOwnedKoordinatorId(req.params["id"], ownerId, res);
    if (id == null) return;

    const body = SetKoordinatorTeamsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const requested = Array.from(new Set(body.data.teamIds));

    // Alle angefragten Teams müssen dem Konto gehören — fremde oder
    // unbekannte IDs antworten 404, ohne zu verraten, welche existieren.
    if (requested.length > 0) {
      const owned = await db
        .select({ id: teamsTable.id })
        .from(teamsTable)
        .where(and(inArray(teamsTable.id, requested), eq(teamsTable.ownerId, ownerId)));
      if (owned.length !== requested.length) {
        res.status(404).json({ error: "Team nicht gefunden" });
        return;
      }
    }

    // Diff gegen den Bestand (nur Teams dieses Kontos betrachten).
    const current = await db
      .select({ teamId: teamMembersTable.teamId })
      .from(teamMembersTable)
      .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
      .where(and(eq(teamMembersTable.userId, id), eq(teamsTable.ownerId, ownerId)));
    const currentIds = new Set(current.map((c) => c.teamId));
    const toAdd = requested.filter((t) => !currentIds.has(t));
    const toRemove = current.map((c) => c.teamId).filter((t) => !requested.includes(t));

    if (toAdd.length > 0) {
      await db
        .insert(teamMembersTable)
        .values(toAdd.map((teamId) => ({ teamId, userId: id, isTeamleiter: true })));
    }
    // Defensive Normalisierung: Auch BESTEHENDE, weiterhin gewünschte Zeilen
    // müssen isTeamleiter=true tragen. Sollte je eine Koordinator-Zeile ohne
    // das Flag entstehen (Altbestand, manuelle Eingriffe), repariert der
    // Vollabgleich sie hier, statt sie stillschweigend zu behalten.
    const toKeep = requested.filter((t) => currentIds.has(t));
    if (toKeep.length > 0) {
      await db
        .update(teamMembersTable)
        .set({ isTeamleiter: true })
        .where(
          and(
            eq(teamMembersTable.userId, id),
            inArray(teamMembersTable.teamId, toKeep),
            eq(teamMembersTable.isTeamleiter, false),
          ),
        );
    }
    if (toRemove.length > 0) {
      await db
        .delete(teamMembersTable)
        .where(and(eq(teamMembersTable.userId, id), inArray(teamMembersTable.teamId, toRemove)));
    }

    const [dto] = await loadKoordinatoren(ownerId, id);
    res.json(dto);
  },
);

/**
 * PATCH /koordinatoren/:id — Zugang sperren/entsperren (isActive).
 * Eine Sperre wirkt SOFORT: Die Auth-Middleware liest isActive pro Request
 * frisch aus der DB (gleiche Mechanik wie die Deaktivierung von
 * Assistenzkräften) und zerstört die Session beim nächsten Zugriff.
 */
router.patch("/koordinatoren/:id", requireDienstleister, async (req, res): Promise<void> => {
  const ownerId = req.session.userId!;
  const id = await resolveOwnedKoordinatorId(req.params["id"], ownerId, res);
  if (id == null) return;

  const body = UpdateKoordinatorBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  await db.update(usersTable).set({ isActive: body.data.isActive }).where(eq(usersTable.id, id));

  const [dto] = await loadKoordinatoren(ownerId, id);
  res.json(dto);
});

/**
 * DELETE /koordinatoren/:id — entfernt den Koordinator vollständig:
 * Nutzerzeile (inkl. Login/Einladungstoken) und via ON DELETE CASCADE alle
 * team_members-Zuweisungen. Bestehende Sitzungen enden sofort (frischer
 * DB-Read pro Request findet den Nutzer nicht mehr → 401).
 *
 * Sollte der Koordinator wider Erwarten in Append-only-Historien referenziert
 * sein (FK ohne CASCADE), antwortet die Route mit einem lesbaren 409 und
 * verweist auf das Sperren — statt mit einem 500 zu scheitern.
 */
router.delete("/koordinatoren/:id", requireDienstleister, async (req, res): Promise<void> => {
  const ownerId = req.session.userId!;
  const id = await resolveOwnedKoordinatorId(req.params["id"], ownerId, res);
  if (id == null) return;

  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  } catch (err) {
    const pgCode =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23503") {
      res.status(409).json({
        error:
          "Entfernen nicht möglich, weil noch Daten auf diese Person verweisen. Sperre den Zugang stattdessen.",
      });
      return;
    }
    throw err;
  }

  res.status(204).end();
});

export default router;
