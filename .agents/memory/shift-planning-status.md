---
name: Shift planning status defaults
description: Why the planning_status column defaults to FIX but new shifts created via the dialog default to Entwurf (VORLAEUFIG).
---

Shifts carry a `planning_status` enum (`VORLAEUFIG` = Entwurf, `ANGEBOTEN` = Vorschlag, `FIX` = bestätigt).

The DB column default is **FIX** while the shift-dialog default for *newly created* shifts is **VORLAEUFIG**.

**Why:** The two defaults serve different purposes. The column default (FIX) only governs the migration backfill — pre-existing shifts predate the feature and were already "real" binding shifts, so they must stay binding. New shifts, however, should enter the planning workflow at the draft stage (Entwurf → Vorschlag → Bestätigt), so the dialog explicitly sends VORLAEUFIG on create.

**How to apply:** If you change either default, keep them decoupled — do not assume the column default reflects the UX default. Absences (vacation/sick) deliberately have no planning-status UI (they are immediately binding); the dialog only shows the status selector for regular shifts.

**Re-confirmation on substance change:** PATCH /shifts/:id now falls a FIX (non-absence, non-"team") shift back to ANGEBOTEN whenever startTime/endTime/userId/shiftModelId/pauseMinutes change AND the request doesn't send a genuinely *different* planningStatus than the shift's old one. An edit dialog that always echoes back the current status (unchanged) does NOT count as a deliberate decision — it still triggers the fallback. Any e2e spec that PATCHes a substance field on a FIX shift and then relies on it staying FIX (e.g. wage/Nachberechnung totals, which only count FIX shifts) must add a separate no-time-fields `{ planningStatus: "FIX", force: true }` reconfirm PATCH afterward.
