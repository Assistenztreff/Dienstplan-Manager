import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  try {
    const hashBuf = Buffer.from(hash, "hex");
    const derived = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuf, derived);
  } catch {
    return false;
  }
}

export function generateInviteToken(userId: number): string {
  const random = randomBytes(24).toString("hex");
  return `${userId}-${random}`;
}
