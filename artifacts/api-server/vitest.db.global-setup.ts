// Vitest-globalSetup fuer test:db: Cross-Run-Lock auf die geteilte
// `_test`-DB (Details siehe @workspace/test-fixtures/vitest-db-lock).
import { acquireVitestDbLock } from "@workspace/test-fixtures/vitest-db-lock";

export default async function setup(): Promise<() => Promise<void>> {
  return acquireVitestDbLock();
}
