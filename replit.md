# Dienstplan-App

Eine Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell, orientiert an "Assistenz-Connect".

## Architektur (Kern)

- **Single Responsive Web App (PWA)** — EINE React-Codebasis. Bewusst KEINE separate native/Mobile-App. Endgeräte-Anpassung ausschließlich über Tailwind-Breakpoints (`md:`, `lg:` …) in denselben Komponenten; jedes Formular wird einmal gebaut und passt sich responsiv an.
- **Contract-first**: `lib/api-spec/openapi.yaml` ist die Single Source of Truth. Codegen erzeugt daraus React-Query-Hooks (`@workspace/api-client-react`) und Zod-Schemas (`@workspace/api-zod`).
- Express-Routen validieren mit den generierten Zod-Schemas; das Frontend nutzt ausschließlich die generierten Hooks.
- Drizzle ORM mit PostgreSQL — kein Raw-SQL in Routen.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`, erreichbar über `/api`)
- Frontend: React + Vite + Tailwind (`artifacts/dienstplan`, Routing via wouter)
- DB: PostgreSQL + Drizzle ORM; Validation: Zod (`zod/v4`) + drizzle-zod
- API-Codegen: Orval; Build: esbuild (CJS Bundle)

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API-Server (Port 8080, `/api`)
- `pnpm --filter @workspace/dienstplan run dev` — Frontend (Port dynamisch, Pfad `/`)
- `pnpm run typecheck` — Typecheck über alle Pakete
- `pnpm run build` — Typecheck + Build aller Pakete
- `pnpm --filter @workspace/api-spec run codegen` — Hooks + Zod-Schemas neu generieren (nach jeder openapi.yaml-Änderung)
- `pnpm --filter @workspace/db run push` — DB-Schema pushen (nur Dev)
- `pnpm --filter @workspace/scripts run setup-admin` — Ersten Admin anlegen (admin@dienstplan.local / admin1234)
- `pnpm --filter @workspace/scripts run setup-test-db` — Test-DB anlegen/aktualisieren (idempotent, wird von `test:e2e` automatisch aufgerufen)
- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright-E2E gegen **isolierten Test-Stack** (eigener API-Port 8099 + Vite 5199) auf separater Test-DB `<dbname>_test`; Dev-DB wird NICHT berührt. Override via `E2E_BASE_URL=...`.
- Required env: `DATABASE_URL`, `SESSION_SECRET`

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI-Spec (Vertrags-Quelle)
- `lib/db/src/schema/` — Drizzle-Tabellen (users, teams, team_members, contracts, shifts, shift_models, time_tracking, session)
- `lib/entitlements/src/index.ts` — Free/Premium-Config (Single Source, s.u.)
- `artifacts/api-server/src/routes/` — Express-Routen (users, contracts, shifts, time_tracking, dashboard, teams)
- `artifacts/api-server/src/lib/` — `plan.ts` (Plan-Enforcement), `teams.ts`-Helfer, `default-shift-models.ts`
- `artifacts/dienstplan/src/pages/` — React-Seiten
- `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/` — generiert, NICHT manuell editieren

## Product

- **Rollen**: `admin` (Assistenznehmer, Vollzugriff), `assistant` (nur eigene Daten), `superadmin` (Betreiber). `superadmin` wird NICHT über Registrierung/`UserInput` vergeben, nur direkt in der DB.
- **Konto-Typ** (`users.account_type`, `privat` | `dienstleister`): bei Registrierung festgelegt, danach NICHT im UI änderbar (nur direkt in DB). Privat = einzelner Assistenznehmer; Dienstleister = mehrere Teams.
- **Stammdaten**: Assistenten mit Vertragsdaten (Wochenstunden, Urlaubstage, Kontakt).
- **Dienstplan-Kalender**: Monatsansicht. Schichten tragen `planning_status` (VORLAEUFIG = Entwurf, ANGEBOTEN = Vorschlag, FIX = verbindlich; Default-Spalte FIX, neue Schichten im Dialog aber VORLAEUFIG — bewusst entkoppelt). **Nur FIX-Schichten** zählen in Auswertungen und im PDF-Stundennachweis; Entwürfe/Vorschläge bleiben sichtbar, fließen aber nicht in offizielle Stunden ein. Abwesenheiten sind Default-FIX.
- **Standard-Dienste-Seeding**: Neue Nutzer bekommen bei Registrierung 4 Standard-Schichtmodelle (Frühdienst, Spätdienst, 24h Dienst, Bereitschaft). Urlaub/Krankheit sind KEINE Modelle — sie laufen über das Abwesenheits-System.
- **Zeiterfassung**: Ist-Zeiten mit Status (offen / bestätigt / abgelehnt).
- **Auswertungen**: Soll/Ist-Abgleich pro Assistent und Monat.
- **Zuschlags-Einstellungen pro Konto**: `allowance_settings` hat eine Zeile je Admin-Konto (`owner_id` UNIQUE, lazy angelegt mit Defaults 25/50/100, Nachtfenster 23:00–06:00). KEIN globaler Singleton mehr. Auswertungen (hours-balance) und Schicht-Kennzahlen nutzen die Settings des jeweiligen **Team-Eigentümers** (Join teams→allowance_settings über ownerId, Fallback Defaults).
- **Regionale Feiertage**: In den Einstellungen wählbares Bundesland → landesspezifische gesetzliche Feiertage (inkl. beweglicher). Ohne Bundesland nur bundesweite. Keine rückwirkende Neuberechnung bestehender Schichten.
- **Farbkodierung pro Assistenzkraft**: Schicht-Badges/Monats-Punkte werden **nach `userId`** eingefärbt (deterministischer Hash → `lib/shift-model-colors.ts`), nicht nach Schichtart. Abwesenheiten behalten ihre semantische Farbe (Urlaub Gelb, Krankheit Grau). Farbauswahl pro Dienst wurde entfernt; `shift_models.color` bleibt in der DB (Default `slate`, Bestandsdaten unberührt), wird vom Frontend nicht mehr gesendet.
- **24h-Dienst-Hinweis**: Identische Start-/Enduhrzeit an unterschiedlichen Tagen (z. B. 08:00–08:00 Folgetag) oder Legacy-Typ `full_day` → `ShiftBadge` zeigt „24h-Dienst".

## Multi-Team & Datentrennung

- **Erlaubte Teams** eines Nutzers = besessene Teams (`teams.owner_id`) ∪ Mitgliedschaften (`team_members`). Zentrale Helfer in `lib/teams.ts`: `getAllowedTeamIds`, `resolveReadTeamScope` (403 bei fremdem Team), `resolveWriteTeamId` (403/400), `parseTeamIdParam`.
- **Team-CRUD** `/api/teams` (nur `requireDienstleister`, owner-scoped). DELETE liefert 409, solange Daten/Mitglieder hängen. Mitgliedschafts-Endpunkte `/:id/members` (GET/POST/DELETE) mit IDOR-Check `assertTeamOwnership`.
- **Echtes Backend-Scoping** auf allen Domänen-Routen (nicht nur UI):
  - GET-Listen: `inArray(table.teamId, teamScope)`; 403 bei fremdem `teamId`, `[]` bei leerem Scope.
  - POST: Ziel-Team via `resolveWriteTeamId`; `time_tracking` erbt `teamId` von der Schicht. **Member-of-Team-Invariante**: `body.userId` muss Mitglied des Ziel-Teams sein (`isUserMemberOfTeam`), sonst 403 — sonst Leak fremder PII über user-gejointe Antworten. Gilt bei POST shifts/contracts/time_tracking.
  - PATCH/DELETE/GET:id: IDOR — Row-`teamId` muss in `getAllowedTeamIds` liegen, sonst 404.
  - `ShiftUpdate` erlaubt optionales `userId` (Assistenten-Wechsel via Massenbearbeitung) und erzwingt dieselbe Member-Invariante + Überschneidungsprüfung gegen den NEUEN Nutzer; das Team der Schicht bleibt.
  - `GET /users` strikt gescoped (kein globaler Pool). **Bootstrap-Ausnahme nur für `privat`-Konten ohne jedes Team + ohne `teamId`**: Fallback auf globalen Pool (sonst wäre Erst-Einrichtung leer). `dienstleister` bekommen NIE den globalen Pool. `POST /users` ordnet den Nutzer per `teamId` einer Team-Mitgliedschaft zu (KEINE `users`-Spalte → vor Insert strippen), sonst verschwindet er aus gescopten Pickern.
  - Dashboard-Admin-Branch gescoped (optionaler `teamId`); Assistant-Branch bleibt rein userId-personal.
- **Migration**: `pnpm --filter @workspace/scripts run migrate-teams` (idempotent, backfillt `team_members` aus bestehenden Paaren; läuft in post-merge VOR `db push`).
- **`teamId` NOT NULL** auf shifts/contracts/shift_models/time_tracking — jeder Insert (inkl. verstecktem Abwesenheits-Auto-Booking) muss es liefern.
- **Frontend Team-Wechsler**: `context/team.tsx` lädt Teams nur für Dienstleister, persistiert `selectedTeamId` in localStorage; `components/team-switcher.tsx` nur sichtbar für Dienstleister mit ≥1 Team.

## Free/Premium (SaaS-Entitlements)

- **`users.plan`** (`free` | `premium`, Default `free`) wird in allen AuthUser-Responses ausgeliefert (in OpenAPI an `AuthUser` UND `User` required).
- **`@workspace/entitlements`** ist die Single Source of Truth, importiert von Frontend UND API-Server. `PLAN_CONFIG` je Plan: Features (boolean) + Limits (number | null = unbegrenzt). Free: maxAssistants 6, maxTeams 1, maxShiftModels 5, historyMonths 1, nur Basis-Features. Premium: alles. Helfer: `hasAccess`, `getLimit`, `isWithinLimit`, `resolvePlan`, `isPremium`.
- **Serverseitige Durchsetzung ist autoritativ** — Frontend-Gates sind reine UX. `artifacts/api-server/src/lib/plan.ts`: `getUserPlan` liest `users.plan` IMMER frisch aus der DB (manuelle Freischaltung wirkt sofort), plus `userHasFeature`, `userWithinLimit`, Middleware `requirePlanFeature`.
- **Durchgesetzt** (Plan des **Team-Eigentümers** ist maßgeblich, nicht des Anfragers):
  - `maxShiftModels`, `maxAssistants`, `maxTeams` — 403 `plan_limit_reached` beim Anlegen über dem Limit. (Free startet durch die 4 Seeds bewusst unter dem 5er-Limit; Limit MUSS über der Seed-Anzahl bleiben.)
  - `historyMonths` (shifts POST + PATCH-mit-`startTime`) — 403 wenn Kalendermonat mehr als `historyMonths` in der Zukunft liegt. Vergangenheit nie blockiert. PATCH ohne `startTime` frei (kein Move-Forward-Bypass nötig).
  - `bulkEdit` — der Assistenten-Wechsel via `ShiftUpdate.userId` (nur von der Massenbearbeitung) verlangt Premium; Einzel-Edit ohne Nutzerwechsel bleibt frei.
  - `advancedPersonnelFile` (users POST/PATCH) — Lohn-/SV-Felder (birthDate, socialSecurityNumber, taxId, taxClass, healthInsurance, iban) nur Premium; PATCH blockt nur ECHTE Änderungen gegen den DB-Stand.
  - `advancedAnalytics` (`GET /dashboard/hours-balance`) — setzt transitiv `payrollExport` durch (Datenquelle des PDF-Nachweises). `dashboard/summary` bleibt frei.
  - `caregiverLogin` (`POST /users/:id/invite`) — Einladungs-Token für Assistenten-Logins nur Premium. Bestandsschutz: bereits eingeladene Assistenten können sich weiter einloggen.
  - `strictTimeTracking` (`PATCH /time-tracking/:id/confirm`) — Bestätigen/Ablehnen von Ist-Zeiten nur Premium. Free-Einträge bleiben „offen". `dashboard/summary` zählt Ist-Stunden **plan-abhängig**: bestätigte immer; „offene" zusätzlich in Teams, deren **Eigentümer** Free ist (kein Freigabe-Workflow → sonst blieben Free-Ist-Stunden ewig 0). Abgelehnte nie. Helfer `getLenientTimeTrackingTeamIds` in `lib/plan.ts`; gilt für Admin- UND Assistant-Branch. Premium-Teams unverändert strikt (nur bestätigte).
  - **„Offene Zeiteinträge"-Warnung nur bei Freigabe-Workflow**: `warnings.timeTrackingConfirmable` (Dashboard-Summary) ist true, sobald mindestens ein Team im Scope einen Premium-Eigentümer (strictTimeTracking) hat. Bei false (reiner Free-Scope) blendet das Dashboard die Warnung „X offene Zeiterfassungen" aus — „offen" ist dort der Normalzustand, die Stunden zählen bereits; ein To-do wäre irreführend (Bestätigen ist Premium). Produktentscheidung: ausblenden statt umformulieren, kein Upsell im Hinweise-Block. Zähler (`pendingTimeEntries` in Summary UND warnings) sowie KPI-Kachel „Offene Zeiteinträge" bleiben unverändert korrekt; Status-Badge „Offen" in der Zeiterfassung bleibt als faktischer Status stehen (Bestätigen-Buttons haben dort bereits Premium-Tooltips).
  - **Upgrade-Transparenz (kein stilles Schrumpfen)**: Nach Free→Premium fallen alte „offene" Einträge aus den Ist-Stunden, bis sie bestätigt sind (bewusste Produktentscheidung: KEIN Auto-Bestätigen beim Upgrade — Freischaltung passiert direkt in der DB, es gibt keinen Upgrade-Hook, und ungeprüfte Zeiten sollen nicht automatisch offiziell werden). Stattdessen liefert `dashboard/summary` in beiden Branches `uncountedPendingHours`/`uncountedPendingEntries` (pending-Summe des Monats in STRIKTEN Teams; in Free-Teams immer 0). Das Dashboard zeigt daraus einen blauen Hinweis (`UncountedPendingNotice`) mit „Jetzt prüfen"-Link auf `/zeiterfassung?status=pending`; dort erklärt ein Hinweis (nur Admin + Premium + pending-Filter) den Nachbestätigungs-Flow.
  - `calendarSync` (`GET /calendar-export`, `routes/calendar.ts`) — ICS-Export der FIX-Schichten (Assistenten: eigene; Admins: Team-Scope, optional `?teamId=`). Download-Card in `einstellungen.tsx` (`CalendarExportCard`). Zusätzlich **Abo-Feed**: `users.calendar_token` (unique, nullable) authentifiziert die öffentliche Feed-URL `GET /calendar-feed/:token` (Session-Cookies funktionieren in Kalender-Clients nicht; Premium-Gate über den Token-EIGENTÜMER, 404 bei unbekanntem/widerrufenem Token, kein `teamId`-Param — immer voller erlaubter Scope). Token-Verwaltung: `GET/POST /calendar-token` (Premium; POST rotiert = alter Link sofort ungültig), `DELETE /calendar-token` bewusst OHNE Plan-Gate (Widerruf muss auch nach Downgrade möglich sein). UI in derselben Card: Abo-URL kopieren, Link erneuern, widerrufen.
- **Frontend-Gates** (reine UX, `PLAN_FEATURE_MESSAGES`/`planFeatureMessage` in `lib/api-error.ts`): PDF-Nachweis-Buttons (assistenten.tsx, auswertungen.tsx), Einladen-Button + InviteDialog, Zeiterfassungs-Bestätigen/Ablehnen, Kalender-Export-Card.
- **payrollExport** hat keinen eigenen Endpunkt — serverseitig transitiv über `hours-balance` (advancedAnalytics) durchgesetzt; im Frontend eigenständig gegated.
- **VERBINDLICHE REGEL — Bestandsschutz**: Free-Limits beschränken AUSSCHLIESSLICH das Anlegen von NEUEM / neue Aktionen. Bereits vorhandene Daten (Teams, Lohndaten, geplante/vergangene Monate, Schichtmodelle) dürfen NIEMALS ausgeblendet, gesperrt oder gelöscht werden, nur weil ein Konto Free ist. `isWithinLimit` prüft, ob ein WEITERER Eintrag erlaubt ist — es ist KEIN Anzeige-Filter.
- **Billing/Architektur** (Kommentare in `entitlements.ts`): Auth ist hybrid (Plattform-SSO via JWT + lokal E-Mail/Passwort/Einladung). Abrechnung über **Lexware API** (Rechnungsentwürfe), NICHT Stripe; Premium-Freischaltung erfolgt **manuell** im Operator-Dashboard nach Zahlungseingang.
- **Upgrade-Weg im Frontend**: `/preise` (`pages/preise.tsx`, Route nur `admin`) zeigt den Free/Premium-Vergleich DIREKT aus `PLAN_CONFIG` + CTA „Upgrade per E-Mail anfragen" (mailto an `UPGRADE_CONTACT_EMAIL` in `preise.tsx`, vorausgefüllt mit Kontodaten — kein Self-Service-Checkout, passend zur manuellen Freischaltung). Alle Free-Limit-Hinweise nutzen `components/plan-limit-banner.tsx` (gelber Kasten + Link „Preise & Premium ansehen"); der Vorausplanungs-Toast im Dienstplan hat eine „Zu Premium"-Action.

## Auth

- Session-basiert mit `express-session` (Cookie `connect.sid`, 7 Tage). Middleware: `requireAuth`, `requireAdmin`, `requireDienstleister` (Admin + `dienstleister`, frisch aus DB gelesen).
- **Registrierung** (Self-Service, public): `/registrierung` → `POST /api/auth/register` (`{name, email, password, accountType}`) legt einen **Admin** mit gewähltem `accountType` an, erzeugt ein initiales „Standard-Team" (owner + Mitgliedschaft) und meldet direkt an. Konto-Typ ist danach fixiert.
- **Einladungsflow**: Admin generiert Token via `POST /api/users/:id/invite`, Assistent setzt Passwort via `/einladung?token=...`.
- **Passwort vergessen**: öffentliche Seite `/passwort-vergessen` (kein E-Mail-Self-Service, verweist auf Admin).
- **Selbst-Profil**: `POST /api/auth/change-password` und `POST /api/auth/update-profile` (session-scoped; E-Mail normalisiert, 409 bei Kollision).
- **Logout**: `POST /api/auth/logout` (via `useAuth().logout` in `context/auth.tsx`) leert Session + lokalen Cache; `App.tsx` leitet bei `!currentUser` automatisch nach `/login` (Abmelden-Button in Desktop-Pille und Mobile-Drawer, `layout.tsx`).
- **PUBLIC_PATHS**: `/login`, `/registrierung`, `/einladung`, `/passwort-vergessen`.
- **Dev-Auto-Login**: In Vite-DEV feuert `bootstrap()` bei 401 automatisch `POST /api/auth/dev-login` → man ist sofort als Admin eingeloggt. Folge: öffentliche Seiten (Registrierung/Login-Formular) sind im Dev-Vorschaufenster nicht sichtbar, funktionieren aber im Prod-Build und per API. Dev-Session-Cache (`assistenz_treff_session`, nur `import.meta.env.DEV`) speichert NUR das nicht-sensible Profil; Cookie bleibt die Wahrheit.

## Operator-Dashboard & superadmin

- `pages/operator-dashboard.tsx`: interne Betreiber-Konsole. Bereich 1 (Nutzer-Monitoring + manuelle Premium-Freischaltung) ist LIVE angebunden; Lexware-Buchungs-Log und Fehler-Tracking bleiben Platzhalter.
- **Serverseitige Autorisierung**: `requireSuperadmin`-Middleware (`middleware/auth.ts`, Rolle frisch aus DB — analog `requireDienstleister`) schützt alle `/api/operator/*`-Endpunkte. Admin/Assistant → 403, unauthentifiziert → 401. Frontend-Guard (`role === "superadmin"` in App.tsx) ist reine UX.
- **Operator-Endpunkte** (`routes/operator.ts`): `GET /operator/accounts` (alle Admin-Konten plattformweit mit Team-/Assistenten-Aggregaten), `PATCH /operator/accounts/:id/plan` (`{plan: free|premium}`). Plan-Flip wirkt sofort, da `getUserPlan` frisch liest. Ziel muss Rolle `admin` haben (sonst 404) — nur Admin-Konten sind zahlende Konten.
- Zugang: Route `/operator-dashboard` nur bei `role === "superadmin"`; versteckter Link im Footer-Platzhalter. `superadmin` wird weiterhin NUR direkt in der DB vergeben.

## PWA & Plattform-Einbettung (iframe)

- **PWA-Meta-Tags** in `artifacts/dienstplan/index.html` (mobile-web-app-capable, apple-*, theme-color) für Homescreen-Installation. Noch KEIN Web-App-Manifest / Service Worker.
- Die App wird per `<iframe>` unter „Connect" in die externe AssistenzTreff-Plattform (Symfony) eingebettet; eigene Postgres-DB bleibt.
- **Cross-Site-Cookie**: In Produktion (oder `SESSION_COOKIE_CROSS_SITE=1`) setzt der API-Server das Session-Cookie `SameSite=None; Secure` — sonst wird es im fremden iframe-Origin nicht mitgesendet und der Login schlägt still fehl. Lokal/Dev bleibt `Lax`. Ggf. `Partitioned`/CHIPS nachrüsten, falls Chrome 3rd-party-Cookies blockt.
- **Embed-Modus** `?embed=1` (gemerkt in sessionStorage, `src/lib/embed.ts`): `layout.tsx` blendet die Plattform-Platzhalter (Header/Footer) aus. Keine `window.top`-Auto-Erkennung (Replit-Vorschau ist selbst ein iframe).
- **Plattformseite** (nicht im Repo): iframe-URL inkl. `?embed=1` einsetzen; Deploy-Domain in `nelmio_security.yaml` unter `frame-src` (enforce UND report) eintragen, sonst blockt die CSP den iframe.

## Layout & UI

- `components/layout.tsx`: Plattform-Header/-Footer sind Platzhalter (im Embed ausgeblendet). App-Sub-Navigation bleibt immer sichtbar; responsiv (Mobile-Drawer < md, zentrierte Pillen ab md). Abmelden-Button in beiden Varianten.
- Firmenlogo-Upload (`einstellungen.tsx` `LogoSettingsCard`) nur für `dienstleister`; Privat-Konten nutzen das Standard-Logo.
- Logo-Assets: blauer Schriftzug (`attached_assets/20260626_094418_0000_1782459883949.png`) auf hellem Grund (Login, Einladung, PDF); weißes Logo bleibt in dunklen Kontexten.

## Gotchas

- Nach `openapi.yaml`-Änderung: Codegen laufen lassen. Nach Schema-Änderung: `db push`.
- Nach Codegen/`db push` den laufenden API-Server neu starten — sonst nutzt er stale Zod/Drizzle-Schemas und strippt neue Felder still.
- Zod-Schema-Namen aus `@workspace/api-zod` per grep ermitteln, nicht raten (Orval-Namenskonventionen variieren).
- `useListUsers` gibt für Nicht-Admins 401 (Query-Error, kein Crash) — Daten nur unter `isAdmin` nutzen.
- Route-Handler-Pattern: `async (req, res): Promise<void> =>` mit `res.json(); return;` (kein `return res.json()`) — sonst TS7030.
- `session`-Tabelle (connect-pg-simple) ist als Drizzle-Schema (`lib/db/src/schema/session.ts`) abgebildet, damit `db push` sie nicht als Datenverlust löschen will. Struktur nicht ändern.
- `@workspace/scripts` braucht `pg` als eigene Dependency (Workspace-Pakete teilen Deps nicht implizit).
- Bodyless POSTs (z. B. Dev-Login) lassen `req.body` undefined — mit `?? {}` destrukturieren.

## User preferences

- Strikt task-orientiertes Vorgehen: nach jedem Task auf Feedback warten
- Keine Emojis in der App-UI
- Responsive PWA (eine Codebasis für Desktop und Smartphone, keine separate native App)
- Datenbankschema: PostgreSQL mit Drizzle ORM

## Pointers

- Siehe `pnpm-workspace` Skill für Workspace-Struktur, TypeScript-Setup und Paketdetails.
