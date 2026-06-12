# Dienstplan-App

Eine Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell, orientiert an "Assistenz-Connect".

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API-Server starten (Port 8080, erreichbar über `/api`)
- `pnpm --filter @workspace/dienstplan run dev` — Frontend starten (Port dynamisch, Pfad `/`)
- `pnpm run typecheck` — Vollständiger Typecheck über alle Pakete
- `pnpm run build` — Typecheck + Build aller Pakete
- `pnpm --filter @workspace/api-spec run codegen` — API-Hooks und Zod-Schemas aus OpenAPI-Spec regenerieren
- `pnpm --filter @workspace/db run push` — DB-Schema pushen (nur Dev)
- Required env: `DATABASE_URL` — Postgres-Verbindungsstring

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (artifacts/api-server)
- Frontend: React + Vite + Tailwind (artifacts/dienstplan)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (aus OpenAPI-Spec)
- Build: esbuild (CJS Bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI-Spec (Single Source of Truth für alle API-Verträge)
- `lib/db/src/schema/` — Drizzle-Tabellendefinitionen (users, contracts, shifts, time_tracking)
- `artifacts/api-server/src/routes/` — Express-Routen (users, contracts, shifts, time_tracking, dashboard)
- `artifacts/dienstplan/src/pages/` — React-Seiten (Dashboard, Dienstplan, Assistenten, Zeiterfassung, Auswertungen)
- `lib/api-client-react/src/generated/` — Generierte React-Query-Hooks (nicht manuell editieren)
- `lib/api-zod/src/generated/` — Generierte Zod-Schemas (nicht manuell editieren)

## Architecture decisions

- Contract-first: OpenAPI-Spec zuerst, dann Codegen → Hooks + Zod-Schemas automatisch generiert
- Drizzle ORM mit PostgreSQL — kein Raw-SQL in Routen
- Express-Routen nutzen generierte Zod-Schemas zur Validierung (aus `@workspace/api-zod`)
- Frontend nutzt ausschließlich generierte React-Query-Hooks (aus `@workspace/api-client-react`)
- Shared Express-Backend für alle Frontends (auch zukünftige Expo-App möglich)

## Product

Kernfunktionen (Task 1 — Grundstruktur):
- **Benutzerrollen**: Admin (Assistenznehmer) und Assistent (Mitarbeiter)
- **Stammdaten**: Assistenten mit Vertragsdaten (Wochenstunden, Urlaubstage, Kontaktdaten)
- **Dienstplan-Kalender**: Monatsansicht, Schichttypen: Aktiv, Bereitschaft, Nacht, 24h
- **Zeiterfassung**: Ist-Zeiten eintragen, Status (offen / bestätigt / abgelehnt)
- **Auswertungen**: Soll/Ist-Abgleich pro Assistent und Monat

## User preferences

- Strikt task-orientiertes Vorgehen: nach jedem Task auf Feedback warten
- Keine Emojis in der App-UI
- Mobil-optimiert (Assistenten nutzen Smartphones)
- Datenbankschema: PostgreSQL mit Drizzle ORM

## Gotchas

- Nach jeder Änderung an `lib/api-spec/openapi.yaml` muss Codegen neu ausgeführt werden: `pnpm --filter @workspace/api-spec run codegen`
- Nach DB-Schema-Änderungen: `pnpm --filter @workspace/db run push`
- Zod-Schema-Namen aus `@workspace/api-zod` per grep ermitteln, nicht raten (Orval-Namenskonventionen variieren)

## Pointers

- Siehe `pnpm-workspace` Skill für Workspace-Struktur, TypeScript-Setup und Paketdetails
