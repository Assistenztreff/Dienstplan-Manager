---
name: Shared Header-Tier-Logik
description: HeaderTier, useIsMobileViewport und useHeaderTier sind zentral in src/lib/header-tier.ts; beide Seiten (dienstplan.tsx, auswertungen.tsx) importieren von dort.
---

## Regel
`HeaderTier`, `useIsMobileViewport`, `useHeaderTier` sind in `src/lib/header-tier.ts` definiert.
Beide Seiten importieren von dort — **niemals lokal redefinieren**.

**Why:** Die Logik war identisch in beiden Dateien dupliziert. Bugfixes müssen nur noch an einer Stelle gemacht werden.

**How to apply:**
- Bei neuen Seiten, die dieselbe Tier-Messung brauchen: `import { useHeaderTier } from "@/lib/header-tier"`.
- Wenn TypeScript `TS2440: Import declaration conflicts with local declaration` meldet, ist eine lokale `type HeaderTier`-Deklaration stehen geblieben — löschen.
- `useLayoutEffect` wird von `header-tier.ts` selbst importiert; aufrufende Dateien brauchen es nicht mehr im React-Import.
