import { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { usersTable, teamMembersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "admin" | "assistant" | "superadmin";
  }
}

/**
 * Prüft Session-Vorhandensein UND lädt den Nutzer frisch aus der DB, damit
 * eine Deaktivierung (`isActive=false`) SOFORT wirkt statt erst nach Ablauf
 * der bis zu 7 Tage gültigen Session-Cookie. Ohne diesen Reload würde jede
 * bereits bestehende Session nach einer Deaktivierung weiter funktionieren.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Konto deaktiviert oder nicht gefunden" });
    return;
  }
  next();
}

/**
 * "Admin-artig" = Rolle admin ODER superadmin. Der Betreiber (superadmin)
 * nutzt die normale App wie ein Admin (nur eigene Teams/Daten über die
 * regulären Team-Scoping-Helfer); zusätzlich hat er exklusiv die
 * Operator-Endpunkte (requireSuperadmin). Superadmin ist also eine
 * ERWEITERUNG von admin, keine getrennte Welt.
 */
export function isAdminLikeRole(role: string | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  if (!isAdminLikeRole(req.session.role)) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Konto deaktiviert oder nicht gefunden" });
    return;
  }
  next();
}

/**
 * Nur Betreiber (Rolle "superadmin"). Die Rolle wird frisch aus der DB
 * gelesen, damit eine Änderung sofort wirkt (nicht aus der Session) — analog
 * requireDienstleister. Frontend-Guards sind KEINE Autorisierung; jede
 * privilegierte Operator-Aktion MUSS über diese Middleware laufen.
 */
export async function requireSuperadmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  const [user] = await db
    .select({ role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Konto deaktiviert oder nicht gefunden" });
    return;
  }
  if (user.role !== "superadmin") {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  next();
}

/**
 * Erlaubt Zugriff für Admin-artige Rollen ODER für Nutzer, die in mindestens
 * einem Team als Teamleiter eingetragen sind. Der Teamleiter-Status wird frisch
 * aus der DB gelesen, damit ein Rechteentzug sofort beim nächsten Request greift.
 */
export async function requireTeamleiterOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Konto deaktiviert oder nicht gefunden" });
    return;
  }
  if (isAdminLikeRole(req.session.role)) {
    next();
    return;
  }
  // Für Nicht-Admins: prüfen, ob Teamleiter in mindestens einem Team.
  const [tlRow] = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.userId, req.session.userId),
        eq(teamMembersTable.isTeamleiter, true),
      ),
    )
    .limit(1);
  if (tlRow) {
    next();
    return;
  }
  res.status(403).json({ error: "Keine Berechtigung" });
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
  if (!isAdminLikeRole(req.session.role)) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return;
  }
  const [user] = await db
    .select({ accountType: usersTable.accountType, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Konto deaktiviert oder nicht gefunden" });
    return;
  }
  if (user.accountType !== "dienstleister") {
    res.status(403).json({ error: "Nur für Dienstleister-Konten verfügbar" });
    return;
  }
  next();
}
