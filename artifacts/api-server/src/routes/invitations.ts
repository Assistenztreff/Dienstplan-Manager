import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

const router = Router();

function generateInviteToken(userId: number): string {
  const random = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(`${userId}-${random}-${process.env.SESSION_SECRET ?? "dev"}`)
    .digest("hex")
    .slice(0, 24);
  return `${userId}-${hash}`;
}

router.post("/users/:id/invite", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Ungültige ID" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));

  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden" });
  if (user.role !== "assistant") {
    return res.status(400).json({ error: "Einladungen nur für Assistenten möglich" });
  }

  const token = generateInviteToken(user.id);
  const baseUrl =
    process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
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
