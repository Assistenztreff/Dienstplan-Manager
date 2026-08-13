/**
 * Rate-Limiter fuer die OEFFENTLICHEN E-Mail-Versand-Endpunkte:
 *   POST /auth/forgot-password
 *   POST /auth/resend-verification
 *
 * Kontext: Ohne Rate-Limit kann jemand beliebig viele Reset-Mails an eine
 * beliebige E-Mail-Adresse senden — das verbraucht Resend-Kontingent und
 * wirkt als Spam-Werkzeug. Analog zum Registrierungs-Rate-Limit (Task #600)
 * wird der Zaehler in der gemeinsamen Postgres-DB gehalten, damit er unter
 * Autoscale (mehrere API-Instanzen) korrekt aggregiert wird.
 *
 * Semantik:
 * - Sliding Window pro IP.
 * - Konfigurierbar via ENV:
 *     EMAIL_RATE_LIMIT_MAX         (Default: 5 Versuche)
 *     EMAIL_RATE_LIMIT_WINDOW_MS   (Default: 60 Minuten)
 *   EMAIL_RATE_LIMIT_MAX=0 schaltet den Limiter ab (E2E-Test-Stack).
 * - Zaehlt jeden Versuch, unabhaengig davon ob die E-Mail-Adresse existiert
 *   (sonst waere Enumeration ueber den Timing-Kanal moeglich).
 * - Advisory-Lock pro IP (wie bei register-rate-limit) verhindert
 *   Check-then-act-Luecken unter parallelen Anfragen.
 * - Alte Zeilen ausserhalb des Fensters werden beim Versuch mitgeloescht.
 * - DB-Fehler propagieren (500) — Fail-Open waere ein Sicherheits-Downgrade.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const DEFAULT_MAX = 5;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 Stunde

function configuredMax(): number {
  const raw = process.env.EMAIL_RATE_LIMIT_MAX;
  if (raw === undefined || raw === "") return DEFAULT_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX;
}

function configuredWindowMs(): number {
  const raw = process.env.EMAIL_RATE_LIMIT_WINDOW_MS;
  if (raw === undefined || raw === "") return DEFAULT_WINDOW_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_WINDOW_MS;
}

/**
 * Registriert einen Versuch fuer die IP und meldet, ob er noch erlaubt ist.
 * Gibt bei Ueberschreitung zusaetzlich die Restzeit (Sekunden, aufgerundet)
 * bis zum Freiwerden des aeltesten Slots zurueck.
 */
export async function checkEmailRateLimit(
  ip: string,
  now: number = Date.now(),
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const max = configuredMax();
  if (max === 0) return { allowed: true };
  const windowMs = configuredWindowMs();

  const nowDate = new Date(now);
  const cutoff = new Date(now - windowMs);

  return db.transaction(async (tx) => {
    // Pro-IP-Advisory-Lock (transaktionsgebunden): serialisiert parallele
    // Versuche derselben IP ueber alle Prozesse/Instanzen hinweg.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"email-rate-limit:" + ip}))`,
    );

    // Speicher-Hygiene: abgelaufene Zeilen (aller IPs) entsorgen.
    await tx.execute(
      sql`DELETE FROM email_rate_limit_attempts WHERE attempted_at <= ${cutoff}`,
    );

    const counted = await tx.execute(sql`
      SELECT count(*)::int AS n, min(attempted_at) AS oldest
      FROM email_rate_limit_attempts
      WHERE ip = ${ip} AND attempted_at > ${cutoff}
    `);
    const row = counted.rows[0] as { n: number; oldest: Date | string | null } | undefined;
    const n = row?.n ?? 0;

    if (n >= max) {
      const oldestMs = row?.oldest ? new Date(row.oldest).getTime() : now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + windowMs - now) / 1000));
      return { allowed: false as const, retryAfterSeconds };
    }

    await tx.execute(
      sql`INSERT INTO email_rate_limit_attempts (ip, attempted_at) VALUES (${ip}, ${nowDate})`,
    );
    return { allowed: true as const };
  });
}
