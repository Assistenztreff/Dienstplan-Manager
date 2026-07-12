# Dienstplan-App

Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell.

## User preferences

- (keine)

## Architektur & Stack

- **Single Responsive Web App (PWA)** — EINE React-Codebasis, bewusst KEINE native App; Geräteanpassung nur über Tailwind-Breakpoints.
- **Contract-first**: `lib/api-spec/openapi.yaml` ist Single Source of Truth. Orval-Codegen → React-Query-Hooks (`@workspace/api-client-react`) + Zod-Schemas (`@workspace/api-zod`). Routen validieren mit den generierten Zod-Schemas; Frontend nutzt NUR die generierten Hooks. Generierte Verzeichnisse NICHT manuell editieren.
- pnpm workspaces, Node.js 24, TS 5.9. API: Express 5 (`artifacts/api-server`, `/api`, Port 8080). Frontend: React + Vite + Tailwind (`artifacts/dienstplan`, wouter). DB: PostgreSQL + Drizzle (`lib/db`, kein Raw-SQL in Routen); Zod (`zod/v4`) + drizzle-zod; Build esbuild (CJS).

## Betrieb (Befehle & Env)

- Dev: `pnpm --filter @workspace/api-server run dev` / `... @workspace/dienstplan run dev`; `pnpm run typecheck`; `pnpm run build`.
- Nach openapi.yaml-Änderung: `pnpm --filter @workspace/api-spec run codegen`. DB-Push (nur Dev): `pnpm --filter @workspace/db run push`.
- Skripte via `pnpm --filter @workspace/scripts run <name>`:
  - `setup-admin` — erster Admin (admin@dienstplan.local / admin1234).
  - `setup-superadmin -- <email> <passwort> [name]` — Betreiber-Konto (idempotent; alternativ Env `SUPERADMIN_*`; min. 8 Zeichen; Befördern eines BESTEHENDEN Kontos nur mit `--promote`/`SUPERADMIN_ALLOW_PROMOTE=1`, Passwort bleibt).
  - `migrate-teams` — idempotent, läuft in post-merge VOR `db push`.
- Required env: `DATABASE_URL`, `SESSION_SECRET`. Optional: `RESEND_API_KEY`, `ERROR_ALERT_EMAIL`, `ERROR_ALERT_FROM` (Warn-Mails).

## Produktregeln

- **Rollen**: `admin` (Assistenznehmer, Vollzugriff), `assistant` (nur eigene Daten), `superadmin` (Betreiber; NUR per DB/Skript, nie über Registrierung; nutzt die App wie ein Admin via `isAdminLikeRole`/`isAdminRole`, plus Operator-Dashboard). `requireDienstleister` bleibt an `account_type` gebunden.
- **Konto-Typ** (`users.account_type`, `privat` | `dienstleister`): bei Registrierung fixiert, danach NICHT im UI änderbar. Privat = einzelner Assistenznehmer; Dienstleister = mehrere Teams.
- **Dienstplan-Kalender** (Monatsansicht): `planning_status` VORLAEUFIG / ANGEBOTEN / FIX. DB-Default FIX, neue Schichten im Dialog aber VORLAEUFIG (bewusst entkoppelt). **Nur FIX-Schichten zählen** in Auswertungen und PDF. Abwesenheiten Default-FIX. Bestätigen einzeln oder monatsweise (PATCH `planningStatus: FIX` + `force: true`).
- **Schichtmodelle statt Arbeitszeit-Vorlagen**: KEINE separaten Vorlagen mehr — das Schichtmodell (`shift_models`) trägt selbst `default_start_time`/`default_end_time` (HH:MM) + `default_weekdays` (int[] 1–7, Mo=1). Der Schicht-Dialog füllt Start/Ende aus dem Modell vor; bei Bulk-Anlage werden Modell-Wochentage als Hinweis abgeglichen (`weekdayMismatchDates`), Anlegen an „unpassenden" Tagen bleibt erlaubt. „+ Neuen Dienst" für Free UND Premium sichtbar (Limit greift erst beim Speichern).
- **Standard-Dienste-Seeding**: Registrierung legt 5 Modelle an (`default-shift-models.ts`: Frühdienst, Spätdienst, Nachtdienst, Bereitschaft, 24h Dienst) inkl. Standard-Zeiten + Wochentagen. Urlaub/Krankheit sind KEINE Modelle (eigenes Abwesenheits-System).
- **Vergütungstyp pro Dienst** (`shift_models.compensation_type`: `regular` | `percentage` | `flat`): `regular` = Stundenlohn × IST-Stunden; `percentage` = Stundenlohn × IST-Stunden × `compensation_percent`/100; `flat` = fester Betrag `compensation_flat_cents` (unabhängig von Stunden). Steuert die Geld-Berechnung der Lohnauswertung.
- **Zeiterfassung**: Ist-Zeiten (offen/bestätigt/abgelehnt). Schalter „Stundenzettel automatisch genehmigen" (`allowance_settings.auto_approve_timesheets`, admin-/team-seitig): neu erfasste IST-Zeiten werden dann sofort als bestätigt gebucht. **Auswertungen**: Soll/Ist je Assistent & Monat.
- **Zuschläge STRIKT aus IST**: Die Zuschlags-**Vergütung** (Nacht/Sonntag/Feiertag) wird ausschließlich aus **bestätigten IST-Stunden** berechnet, nie aus der Soll-Planung; ohne bestätigte IST-Zeit kein Zuschlag. (Die reinen Zuschlags-Stundenkennzahlen folgen weiterhin dem `billingMethod`-Toggle SOLL/IST.)
- **Premium-Lohnauswertung** (`GET /dashboard/hours-balance`, Param `hourlyWage`): Geldwerte IMMER IST-basiert. Grundvergütung je Eintrag nach `compensationType`; Zuschlags-Vergütung = Zuschlagsstunden × Stundenlohn auf den dynamischen IST-Sätzen. `HoursBalanceRow` liefert `hourlyWage`, `basePay`, `night|sunday|holidaySurchargePay`, `totalPay` (Cent). **0%-Zuschläge werden NICHT aufgelistet** (UI `auswertungen.tsx` + PDF `pdf-export.ts` filtern `percent>0`).
- **Zuschlags-Sätze** (`allowance_settings`): eine Konto-Zeile je Admin (`team_id IS NULL`, lazy, Defaults 25/50/100, Nachtfenster 23–06 Uhr) + optional EINE Override-Zeile je Team (`team_id` UNIQUE). Fallback-Kette: **Team-Override → Konto des Team-Eigentümers → Defaults**; bei `teamId`-Filter zeigen die Prozente die angewandten Team-Sätze. API `?teamId=` nur für eigene Teams (403); UI nur Dienstleister.
- **Urlaub stundenbasiert**: 1 Tag = 8 h (`hoursPerDay`); ein 24h-Urlaubsdienst zählt 24/8 = **3,0 Tage**. `contracts.vacationHoursUsed` ist der maßgebliche Zähler; Methode `bwavg` (Durchschnitt) oder `factor`. `GET /contracts/:id/vacation-balance` liefert Stunden UND abgeleitete Tage (`vacationDaysUsed = vacationHoursUsed / hoursPerDay`). UI zeigt überall **Tage = Stunden / 8** (Dashboard `AssistantVacationCard`; Resturlaub-Liste `abwesenheiten.tsx`: bei Vertrag `vacationHoursUsed/8`, ohne Vertrag Fallback = geplante Urlaubs-Schichten des Jahres). `vacationHoursUsed` MUSS im `CONTRACT_SELECT` der Route stehen, sonst rechnet die UI mit 0.
- **Regionale Feiertage**: wählbares Bundesland (Einstellungen); ohne Bundesland nur bundesweite. Keine rückwirkende Neuberechnung.
- **Farbkodierung nach `userId`** (deterministischer Hash, `lib/shift-model-colors.ts`), nicht nach Schichtart. Abwesenheiten behalten semantische Farben (Urlaub Gelb, Krankheit Grau). `shift_models.color` bleibt in der DB (Default `slate`), Frontend sendet sie nicht.
- **24h-Dienst**: identische Start-/Enduhrzeit über Tagesgrenze oder Legacy `full_day` → `ShiftBadge` zeigt „24h-Dienst".

## Multi-Team & Datentrennung

- **Erlaubte Teams** = besessene (`teams.owner_id`) ∪ Mitgliedschaften (`team_members`); Helfer in `lib/teams.ts`.
- **Team-CRUD** `/api/teams`: nur `requireDienstleister`, owner-scoped; DELETE 409 solange Daten/Mitglieder hängen; Member-Endpunkte mit IDOR-Check `assertTeamOwnership`.
- **Backend-Scoping-Invarianten** (alle Domänen-Routen):
  - GET-Listen: nur Teams im Scope; 403 bei fremdem `teamId`, `[]` bei leerem Scope.
  - POST: Ziel-Team via `resolveWriteTeamId`; `time_tracking` erbt `teamId` von der Schicht. **Member-of-Team-Invariante**: `body.userId` muss Mitglied des Ziel-Teams sein, sonst 403 (PII-Leak) — gilt für POST shifts/contracts/time_tracking.
  - PATCH/DELETE/GET:id: Row-`teamId` muss in `getAllowedTeamIds` liegen, sonst 404 (IDOR).
  - `ShiftUpdate` erlaubt optionales `userId` (Assistenten-Wechsel, nur Massenbearbeitung) mit derselben Member-Invariante + Überschneidungsprüfung gegen den NEUEN Nutzer; Team der Schicht bleibt.
  - `GET /users` strikt gescoped, kein globaler Pool. Einzige Ausnahme: `privat`-Konto ohne jedes Team + ohne `teamId` (Erst-Einrichtung); `dienstleister` NIE. `POST /users` legt via `teamId` eine Mitgliedschaft an (keine `users`-Spalte → vor Insert strippen).
  - Dashboard-Admin-Branch team-gescoped (optionaler `teamId`); Assistant-Branch rein userId-personal.
- **`teamId` NOT NULL** auf shifts/contracts/shift_models/time_tracking — JEDER Insert (inkl. Abwesenheits-Auto-Booking) muss es liefern.
- Frontend: `context/team.tsx` (Teams nur für Dienstleister, `selectedTeamId` in localStorage) + Team-Switcher.

## Free/Premium (Entitlements)

- `users.plan` (`free` | `premium`, Default `free`), in OpenAPI an `AuthUser` UND `User` required.
- **`@workspace/entitlements`** = Single Source of Truth (`PLAN_CONFIG`: Features boolean + Limits number|null=unbegrenzt). Free-Limits: maxAssistants 6, maxTeams 1, maxShiftModels 5 (= Seed-Anzahl; Free startet AM Limit), historyMonths 1.
- **Server autoritativ, Frontend-Gates reine UX.** `getUserPlan` liest IMMER frisch aus der DB (manuelle Freischaltung wirkt sofort). Maßgeblich ist der Plan des **Team-Eigentümers**. Assistenten-Zugang via Arbeitgeber-Plan: `requirePlanFeatureViaTeamOwner` (Owner-Fallback NUR für Rolle assistant, ein Premium-Arbeitgeber genügt).
- **Durchgesetzte Gates** (403 `plan_limit_reached` / `plan_feature_required`):
  - Limits `maxShiftModels`/`maxAssistants`/`maxTeams` beim Anlegen; `historyMonths` bei shifts POST + PATCH-mit-`startTime` (Zukunft blockiert, Vergangenheit nie; PATCH ohne `startTime` frei). Abwesenheiten NICHT gegated.
  - `bulkEdit`: Assistenten-Wechsel via `ShiftUpdate.userId` nur Premium; Einzel-Edit ohne Nutzerwechsel frei.
  - `advancedPersonnelFile` (users POST/PATCH): Lohn-/SV-Felder (birthDate, socialSecurityNumber, taxId, taxClass, healthInsurance, iban) nur Premium; PATCH blockt nur ECHTE Änderungen gegen den DB-Stand.
  - `advancedAnalytics` (`GET /dashboard/hours-balance`) — setzt transitiv `payrollExport` durch (Datenquelle des PDF-Nachweises). `dashboard/summary` bleibt frei.
  - `caregiverLogin` (`POST /users/:id/invite`): Einladungs-Token nur Premium. Bestandsschutz: bereits eingeladene Assistenten loggen sich weiter ein.
  - `absenceTracking`: Frontend-Gate in `abwesenheiten.tsx` (bei Free Upgrade-Hinweis statt „Resturlaub {Jahr}", Bilanz clientseitig) + Server-Gate `GET /contracts/:id/vacation-balance` (`requireAuth` + `requirePlanFeatureViaTeamOwner`). Assistenten dürfen NUR die eigene Bilanz (fremder Vertrag → 404); Zugang hängt am Arbeitgeber-Plan. Dashboard-Karte „Mein Resturlaub" (`AssistantVacationCard`, nur Nicht-Admins): bei Free-Arbeitgeber dezenter Info-Hinweis statt Upgrade-Aufforderung; ohne Vertrag/bei Fehlern still ausgeblendet. Das EINTRAGEN von Urlaub/Krankheit sowie die Rohdaten bleiben für alle Pläne zugänglich (kein Datenverlust bei Upgrade).
  - `strictTimeTracking` (`PATCH /time-tracking/:id/confirm`): Bestätigen/Ablehnen nur Premium. `dashboard/summary` zählt bestätigte IST immer, „offene" zusätzlich in Free-Eigentümer-Teams (`getLenientTimeTrackingTeamIds`), abgelehnte nie. Warnung „offene Zeiteinträge" nur bei Freigabe-Workflow (`warnings.timeTrackingConfirmable`). KEIN Auto-Bestätigen beim Upgrade; `summary` liefert `uncountedPendingHours`/`uncountedPendingEntries` (Dashboard `UncountedPendingNotice` → `/zeiterfassung?status=pending`).
  - `calendarSync` (`routes/calendar.ts`): ICS-Export der FIX-Schichten (`GET /calendar-export`) + öffentlicher Abo-Feed `GET /calendar-feed/:token` (`users.calendar_token` unique/nullable; Premium-Gate über Token-Eigentümer, 404 bei unbekanntem Token). `GET/POST /calendar-token` Premium (POST rotiert); `DELETE` bewusst OHNE Gate (Widerruf auch nach Downgrade). Assistenten-Zugang via Arbeitgeber-Plan (`requirePlanFeatureViaTeamOwner`). `CalendarExportCard` nutzt für Assistenten `GET /calendar-token` als Probe.
- **Frontend-Gates** (`PLAN_FEATURE_MESSAGES` in `lib/api-error.ts`): PDF-Nachweis, Einladen + InviteDialog, Zeiterfassung-Bestätigen, Kalender-Export. Limit-Hinweise: `plan-limit-banner.tsx`.
- **Einfacher Monats-Export** (`basicExport`, auch Free): Button „Monats-PDF" für Admin UND Assistent (`exportSimpleMonthPdf`). Rein aus `GET /shifts`: FIX-Dienste + Abwesenheiten (ganztägig, „1 Tag"), OHNE Zeiterfassung/Soll-Ist/Zuschläge. Eine Seite pro Assistent.
- **VERBINDLICHE REGEL — Bestandsschutz**: Free-Limits beschränken AUSSCHLIESSLICH neues Anlegen. Bestehende Daten (Teams, Lohndaten, geplante/vergangene Monate, Schichtmodelle) NIEMALS ausblenden/sperren/löschen nur wegen Free. `isWithinLimit` ist KEIN Anzeige-Filter.
- **Billing**: Lexware API (Rechnungsentwürfe), NICHT Stripe; Premium-Freischaltung manuell im Operator-Dashboard. Upgrade-Weg: `/preise` (nur `admin`) rendert den Vergleich aus `PLAN_CONFIG`, CTA = mailto (`UPGRADE_CONTACT_EMAIL`) — kein Self-Service-Checkout.

## Auth

- Session-basiert (`express-session`, Cookie `connect.sid`, 7 Tage). Middleware `requireAuth` / `requireAdmin` / `requireDienstleister` / `requireSuperadmin` — Rollen/Typ jeweils frisch aus DB.
- **Registrierung** (public): `/registrierung` → `POST /api/auth/register` legt einen Admin mit gewähltem `accountType` an, erzeugt „Standard-Team" (owner + Mitgliedschaft), meldet direkt an.
- **Einladungsflow**: `POST /api/users/:id/invite` → Passwort via `/einladung?token=...`. **Passwort vergessen**: `/passwort-vergessen` verweist auf den Admin (kein E-Mail-Self-Service).
- **Selbst-Profil**: `POST /api/auth/change-password` / `update-profile` (E-Mail normalisiert, 409 bei Kollision). **Logout**: `POST /api/auth/logout`.
- **PUBLIC_PATHS**: `/login`, `/registrierung`, `/einladung`, `/passwort-vergessen`.
- **Dev-Auto-Login**: In Vite-DEV feuert die App bei 401 automatisch `POST /api/auth/dev-login` (öffentliche Seiten daher in Dev-Vorschau nicht sichtbar, im Prod-Build schon). Dev-Session-Cache (`assistenz_treff_session`, nur DEV) speichert NUR das nicht-sensible Profil; Cookie bleibt die Wahrheit.

## Operator-Dashboard & superadmin

- `/operator-dashboard` (nur `role === "superadmin"`, Frontend-Guard = UX; versteckter Footer-Link): Nutzer-Monitoring, Premium-Freischaltung, Fehler-Tracking, Lexware-Buchungs-Log. Serverseitig schützt `requireSuperadmin` alle `/api/operator/*` (Admin/Assistant → 403, unauthentifiziert → 401).
- **Endpunkte**: `GET /operator/accounts` (Admin-Konten mit Aggregaten), `PATCH /operator/accounts/:id/plan` (`{plan, note?}`; Ziel muss Rolle `admin` haben, sonst 404; Plan-Flip wirkt sofort).
- **Plan-Audit-Log**: jeder Plan-Flip (auch No-Op) append-only in `plan_changes` (Konto, alt/neu, superadmin, Zeitstempel, optionale `note` ≤500 Zeichen). `GET /operator/plan-changes?limit=` (Default 50, max 200).
- **Fehler-Tracking**: zentraler Express-Error-Handler (`app.ts`, ganz am Ende) antwortet 500-JSON ohne Details, persistiert via `recordPlatformError` in `platform_errors`:
  - Bündelung gleiche Meldung+Kontext = EINE Zeile (Upsert ohne UNIQUE-Index; Wiederauftreten erhöht `count`, setzt `last_seen_at`, `resolved=false`).
  - Retention 500 zuletzt aufgetretene (`PLATFORM_ERRORS_MAX_STORED`); `GET /operator/errors?limit=` → `{errors, totalStored, retentionLimit}`. Abhaken via `PATCH /operator/errors/:id`; Sammel-Abhaken `POST /operator/errors/resolve-all`. Dev-Route `GET /api/dev/boom` (nur NODE_ENV≠production).
- **Warn-E-Mail bei Level error** (Resend, fire-and-forget, wirft NIE): ohne `RESEND_API_KEY` Skip. Empfänger `ERROR_ALERT_EMAIL` (Fallback erster superadmin), Absender `ERROR_ALERT_FROM` (Fallback onboarding@resend.dev). Drosselung 15 min pro Meldung+Kontext. Bei Absender-Ablehnung (403/422) EINMAL Testabsender-Retry. Shared Env: `ERROR_ALERT_FROM=alerts@mail.assistenztreff.de`, `ERROR_ALERT_EMAIL=kontakt@assistenztreff.de`.
- **Lexware-Buchungs-Log (Dummy mit Adapter)**: echte Anbindung verschoben bis DB-Migration auf deutschen Server. `GET /operator/lexware/bookings` liefert `{source: "demo"|"live", bookings}`. Adapter `LexwareClient` (`lib/lexware.ts`): ohne `LEXWARE_API_KEY` → `MockLexwareClient` (`source: "demo"`); mit gesetztem Key wirft `getLexwareClient()` bewusst LAUT (echter Client noch nicht implementiert). Späterer Umbau = nur Adapter-Tausch; Frontend/OpenAPI bleiben. Badge „Demo-Daten" nur bei `source === "demo"`.

## PWA & Plattform-Einbettung (iframe)

- PWA-Meta-Tags in `index.html`; noch KEIN Manifest/Service Worker. Einbettung per `<iframe>` in die AssistenzTreff-Plattform (Symfony); eigene Postgres-DB bleibt.
- **Cross-Site-Cookie**: in Produktion (oder `SESSION_COOKIE_CROSS_SITE=1`) `SameSite=None; Secure` — sonst schlägt der Login im fremden iframe-Origin still fehl. Lokal/Dev `Lax`.
- **Embed-Modus** `?embed=1` (sessionStorage): blendet Plattform-Platzhalter aus. Keine `window.top`-Auto-Erkennung. Plattformseite (nicht im Repo): iframe-URL mit `?embed=1`; Deploy-Domain in `nelmio_security.yaml` unter `frame-src`.

## Tests & Dev-Testkonten

- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright gegen **isolierten Test-Stack** (API 8099 + Vite 5199, DB `<dbname>_test`); Dev-DB unberührt. Beim Config-Load laufen automatisch `setup-test-db`, dann `verify-account-separation` (~20s) und `verify-test-db-cleanup` (Selbstheilungs-Nachweis); jeder Fehlschlag bricht ab. Skips: `E2E_SKIP_SEPARATION_CHECK=1`, `E2E_SKIP_CLEANUP_CHECK=1`, `E2E_SKIP_DB_SETUP=1`, `E2E_BASE_URL`. Test-Konten MÜSSEN dem Muster `e2e.*@dienstplan.test` folgen (`cleanup-test-accounts` räumt vor/nach jedem Lauf). Waisen-Prozesse abgebrochener Läufe (Ports 8099/5199) werden beim Config-Load automatisch erkannt und beendet (lsof + SIGTERM/SIGKILL) — kein manuelles `kill` mehr nötig.
- Skripte: `setup-test-db` (Test-DB idempotent); `verify-account-separation` (Regressionscheck 7/5/5 aktive Assistenten, heilt Schema, räumt auf); `verify-test-db-cleanup` (Selbstheilungs-Beweis; FK-Wächter: neue team-gebundene Tabellen → `TEAM_BOUND_TABLES` in `scripts/src/lib/account-tree.ts`). Retention-Regressionstest `platform-errors.retention.test.ts` (provisioniert sich selbst) + Seed-Skript `seed-platform-errors`.

### Dev-Testkonten (nur Dev-DB)

- Neuaufsetzen: `setup-test-accounts` (idempotent). `migrate-teams` fügt Nutzer mit bestehender Mitgliedschaft NICHT in Team 1 ein (Bootstrap-Semantik).
- **Oliver Straub** `admin@dienstplan.local` — admin, privat, **premium**. „Standard-Team": 7 reale Assistenzkräfte inkl. Personalakten, Schichten, Verträge, 5 Modelle.
- **Betreiber** `betreiber@dienstplan.local` — superadmin, privat, **free**. „Betreiber-Team": Max Mustermann 1–4 + Test-Assistent.
- **Test-Dienstleister** `dienstleister@dienstplan.local` — admin, dienstleister, **premium**. „Dienstleister-Team": Max Mustermann 5–9.
- **Test-Assistent** `assistent@dienstplan.local` — assistant, NUR im Betreiber-Team (Free-Eigentümer → Free-Gates greifen). Für Arbeitgeber-Plan-Features Betreiber temporär auf premium.
- Dummys (max.mustermannN@dienstplan.local): kein Passwort, keine Premium-Lohndaten. Dummys + Test-Assistent: Vertrag 30h/30 Urlaubstage ab 2026-01-01.
