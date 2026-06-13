import { NextFunction, Request, Response } from "express";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "admin" | "assistant";
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
