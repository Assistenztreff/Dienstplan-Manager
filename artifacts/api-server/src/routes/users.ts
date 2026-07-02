import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, teamMembersTable, teamsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  ListUsersQueryParams,
  CreateUserBody,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
  GetUserParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  getAllowedTeamIds,
  parseTeamIdParam,
  resolveWriteTeamId,
  isUserInAllowedTeams,
} from "../lib/teams";
import { userWithinLimit, getUserLimit, userHasFeature } from "../lib/plan";

const router = Router();

// Felder der ERWEITERTEN Personalakte (Lohn-/Sozialversicherungsdaten). Das
// Setzen/Ändern dieser Felder ist das Premium-Feature "advancedPersonnelFile";
// die einfache Personalakte (Name, E-Mail, Telefon, Adresse) bleibt für Free
// frei. Bestandsschutz: bereits erfasste Werte bleiben sichtbar (Lesen ist nie
// gesperrt) und unverändert speicherbar — gesperrt wird nur das tatsächliche
// Ändern auf einen neuen Wert.
const ADVANCED_PERSONNEL_FIELDS = [
  "birthDate",
  "socialSecurityNumber",
  "taxId",
  "taxClass",
  "healthInsurance",
  "iban",
] as const;

/** Vergleichsnormalisierung: null/undefined/"" gelten als "kein Wert". */
function normalizePersonnelValue(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

const SAFE_USER_SELECT = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  accountType: usersTable.accountType,
  phone: usersTable.phone,
  address: usersTable.address,
  birthDate: usersTable.birthDate,
  socialSecurityNumber: usersTable.socialSecurityNumber,
  taxId: usersTable.taxId,
  taxClass: usersTable.taxClass,
  healthInsurance: usersTable.healthInsurance,
  iban: usersTable.iban,
  isActive: usersTable.isActive,
  createdAt: usersTable.createdAt,
};

router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  // Strikte Datentrennung: Nutzer werden auf die erlaubten Teams des Anfragers
  // gescoped. Mit teamId = genau dieses (erlaubte) Team; ohne teamId = Vereinigung
  // aller erlaubten Teams (eigene + Mitgliedschaften). Mehrfach-Mitgliedschaften
  // werden dedupliziert.
  const allowedTeams = await getAllowedTeamIds(req.session.userId!);
  const teamId = parseTeamIdParam(req);
  if (teamId != null && !allowedTeams.includes(teamId)) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  // Bewusste Bootstrap-Ausnahme – ausschließlich für privat-Konten: Hat ein
  // privat-Admin (Einzel-Assistenznehmer, kein Mandant) weder ein eigenes Team
  // noch eine Mitgliedschaft UND fragt kein teamId an, fällt die Antwort auf den
  // globalen Pool zurück. Sonst wäre die Liste bei Erst-Einrichtung leer – der
  // Admin könnte sich nicht einmal selbst sehen oder Nutzer anlegen/zuordnen.
  // Der Konto-Typ wird frisch aus der DB gelesen (wie requireDienstleister),
  // damit ein Wechsel sofort greift. WICHTIG: Für dienstleister-Konten gilt IMMER
  // strikte Team-Trennung – sie bekommen niemals den globalen Pool, auch nicht bei
  // null Teams (sie sehen dann eine leere Liste, bis sie ein Team anlegen). Sobald
  // ein privat-Admin ≥1 Team hat, greift ebenfalls wieder strikte Trennung.
  if (teamId == null && allowedTeams.length === 0) {
    const [requester] = await db
      .select({ accountType: usersTable.accountType })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId!));
    if (requester?.accountType === "privat") {
      let rows = await db.select(SAFE_USER_SELECT).from(usersTable);
      if (query.data.role) {
        rows = rows.filter((u) => u.role === query.data.role);
      }
      res.json(rows);
      return;
    }
  }
  const teamScope = teamId != null ? [teamId] : allowedTeams;
  const joined =
    teamScope.length > 0
      ? await db
          .select(SAFE_USER_SELECT)
          .from(usersTable)
          .innerJoin(teamMembersTable, eq(teamMembersTable.userId, usersTable.id))
          .where(inArray(teamMembersTable.teamId, teamScope))
      : [];
  // Mehrfach-Mitgliedschaften (Nutzer in mehreren erlaubten Teams) deduplizieren.
  const byId = new Map<number, (typeof joined)[number]>();
  for (const u of joined) byId.set(u.id, u);
  let rows = Array.from(byId.values());
  if (query.data.role) {
    rows = rows.filter((u) => u.role === query.data.role);
  }
  res.json(rows);
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // teamId steuert nur die Team-Mitgliedschaft, ist keine Spalte auf users.
  const { teamId: requestedTeamId, ...userValues } = body.data;

  // Premium-Gate "advancedPersonnelFile": ein Free-Konto darf beim Anlegen keine
  // Lohn-/SV-Daten (erweiterte Personalakte) setzen.
  const values = userValues as Record<string, unknown>;
  if (
    ADVANCED_PERSONNEL_FIELDS.some((f) => normalizePersonnelValue(values[f]) !== "") &&
    !(await userHasFeature(req.session.userId!, "advancedPersonnelFile"))
  ) {
    res.status(403).json({
      error:
        "Die erweiterte Personalakte (Lohn-/Sozialversicherungsdaten) ist im Premium-Tarif enthalten.",
      code: "plan_feature_required",
      feature: "advancedPersonnelFile",
    });
    return;
  }

  const target = await resolveWriteTeamId(req.session.userId!, requestedTeamId ?? undefined);
  if (!target.ok && target.reason === "forbidden") {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }

  // Free-Limit (maxAssistants) autoritativ durchsetzen: nur das Anlegen eines
  // WEITEREN Assistenten ueber dem Limit sperren (Bestandsschutz — vorhandene
  // Assistenten bleiben sichtbar/editierbar). Nur fuer neue Assistenten relevant
  // (Admins zaehlen nicht gegen das Limit). Gezaehlt werden die distinct
  // Assistenten ueber ALLE Teams des Ziel-Team-Eigentuemers (kontoweites Limit);
  // der Plan des Eigentuemers (nicht des ggf. anderen Anfragers) ist massgeblich.
  if (userValues.role === "assistant" && target.ok) {
    const [team] = await db
      .select({ ownerId: teamsTable.ownerId })
      .from(teamsTable)
      .where(eq(teamsTable.id, target.teamId));
    const ownerId = team?.ownerId ?? req.session.userId!;
    const existingAssistants = await db
      .selectDistinct({ userId: teamMembersTable.userId })
      .from(teamMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
      .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
      .where(and(eq(teamsTable.ownerId, ownerId), eq(usersTable.role, "assistant")));
    if (!(await userWithinLimit(ownerId, "maxAssistants", existingAssistants.length))) {
      const max = await getUserLimit(ownerId, "maxAssistants");
      res.status(403).json({
        error: `Im Free-Tarif sind maximal ${max} Assistenten moeglich. Bitte upgrade auf Premium fuer unbegrenzte Assistenten.`,
        code: "plan_limit_reached",
        limit: "maxAssistants",
      });
      return;
    }
  }

  const [user] = await db
    .insert(usersTable)
    .values(userValues)
    .returning(SAFE_USER_SELECT);
  // Neuen Nutzer dem Ziel-Team zuordnen, damit er in gescopten Listen erscheint.
  // Wenn der Ersteller (noch) kein Team hat (reason "none"), bleibt der Nutzer
  // ohne Mitgliedschaft – er taucht dann erst nach Team-Zuordnung in Listen auf.
  if (target.ok && user) {
    await db
      .insert(teamMembersTable)
      .values({ teamId: target.teamId, userId: user.id })
      .onConflictDoNothing();
  }
  res.status(201).json(user);
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const requestedId = params.data.id;
  if (req.session.role !== "admin" && req.session.userId !== requestedId) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  // IDOR-Schutz: ein Admin darf fremde Nutzer nur lesen, wenn sie Mitglied
  // eines seiner erlaubten Teams sind. Eigener Datensatz immer erlaubt.
  if (req.session.userId !== requestedId) {
    const allowed = await isUserInAllowedTeams(req.session.userId!, requestedId);
    if (!allowed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  const [user] = await db
    .select(SAFE_USER_SELECT)
    .from(usersTable)
    .where(eq(usersTable.id, requestedId));
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse({ id: Number(req.params["id"]) });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  // IDOR-Schutz: fremde Nutzer nur ändern, wenn sie in einem erlaubten Team sind.
  if (req.session.userId !== params.data.id) {
    const allowed = await isUserInAllowedTeams(req.session.userId!, params.data.id);
    if (!allowed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }

  // Premium-Gate "advancedPersonnelFile": ein Free-Konto darf Lohn-/SV-Daten nicht
  // auf einen NEUEN Wert ändern. Bestandsschutz: bereits gespeicherte Werte dürfen
  // unverändert mitgesendet werden (z.B. wenn das Formular alle Felder zurückschickt)
  // — verglichen wird gegen den aktuellen DB-Stand, nur echte Änderungen blocken.
  const updateBody = body.data as Record<string, unknown>;
  const touchedAdvanced = ADVANCED_PERSONNEL_FIELDS.filter((f) => f in updateBody);
  if (touchedAdvanced.length > 0 && !(await userHasFeature(req.session.userId!, "advancedPersonnelFile"))) {
    const [existing] = await db
      .select({
        birthDate: usersTable.birthDate,
        socialSecurityNumber: usersTable.socialSecurityNumber,
        taxId: usersTable.taxId,
        taxClass: usersTable.taxClass,
        healthInsurance: usersTable.healthInsurance,
        iban: usersTable.iban,
      })
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id));
    const existingValues = (existing ?? {}) as Record<string, unknown>;
    const changed = touchedAdvanced.some(
      (f) => normalizePersonnelValue(updateBody[f]) !== normalizePersonnelValue(existingValues[f]),
    );
    if (changed) {
      res.status(403).json({
        error:
          "Die erweiterte Personalakte (Lohn-/Sozialversicherungsdaten) ist im Premium-Tarif enthalten.",
        code: "plan_feature_required",
        feature: "advancedPersonnelFile",
      });
      return;
    }
  }

  // E-Mail-Kollision explizit als 409 mit lesbarer Meldung melden — sonst
  // knallt der UNIQUE-Constraint (23505) als unbehandelter 500 und der Dialog
  // zeigt nur eine generische Fehlermeldung (analog /auth/update-profile).
  if (typeof updateBody["email"] === "string") {
    const requestedEmail = (updateBody["email"] as string).trim();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${requestedEmail})`);
    if (existing && existing.id !== params.data.id) {
      res.status(409).json({
        error: "Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.",
      });
      return;
    }
  }

  let user;
  try {
    [user] = await db
      .update(usersTable)
      .set(body.data)
      .where(eq(usersTable.id, params.data.id))
      .returning(SAFE_USER_SELECT);
  } catch (err) {
    // Sicherheitsnetz gegen Race: UNIQUE-Verletzung (23505) sauber als 409.
    const pgCode = (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23505") {
      res.status(409).json({
        error: "Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.",
      });
      return;
    }
    throw err;
  }
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse({ id: Number(req.params["id"]) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // IDOR-Schutz: fremde Nutzer nur löschen, wenn sie in einem erlaubten Team sind.
  if (req.session.userId !== params.data.id) {
    const allowed = await isUserInAllowedTeams(req.session.userId!, params.data.id);
    if (!allowed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  // Konten, die noch Teams besitzen, dürfen nicht gelöscht werden: die
  // Team-Kaskade würde an team-gebundenen Daten (Schichten, Verträge, ...)
  // scheitern und als unbehandelter 500 enden. Analog zum Team-DELETE → 409.
  const [ownedTeam] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, params.data.id))
    .limit(1);
  if (ownedTeam) {
    res.status(409).json({
      error:
        "Konto kann nicht gelöscht werden, solange es noch Teams besitzt. Bitte zuerst alle Teams des Kontos löschen.",
    });
    return;
  }
  try {
    await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  } catch (err) {
    // Sicherheitsnetz: verbleibende FK-Abhängigkeiten (23503) sauber als 409
    // melden statt als unbehandelter Serverfehler.
    const pgCode = (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23503") {
      res.status(409).json({
        error:
          "Konto kann nicht gelöscht werden, solange noch abhängige Daten bestehen.",
      });
      return;
    }
    throw err;
  }
  res.status(204).send();
});

export default router;
