---
name: Persisted query-cache owner tag (buster)
description: Why the React Query persist buster must be stamped dynamically at write time, not frozen at App mount.
---

# Persisted cache owner must be stamped at WRITE time

`PersistQueryClientProvider` freezes its `persistOptions` at mount (effect deps `[client, isRestoring]`
capture the options once). A buster like `u:<storedSessionUserId() ?? "anon">` computed inline in
`persistOptions` is therefore fixed for the whole tab session.

**Failure mode:** app mounts logged-out (login page) → buster frozen as `u:anon` → user logs in
in-session → all persists get stamped `u:anon` → next reload computes `u:<id>` → whole persisted
cache discarded instead of restored (cold start with skeletons after every in-session login; same
for in-session account switches, which keep stamping the OLD owner).

**Fix pattern (App.tsx):** `cacheOwnerTag()` helper + a wrapper `Persister` whose `persistClient`
re-stamps `client.buster = cacheOwnerTag()` dynamically before delegating to the
`createSyncStoragePersister` instance. The mount-time buster in `persistOptions` stays — it is only
used for the restore comparison, which runs at mount when the snapshot-derived value is correct.

**Why safe across accounts:** `registerUserSwitchHandler`/`registerSignOutHandler` already
`clear()` + `removeClient()` on switch/logout; a late throttled write can at worst recreate an entry
stamped for the OLD owner, which the next mount's differing buster rejects.

**How to apply:** never put a login-state-dependent value directly into `persistOptions`; route it
through the wrapper persister so it is evaluated per persist call.
