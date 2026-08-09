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

  // Zugriff MUSS vor jeder weiteren Auskunft geprüft werden — sonst ließe
  // sich über die 404/400/200-Antwortcodes erraten, ob eine fremde ID
  // existiert und welche Rolle sie hat (Cross-Tenant-Enumeration). Erlaubt:
  // Mitglieder der eigenen Teams (Assistenzkräfte) sowie eigene Koordinatoren
  // (über managedByUserId verknüpft, auch ohne Team-Zuweisung). Alles andere
  // antwortet einheitlich "nicht gefunden".
  const requesterId = req.session.userId as number;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  const isOwnKoordinator =
    user?.role === "koordinator" && user.managedByUserId === requesterId;
  const isMember = isOwnKoordinator ? true : await isUserInAllowedTeams(requesterId, id);

  if (!user || (!isMember && !isOwnKoordinator)) {
    res.status(404).json({ error: "Benutzer nicht gefunden" });
    return;
  }
  if (user.role !== "assistant" && user.role !== "koordinator") {
    res.status(400).json({ error: "Einladungen nur für Assistenzkräfte und Koordinatoren möglich" });
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
    note: "Dieser Link ist temporär und dient zur ersten Anmeldung der Assistenzkraft.",
  });
});

export default router;
