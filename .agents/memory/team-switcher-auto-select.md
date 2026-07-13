---
name: TeamSwitcher auto-select — e2e implications
description: No "Alle Teams" option anymore; dienstleister always has a concrete team auto-selected — what that means for UI specs and first-load fetches.
---

# TeamSwitcher auto-select (kein „Alle Teams")

Rule: Dienstleister accounts always have exactly one team selected; on first use (or when the stored team no longer exists) the context auto-selects the FIRST team from `GET /teams`.

**Why:** Cross-team mixed views caused confusion; product decision was one-team-at-a-time.

**How to apply:**
- UI e2e specs for dienstleister accounts can no longer rely on an unfiltered "all teams" default view. Fixtures must either live in the account's FIRST team (Standard-Team, created at registration, lowest id) or the spec must explicitly switch teams via the switcher (`getByLabel("Team auswählen")` → option click).
- Pages using team-management lists (`/team-verwaltung`) are NOT switcher-scoped — they still show all owned teams.
- First page load fires one brief unscoped fetch (e.g. `/api/shifts` without `teamId`) before teams load and the auto-select effect runs; the scoped refetch follows immediately. Don't assert on the very first request.
- Icon-only active-state buttons: `size="icon"` on the shared Button suppresses the auto-appended arrow of `variant="default"` — no button.tsx change needed for arrow-free yellow icon buttons.
