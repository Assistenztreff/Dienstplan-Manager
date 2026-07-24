/**
 * Seiteneffekt-Import: loest die effektive Datenbank-URL auf
 * (APP_DATABASE_URL hat Vorrang vor DATABASE_URL; percent-kodiert unkodierte
 * Sonderzeichen im Passwort; optionaler sslmode-Rewrite via
 * DATABASE_SSL_NO_VERIFY=1) und schreibt sie nach process.env.DATABASE_URL,
 * bevor ein Script pg-Clients erstellt.
 * MUSS in jedem Script importiert werden, das DATABASE_URL direkt nutzt.
 */
import { resolveDatabaseUrl } from "@workspace/db/database-url";

const databaseUrl = resolveDatabaseUrl();
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}
