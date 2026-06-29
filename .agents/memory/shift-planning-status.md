---
name: Shift planning status defaults
description: Why the planning_status column defaults to FIX but new shifts created via the dialog default to Entwurf (VORLAEUFIG).
---

Shifts carry a `planning_status` enum (`VORLAEUFIG` = Entwurf, `ANGEBOTEN` = Vorschlag, `FIX` = bestätigt).

The DB column default is **FIX** while the shift-dialog default for *newly created* shifts is **VORLAEUFIG**.

**Why:** The two defaults serve different purposes. The column default (FIX) only governs the migration backfill — pre-existing shifts predate the feature and were already "real" binding shifts, so they must stay binding. New shifts, however, should enter the planning workflow at the draft stage (Entwurf → Vorschlag → Bestätigt), so the dialog explicitly sends VORLAEUFIG on create.

**How to apply:** If you change either default, keep them decoupled — do not assume the column default reflects the UX default. Absences (vacation/sick) deliberately have no planning-status UI (they are immediately binding); the dialog only shows the status selector for regular shifts.
