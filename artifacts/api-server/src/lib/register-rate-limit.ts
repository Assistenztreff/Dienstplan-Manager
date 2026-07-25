/**
 * Rate-Limiter fuer die OEFFENTLICHE Registrierung (POST /auth/register).
 *
 * Kontext (Task #553): Die E-Mail-Eindeutigkeit ist plattformweit (UNIQUE in
 * der DB) und die Registrierung meldet eine belegte E-Mail bewusst mit 409
 * "E-Mail-Adresse wird bereits verwendet" direkt am Feld (Produkt-UX, Tasks
 * #384/#406). Dieses Existenz-Orakel laesst sich ohne E-Mail-Versand-Flows
 * nicht echt verstecken (Erfolg vs. 409 bleibt beobachtbar) — die Entscheidung
 * ist daher: Verhalten AKZEPTIERT, aber Massen-Enumeration durch anonyme
 * Besucher wird per IP-Rate-Limit gebremst.
 *
 * Eigenschaften:
 * - Sliding Window pro IP (In-Memory; ein API-Prozess, kein Cluster).
 * - Konfigurierbar via ENV: REGISTER_RATE_LIMIT_MAX (Default 20 Versuche),
 *   REGISTER_RATE_LIMIT_WINDOW_MS (Default 10 Minuten).
 *   REGISTER_RATE_LIMIT_MAX=0 schaltet den Limiter ab (E2E-Test-Stack, der
 *   pro Lauf dutzende Konten von 127.0.0.1 registriert).
 * - Zaehlt JEDEN Versuch (auch erfolgreiche) — sonst waere das Anlegen vieler
 *   Konten selbst der Enumerations-Kanal ("frei" = Registrierung klappt).
 * - Uhr injizierbar fuer Unit-Tests.
 */

type Bucket = number[]; // Zeitstempel (ms) der Versuche im Fenster

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

const buckets = new Map<string, Bucket>();

function configuredMax(): number {
  const raw = process.env.REGISTER_RATE_LIMIT_MAX;
  if (raw === undefined || raw === "") return DEFAULT_MAX;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX;
}

function configuredWindowMs(): number {
  const raw = process.env.REGISTER_RATE_LIMIT_WINDOW_MS;
  if (raw === undefined || raw === "") return DEFAULT_WINDOW_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_WINDOW_MS;
}

/**
 * Registriert einen Versuch fuer die IP und meldet, ob er noch erlaubt ist.
 * Gibt bei Ueberschreitung zusaetzlich die Restzeit (Sekunden, aufgerundet)
 * bis zum Freiwerden des aeltesten Slots zurueck.
 */
export function checkRegisterRateLimit(
  ip: string,
  now: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const max = configuredMax();
  if (max === 0) return { allowed: true };
  const windowMs = configuredWindowMs();

  const cutoff = now - windowMs;
  const bucket = (buckets.get(ip) ?? []).filter((t) => t > cutoff);

  if (bucket.length >= max) {
    buckets.set(ip, bucket);
    const oldest = bucket[0]!;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.push(now);
  buckets.set(ip, bucket);

  // Speicher-Hygiene: gelegentlich leere/alte Buckets fremder IPs entsorgen.
  if (buckets.size > 10_000) {
    for (const [key, b] of buckets) {
      if (b.every((t) => t <= cutoff)) buckets.delete(key);
    }
  }

  return { allowed: true };
}

/** Nur fuer Tests: setzt den In-Memory-Zustand zurueck. */
export function resetRegisterRateLimit(): void {
  buckets.clear();
}
