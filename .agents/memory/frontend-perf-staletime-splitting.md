---
name: Frontend-Perf staleTime & Code-Splitting
description: Globales staleTime im QueryClient und React.lazy()-Code-Splitting für alle schweren Seiten; verhindert Navigations-Refetches und reduziert Haupt-Bundle von 1 MB auf ~150 KB.
---

# QueryClient staleTime & Code-Splitting

## Regel
- `staleTime: 5 * 60 * 1000` muss im QueryClient-`defaultOptions.queries` gesetzt sein.
  Ohne globales staleTime refetcht jede Navigation alle Queries neu (staleTime=0 default).
- Alle schweren App-Seiten werden per `React.lazy()` importiert; leichte Auth-Seiten bleiben statisch.
- Suspense-Wrapper in beiden Router-Branches (auth + unauth) mit `<PageLoader />` als Fallback.

**Why:** Dashboard allein feuert ~10 API-Requests; ohne staleTime werden alle bei jedem
Seitenwechsel wiederholt. Mit 5 min Cache entfällt die Wartezeit bei Navigation zwischen
Dashboard → Dienstplan → Auswertungen vollständig.

## How to apply
- `artifacts/dienstplan/src/App.tsx` — QueryClient defaultOptions + lazy-Deklarationen + Suspense
- Named-exports (Handbuch): `lazy(() => import("@/pages/handbuch").then(m => ({ default: m.HandbuchStart })))`
  → alle Handbuch-Lazy-Calls aus derselben Datei landen im gleichen Chunk (Vite-Dedup).
- `staleTime` per Query überschreibt den globalen Default; per-Query-Werte (z.B. shifts: 30s) haben Vorrang.
- Mutations müssen weiterhin `invalidateQueries` aufrufen, damit Schreiboperationen sofort sichtbar werden.

## Haupt-Bundle vor/nach
- Vorher: `index.js` ~1000 KB (alles in einem Chunk)
- Nachher: Haupt-Bundle ~150 KB, je eine Chunk-Datei pro lazy-Seite
