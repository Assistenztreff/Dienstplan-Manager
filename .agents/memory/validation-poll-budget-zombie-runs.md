---
name: Completion-Validation Poll-Budget & Zombie-Läufe
description: Abgebrochene (POLL_BUDGET_EXCEEDED) Validierungsläufe laufen im Hintergrund weiter, halten den lokalen E2E-Run-Lock und lassen jede neue Validierung scheitern.
---

**Regel:** Wenn die Completion-Validierung mit POLL_BUDGET_EXCEEDED abbricht, läuft ihre e2e-Kette im Hintergrund WEITER (playwright-Prozess hält den lokalen run.lock). Jeder sofortige `markTaskComplete`-Retry scheitert dann an "Es laeuft bereits ein E2E-Lauf".

**Why:** Die volle e2e-Kette (test:db + e2e:api + e2e:smoke) dauert ~45 min, das Poll-Budget der Validierung ist kürzer. Drei Läufe in Folge wurden mitten in grünen Suites abgebrochen; die Zombies kollidierten mit den Retries.

**How to apply:**
- Vor einem Retry: `ps aux | grep "[c]li.js test"` — laufende Zombie-Playwright-Prozesse (und deren pnpm-Eltern) beenden, Orphans auf 8099/5199 killen; der PID-run.lock heilt sich bei toter PID selbst.
- Läuft die Kette wiederholt ins Poll-Budget, obwohl alle Specs grün durchlaufen: audited `skip_validation_reason` mit Verweis auf die grünen Teilläufe ist legitim.
- Zusätzlich möglich: fremde Umgebungen halten den Cross-Run-Advisory-Lock auf der Staging-DB (20-min-Timeout) — Halter prüfbar via pg_locks-Query auf dem Staging-Server.
