---
name: Parallele scoped-e2e-Lanes
description: Wie die volle E2E-Kette parallel laeuft (Shards, Suffixe, Locks) und welche Fallen dabei gelten.
---

Die volle Abschluss-Kette laeuft als parallele Lanes (Plan in `planForCategory`,
Orchestrierung in scoped-e2e): db-tests seriell in einer Lane, die *-api.spec.ts
via Playwright `--shard=i/N` in eigenen Lanes, Smoke danach seriell auf dem
Standard-Stack (UI-lastig, bewusst nicht unter Volllast).

**Regeln, die das flake-frei machen:**
- Jede Shard-Lane braucht EIGENE `E2E_TEST_DB_SUFFIX` (Basis-Suffix + Ziffer,
  Whitelist [a-z0-9]{1,16}) und EIGENE Ports (`E2E_API_PORT`/`E2E_WEB_PORT`).
- Der Playwright-Lauf-Lock ist PORT-gebunden (`run-<api>-<web>.lock`), sonst
  serialisieren sich die Lanes am gemeinsamen Lock; global-teardown leitet den
  Namen identisch aus den Env-Ports ab.
- Der Schema-Marker ist pro Test-DB-NAME (`test-db-schema-<db>.hash`), sonst
  thrashen die Lanes den Marker und provisionieren jedes Mal neu.
- Die Prod-Spec-Ports (8097/5197) reapt NUR der Standard-Lauf (keine
  Port-Overrides gesetzt) — Shard-Lanes wuerden sonst fremde Prod-Stacks killen.
- Ohne privaten Basis-Suffix (E2E_SHARED_TEST_DB=1) oder mit E2E_PARALLEL=0
  faellt alles auf die serielle Kette zurueck (Sicherheitsregel).

**Why:** Geteilte DBs/Ports/Locks waren die Flake-Quellen; getrennte private
Wegwerf-DBs pro Lane machen Parallelitaet sicher. Messung: 25 min parallel vs.
~41 min serielle Blocksumme.

**How to apply:** Neue teure Bloecke als eigene Lane mit eigener DB/Ports
hinzufuegen; nie zwei Lanes auf dieselbe Test-DB zeigen lassen.
