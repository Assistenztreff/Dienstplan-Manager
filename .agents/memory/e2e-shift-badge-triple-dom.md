---
name: shift-badge testid exists 3x in DOM
description: getByTestId(`shift-badge-<id>`) matches 3 elements at once on /dienstplan; must scope to the desktop container to avoid Playwright strict-mode violations.
---

`/dienstplan` renders the same shift simultaneously in up to three places once
loaded: the desktop month-grid/table pill, and BOTH the mobile and desktop
"persistent week list" panels (all using the shared `shift-badge-<id>`
testid, differing only by surrounding container). A bare
`page.getByTestId(\`shift-badge-${id}\`)` therefore fails Playwright's strict
mode ("resolved to 3 elements") even though only one is meant to be the
target for a given viewport/test.

**Why:** the persistent week lists mount off-DOM-visibility (CSS
hidden/collapsed, not unmounted) regardless of which top-level view
(grid/table) is active, so all three copies always exist together.

**How to apply:** scope the locator to the container under test first, e.g.
`desktop.getByTestId(\`shift-badge-${id}\`)` where `desktop =
page.getByTestId("dienstplan-desktop")`, exactly like existing helpers do for
`day-detail-panel`. Never assert on the bare testid across the whole page.
