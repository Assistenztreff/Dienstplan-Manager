/**
 * Leitet aus der Dev-`DATABASE_URL` die URL der isolierten Test-Datenbank ab.
 * Geteilt zwischen `setup-test-db` (Provisionierung) und
 * `verify-test-db-cleanup` (Selbstheilungs-Check).
 *
 * Die eigentliche Namenslogik (inkl. privatem Umgebungs-Suffix, Task #633)
 * lebt zentral in `@workspace/test-fixtures/test-db-name`.
 */
import { normalizeDatabaseUrl } from "@workspace/db/database-url";
import { deriveTestDbTarget } from "@workspace/test-fixtures/test-db-name";

export function deriveTestDbUrl(base: string): { url: string; name: string } {
  const target = deriveTestDbTarget(normalizeDatabaseUrl(base));
  return { url: target.url, name: target.name };
}
