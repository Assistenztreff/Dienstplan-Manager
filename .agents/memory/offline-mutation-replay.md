---
name: Offline Mutation Replay
description: React Query networkMode + resumePausedMutations must both be set for offline queuing to work; pattern for OfflineBanner pending count.
---

# Offline Mutation Replay

## The rule
Two pieces must be set together for offline mutation queuing to work:

1. **`QueryClient.defaultOptions.mutations.networkMode: 'offlineFirst'`** — causes React Query to *pause* new mutations instead of failing them immediately when `navigator.onLine === false`.
2. **`queryClient.resumePausedMutations()`** — called on reconnect (inside a `useEffect` that watches `isOnline`) — actually sends the queued mutations.

Neither alone is sufficient:
- Without `networkMode: 'offlineFirst'`, mutations still fail immediately while offline (default `'online'` mode fails them).
- Without `resumePausedMutations()`, paused mutations stay paused even after coming back online (React Query does not auto-resume them).

## Where this lives
- **App.tsx** — `QueryClient` instantiation, `defaultOptions.mutations.networkMode: 'offlineFirst'`
- **`src/components/offline-banner.tsx`** — `useEffect` calls `resumePausedMutations()` when `isOnline` becomes true; also calls `invalidateQueries()` to refresh stale queries.

## Pending mutation count in UI
```typescript
const pendingCount = useMutationState({
  filters: { status: "pending" },
  select: (mutation) => (mutation.state.isPaused ? 1 : 0) as 0 | 1,
}).reduce((sum, v) => sum + v, 0);
```
The banner shows this count via `data-testid="offline-banner-pending"`.

**Why:** `status: 'pending'` includes all in-flight mutations; `isPaused` narrows to only those paused by the offline check.

## How to apply
Any time the QueryClient defaultOptions are touched (e.g. adding retry logic, changing staleTime) — make sure `mutations.networkMode` is not accidentally removed. The E2E test in #680 would catch a regression.
