---
name: Vite dynamic-import deps reload mid-action
description: Dynamically imported heavy libs (jspdf) must be in optimizeDeps.include or Vite reloads the page mid-action and aborts it.
---

In the Vite dev server, a library that is only reached via `await import(...)`
(e.g. `jspdf` / `jspdf-autotable` in the PDF export) is NOT pre-bundled at
server start. The first time the dynamic import runs, Vite optimizes the dep
on-demand and triggers a **full page reload** ("new dependencies optimized,
re-reloading"). That reload aborts the in-flight handler, so the side effect
that follows the import never completes.

**Symptom:** an E2E test that clicks an export button and waits for a
`download` event hangs forever (no download fires) on the first run, while a
real user "fixes" it by clicking again.

**Fix:** list such deps in `optimizeDeps.include` in the artifact's
`vite.config.ts` so they are pre-bundled at startup. This also removes the
first-use reload glitch for real users.

**Why:** the reload is invisible in manual testing (you just retry) but makes
download-based E2E flows non-deterministic.

**How to apply:** whenever a feature reaches a heavy third-party lib only via
dynamic `import()` and a side effect (download, navigation) depends on that
import finishing, add the lib to `optimizeDeps.include`. Restart the dev
workflow afterward so Vite re-bundles.
