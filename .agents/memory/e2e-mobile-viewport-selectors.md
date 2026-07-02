---
name: E2E selectors under the 400px mobile viewport
description: The dienstplan Playwright config uses a 400px-wide viewport; responsive `hidden sm:inline` button labels vanish, breaking getByRole name lookups.
---

# E2E selectors under the mobile viewport

The Playwright config pins the viewport to 400x720 (mobile). Any button whose
text label is wrapped in `hidden sm:inline` (Tailwind `sm` = 640px) renders
icon-only, so `getByRole("button", { name: "…" })` finds nothing — the element
exists but has no accessible name.

**How to apply:** for icon-only/responsive buttons, select via a stable
attribute instead: `data-testid`, or the `title` attribute (the plan-gate
buttons carry the Premium hint in `title` when locked, e.g.
`button[title*="… ist ein Premium-Feature"]`).

**Why:** a spec that passes conceptually can fail purely from the viewport
hiding the label; this cost a debug round in the premium-gates spec.
