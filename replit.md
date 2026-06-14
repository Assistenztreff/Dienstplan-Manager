# Dienstplan-App

Eine Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell, orientiert an "Assistenz-Connect".

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API-Server starten (Port 8080, erreichbar über `/api`)
- `pnpm --filter @workspace/dienstplan run dev` — Frontend starten (Port dynamisch, Pfad `/`)
- `pnpm run typecheck` — Vollständiger Typecheck über alle Pakete
- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright-E2E-Tests (API-Server + Frontend müssen laufen; nutzt Admin-Login admin@dienstplan.local / admin1234)
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
- **Regionale Feiertage**: In den Einstellungen wählbares Bundesland; die Feiertagsberechnung berücksichtigt dann landesspezifische gesetzliche Feiertage (inkl. beweglicher wie Fronleichnam). Ohne Bundesland gelten nur bundesweite Feiertage. Bundesland-genaue Näherung, keine rückwirkende Neuberechnung bestehender Schichten.

## Multi-Team (Task 42 — Stufe 1: Fundament & Team anlegen)

- **Konto-Typ** auf `users`: `account_type` Enum (`privat` | `dienstleister`, Default `privat`). Privat = einzelner Assistenznehmer; Dienstleister = Verwaltung mehrerer Teams.
- **Tabellen**: `teams` (owner_id → users, cascade) und `team_members` (unique team_id+user_id). Alle Domänen-Tabellen (shifts, contracts, shift_models, time_tracking) haben jetzt `team_id NOT NULL`.
- **Team-CRUD**: `/api/teams` (GET/POST/PATCH/DELETE), strikt owner-scoped (`owner_id = session.userId`). DELETE liefert 409, solange Mitglieder oder Daten am Team hängen.
- **Gating**: Middleware `requireDienstleister` (Admin + accountType `dienstleister`, frisch aus DB gelesen). Frontend: Nav + Route `/team-verwaltung` nur für Dienstleister; Konto-Typ-Umschalter in den Einstellungen (ruft `refreshUser` im Auth-Context).
- **teamId-Injektion**: Helper `resolveTeamId(userId)` (bevorzugt eigenes Team, sonst erste Mitgliedschaft) wird in alle Insert-Handler eingehängt; time_tracking erbt team_id von der verknüpften Schicht.
- **Migration**: `pnpm --filter @workspace/scripts run migrate-teams` (idempotent, läuft in post-merge VOR `db push`). Datentrennung über Teams folgt in Stufe 2/3 (#43 Zuweisung, #44 Wechsler).

## User preferences

- Strikt task-orientiertes Vorgehen: nach jedem Task auf Feedback warten
- Keine Emojis in der App-UI
- Mobil-optimiert (Assistenten nutzen Smartphones)
- Datenbankschema: PostgreSQL mit Drizzle ORM

## Auth (Task 8)

- Session-basierte Authentifizierung mit `express-session` (Cookie: `connect.sid`, 7 Tage)
- Rollen: `admin` (Assistenznehmer, Vollzugriff) und `assistant` (nur eigene Daten)
- Middleware: `requireAuth` (alle eingeloggten), `requireAdmin` (nur Admin)
- Einladungsflow: Admin generiert Token via `POST /api/users/:id/invite`, Assistent setzt Passwort via `/einladung?token=...`
- Erster Admin-User anlegen: `pnpm --filter @workspace/scripts run setup-admin` (Standard: admin@dienstplan.local / admin1234)
- Session-Secret via Umgebungsvariable `SESSION_SECRET` (bereits als Secret gesetzt)

## Gotchas

- Nach jeder Änderung an `lib/api-spec/openapi.yaml` muss Codegen neu ausgeführt werden: `pnpm --filter @workspace/api-spec run codegen`
- Nach DB-Schema-Änderungen: `pnpm --filter @workspace/db run push`
- Zod-Schema-Namen aus `@workspace/api-zod` per grep ermitteln, nicht raten (Orval-Namenskonventionen variieren)
- `useListUsers` für Nicht-Admins gibt 401 zurück (Query-Error, kein UI-Crash) — Daten nur unter `isAdmin`-Bedingung nutzen
- Route-Handler-Pattern: `async (req, res): Promise<void> =>` mit `res.json(); return;` (kein `return res.json()`) — sonst TS7030
- `session`-Tabelle (connect-pg-simple) ist als Drizzle-Schema in `lib/db/src/schema/session.ts` abgebildet, damit `db push` (auch im Post-Merge non-interaktiv) sie NICHT als Datenverlust löschen will. Struktur nicht ändern.
- Mobile: generierte Query-Hooks erwarten `queryKey` im vollen `UseQueryOptions`. Für `enabled` Cast nutzen: Optionen `as Parameters<typeof useXyz>[1]` UND Ergebnis casten (`(rawData ?? []) as Xyz[]`), da der Optionen-Cast die TData-Inferenz auf `{}` reduziert.
- `@workspace/scripts` braucht `pg` als eigene Dependency (Workspace-Pakete teilen Deps nicht implizit)

## Pointers

- Siehe `pnpm-workspace` Skill für Workspace-Struktur, TypeScript-Setup und Paketdetails
