---
name: Drei-Datenbanken-Architektur
description: Das Projekt hat drei separate PostgreSQL-Datenbanken mit unterschiedlichen Rollen — kritisch für Scripts und Datenmigration.
---

# Drei-Datenbanken-Architektur

## Die drei Datenbanken

1. **Replit Dev DB** (`heliumdb` auf localhost)
   - Zugriff: `DATABASE_URL` (vor APP_DATABASE_URL-Override, d.h. WITHOUT normalize-db-url)
   - `executeSql({ environment: "development" })` nutzt diese DB
   - Enthält die echten Produktionsdaten des Nutzers (admin@dienstplan.local, 7 echte Assistenzkräfte, 71 Dienste bis August 2026)
   - Die Staging-Quelle für Datenmigration

2. **Replit Prod DB** (Replit-verwaltetes PostgreSQL in Production)
   - `executeSql({ environment: "production" })` nutzt diese DB — aber READ-ONLY
   - Nutzt dieselben User-IDs wie heliumdb (admin@dienstplan.local = ID 5, Team = 1, Assistenten = IDs 2,3,4,7,24,26,28)
   - Deployed App nutzt diese DB über DATABASE_URL (in production-Umgebung, bevor resolveDatabaseUrl PROD_DATABASE_URL bevorzugt)
   - Nicht direkt schreibbar aus dem Workspace — nur via Replit-DB-Pane UI oder production API

3. **Scaleway externe DBs** (APP_DATABASE_URL + PROD_DATABASE_URL)
   - `APP_DATABASE_URL` → `dienstplan-app-staging` (Host 100.64.0.3)
   - `PROD_DATABASE_URL` → `dienstplan-app-assitreff` (Host 100.64.0.3)
   - Dev-Server (artifacts/api-server in dev) nutzt APP_DATABASE_URL (via normalize-db-url)
   - Enthält ANDERE Daten als heliumdb/Replit Prod DB
   - Scripts im Workspace (die normalize-db-url importieren) schreiben in APP_DATABASE_URL, NICHT in Replit Prod DB

**Why:** normalize-db-url überschreibt DATABASE_URL mit APP_DATABASE_URL. Scripts die normalize-db-url importieren, schreiben daher in Scaleway (dienstplan-app-staging), NICHT in heliumdb oder Replit Prod DB.

**How to apply:**
- Um Replit Dev DB (heliumdb) zu nutzen: DATABASE_URL direkt verwenden, OHNE normalize-db-url zu importieren
- Um Replit Prod DB zu schreiben: Nur via DB-Pane in Replit UI oder via production API (nicht direkt aus scripts)
- executeSql environment: "production" = Replit Prod DB (read-only aus Script-Sicht)
- executeSql environment: "development" = heliumdb (read-only aus Script-Sicht, aber die eigentliche Staging-Quelle)

## Password-Reset in Prod

Passwort-Reset für admin@dienstplan.local in Prod (Replit Prod DB) muss über:
1. DB-Pane → Production → SQL ausführen: `UPDATE users SET password_hash = '<hash>' WHERE email = 'admin@dienstplan.local';`
2. Oder: API-Calls gegen die deployed production URL
NICHT via Workspace-Scripts (die schreiben in Scaleway/APP_DATABASE_URL).

## Migration heliumdb → Replit Prod DB

SQL-Migration `scripts/src/prod-migration-2026-08-13.sql` enthält:
- Passwort-Reset für admin@dienstplan.local (Passwort: Dienstplan2026!)
- Vertrags-Korrekturen (Romain Appler contract_id=6, Oliver Kennedy contract_id=12)
- 37 fehlende Dienste (3. Juli – 5. August 2026) für Team-ID 1

Diese SQL-Datei im Replit-DB-Pane → Production ausführen.
