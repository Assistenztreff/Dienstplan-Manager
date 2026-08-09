import { Router } from "express";
import { db } from "@workspace/db";
import {
  teamsTable,
  teamMembersTable,
  usersTable,
  shiftsTable,
  contractsTable,
  shiftModelsTable,
  timeTrackingTable,
} from "@workspace/db";
import { eq, and, asc, sql, count, inArray } from "drizzle-orm";
import type { Response } from "express";
import {
  CreateTeamBody,
  UpdateTeamParams,
  UpdateTeamBody,
  DeleteTeamParams,
  AddTeamMemberBody,
  MoveTeamMemberBody,
} from "@workspace/api-zod";
import {
  requireDienstleister,
  requireAdmin,
  requireTeamReadOrAdmin,
  requireTeamManageOrAdmin,
  requireAuth,
  isAdminLikeRole,
} from "../middleware/auth";
import { userWithinLimit, getUserLimit } from "../lib/plan";
import { seedDefaultShiftModels } from "../lib/default-shift-models";
import {
  hasTeamCapability,
  mayGrantPayrollAccess,
  getTeamIdsWithCapability,
  isTeamleiterOfTeam,
  isKoordinatorUser,
  type TeamCapability,
} from "../lib/teams";
import { UpdateTeamMemberFlagsBody } from "@workspace/api-zod";

const router = Router();

const TEAM_SELECT = {
  id: teamsTable.id,
  name: teamsTable.name,
  ownerId: teamsTable.ownerId,
  createdAt: teamsTable.createdAt,
};

/**
 * Prüft, ob das Team dem Aufrufer gehört. Antwortet bei Misserfolg mit 404 und
 * gibt false zurück; bei Erfolg true. So verhindern wir IDOR auf fremde Teams.
 */
async function assertTeamOwnership(
  teamId: number,
  ownerId: number,
  res: Response,
): Promise<boolean> {
  const [team] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(and(eq(teamsTable.id, teamId), eq(teamsTable.ownerId, ownerId)));
  if (!team) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

/**
 * Prüft für Team-Mitglieder-Operationen, ob der Aufrufer entweder der
 * Eigentümer des Teams ODER im Team ausreichend freigeschaltet ist. Gibt bei
 * Erfolg die ownerId des Teams zurück (benötigt für selectMembers), sonst null.
 *
 * `capability` muss zur jeweiligen Route passen: Lesen der Mitgliederliste
 * genügt "read" (Basis-Freischaltung sieht das Team ohnehin), Hinzufügen und
 * Entfernen verlangen "manage". Ohne diesen Parameter fiel die Liste für
 * Basis-/Stufe-1-Mitglieder trotz erlaubter Route auf 404 zurück.
 */
async function assertTeamAdminAccess(
  teamId: number,
  userId: number,
  role: string,
  res: Response,
  capability: TeamCapability = "manage",
): Promise<number | null> {
  const [teamRow] = await db
    .select({ ownerId: teamsTable.ownerId })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  if (!teamRow) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (isAdminLikeRole(role)) {
    // Admin muss Eigentümer sein.
    if (teamRow.ownerId !== userId) {
      res.status(404).json({ error: "Not found" });
      return null;
    }
  } else {
    // Nicht-Admin: braucht die geforderte Freischaltung für genau dieses Team.
    if (!(await hasTeamCapability(userId, teamId, capability))) {
      res.status(404).json({ error: "Not found" });
      return null;
    }
  }
  return teamRow.ownerId;
}

/**
 * Liefert Mitglieder als TeamMember-DTOs inkl. teamCount (Anzahl Teams DIESES
 * Dienstleisters, in denen der Nutzer Mitglied ist), damit Mehrfachzuweisung im
 * Frontend erkennbar ist. `where` filtert die einbezogenen Mitgliedschaften.
 */
function selectMembers(
  ownerId: number,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
) {
  const teamCount = sql<number>`(
    SELECT count(*)::int FROM team_members tm2
    JOIN teams t2 ON t2.id = tm2.team_id
    WHERE tm2.user_id = ${usersTable.id} AND t2.owner_id = ${ownerId}
  )`;
  return db
    .select({
      id: teamMembersTable.id,
      teamId: teamMembersTable.teamId,
      userId: teamMembersTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      teamCount,
      isTeamleiter: teamMembersTable.isTeamleiter,
      canViewPayroll: teamMembersTable.canViewPayroll,
      accessLevel: teamMembersTable.accessLevel,
      createdAt: teamMembersTable.createdAt,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
    .where(where)
    .orderBy(asc(usersTable.name));
}

/**
 * GET /teams — Admins sehen eigene Teams, Teamleiter sehen ihre zugewiesenen Teams.
 */
router.get("/teams", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const role = req.session.role!;

  if (isAdminLikeRole(role)) {
    // Admins: nur eigene Teams
    const rows = await db
      .select(TEAM_SELECT)
      .from(teamsTable)
      .where(eq(teamsTable.ownerId, userId))
      .orderBy(asc(teamsTable.id));
    res.json(rows);
  } else {
    // Nicht-Admins: Teams, für die sie freigeschaltet sind — als Teamleiter
    // oder über eine gestufte Freischaltung ab Basis.
    const allowed = await getTeamIdsWithCapability(userId, "read");
    if (allowed.length === 0) {
      res.json([]);
      return;
    }
    const rows = await db
      .select(TEAM_SELECT)
      .from(teamsTable)
      .where(inArray(teamsTable.id, allowed))
      .orderBy(asc(teamsTable.id));
    res.json(rows);
  }
});

router.post("/teams", requireDienstleister, async (req, res): Promise<void> => {
  const body = CreateTeamBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Free-Limit (maxTeams) autoritativ durchsetzen: nur das Anlegen eines
  // WEITEREN Teams ueber dem Limit sperren (Bestandsschutz — vorhandene Teams
  // bleiben unberuehrt). Gezaehlt werden die Teams im Besitz des Nutzers; die
  // Registrierung legt bereits ein Standard-Team an, daher startet ein Free-
  // Dienstleister bei 1 und kann ohne Premium kein zweites Team eroeffnen.
  const ownerId = req.session.userId!;
  const [{ value: ownedTeams }] = await db
    .select({ value: count() })
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, ownerId));
  if (!(await userWithinLimit(ownerId, "maxTeams", ownedTeams))) {
    const max = await getUserLimit(ownerId, "maxTeams");
    res.status(403).json({
      error: `Im Free-Tarif ist maximal ${max} Team moeglich. Bitte upgrade auf Premium fuer mehrere Teams.`,
      code: "plan_limit_reached",
      limit: "maxTeams",
    });
    return;
  }

  const [team] = await db
    .insert(teamsTable)
    .values({ name: body.data.name, ownerId })
    .returning(TEAM_SELECT);

  // Neue Teams starten mit den 5 Standard-Diensten (wie bei der Registrierung),
  // damit der Schicht-Dialog nicht mit leerer Dienste-Liste beginnt. Das
  // Free-Limit maxShiftModels zählt pro Team und greift unverändert erst beim
  // Anlegen WEITERER Modelle.
  await seedDefaultShiftModels(team!.id);

  res.status(201).json(team);
});

router.patch("/teams/:id", requireDienstleister, async (req, res): Promise<void> => {
  const params = UpdateTeamParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateTeamBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [team] = await db
    .update(teamsTable)
    .set({ name: body.data.name })
    .where(and(eq(teamsTable.id, params.data.id), eq(teamsTable.ownerId, req.session.userId!)))
    .returning(TEAM_SELECT);
  if (!team) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(team);
});

router.delete("/teams/:id", requireDienstleister, async (req, res): Promise<void> => {
  const params = DeleteTeamParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [team] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(and(eq(teamsTable.id, params.data.id), eq(teamsTable.ownerId, req.session.userId!)));
  if (!team) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Löschen blockieren, solange noch Daten oder Mitglieder am Team hängen, damit
  // keine Dienstpläne/Verträge verwaist zurückbleiben (FK ohne Cascade).
  const teamId = params.data.id;
  for (const table of [shiftsTable, contractsTable, shiftModelsTable, timeTrackingTable, teamMembersTable]) {
    const [used] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.teamId, teamId))
      .limit(1);
    if (used) {
      res.status(409).json({
        error: "Team kann nicht gelöscht werden, solange noch Daten oder Mitglieder zugeordnet sind.",
      });
      return;
    }
  }

  await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
  res.status(204).send();
});

/**
 * GET /teams/:id/members — Admins und Teamleiter können Mitglieder ihres Teams sehen.
 */
router.get("/teams/:id/members", requireTeamReadOrAdmin, async (req, res): Promise<void> => {
  const teamId = Number(req.params["id"]);
  if (!Number.isInteger(teamId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = req.session.userId!;
  const role = req.session.role!;
  const ownerId = await assertTeamAdminAccess(teamId, userId, role, res, "read");
  if (ownerId === null) return;

  const rows = await selectMembers(ownerId, eq(teamMembersTable.teamId, teamId));
  res.json(rows);
});

/**
 * POST /teams/:id/members — Admins und Teamleiter können Mitglieder hinzufügen.
 */
router.post("/teams/:id/members", requireTeamManageOrAdmin, async (req, res): Promise<void> => {
  const teamId = Number(req.params["id"]);
  const body = AddTeamMemberBody.safeParse(req.body);
  if (!Number.isInteger(teamId) || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const userId = req.session.userId!;
  const role = req.session.role!;
  const ownerId = await assertTeamAdminAccess(teamId, userId, role, res);
  if (ownerId === null) return;

  // Nur Nutzer annehmen, die bereits Mitglied EINES Teams DIESES Eigentümers
  // sind (Mehrfachzuweisung innerhalb des eigenen Kontos). Ohne diese Prüfung
  // ließe sich jeder existierende Nutzer-ID auf der Plattform (auch aus
  // fremden Mandanten) per Enumeration in das eigene Team annektieren und
  // dessen Daten über die Team-Scoping-Helfer auslesen/ändern.
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .innerJoin(teamMembersTable, eq(teamMembersTable.userId, usersTable.id))
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .where(and(eq(usersTable.id, body.data.userId), eq(teamsTable.ownerId, ownerId)));
  if (!user) {
    res.status(404).json({ error: "Benutzer nicht gefunden" });
    return;
  }
  // Koordinator-Mitgliedschaften laufen ausschließlich über den Zuweisungs-
  // bereich (PUT /koordinatoren/:id/teams) — hier entstünde sonst eine Zeile
  // ohne isTeamleiter, die der deklarative Vollabgleich nicht repariert.
  if (user.role === "koordinator") {
    res.status(403).json({
      error: "Teamkoordinatoren werden über den Bereich Teamkoordinatoren zugewiesen.",
    });
    return;
  }

  const [existing] = await db
    .select({ id: teamMembersTable.id })
    .from(teamMembersTable)
    .where(
      and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, body.data.userId)),
    );
  if (existing) {
    res.status(409).json({ error: "Benutzer ist bereits Mitglied dieses Teams." });
    return;
  }

  const [inserted] = await db
    .insert(teamMembersTable)
    .values({ teamId, userId: body.data.userId })
    .returning({ id: teamMembersTable.id });

  const [member] = await selectMembers(ownerId, eq(teamMembersTable.id, inserted!.id));
  res.status(201).json(member);
});

/**
 * PATCH /teams/:id/members/:userId — Setzt isTeamleiter, accessLevel und/oder
 * canViewPayroll für ein Mitglied.
 *
 * Grenzen (serverseitig durchgesetzt, nicht nur im UI):
 * - Konto-Inhaber dürfen alle drei Felder für ihre Teams setzen.
 * - Teamleiter des betroffenen Teams dürfen NUR accessLevel setzen — weder
 *   Teamleiter- noch Lohndaten-Flags, und nie die Rechte des Konto-Inhabers.
 *   Fremde Teams antworten 404 (kein Daten-Orakel).
 * - canViewPayroll bleibt Unternehmens-Teamleitern eines Dienstleister-Kontos
 *   vorbehalten. Jeder andere Versuch wird mit 403 abgelehnt — Assistenzkräfte
 *   und gestufte Rollen bekommen nie Lohndaten.
 * - Wird der Teamleiter-Status entzogen, fällt canViewPayroll automatisch mit.
 *
 * Bewusst NICHT requireTeamManageOrAdmin: Stufe 2 erlaubt Team-Verwaltung,
 * aber KEINE Rechtevergabe — die bleibt Inhabern und Teamleitern vorbehalten.
 */
router.patch(
  "/teams/:id/members/:userId",
  requireAuth,
  async (req, res): Promise<void> => {
    const teamId = Number(req.params["id"]);
    const targetUserId = Number(req.params["userId"]);
    if (!Number.isInteger(teamId) || !Number.isInteger(targetUserId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const callerId = req.session.userId!;

    // Autorisierung VOR Inhaltsprüfung: Konto-Inhaber ODER Teamleiter genau
    // dieses Teams. Alles andere (fremdes/unbekanntes Team, Stufe 2 ohne
    // Teamleiter-Status) antwortet einheitlich 404.
    const [teamRow] = await db
      .select({ ownerId: teamsTable.ownerId })
      .from(teamsTable)
      .where(eq(teamsTable.id, teamId));
    if (!teamRow) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    let isOwner = false;
    if (isAdminLikeRole(req.session.role)) {
      if (teamRow.ownerId !== callerId) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      isOwner = true;
    } else if (!(await isTeamleiterOfTeam(callerId, teamId))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ownerId = teamRow.ownerId;

    const body = UpdateTeamMemberFlagsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const updates = { ...body.data };

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Keine Felder zum Aktualisieren angegeben" });
      return;
    }

    // Teamleiter vergeben nur die Zugriffsstufe. Teamleiter-/Lohndaten-Flags
    // und die Rechte des Konto-Inhabers bleiben dem Inhaber vorbehalten.
    if (!isOwner) {
      if (updates.isTeamleiter !== undefined || updates.canViewPayroll !== undefined) {
        res.status(403).json({
          error: "Teamleiter- und Lohndaten-Freigaben kann nur der Konto-Inhaber ändern.",
        });
        return;
      }
      if (targetUserId === ownerId) {
        res.status(403).json({
          error: "Die Rechte des Konto-Inhabers kannst du nicht ändern.",
        });
        return;
      }
    }

    // Mitgliedschaft muss existieren.
    const [existing] = await db
      .select({
        id: teamMembersTable.id,
        isTeamleiter: teamMembersTable.isTeamleiter,
      })
      .from(teamMembersTable)
      .where(
        and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUserId)),
      );
    if (!existing) {
      res.status(404).json({ error: "Mitgliedschaft nicht gefunden" });
      return;
    }

    // Koordinator-Zeilen sind über den Zuweisungsbereich verwaltet: weder
    // Stufen noch Flags dürfen hier geändert werden — isTeamleiter=false
    // würde die Zuweisung unbemerkt entwerten (der Vollabgleich stellte sie
    // nicht wieder her), Stufen sind für Koordinatoren bedeutungslos.
    const [targetUser] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));
    if (targetUser?.role === "koordinator") {
      res.status(403).json({
        error: "Die Rechte von Teamkoordinatoren werden über den Bereich Teamkoordinatoren verwaltet.",
      });
      return;
    }

    // Lohndaten-Sperre: canViewPayroll nur für Unternehmens-Teamleiter eines
    // Dienstleister-Kontos. Der Teamleiter-Status kann im selben Request
    // gesetzt werden, deshalb wird der Zielzustand geprüft.
    const nextIsTeamleiter = updates.isTeamleiter ?? existing.isTeamleiter;
    if (updates.canViewPayroll === true) {
      if (!(await mayGrantPayrollAccess(teamId, targetUserId, nextIsTeamleiter))) {
        res.status(403).json({
          error:
            "Lohndaten kannst du nur für Teamleiter in einem Dienstleister-Konto freigeben. Setze die Person zuerst als Teamleiter ein.",
        });
        return;
      }
    }
    // Teamleiter-Status entzogen? Dann fällt der Lohndaten-Zugriff sofort mit,
    // damit keine verwaiste Freigabe zurückbleibt.
    if (updates.isTeamleiter === false) {
      updates.canViewPayroll = false;
    }

    // Flags aktualisieren.
    const [updated] = await db
      .update(teamMembersTable)
      .set(updates)
      .where(
        and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUserId)),
      )
      .returning({ id: teamMembersTable.id });

    const [member] = await selectMembers(ownerId, eq(teamMembersTable.id, updated!.id));
    res.json(member);
  },
);

/**
 * DELETE /teams/:id/members/:userId — Admins und Teamleiter können Mitglieder entfernen.
 */
router.delete(
  "/teams/:id/members/:userId",
  requireTeamManageOrAdmin,
  async (req, res): Promise<void> => {
    const teamId = Number(req.params["id"]);
    const targetUserId = Number(req.params["userId"]);
    if (!Number.isInteger(teamId) || !Number.isInteger(targetUserId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const userId = req.session.userId!;
    const role = req.session.role!;
    const ownerId = await assertTeamAdminAccess(teamId, userId, role, res);
    if (ownerId === null) return;

    // ERST die Mitgliedschaft im eigenen Team prüfen (404 wie bisher), DANN
    // die Rolle: Ein Rollen-Check vor der Mitgliedschaft wäre ein Cross-
    // Tenant-Orakel (403 für fremde Koordinatoren vs. 404 für alle anderen).
    const [membership] = await db
      .select({ id: teamMembersTable.id, role: usersTable.role })
      .from(teamMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUserId)))
      .limit(1);
    if (!membership) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Koordinator-Mitgliedschaften entfernt nur der Zuweisungsbereich
    // (PUT /koordinatoren/:id/teams) — sonst liefe die Koordinator-Anzeige
    // („zugewiesene Teams") auseinander bzw. Teamleiter könnten Koordinatoren
    // aus dem Team werfen.
    if (membership.role === "koordinator") {
      res.status(403).json({
        error: "Teamkoordinatoren werden über den Bereich Teamkoordinatoren verwaltet.",
      });
      return;
    }

    const deleted = await db
      .delete(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUserId)))
      .returning({ id: teamMembersTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  },
);

/**
 * Überführt eine Mitgliedschaft atomar vom Quell- ins Ziel-Team (Task #462):
 * Entfernen + Anlegen laufen in EINER Transaktion, damit die Person nie
 * "zwischen den Teams" ohne Mitgliedschaft hängt (und damit aus allen
 * team-gescopten Listen verschwindet), falls ein Teilschritt fehlschlägt.
 * Beide Teams müssen dem Aufrufer gehören (IDOR → 404 wie überall).
 * Überführen bleibt dem Konto-Admin vorbehalten (nicht Teamleiter), da es
 * teamübergreifende Daten-Umhängung beinhaltet.
 */
router.post(
  "/teams/:id/members/:userId/move",
  requireDienstleister,
  async (req, res): Promise<void> => {
    const teamId = Number(req.params["id"]);
    const userId = Number(req.params["userId"]);
    const body = MoveTeamMemberBody.safeParse(req.body);
    if (!Number.isInteger(teamId) || !Number.isInteger(userId) || !body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const targetTeamId = body.data.targetTeamId;
    const ownerId = req.session.userId!;

    // Quell- UND Ziel-Team müssen dem Aufrufer gehören (fremde Teams → 404,
    // keine Existenz-Preisgabe). assertTeamOwnership antwortet selbst.
    if (!(await assertTeamOwnership(teamId, ownerId, res))) return;
    if (!(await assertTeamOwnership(targetTeamId, ownerId, res))) return;

    if (targetTeamId === teamId) {
      res.status(409).json({ error: "Benutzer ist bereits Mitglied dieses Teams." });
      return;
    }

    const [membership] = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
    if (!membership) {
      res.status(404).json({ error: "Mitgliedschaft nicht gefunden" });
      return;
    }

    // Koordinatoren werden nicht überführt: Das Umhängen würde die Zuweisung
    // ohne isTeamleiter neu anlegen (stiller Rechteverlust) und Personal-
    // Daten-Migration ist für Verwaltungspersonen gegenstandslos. Zuweisungen
    // ändert nur der Bereich Teamkoordinatoren.
    if (await isKoordinatorUser(userId)) {
      res.status(403).json({
        error: "Teamkoordinatoren werden über den Bereich Teamkoordinatoren zugewiesen.",
      });
      return;
    }

    const [already] = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(
        and(eq(teamMembersTable.teamId, targetTeamId), eq(teamMembersTable.userId, userId)),
      );
    if (already) {
      res.status(409).json({ error: "Benutzer ist bereits Mitglied des Ziel-Teams." });
      return;
    }

    // Race-Absicherung: Bei parallelen Moves kann der Insert trotz Vorabprüfung
    // am UNIQUE-Constraint scheitern — das wird unten auf 409 gemappt statt 500.
    // Atomar: alte Mitgliedschaft löschen + neue anlegen + die PERSÖNLICHEN
    // Daten der Person (Verträge, Schichten inkl. Abwesenheiten, Ist-Zeiten)
    // aus dem Quell-Team ins Ziel-Team umhängen — alles in EINER Transaktion.
    // Team-Einstellungen (Schichtmodelle, Zuschlags-Sätze) bleiben unberührt.
    // Schichten verlieren dabei ihre shift_model_id, weil das Modell zum
    // Quell-Team gehört; die gewerteten Stunden (valuedHours/night/sunday/
    // holiday) sind bereits auf der Schicht gespeichert und bleiben korrekt.
    let insertedId: number;
    try {
      insertedId = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(teamMembersTable)
        .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)))
        .returning({ id: teamMembersTable.id });
      if (deleted.length === 0) {
        // Rennen mit parallelem Entfernen — Transaktion abbrechen.
        tx.rollback();
      }
      const [inserted] = await tx
        .insert(teamMembersTable)
        .values({ teamId: targetTeamId, userId })
        .returning({ id: teamMembersTable.id });

      await tx
        .update(contractsTable)
        .set({ teamId: targetTeamId })
        .where(and(eq(contractsTable.teamId, teamId), eq(contractsTable.userId, userId)));
      await tx
        .update(shiftsTable)
        .set({ teamId: targetTeamId, shiftModelId: null })
        .where(and(eq(shiftsTable.teamId, teamId), eq(shiftsTable.userId, userId)));
      // Aushilfe-Einsätze der Person auf das ZIEL-Team werden sinnlos, sobald
      // die Schicht selbst im Ziel-Team liegt (einsatzTeamId === teamId wäre
      // ungültig) — daher normalisieren: Einsatz auf das Ziel-Team nullen.
      await tx
        .update(shiftsTable)
        .set({ einsatzTeamId: null })
        .where(
          and(eq(shiftsTable.userId, userId), eq(shiftsTable.einsatzTeamId, targetTeamId)),
        );
      await tx
        .update(timeTrackingTable)
        .set({ teamId: targetTeamId })
        .where(and(eq(timeTrackingTable.teamId, teamId), eq(timeTrackingTable.userId, userId)));

      return inserted!.id;
      });
    } catch (err) {
      // 23505 = unique_violation: paralleler Move hat die Ziel-Mitgliedschaft
      // bereits angelegt — kontrolliert als Konflikt melden statt 500.
      const pgCode =
        (err as { code?: string } | null)?.code ??
        ((err as { cause?: { code?: string } } | null)?.cause?.code);
      if (pgCode === "23505") {
        res.status(409).json({ error: "Benutzer ist bereits Mitglied des Ziel-Teams." });
        return;
      }
      throw err;
    }

    const [member] = await selectMembers(ownerId, eq(teamMembersTable.id, insertedId));
    res.json(member);
  },
);

export default router;
