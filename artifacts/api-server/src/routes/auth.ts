import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/auth-utils";

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

export default router;
