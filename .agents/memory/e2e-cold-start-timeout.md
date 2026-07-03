---
name: E2E cold-start timeouts & result capture in this env
description: Playwright E2E in the dienstplan repo — beforeEach login/first-nav can exceed the 30s default timeout, and how to capture results when a run outlasts the tool budget.
---

# Playwright E2E cold-start timeout

The first page navigation in a fresh browser context loads the whole app bundle
over the shared proxy and can take well over the **default 30s test timeout**,
especially when `beforeEach` does login **plus** extra setup (e.g. creating a
test user via `page.request`). Symptom: failure message
`Test timeout of 30000ms exceeded while running "beforeEach" hook` — this is NOT
a logic/assertion bug.

**Fix:** call `test.setTimeout(120_000)` as the first line of `beforeEach` (it
extends the timeout for the running hook + the test). The template
`dienstplan-calendar.spec.ts` survives on the default 30s only because its
`beforeEach` is login-only; adding any setup work tips it over.

**Why:** cold bundle load over the proxy is slow and variable in this env; the
default 30s is too tight once setup work is added.

# Capturing results when a run outlasts the 120s tool budget

A full cold Playwright run here can exceed the bash-tool 120s wall-clock cap, and
**detached/background runs (nohup/setsid) get reaped by the platform between tool
calls** — they produce empty output files. So:

- Run **foreground** only. Background polling does not work.
- The `list`/`line`/`json` reporters buffer to a file and lose everything if the
  process is killed mid-run (json only writes at `onEnd`).
- Use a **tiny custom reporter that `fs.appendFileSync`s per `onTestEnd`** — the
  verdict is on disk the instant a test ends, surviving a slow/killed teardown.
  Run with `timeout --kill-after=3 116 ... --reporter=/tmp/rep.cjs`, then read the
  results file. Run tests one at a time (`-g`) so each fits the budget.
- Practical recipe that fits the budget: run `setup-test-db` once in its own tool
  call, then foreground spec runs with `E2E_SKIP_DB_SETUP=1` and `-g` batches of
  ~5-6 tests (incl. any earlier test that sets shared state like recordedErrorId).
  ~6 tests + stack boot ≈ 35-45s. The code_execution notebook also gets reset
  between calls, so spawning long runs there fails the same way as nohup.
