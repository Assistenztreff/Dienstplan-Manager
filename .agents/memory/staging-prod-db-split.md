---
name: Staging/Prod-DB-Trennung via APP_DATABASE_URL
description: Wie Dev (Staging-DB) und Deploy (Prod-DB) getrennt sind und welche Fallen der Override hat.
---

- Nach Löschen des DATABASE_URL-Secrets ist DATABASE_URL runtime-managed (Replit-DB) und NICHT als Env-Var überschreibbar. Lösung: eigene Var `APP_DATABASE_URL` mit Vorrang in `resolveDatabaseUrl()` (lib/db/src/database-url.ts).
- **Why:** Dev-Umgebung soll auf die Scaleway-Staging-DB zeigen, Deploy auf die Prod-DB; beide via Env `APP_DATABASE_URL` (development=…-staging, production=…-assitreff), `DATABASE_SSL_NO_VERIFY=1` shared.
- **How to apply:** Jeder Ort, der eine DB-URL liest, muss `resolveDatabaseUrl()` nutzen (lib/db, drizzle.config, scripts/normalize-db-url, playwright.config; Session-Store liest process.env.DATABASE_URL, das lib/db zurückschreibt).
- **Falle:** Jeder Kind-Prozess-Spawn, der `DATABASE_URL` überschreibt (setup-test-db, verify-checks, playwright webServer, e2e-Spec-Spawns, global-teardown), MUSS auch `APP_DATABASE_URL` mit derselben URL setzen — sonst gewinnt der Staging-Override und Test-Skripte treffen die falsche DB (Sicherheitsabbruch "keine _test-DB").
- Die e2e-Test-DB leitet sich jetzt aus Staging ab (`dienstplan-app-staging_test`).
- Verlorene Secrets aus laufenden Alt-Prozessen rekonstruierbar via `/proc/<pid>/environ` (eigene Prozesse), ohne sie auszugeben.
- **Falle "Schema-Drift", die keine ist:** Das Replit-DB-Skill/`executeSql` (environment="development") fragt IMMER die Replit-verwaltete `DATABASE_URL` (hier: `heliumdb`) ab — NICHT die per `APP_DATABASE_URL` überschriebene Scaleway-Staging-DB, die der laufende Dev-Server tatsächlich nutzt. Beide DBs können ähnliche/alte Nutzerdaten enthalten (Verwechslungsgefahr!), aber unterschiedliche Schemas haben (heliumdb bleibt nach `db push`-Läufen zurück). Vor jeder Diagnose "fehlende Spalte/Tabelle" per SQL: erst via `/proc/<pid>/environ` des laufenden Prozesses prüfen, welche DB tatsächlich verwendet wird; bei gesetzter `APP_DATABASE_URL` per Ad-hoc-`tsx`-Skript mit `resolveDatabaseUrl()` (wie in `scaleway-adhoc-script-connection.md`) gegen die ECHTE DB abfragen, nicht `executeSql`.
