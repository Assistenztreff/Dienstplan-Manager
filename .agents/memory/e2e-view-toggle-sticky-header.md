---
name: View-toggle selectors after sticky-header move
description: Dienstplan e2e selectors for the list/table view toggles after they moved into the sticky page header.
---

The Dienstplan list/table view toggles no longer live inside the `dienstplan-mobile` / `dienstplan-desktop` content containers — they sit in the sticky page header in two responsive groups.

**Rule:** e2e specs must select them via `page.getByTestId("view-toggles-mobile")` or `page.getByTestId("view-toggles-desktop")`, then `.getByTestId("view-toggle-list" | "view-toggle-table")`.

**Why:** Selectors scoped to the old content containers time out silently (the toggle exists, just outside the scoped locator), which looks like a product regression but is only a selector drift.

**How to apply:** Whenever a header/toolbar control moves out of a content container, grep the e2e suite for locators scoped to that container and re-anchor them to the new testid group.
