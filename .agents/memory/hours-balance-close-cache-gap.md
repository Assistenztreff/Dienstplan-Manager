---
name: Month-closing didn't invalidate live hours-balance cache
description: Why "Auswertungen" (Soll/Ist evaluation) can show "keine Daten gefunden" even though the month-closing snapshot has real entries and the underlying shift/contract data is correct.
---

Symptom: `POST /month-closings` (Monatsabschluss / "Erneut abschließen") succeeds and
freezes a non-empty snapshot (`month_closings.entries`), proving `computeHoursBalances`
and the underlying shifts/contracts data are correct — yet the live Auswertungen page
(`GET /dashboard/hours-balance`, `useGetHoursBalance`) keeps showing "Keine
Auswertungsdaten gefunden" for the same month/team.

**Why:** `MonthClosingCard`'s `doClose()` only invalidated
`getGetMonthClosingsQueryKey`/`getGetMonthClosingDiffQueryKey` after a close, never
`getGetHoursBalanceQueryKey`. If the Auswertungen query was already cached (e.g. fetched
before shifts were finalized, or before the month existed), closing/re-closing the month
never triggers a refetch of the visible table — it only updates the closing-status card.
`staleTime` on that query is 30s (`SHIFT_LIST_STALE_TIME_MS`), so a long-lived tab or one
that fetched early can sit on a stale empty result indefinitely without an explicit
invalidation hook.

**How to apply:** Any mutation that changes data feeding a displayed evaluation/report
view must invalidate that view's query key too, not just the mutation's "own" status
query. When debugging "the DB clearly has the data but the UI is empty", check both (a)
the server computation directly against the real DB, AND (b) which query keys the
mutation that should have triggered a refresh actually invalidates.

Also relevant to this project specifically: production runs on an external Scaleway
Postgres (`PROD_DATABASE_URL`), completely separate from the dev DB; `executeSql({
environment: "production" })` does NOT reach it (it hits Replit's own managed-Postgres
replica instead) — for real production-DB investigations on this project, write a
throwaway script that imports `resolveDatabaseUrl()`/`pool` from `@workspace/db` with
`NODE_ENV=production DATABASE_SSL_NO_VERIFY=1`, call `pool.end()`/`process.exit(0)` at
the end (the pool's `min:2` otherwise keeps the process alive), and never print any part
of the connection string or raw driver errors (only whitelisted fields) — delete the
script when done.
