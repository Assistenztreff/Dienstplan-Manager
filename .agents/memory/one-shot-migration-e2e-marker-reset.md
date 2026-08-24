---
name: One-shot data-migration e2e tests must reset the marker
description: An e2e test that simulates "legacy pre-migration data" for a once-ever data_migrations-gated backfill must delete that migration's marker row first, or it silently becomes a permanent no-op.
---

A data migration gated by the `data_migrations` once-ever marker (e.g.
`backfill-partial-absence-flag`) is, by design, a guaranteed no-op after its
first successful claim on a given database — this is intentional (protects
legitimately ambiguous new data created after the migration's cutover).

Private E2E test DBs persist across many test runs (see
`private-test-dbs.md`), so the marker from the FIRST ever run of such a spec
stays claimed forever. Any later run that manually resets a row's flag to
simulate "legacy data" and then re-invokes the migration script will find the
marker already spent and silently do nothing — the assertion then fails, but
only from the second run onward (passes once, then fails every time after).

**Why:** discovered because such a test passed on a completely fresh test DB
but failed deterministically on any DB where the migration had run before —
easy to misdiagnose as a backfill script bug when the script was already
correct (verified separately by a real bestands-db integration test that
rebuilds a throwaway DB from scratch each time).

**How to apply:** before invoking a one-shot migration script from an e2e
spec to verify it fixes a *simulated* legacy row, delete that migration's row
from `data_migrations` first (mirrors what a real "before the migration ever
ran" database looks like). Do this in the spec itself (in-process DB helper),
not by relying on a fresh DB per run.
