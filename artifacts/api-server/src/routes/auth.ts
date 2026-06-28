import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, teamsTable, teamMembersTable } from "@workspace/db";
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

  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType });
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

  const [user] = await db
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
  });
});

if (process.env.NODE_ENV !== "production") {
  const DEV_ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@dienstplan.local").toLowerCase().trim();
  const DEV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
  const DEV_ADMIN_NAME = process.env.ADMIN_NAME ?? "Administrator";

  router.post("/auth/dev-login", async (req, res) => {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, DEV_ADMIN_EMAIL));

    if (!user) {
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
    }

    req.session.userId = user.id;
    req.session.role = user.role;

    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType });
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
    .select(USER_SELECT)
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Benutzer nicht gefunden" });
  }
  return res.json(user);
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

  const passwordHash = hashPassword(password);
  await db
    .update(usersTable)
    .set({ passwordHash, inviteToken: null, inviteTokenExpiry: null })
    .where(eq(usersTable.id, userId));

  req.session.userId = user.id;
  req.session.role = user.role;

  return res.json({ id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType });
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
