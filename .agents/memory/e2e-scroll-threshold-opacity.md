---
name: E2E scroll-threshold & opacity visibility
description: Testing scroll-depth-triggered UI (scroll-to-top button) in the e2e stack
---

Two pitfalls when testing UI that appears after a scroll-depth threshold and hides via opacity:

- **Test-DB content is too short.** The month grid in the `_test` DB (no seeded shifts) yields only ~270px of scrollable distance on a 400x700 viewport — below a 300px threshold, so the feature can never trigger. Inject a tall spacer into `<main>` inside the real `layout-scroll-container` (`insertAdjacentHTML` with a 2000px div) instead of depending on seeded data height; the button↔container wiring is still fully exercised.
- **Playwright ignores opacity.** Elements hidden via `opacity-0 pointer-events-none` (kept in DOM with size) count as visible for `isVisible()`/`toBeVisible()`. Assert on `getComputedStyle(el).opacity` and `.pointerEvents` instead; for `md:hidden` desktop checks assert `display === "none"`.

**How to apply:** any spec for scroll-triggered floating UI (scroll-to-top, back-to-top, reveal-on-scroll banners).
