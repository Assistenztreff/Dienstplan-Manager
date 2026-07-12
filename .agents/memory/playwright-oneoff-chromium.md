---
name: One-off Playwright scripts need the nix chromium
description: How to launch chromium in ad-hoc Playwright node scripts in this NixOS env (downloaded browsers fail with missing libglib).
---

# One-off Playwright scripts: use REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE

`npx playwright install chromium` downloads a headless shell that **cannot run**
on this NixOS env (`error while loading shared libraries: libglib-2.0.so.0`).

**Fix:** launch with the nix-provided browser that the repo's Playwright config
already uses:

```js
chromium.launch({ executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE })
```

**How to apply:** any ad-hoc verification script run with plain `node` (import
`@playwright/test`, run it from inside `artifacts/dienstplan` so the package
resolves). The regular `playwright test` runner picks the executable up via
`playwright.config.ts` automatically.

**Gotchas in ad-hoc scripts:**
- `browser.newPage({ viewportSize: ... })` is silently IGNORED — the correct
  option is `viewport: { width, height }`. A wrong key leaves you at the
  default 1280×720 and mobile-only UI (`md:hidden`) never renders. Verify with
  `window.innerWidth` when responsive behavior seems wrong.
- Playwright's `isVisible()` ignores `opacity: 0` — elements faded out via
  opacity still report visible. Assert on `getComputedStyle(...).opacity` /
  `pointerEvents` for fade-toggled UI.
