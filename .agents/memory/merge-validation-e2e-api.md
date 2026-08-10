---
name: Merge validation structure (typecheck / unit / serial e2e chain)
description: Which validation commands run on merge, why DB-bound runs are chained serially, and how the API filter + smoke list work.
---

Three validation commands are registered via the validation skill and run on every `mark_task_complete`/merge. **They execute in PARALLEL** (total = max, not sum), so anything touching the shared `_test` DB must live in ONE serial chain:

- `typecheck` — `pnpm run typecheck` (enthält den Codegen-Wächter: Orval LEERT die generierten Verzeichnisse für Sekunden und schreibt sie neu)
- `unit` — `pnpm --filter @workspace/scripts run test-unit-locked`: dienstplan/db/api-server(test:unit)/scripts-Vitest UNTER der Codegen-Sperre. Grund: dienstplan- und api-server-Suiten importieren `lib/*/src/generated`; ohne Sperre lasen sie parallel zum typecheck ins Leerfenster → "Cannot find module './generated/api'" ohne echten Fehler.
- `e2e` — `pnpm --filter @workspace/scripts run scoped-e2e` (git-Diff→Kategorie; Details in scoped-e2e-validation.md); dessen interne typecheck-Stufe ist ein weiterer Codegen-SCHREIBER.

**Why:** while 13 specs were red for weeks, two product changes silently invalidated their assertions — merge gating surfaces red specs immediately. And a first attempt with separate `e2e-api`/`e2e-smoke` validations failed instantly: parallel Playwright config loads raced past the run lock and collided in the `_test` DB (duplicate seeded accounts, failed separation checks).

**How to apply:**
- Jede Validierungs-Lane, die `lib/api-client-react/src/generated` oder `lib/api-zod/src/generated` LIEST oder SCHREIBT, muss die Codegen-Sperre halten (Muster: `typecheck-libs-locked.ts` / `test-unit-locked.ts` in scripts/src) — sonst sporadische "Cannot find module"-Fehlschläge bei paralleler Abschluss-Validierung.
- Never register two validation commands that both touch the `_test` DB; extend the `e2e` chain instead.
- New DB-bound vitest files in api-server must be excluded from `test:unit` and added to `test:db`.
- `test:e2e:api` bakes the filter into the script (`playwright test "api\.spec\.ts$"`); `pnpm run test:e2e -- <file>` does NOT filter. Name API-only specs `*-api.spec.ts` to join the gate automatically.
- `test:e2e:smoke` reads `artifacts/dienstplan/e2e/smoke-specs.txt` (one spec filename per line, `#` comments) — curated critical UI flows; keep it small (few minutes).
- If a task legitimately leaves a gated spec red, fix or adjust the spec in the same task — do not deregister the validation.
