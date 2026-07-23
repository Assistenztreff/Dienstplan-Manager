/**
 * Leitet aus der Dev-`DATABASE_URL` die URL der isolierten Test-Datenbank
 * (`<dbname>_test`) ab. Geteilt zwischen `setup-test-db` (Provisionierung)
 * und `verify-test-db-cleanup` (Selbstheilungs-Check).
 */
import { normalizeDatabaseUrl } from "@workspace/db/database-url";

export function deriveTestDbUrl(base: string): { url: string; name: string } {
  const u = new URL(normalizeDatabaseUrl(base));
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const testName = `${current}_test`;
  u.pathname = `/${testName}`;
  return { url: u.toString(), name: testName };
}
