---
name: Drei-Datenbanken-Architektur
description: Das Projekt hat drei separate PostgreSQL-Datenbanken mit unterschiedlichen Rollen — kritisch für Scripts und Datenmigration.
---

# Drei-Datenbanken-Architektur

## Die drei Datenbanken

1. **Replit Dev DB** (lokale managed Postgres)
   - Zugriff: `DATABASE_URL` (vor APP_DATABASE_URL-Override, d.h. WITHOUT normalize-db-url)
   - `executeSql({ environment: "development" })` nutzt diese DB
   - Enthält lokale Entwicklungsdaten

2. **Replit Prod DB** (Replit-verwaltetes PostgreSQL in Production)
   - `executeSql({ environment: "production" })` nutzt diese DB — aber READ-ONLY
   - Deployed App nutzt diese DB über DATABASE_URL (in production-Umgebung, bevor resolveDatabaseUrl PROD_DATABASE_URL bevorzugt)
   - Nicht direkt schreibbar aus dem Workspace — nur via Replit-DB-Pane UI oder production API

3. **Scaleway externe DBs** (APP_DATABASE_URL + PROD_DATABASE_URL)
   - `APP_DATABASE_URL` → Scaleway Staging-DB
   - `PROD_DATABASE_URL` → Scaleway Prod-DB
   - **Beide teilen denselben Host** — unterscheiden sich nur im Datenbanknamen
   - Dev-Server (artifacts/api-server in dev) nutzt APP_DATABASE_URL (via normalize-db-url)
   - Scripts im Workspace (die normalize-db-url importieren) schreiben in APP_DATABASE_URL (Staging), NICHT in Replit Prod DB

**Why:** normalize-db-url überschreibt DATABASE_URL mit APP_DATABASE_URL. Scripts die normalize-db-url importieren, schreiben daher in Scaleway Staging, NICHT in die lokale Dev DB oder Replit Prod DB.

**How to apply:**
- Um lokale Dev DB zu nutzen: DATABASE_URL direkt verwenden, OHNE normalize-db-url zu importieren
- Um Replit Prod DB zu schreiben: Nur via DB-Pane in Replit UI oder via production API (nicht direkt aus scripts)
- assertNotProdDb() vergleicht DATABASE_URL mit PROD_DATABASE_URL via `hostname:port/dbname` — Hostname allein reicht nicht, da Staging und Prod denselben Host teilen
