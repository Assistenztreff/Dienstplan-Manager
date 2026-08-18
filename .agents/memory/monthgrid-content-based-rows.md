---
name: MonthGrid content-based row heights (no viewport stretch)
description: Why the Dienstplan month calendar must never size grid rows from viewport units, and how row-local vs. month-wide growth should behave.
---

A month calendar grid built from CSS Grid must size its rows purely from
content (auto rows), never from a viewport unit (`100svh`/`vh`) or a computed
"fill remaining space" height.

**Why:** an earlier implementation used `100svh` minus header heights, divided
evenly across the week rows, to make short months fill the screen. This
produced two bugs: (1) the pixel value of `100svh` changes with browser zoom,
so the whitespace under the last pill in a day cell was zoom-dependent instead
of a fixed size; (2) going from 2 to 3 shift entries on a single day recomputed
the shared row height for the WHOLE month, visibly shifting every other week's
layout, not just the affected row.

**How to apply:** grid rows must stay `auto`-sized; only give a day cell's
content area (the "Grauzone") a small fixed `min-height` (enough for one
single-line pill) so empty days don't collapse below a usable click target.
Keep `flex-1` on that content area — CSS Grid's default `align-self: stretch`
already makes every cell in a row match the row's tallest cell, so a busy
neighbor in the SAME week still stretches nearby empty/lighter cells (this is
correct, expected, and doesn't need justifying as a bug). What must never come
back is a JS-computed row height or a viewport-relative one that couples
unrelated weeks together or makes spacing zoom-dependent. If a month is short
enough that its natural (content-driven) height is less than the viewport, it
is fine to end early and leave whitespace below — do not force-stretch to fill
the screen.
