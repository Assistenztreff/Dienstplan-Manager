import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, teamsTable, teamMembersTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/auth-utils";
import { seedDefaultShiftModels } from "../lib/default-shift-models";

const router = Router();

const USER_SELECT = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  accountType: usersTable.accountType,
  plan: usersTable.plan,
};

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

  req.session.userId = user.id;
  req.session.role = user.role;

  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType, plan: user.plan });
});

router.post("/auth/register", async (req, res) => {
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

  req.session.userId = user.id;
  req.session.role = user.role;

  return res.status(201).json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountType: user.accountType,
    plan: user.plan,
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
      res.json({
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        accountType: target.accountType,
        plan: target.plan,
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
  return res.json(publicUser);
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

export default router;
