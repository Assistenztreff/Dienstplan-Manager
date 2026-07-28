---
name: Private E2E-Test-DBs pro Umgebung
description: Jede Umgebung nutzt standardmaessig eine eigene <dbname>_test_<suffix>-DB; Advisory-Lock entfaellt; Aufraeumen ueber DB-Kommentar.
---

# Private E2E-Test-DBs pro Umgebung

Regel: E2E-/DB-Test-Ableitung laeuft zentral ueber `@workspace/test-fixtures/test-db-name` (`deriveTestDbTarget`). Standard = private DB `<dbname>_test_<suffix>` (Suffix = Hash aus `REPL_ID`/Hostname, stabil pro Umgebung). Der Lauf-uebergreifende Advisory-Lock wird bei privater DB automatisch uebersprungen. Fallbacks: `E2E_SHARED_TEST_DB=1` (alte geteilte `_test`-DB inkl. Lock), `E2E_TEST_DB_SUFFIX=<a-z0-9>{1,16}` (expliziter Suffix, z. B. zweiter Parallel-Lauf in derselben Umgebung).

**Why:** Parallele Task-Umgebungen serialisierten sich stundenlang am Advisory-Lock der geteilten `_test`-DB; private DBs machen Laeufe unabhaengig. Alterserkennung ueber `COMMENT ON DATABASE` (`dienstplan-e2e used=<ISO>`, in pg_shdescription), NICHT ueber Tabellen/Registry — jede Extra-Tabelle wuerde `drizzle push` zum Drop-Prompt zwingen.

**How to apply:**
- Neue Ableitungsstellen NIE lokal kopieren — immer `deriveTestDbTarget` importieren, sonst provisioniert/testet man verschiedene DBs.
- Namens-Guards muessen `_test` UND `_test_<suffix>` akzeptieren (Bsp. cleanup-test-platform-errors).
- Selbstaufraeumung (`cleanupStaleTestDbs`): droppt NUR Namen nach Whitelist `^<base>_test_[a-z0-9]{1,16}$`, mit eigenem Kommentar-Marker, `used` aelter 72h, ohne aktive Verbindungen; DBs ohne Kommentar werden nie angefasst.
- Lokal in EINER Umgebung bleiben Laeufe durch PID-Run-Lock + feste Ports 8099/5199 seriell — private DBs loesen nur die Cross-Umgebungs-Parallelitaet.
- Der Nutzungs-Stempel wird bei jedem Config-Load aufgefrischt (auch bei Marker-Skip) und sofort nach CREATE in setup-test-db gesetzt.
