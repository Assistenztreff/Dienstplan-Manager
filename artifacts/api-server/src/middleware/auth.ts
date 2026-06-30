import { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "admin" | "assistant" | "superadmin";
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  if (req.session.role !== "admin") {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  next();
}

/**
 * Nur Admins mit Konto-Typ "dienstleister". Der Konto-Typ wird frisch aus der
 * DB gelesen, damit eine Änderung sofort wirkt (nicht aus der Session).
 */
export async function requireDienstleister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  if (req.session.role !== "admin") {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  const [user] = await db
    .select({ accountType: usersTable.accountType })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || user.accountType !== "dienstleister") {
    res.status(403).json({ error: "Nur für Dienstleister-Konten verfügbar" });
    return;
  }
  next();
}
