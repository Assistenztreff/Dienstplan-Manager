---
name: Offline-Lazy-Modul-Vorladen in E2E-Tests
description: React.lazy-Module müssen vor dem Offline-Schalten gecacht sein
---

## Problem

In Playwright-Tests mit `context.setOffline(true)` schlägt `React.lazy(() => import('./pages/X.tsx'))` fehl,
wenn der Browser das Modul noch nicht geladen hat. Das zerstört den React-Baum statt das Offline-Banner zu zeigen.

Fehlermeldung: "Failed to fetch dynamically imported module: http://localhost:5192/src/pages/X.tsx"

## Fix

VOR dem Offline-Setzen das Ziel-Modul via client-side Navigation vorladen (bleibt im selben JS-Kontext):

```typescript
// Modul in Browser-Modul-Register cachen
await page.evaluate(() => {
  window.history.pushState({}, "", "/auswertungen");
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
});
await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible({ timeout: 10_000 });
// Zurück navigieren
await page.evaluate(() => {
  window.history.pushState({}, "", "/dienstplan");
  window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
});
// Dann erst offline schalten
await context.setOffline(true);
```

**Warum:** `page.goto()` resettet den JS-Kontext → Module nicht gecacht. Client-side Navigation behält denselben Kontext.

**Gilt für:** Alle Seiten die über React.lazy geladen werden (z.B. auswertungen.tsx).
