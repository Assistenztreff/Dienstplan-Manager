---
name: Shared staging _test DB race
description: The external staging Postgres `_test` DB is shared across parallel task environments; concurrent e2e runs pollute each other.
---

The e2e `_test` database lives on the external staging Postgres (APP_DATABASE_URL), so EVERY parallel task environment's e2e runs share it. Fresh `e2e.*` accounts can appear mid-run from other environments, breaking the account-separation pre-check even after a clean drop/reprovision.

**Why:** the run lock is a local PID file — it cannot serialize runs across isolated environments.

Interference can be CONTINUOUS (a sibling environment running its full suite): the separation pre-check then fails repeatedly with rotating symptoms — deadlocks in setup-test-accounts/migrate-teams, duplicate-key on fixed-email seeds, FK violations, phantom added/removed memberships. Retry loops don't help while the sibling is active; if code is otherwise verified (typecheck, unit, earlier green spec run), treat the merge e2e-gate failure as environment-blocked rather than burning more retries.

**How to apply:** for a one-off local spec verification, clean leftover `e2e.*` accounts via cascade SQL (team-owned tables first) and run with `E2E_SKIP_SEPARATION_CHECK=1 E2E_SKIP_CLEANUP_CHECK=1`. Don't burn cycles reprovisioning — pollution can recur seconds later. psql to staging: strip `sslmode` param from the URL and set `PGSSLMODE=require`.

Foreign runs' teardown also DELETES all `e2e.*@dienstplan.test` accounts mid-run: a superadmin seeded in `beforeAll` can vanish before/inside a test (login fails, or session dies mid-test with "Nicht angemeldet"). Seed a FRESH uniquely named account inside each test immediately before login; non-account rows (e.g. platform_errors with own context prefixes) are safe.

Update (Juli 2026): Auch der Selbstheilungs-Check (verify-test-db-cleanup) kann durch fremde parallele Läufe fehlschlagen (fremde e2e.*-Konten entstehen mitten im Check oder Konstellations-Reste nach setup-test-accounts-Deadlock blockieren Team-Deletes per FK). Für One-off-Verifikation zusätzlich E2E_SKIP_CLEANUP_CHECK=1 setzen; echte Reste manuell per SQL entfernen (shift_models → team_members → teams → users).

**Retention test:db is a prime victim:** `platform-errors.retention.test.ts` (api-server `test:db`) asserts exact row sets in `platform_errors` on the shared `_test` DB; concurrent validation runs from other environments insert foreign rows (mixed "boom"/"fehler" sets, off-by-one prunes). It passes reliably in isolation — repeated validation-only failures there are cross-run pollution, not a code regression.

**Merge-Validierung betroffen:** Auch der api-server `test:db` (platform_errors Retention-Test) läuft gegen die geteilte `_test`-DB — läuft in einer anderen Umgebung dieselbe Validierung parallel, kollidieren die Seeds (`fehler-*`/`boom-*` mischen sich trotz beforeEach-Truncate) und die Assertions werden rot. Lokal in ruhigem Fenster grün ⇒ Umgebung, nicht Code. Bei rein Frontend-Changes nach mehreren Fehlversuchen mit klarer Begründung skippen.

**Repair:** stale `e2e.*@dienstplan.test` accounts from killed foreign runs break the separation pre-check every run. Fix by running `pnpm run cleanup-test-accounts` (scripts pkg) with DATABASE_URL+APP_DATABASE_URL pointed at the `_test` DB (string-replace the db name in the URL; `new URL()` fails on the unencoded password).

**Update (27.07.2026, Cross-Run-Lock):** Verwaltete E2E-Läufe halten jetzt einen Postgres-Advisory-Session-Lock (`@workspace/test-fixtures/cross-run-lock`, Schlüssel aus dem `_test`-DB-Namen) auf dem geteilten Server — erworben beim Config-Load VOR setup-test-db/Checks, gehalten bis Prozessende (Verbindungsende gibt ihn automatisch frei, auch nach SIGKILL). Parallele Läufe warten (bis 20 min, Meldung "belegt — warte"), statt sich zu zerstören. Skip: `E2E_SKIP_CROSS_RUN_LOCK=1`. Zusätzlich tolerieren verify-account-separation (Membership-Snapshot), verify-test-db-cleanup (nur eigenes Zombie-Konto) und die setup-test-accounts-Endkontrolle fremde `e2e.*@dienstplan.test`-Konten — schützt auch gegen Alt-Läufe ohne Lock.

**Achtung Agent-Shell:** Hintergrundprozesse (auch setsid/nohup/disown) überleben das Ende eines Shell-Aufrufs NICHT zuverlässig — Lock-Halter und paralleler Testlauf müssen im SELBEN Shell-Aufruf laufen, sonst testet man gegen einen toten Halter.

**Update (28.07.2026, test:db mit Lock):** Auch die Vitest-DB-Suiten (`test:db` in api-server & scripts) erwerben denselben Cross-Run-Lock via Vitest-globalSetup (`@workspace/test-fixtures/vitest-db-lock`, eigene Configs `vitest.db.config.ts`). Suiten warten bei belegtem Lock ("[test:db] … belegt — warte"); Skip weiterhin `E2E_SKIP_CROSS_RUN_LOCK=1`. Bei hoher Contention durch fremde Umgebungen kann ein 5-min-Shell-Fenster fürs Warten+Testen nicht reichen — einfach erneut foreground starten (Hintergrundprozesse werden gereapt).

**Nachtrag test:db-Lock:** Der Vitest-globalSetup-Lock (`vitest-db-lock`) nutzt `deriveTestDbTarget` — bei privater Umgebungs-Test-DB (Standard seit den privaten `_test_<suffix>`-DBs) ist er ein No-op; nur im Shared-Modus (`E2E_SHARED_TEST_DB=1`) wird der Advisory-Lock (45-min-Budget) erworben.
