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
 * Mehrprozess-Faehigkeit (Task #600): Der Zaehler lag zuerst im Arbeitsspeicher
 * EINES API-Prozesses. Das Deployment-Target ist aber Autoscale — es koennen
 * mehrere Instanzen parallel laufen, und jede haette separat gezaehlt (die
 * Bremse wuerde mit der Instanzzahl durchlaessiger). ENTSCHEIDUNG: Der Zaehler
 * wandert in die gemeinsame Postgres-DB (Tabelle register_attempts, eine Zeile
 * pro Versuch). Die Semantik bleibt identisch:
 * - Sliding Window pro IP.
 * - Konfigurierbar via ENV: REGISTER_RATE_LIMIT_MAX (Default 20 Versuche),
 *   REGISTER_RATE_LIMIT_WINDOW_MS (Default 10 Minuten).
 *   REGISTER_RATE_LIMIT_MAX=0 schaltet den Limiter ab (E2E-Test-Stack, der
 *   pro Lauf dutzende Konten von 127.0.0.1 registriert) — dann wird die DB
 *   gar nicht beruehrt.
 * - Zaehlt JEDEN Versuch (auch erfolgreiche) — sonst waere das Anlegen vieler
 *   Konten selbst der Enumerations-Kanal ("frei" = Registrierung klappt).
 * - Uhr injizierbar fuer Tests.
 *
 * Atomaritaet: Zaehlen + Eintragen laeuft in einer Transaktion, die zuerst
 * einen pg_advisory_xact_lock pro IP nimmt. Ein reines
 * INSERT...SELECT...WHERE count < max reicht NICHT: unter READ COMMITTED
 * sehen parallele Transaktionen denselben Vorher-Count und fuegen alle ein
 * (Check-then-act-Luecke auf DB-Ebene). Der Advisory-Lock serialisiert
 * konkurrierende Versuche derselben IP ueber alle Instanzen hinweg;
 * verschiedene IPs blockieren einander nicht. Alte Zeilen ausserhalb des
 * Fensters werden bei jedem Versuch mit geloescht — die Tabelle bleibt winzig,
 * Registrierungen sind kein High-Traffic-Endpunkt.
 *
 * Fehlerverhalten: DB-Fehler propagieren (500). Ohne DB wuerde die
 * Registrierung ohnehin scheitern; ein stilles Fail-Open waere ein Downgrade.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

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
export async function checkRegisterRateLimit(
  ip: string,
  now: number = Date.now(),
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const max = configuredMax();
  if (max === 0) return { allowed: true };
  const windowMs = configuredWindowMs();

  const nowDate = new Date(now);
  const cutoff = new Date(now - windowMs);

  return db.transaction(async (tx) => {
    // Pro-IP-Advisory-Lock (transaktionsgebunden, loest sich bei Commit/
    // Rollback selbst): serialisiert parallele Versuche derselben IP ueber
    // alle Prozesse/Instanzen hinweg. hashtext() ist stabil pro Cluster;
    // der Praefix trennt den Lock-Namensraum von anderen Advisory-Locks.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"register-rate-limit:" + ip}))`,
    );

    // Speicher-Hygiene: abgelaufene Zeilen (aller IPs) entsorgen.
    await tx.execute(sql`DELETE FROM register_attempts WHERE attempted_at <= ${cutoff}`);

    const counted = await tx.execute(sql`
      SELECT count(*)::int AS n, min(attempted_at) AS oldest
      FROM register_attempts
      WHERE ip = ${ip} AND attempted_at > ${cutoff}
    `);
    const row = counted.rows[0] as { n: number; oldest: Date | string | null } | undefined;
    const n = row?.n ?? 0;

    if (n >= max) {
      // Blockiert: Restzeit bis der aelteste Slot im Fenster frei wird.
      const oldestMs = row?.oldest ? new Date(row.oldest).getTime() : now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + windowMs - now) / 1000));
      return { allowed: false as const, retryAfterSeconds };
    }

    await tx.execute(
      sql`INSERT INTO register_attempts (ip, attempted_at) VALUES (${ip}, ${nowDate})`,
    );
    return { allowed: true as const };
  });
}
