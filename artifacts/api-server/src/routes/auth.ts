import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, teamsTable, teamMembersTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { hashPassword, verifyPassword, generateSecureToken } from "../lib/auth-utils";
import { isEmailEnabled, sendPasswordResetEmail, sendVerificationEmail } from "../lib/mailer";
import { logger } from "../lib/logger";
import { seedDefaultShiftModels } from "../lib/default-shift-models";
import { checkRegisterRateLimit } from "../lib/register-rate-limit";
import { getHighestTeamAccessLevel, type TeamAccessLevel } from "../lib/teams";

const router = Router();

function getBaseUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    (process.env.REPLIT_DOMAINS
      ? `https://${(process.env.REPLIT_DOMAINS as string).split(",")[0]}`
      : "http://localhost")
  );
}

const USER_SELECT = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  accountType: usersTable.accountType,
  plan: usersTable.plan,
};

/**
 * Prüft frisch aus der DB, ob der Nutzer in mindestens einem Team als
 * Teamleiter eingetragen ist. Wird allen Auth-Antworten als `isTeamleiter`
 * beigefügt, damit das Frontend den Team-Switcher auch für Teamleiter zeigt.
 */
async function computeIsTeamleiter(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.isTeamleiter, true)))
    .limit(1);
  return !!row;
}

/**
 * Prüft frisch aus der DB, ob der Nutzer in mindestens einem Teamleiter-Team
 * auch can_view_payroll=true hat. Globales Flag für die Auth-Antwort —
 * die feingranulare Team-Prüfung (canViewPayrollInTeam) bleibt serverseitig.
 */
async function computeCanViewPayroll(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.userId, userId),
        eq(teamMembersTable.isTeamleiter, true),
        eq(teamMembersTable.canViewPayroll, true),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Höchste gestufte Team-Freischaltung über alle Mitgliedschaften. Rein für die
 * Sichtbarkeit im Frontend (Menüpunkte) — die Durchsetzung passiert pro Team
 * serverseitig, siehe lib/teams.ts.
 */
async function computeTeamAccessLevel(userId: number): Promise<TeamAccessLevel> {
  return getHighestTeamAccessLevel(userId);
}

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "E-Mail und Passwort erforderlich" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (!user) {
    return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
  }
  if (!user.isActive) {
    return res.status(401).json({ error: "Konto deaktiviert" });
  }
  if (!user.passwordHash) {
    return res.status(401).json({ error: "Kein Passwort gesetzt — bitte Einladungslink nutzen" });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
  }
  if (user.emailVerified === false) {
    return res.status(403).json({
      error: "Bitte bestätige zuerst deine E-Mail-Adresse. Prüfe dein Postfach (inkl. Spam-Ordner).",
      code: "email_not_verified",
    });
  }

  req.session.userId = user.id;
  req.session.role = user.role;

  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType, plan: user.plan });
});

router.post("/auth/register", async (req, res) => {
  // Enumerations-Bremse (Task #553): Die 409-Antwort bei belegter E-Mail ist
  // ein bewusst akzeptiertes Existenz-Orakel (siehe lib/register-rate-limit.ts)
  // — aber anonyme Massen-Abfragen werden pro IP gedrosselt. Zaehlt JEDEN
  // Versuch, laeuft VOR jeder weiteren DB-Arbeit. Der Zaehler liegt in der
  // gemeinsamen DB (Task #600), damit die Bremse auch mit mehreren
  // Autoscale-Instanzen plattformweit greift.
  const rate = await checkRegisterRateLimit(req.ip ?? "unknown");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSeconds));
    return res.status(429).json({
      error: "Zu viele Registrierungsversuche — bitte später erneut versuchen.",
      code: "rate_limited",
    });
  }

  const { name, email, password, accountType } = req.body as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    accountType?: unknown;
  };
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Name, E-Mail und Passwort erforderlich" });
  }
  const trimmedName = name.trim();
  const normalizedEmail = email.toLowerCase().trim();
  if (!trimmedName) {
    return res.status(400).json({ error: "Name darf nicht leer sein" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen lang sein" });
  }
  if (accountType !== "privat" && accountType !== "dienstleister") {
    return res.status(400).json({ error: "Ungültiger Konto-Typ" });
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  if (existing) {
    return res.status(409).json({ error: "E-Mail-Adresse wird bereits verwendet" });
  }

  let user: User;
  try {
    [user] = await db
      .insert(usersTable)
      .values({
        name: trimmedName,
        email: normalizedEmail,
        role: "admin",
        accountType,
        passwordHash: hashPassword(password),
        isActive: true,
      })
      .returning();
  } catch (err) {
    // Sicherheitsnetz gegen Race: UNIQUE-Verletzung (23505) sauber als 409
    // melden statt als unbehandelter 500 (analog POST/PATCH /users).
    const pgCode =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23505") {
      return res.status(409).json({ error: "E-Mail-Adresse wird bereits verwendet" });
    }
    throw err;
  }

  const [team] = await db
    .insert(teamsTable)
    .values({ name: "Standard-Team", ownerId: user.id })
    .returning();
  await db
    .insert(teamMembersTable)
    .values({ teamId: team.id, userId: user.id })
    .onConflictDoNothing();
  // Standard-Dienste für das frisch angelegte Team vorinstallieren.
  await seedDefaultShiftModels(team.id);

  // E-Mail-Verifizierung: Wenn RESEND_API_KEY gesetzt ist, erst nach Bestätigung anmelden.
  if (isEmailEnabled()) {
    const verifyToken = generateSecureToken();
    await db
      .update(usersTable)
      .set({ emailVerificationToken: verifyToken, emailVerified: false })
      .where(eq(usersTable.id, user.id));
    const verifyUrl = `${getBaseUrl()}/email-bestaetigen?token=${verifyToken}`;
    await sendVerificationEmail(user.email, verifyUrl);
    // Noch keine Session — Nutzer muss erst E-Mail bestätigen.
    return res.status(201).json({
      id: user.id, name: user.name, email: user.email,
      role: user.role, accountType: user.accountType, plan: user.plan,
      isTeamleiter: false, emailVerificationSent: true,
    });
  }

  req.session.userId = user.id;
  req.session.role = user.role;

  // Frisch registrierte Nutzer können noch kein Teamleiter sein.
  return res.status(201).json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountType: user.accountType,
    plan: user.plan,
    isTeamleiter: false,
    emailVerificationSent: false,
  });
});

if (process.env.NODE_ENV !== "production") {
  const DEV_ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@dienstplan.local").toLowerCase().trim();
  const DEV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
  const DEV_ADMIN_NAME = process.env.ADMIN_NAME ?? "Administrator";
  const DEV_TEST_PASSWORD = "test1234";

  // Stellt den Standard-Admin (+ initiales Team) idempotent sicher und liefert ihn zurück.
  async function ensureDefaultAdmin(): Promise<User> {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, DEV_ADMIN_EMAIL));
    if (user) return user;

    [user] = await db
      .insert(usersTable)
      .values({
        name: DEV_ADMIN_NAME,
        email: DEV_ADMIN_EMAIL,
        role: "admin",
        passwordHash: hashPassword(DEV_ADMIN_PASSWORD),
        isActive: true,
      })
      .returning();

    const [existingTeam] = await db.select({ id: teamsTable.id }).from(teamsTable).limit(1);
    if (!existingTeam) {
      const [team] = await db
        .insert(teamsTable)
        .values({ name: "Standard-Team", ownerId: user.id })
        .returning();
      await db
        .insert(teamMembersTable)
        .values({ teamId: team.id, userId: user.id })
        .onConflictDoNothing();
      await seedDefaultShiftModels(team.id);
    }
    return user;
  }

  // Legt eine kleine, feste Auswahl an Test-Nutzern idempotent an, damit man im
  // Dev-Modus zwischen Rollen/Mandanten umschalten kann: ein Assistent (Mitglied
  // im Standard-Team) und ein zweiter Admin als eigener Dienstleister-Mandant.
  // Reine Dev-Hilfe — durch den NODE_ENV-Guard in Produktion nicht vorhanden.
  async function ensureDevTestUsers(): Promise<void> {
    const admin = await ensureDefaultAdmin();

    // Standard-Team des Admins ermitteln (für die Assistenten-Mitgliedschaft).
    const [ownTeam] = await db
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .where(eq(teamsTable.ownerId, admin.id))
      .limit(1);

    // Assistent (Mitglied im Standard-Team des Admins).
    const assistantEmail = "assistent@dienstplan.local";
    let [assistant] = await db.select().from(usersTable).where(eq(usersTable.email, assistantEmail));
    if (!assistant) {
      [assistant] = await db
        .insert(usersTable)
        .values({
          name: "Test-Assistent",
          email: assistantEmail,
          role: "assistant",
          accountType: "privat",
          passwordHash: hashPassword(DEV_TEST_PASSWORD),
          isActive: true,
        })
        .returning();
    }
    // Mitgliedschaft NUR als Bootstrap für eine frische DB anlegen (Assistent
    // noch nirgends Mitglied). Sonst würde der automatische Dev-Login die von
    // setup-test-accounts eingerichtete Team-Trennung (Test-Assistent gehört
    // ins Betreiber-Team, NICHT ins Standard-Team) bei jedem Aufruf rückgängig
    // machen.
    const [anyMembership] = await db
      .select({ id: teamMembersTable.id })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.userId, assistant.id))
      .limit(1);
    if (ownTeam && !anyMembership) {
      await db
        .insert(teamMembersTable)
        .values({ teamId: ownTeam.id, userId: assistant.id })
        .onConflictDoNothing();
    }

    // Zweiter Admin als eigener Dienstleister-Mandant (fremdes Team).
    const dienstleisterEmail = "dienstleister@dienstplan.local";
    let [dienstleister] = await db.select().from(usersTable).where(eq(usersTable.email, dienstleisterEmail));
    if (!dienstleister) {
      [dienstleister] = await db
        .insert(usersTable)
        .values({
          name: "Test-Dienstleister",
          email: dienstleisterEmail,
          role: "admin",
          accountType: "dienstleister",
          passwordHash: hashPassword(DEV_TEST_PASSWORD),
          isActive: true,
        })
        .returning();
    }
    const [dienstleisterTeam] = await db
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .where(eq(teamsTable.ownerId, dienstleister.id))
      .limit(1);
    if (!dienstleisterTeam) {
      const [team] = await db
        .insert(teamsTable)
        .values({ name: "Dienstleister-Team", ownerId: dienstleister.id })
        .returning();
      await db
        .insert(teamMembersTable)
        .values({ teamId: team.id, userId: dienstleister.id })
        .onConflictDoNothing();
      await seedDefaultShiftModels(team.id);
    }
  }

  router.post("/auth/dev-login", async (req, res) => {
    const { userId } = (req.body ?? {}) as { userId?: unknown };

    // Optionaler Nutzer-Wechsel: als ein bestimmter (vorhandener) Test-Nutzer agieren.
    if (userId !== undefined && userId !== null) {
      const targetId = typeof userId === "number" ? userId : Number(userId);
      if (!Number.isFinite(targetId) || targetId <= 0) {
        res.status(400).json({ error: "Ungültige Nutzer-ID" });
        return;
      }
      const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
      if (!target) {
        res.status(404).json({ error: "Nutzer nicht gefunden" });
        return;
      }
      req.session.userId = target.id;
      req.session.role = target.role;
      const [isTeamleiterTarget, canViewPayrollTarget, teamAccessLevelTarget] = await Promise.all([
        computeIsTeamleiter(target.id),
        computeCanViewPayroll(target.id),
        computeTeamAccessLevel(target.id),
      ]);
      res.json({
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        accountType: target.accountType,
        plan: target.plan,
        isTeamleiter: isTeamleiterTarget,
        canViewPayroll: canViewPayrollTarget,
        teamAccessLevel: teamAccessLevelTarget,
      });
      return;
    }

    // Default: als Standard-Admin anmelden (bestehendes Verhalten).
    const user = await ensureDefaultAdmin();
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType, plan: user.plan });
  });

  // Liste verfügbarer Test-Nutzer für den Dev-Umschalter. Seedet die Test-Nutzer
  // idempotent, damit immer mind. Assistent + zweiter Mandant zum Wechseln da sind.
  router.get("/auth/dev-users", async (_req, res) => {
    await ensureDevTestUsers();
    const users = await db.select(USER_SELECT).from(usersTable).orderBy(usersTable.id);
    res.json(users);
  });
}

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Abmelden fehlgeschlagen" });
    }
    res.clearCookie("connect.sid");
    return res.json({ ok: true });
  });
});

router.get("/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nicht angemeldet" });
  }
  const [user] = await db
    .select({ ...USER_SELECT, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Benutzer nicht gefunden" });
  }
  const { isActive: _isActive, ...publicUser } = user;
  const [isTeamleiter, canViewPayroll, teamAccessLevel] = await Promise.all([
    computeIsTeamleiter(user.id),
    computeCanViewPayroll(user.id),
    computeTeamAccessLevel(user.id),
  ]);
  return res.json({ ...publicUser, isTeamleiter, canViewPayroll, teamAccessLevel });
});

router.post("/auth/set-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) {
    return res.status(400).json({ error: "Token und Passwort erforderlich" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen lang sein" });
  }

  const parts = token.split("-");
  const userId = parseInt(parts[0], 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: "Ungültiger Token" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    return res.status(400).json({ error: "Ungültiger Token" });
  }
  if (!user.inviteToken || user.inviteToken !== token) {
    return res.status(400).json({ error: "Ungültiger oder bereits verwendeter Token" });
  }
  if (user.inviteTokenExpiry && user.inviteTokenExpiry < new Date()) {
    return res.status(400).json({ error: "Token abgelaufen — bitte neuen Einladungslink anfordern" });
  }
  if (!user.isActive) {
    return res.status(400).json({ error: "Konto ist deaktiviert" });
  }

  const passwordHash = hashPassword(password);
  await db
    .update(usersTable)
    .set({ passwordHash, inviteToken: null, inviteTokenExpiry: null })
    .where(eq(usersTable.id, userId));

  req.session.userId = user.id;
  req.session.role = user.role;

  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType, plan: user.plan });
});

router.post("/auth/change-password", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nicht angemeldet" });
  }

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "Aktuelles und neues Passwort erforderlich" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Neues Passwort muss mindestens 8 Zeichen lang sein" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    return res.status(401).json({ error: "Benutzer nicht gefunden" });
  }
  if (!user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: "Aktuelles Passwort falsch" });
  }

  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(usersTable.id, user.id));

  return res.json({ ok: true });
});

router.post("/auth/update-profile", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nicht angemeldet" });
  }

  const { name, email } = req.body as { name?: unknown; email?: unknown };
  if (typeof name !== "string" || typeof email !== "string") {
    return res.status(400).json({ error: "Name und E-Mail erforderlich" });
  }
  const trimmedName = name.trim();
  const normalizedEmail = email.toLowerCase().trim();
  if (!trimmedName) {
    return res.status(400).json({ error: "Name darf nicht leer sein" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben" });
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  if (existing && existing.id !== req.session.userId) {
    return res.status(409).json({ error: "E-Mail-Adresse wird bereits verwendet" });
  }

  const [updated] = await db
    .update(usersTable)
    .set({ name: trimmedName, email: normalizedEmail })
    .where(eq(usersTable.id, req.session.userId))
    .returning(USER_SELECT);
  if (!updated) {
    return res.status(401).json({ error: "Benutzer nicht gefunden" });
  }

  return res.json(updated);
});

// ---------------------------------------------------------------------------
// Passwort-Reset per E-Mail
// ---------------------------------------------------------------------------

router.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: unknown };
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "E-Mail-Adresse erforderlich" });
  }
  const normalizedEmail = email.toLowerCase().trim();
  // Immer 200 zurückgeben — kein Existenz-Orakel.
  try {
    const [user] = await db
      .select({ id: usersTable.id, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));
    if (user?.isActive) {
      const token = generateSecureToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db
        .update(usersTable)
        .set({ passwordResetToken: token, passwordResetTokenExpiry: expiresAt })
        .where(eq(usersTable.id, user.id));
      const resetUrl = `${getBaseUrl()}/passwort-zuruecksetzen?token=${token}`;
      await sendPasswordResetEmail(normalizedEmail, resetUrl);
    }
  } catch (err) {
    logger.error({ err }, "Fehler beim Passwort-Reset-Versand");
  }
  return res.json({ ok: true });
});

router.post("/auth/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: unknown; password?: unknown };
  if (typeof token !== "string" || typeof password !== "string" || !token || !password) {
    return res.status(400).json({ error: "Token und Passwort erforderlich" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen lang sein" });
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordResetToken, token));
  if (!user) {
    return res.status(400).json({ error: "Ungültiger oder abgelaufener Reset-Link" });
  }
  if (user.passwordResetTokenExpiry && user.passwordResetTokenExpiry < new Date()) {
    return res.status(400).json({ error: "Reset-Link abgelaufen — bitte neuen Link anfordern" });
  }
  if (!user.isActive) {
    return res.status(400).json({ error: "Konto ist deaktiviert" });
  }
  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(password), passwordResetToken: null, passwordResetTokenExpiry: null })
    .where(eq(usersTable.id, user.id));
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// E-Mail-Verifizierung
// ---------------------------------------------------------------------------

router.post("/auth/verify-email", async (req, res) => {
  const { token } = req.body as { token?: unknown };
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "Token erforderlich" });
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailVerificationToken, token));
  if (!user) {
    return res.status(400).json({ error: "Ungültiger oder bereits verwendeter Bestätigungslink" });
  }
  if (!user.isActive) {
    return res.status(400).json({ error: "Konto ist deaktiviert" });
  }
  await db
    .update(usersTable)
    .set({ emailVerified: true, emailVerificationToken: null })
    .where(eq(usersTable.id, user.id));
  // Nutzer nach erfolgreicher Verifizierung direkt anmelden.
  req.session.userId = user.id;
  req.session.role = user.role;
  return res.json({
    id: user.id, name: user.name, email: user.email,
    role: user.role, accountType: user.accountType, plan: user.plan,
  });
});

router.post("/auth/resend-verification", async (req, res) => {
  const { email } = req.body as { email?: unknown };
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "E-Mail-Adresse erforderlich" });
  }
  const normalizedEmail = email.toLowerCase().trim();
  // Immer 200 zurückgeben — kein Existenz-Orakel.
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));
    if (user?.isActive && user.emailVerified === false) {
      const token = generateSecureToken();
      await db
        .update(usersTable)
        .set({ emailVerificationToken: token })
        .where(eq(usersTable.id, user.id));
      const verifyUrl = `${getBaseUrl()}/email-bestaetigen?token=${token}`;
      await sendVerificationEmail(normalizedEmail, verifyUrl);
    }
  } catch (err) {
    logger.error({ err }, "Fehler beim Erneut-Senden der Verifizierungsmail");
  }
  return res.json({ ok: true });
});

export default router;
