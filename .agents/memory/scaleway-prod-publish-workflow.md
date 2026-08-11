---
name: Scaleway Prod-DB & Publish-Workflow
description: Welche DB ist Produktion, wie wurde sie befüllt, und wie läuft ein sicherer Publish ab.
---

## Die drei Datenbanken

| Name | Host | Wer nutzt sie |
|---|---|---|
| **heliumdb** (`DATABASE_URL`, `postgresql://postgres:password@helium/heliumdb`) | Replit-intern | Dev-Vorschau (Replit-Workspace) + `executeSql(production)` |
| **Scaleway** (`PROD_DATABASE_URL`, `51.158.116.70:11527/dienstplan-app-assitreff`) | Scaleway extern | Deployed/Published App |
| APP_DATABASE_URL (`100.64.0.3:5432`) | Replit-intern | Staging/Test — nur noch für E2E und migrate-prod-Guard |

**heliumdb = einzige Quelle der echten Nutzdaten** (21 User, 112 Dienste, 17 Verträge nach Stand Aug 2026).

**Why:** Im Aug 2026 war Scaleway leer (nur 3 Seed-User). Echte Daten wurden einmalig via `pg_dump DATABASE_URL | psql PROD_DATABASE_URL` migriert. Scaleway-Admin hat kein SUPERUSER (kein `session_replication_role`, kein `DISABLE TRIGGER ALL`) — TRUNCATE CASCADE + COPY in FK-Reihenfolge funktioniert aber.

## Publish-Sicherheitsregel

**Ein Replit-Republish überschreibt NIEMALS Produktionsdaten** — nur Code wird deployed. Kein Seed-Skript, kein `db push` läuft automatisch gegen Scaleway.

## Schema-Check vor Publish

```bash
pnpm --filter @workspace/scripts run check-prod-schema
# (= migrate-prod ohne --yes, Dry-Run, ändert NICHTS)
```

- „No changes detected" → direkt republishen
- Statements gelistet → erst `migrate-prod -- --yes dienstplan-app-assitreff` ausführen, dann republishen

## Pflicht: Warnung bei neuen DB-Spalten

Wenn eine Aufgabe neue Spalten/Tabellen in `lib/db/src/schema.ts` einführt, **am Ende explizit melden**:

> ⚠️ Diese Änderung fügt neue Datenbankspalten hinzu — vor dem nächsten Publish `check-prod-schema` ausführen und ggf. `migrate-prod` anwenden.

Nie stillschweigend übergehen.

## Admin-Account auf Scaleway

`admin@dienstplan.local` (id=5) → `role=superadmin`, `account_type=dienstleister`
(muss nach jeder kompletten Datenmigration erneut gesetzt werden)

**How to apply:** Nach jedem pg_dump/restore auf Scaleway:
```sql
UPDATE users SET role = 'superadmin', account_type = 'dienstleister'
WHERE email = 'admin@dienstplan.local';
```
