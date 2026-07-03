import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateInviteToken } from "../lib/auth-utils";
import { requireAdmin } from "../middleware/auth";
import { requirePlanFeature } from "../lib/plan";
import { isUserInAllowedTeams } from "../lib/teams";

const router = Router();

// Premium-Feature "caregiverLogin": Assistenzkräfte erhalten eigenen Zugang.
// Gegated wird NUR das Erzeugen NEUER Einladungslinks (Bestandsschutz:
// bereits eingeladene Assistenten mit gesetztem Passwort können sich weiterhin
// anmelden — bestehende Logins werden nie gesperrt).
router.post("/users/:id/invite", requireAdmin, requirePlanFeature("caregiverLogin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Ungültige ID" });
    return;
  }

  // Team-Zugehörigkeit MUSS vor jeder weiteren Auskunft geprüft werden — sonst
  // ließe sich über die 404/400/200-Antwortcodes erraten, ob eine fremde ID
  // existiert und ob sie ein Assistent ist (Cross-Tenant-Enumeration). Ein
  // Nicht-Mitglied wird daher immer als "nicht gefunden" behandelt.
  const requesterId = req.session.userId as number;
  const isMember = await isUserInAllowedTeams(requesterId, id);
  if (!isMember) {
    res.status(404).json({ error: "Benutzer nicht gefunden" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));

  if (!user) {
    res.status(404).json({ error: "Benutzer nicht gefunden" });
    return;
  }
  if (user.role !== "assistant") {
    res.status(400).json({ error: "Einladungen nur für Assistenten möglich" });
    return;
  }
  if (!user.isActive) {
    res.status(400).json({ error: "Konto ist deaktiviert" });
    return;
  }

  const token = generateInviteToken(user.id);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ inviteToken: token, inviteTokenExpiry: expiresAt })
    .where(eq(usersTable.id, user.id));

  const baseUrl =
    process.env.REPLIT_DOMAINS
      ? `https://${(process.env.REPLIT_DOMAINS as string).split(",")[0]}`
      : "http://localhost";

  const inviteUrl = `${baseUrl}/einladung?token=${token}`;

  res.json({
    userId: user.id,
    userName: user.name,
    inviteUrl,
    token,
    expiresIn: "48 Stunden",
    note: "Dieser Link ist temporär und dient zur ersten Anmeldung des Assistenten.",
  });
});

export default router;
