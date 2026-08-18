---
name: Automatischer Prod-Schema-Guard beim Publish
description: Deployment-postBuild bricht Veröffentlichungen bei Schema-Drift zur Scaleway-Prod-DB fail-closed ab.
---

**Rule:** Jede Veröffentlichung läuft durch einen read-only Schema-Drift-Check gegen die Prod-DB (Deployment-postBuild). Er ist fail-closed und muss dieselben effektiven Credentials wie die Laufzeit nutzen — insbesondere die SCALEWAY_DB_PASSWORD-Rotation via `applyRotatedDbPassword`, sonst blockiert der Guard nach einer Passwort-Rotation jede Veröffentlichung.

**Why:** Die Prod-DB ist eine externe Scaleway-Postgres — Replits Publish-Zeit-Schema-Abgleich greift nicht; eine nie migrierte Spalte hat den Prod-Login komplett gebrochen, weil der manuelle `check-prod-schema`-Schritt vergessen wurde.

**How to apply:** Drift gemeldet → erst `migrate-prod -- --yes <dbname>`, dann erneut veröffentlichen (Schema zuerst, Code danach). Notausstieg nur für Publishes OHNE Schemaänderungen: Deployment-Env `SKIP_PROD_SCHEMA_CHECK=1`.
