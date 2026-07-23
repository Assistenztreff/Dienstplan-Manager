/**
 * Seiteneffekt-Import: normalisiert process.env.DATABASE_URL (percent-kodiert
 * unkodierte Sonderzeichen im Passwort; optionaler sslmode-Rewrite via
 * DATABASE_SSL_NO_VERIFY=1), bevor ein Script pg-Clients erstellt.
 * MUSS in jedem Script importiert werden, das DATABASE_URL direkt nutzt.
 */
import { normalizeDatabaseUrl } from "@workspace/db/database-url";

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL);
}
