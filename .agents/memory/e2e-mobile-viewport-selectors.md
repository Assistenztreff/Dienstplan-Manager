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

Two more strict-mode pitfalls from the downgrade-bestandsschutz spec:
- Dienstplan shift badges (`shift-badge-<id>`) render in BOTH the mobile
  agenda list AND the CSS-hidden desktop grid — `getByTestId` alone hits a
  strict-mode violation. Scope through the visible container first
  (e.g. `getByTestId("agenda-day-…").getByTestId("shift-badge-…")`).
- `locator.getByDisplayValue` does not exist in the pinned Playwright
  version; assert input contents with `getByPlaceholder(...).toHaveValue()`.

Scroll-behavior specs: at 400x874 the mobile month grid overflows the layout
scroll container by only ~97px — not enough for the platform header + app
menu bar (~110px) to leave the viewport, so "scrolled away" assertions fail
spuriously. Use a shorter phone viewport (e.g. 400x700) and force the grid
view via localStorage so scrollable height never depends on seeded shifts.

## Zeilen-Klick trifft eingebetteten Button (Zentrum-Klick-Falle)
`locator.click()` klickt die ELEMENT-MITTE. Bei kompakten Listenzeilen (z. B. Tagesleisten-Zeile mit eingebettetem "Bestätigen"-Button) liegt der Button am 402-px-Viewport genau im Zeilenzentrum — der Klick landet auf dem Button (stopPropagation), bestätigt die Schicht und der Zeilen-onClick (Dialog öffnen) feuert nie. Symptom: Dialog-toBeVisible-Timeout, Snapshot zeigt plötzlich "bestätigt".
**How to apply:** Zeilen-Klicks in Specs auf ein eindeutiges Kind zielen (z. B. `row.getByText(name).click()`) statt auf die Zeile selbst, sobald die Zeile interaktive Kinder enthält.
