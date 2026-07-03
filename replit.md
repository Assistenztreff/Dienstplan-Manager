# Dienstplan-App

Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell (orientiert an "Assistenz-Connect").

## Architektur (Kern)

- **Single Responsive Web App (PWA)** — EINE React-Codebasis, bewusst KEINE separate native App. Endgeräte-Anpassung ausschließlich über Tailwind-Breakpoints in denselben Komponenten.
- **Contract-first**: `lib/api-spec/openapi.yaml` ist Single Source of Truth. Orval-Codegen erzeugt React-Query-Hooks (`@workspace/api-client-react`) und Zod-Schemas (`@workspace/api-zod`). Express-Routen validieren mit den generierten Zod-Schemas; das Frontend nutzt ausschließlich die generierten Hooks.
- Drizzle ORM mit PostgreSQL — kein Raw-SQL in Routen.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`, `/api`, Port 8080) · Frontend: React + Vite + Tailwind (`artifacts/dienstplan`, Routing via wouter)
- DB: PostgreSQL + Drizzle; Validation: Zod (`zod/v4`) + drizzle-zod; Build: esbuild (CJS)

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` / `pnpm --filter @workspace/dienstplan run dev` — Dev-Server
- `pnpm run typecheck` — Typecheck alle Pakete; `pnpm run build` — Typecheck + Build
- `pnpm --filter @workspace/api-spec run codegen` — nach jeder openapi.yaml-Änderung
- `pnpm --filter @workspace/db run push` — DB-Schema pushen (nur Dev)
- `pnpm --filter @workspace/scripts run setup-admin` — erster Admin (admin@dienstplan.local / admin1234)
- `pnpm --filter @workspace/scripts run setup-superadmin -- <email> <passwort> [name]` — Betreiber-Konto (idempotent; alternativ Env `SUPERADMIN_*`; kein Default-Passwort, min. 8 Zeichen). Befördern eines BESTEHENDEN Kontos nur mit explizitem `--promote`-Flag (oder Env `SUPERADMIN_ALLOW_PROMOTE=1`), sonst Abbruch mit Meldung — schützt vor Tippfehler-Beförderung echter Kundenkonten; Passwort bleibt beim Befördern unverändert. Neuanlegen braucht kein Flag.
- `pnpm --filter @workspace/scripts run setup-test-db` — Test-DB anlegen/aktualisieren (idempotent)
- `pnpm --filter @workspace/scripts run verify-account-separation` — Regressionscheck Testkonten-Trennung: seedet die Konstellation (Betreiber/Dienstleister/Assistent + 7 Assistenzkräfte) in die `_test`-DB, führt `setup-test-accounts` + `migrate-teams` aus und asserted, dass die Team-Belegung unverändert bleibt (Oliver 7 / Dienstleister 5 / Betreiber 5 aktive Assistenten); heilt veraltetes Test-DB-Schema selbst (Enum-Probe → `setup-test-db`), räumt danach restlos auf (Test-DB wieder nur Seed-Admin + Standard-Team)
- `pnpm --filter @workspace/scripts run verify-test-db-cleanup` — beweist die Selbstheilung der Test-DB: seedet einen Zombie-Konto-Baum in die `_test`-DB, führt `cleanup-test-accounts` aus und asserted, dass nur der Seed-Admin übrig bleibt; FK-Wächter schlägt fehl, wenn eine neue team-gebundene Tabelle (FK auf `teams.id` ohne Cascade) nicht in `TEAM_BOUND_TABLES` (`scripts/src/lib/account-tree.ts`) abzugeckt ist
- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright against **isolierten Test-Stack** (API 8099 + Vite 5199, eigene DB `<dbname>_test`, via `setup-test-db` auto-provisioniert); Dev-DB wird nicht berührt. `setup-test-db` läuft automatisch beim Laden der Playwright-Config — gilt auch für Einzel-Specs via `pnpm exec playwright test <name>`; Skip via `E2E_SKIP_DB_SETUP=1`. Direkt danach (noch vor dem Start der webServer, nie parallel zu Specs) läuft `verify-account-separation` automatisch mit (~20 s); Fehlschlag bricht den Lauf hart ab. Skip nur des Checks via `E2E_SKIP_SEPARATION_CHECK=1`; `E2E_SKIP_DB_SETUP=1` überspringt beides. Override via `E2E_BASE_URL` (überspringt Setup + Stack). Test-Konten (`e2e.*@dienstplan.test`) räumt `cleanup-test-accounts` vor/nach jedem Lauf ab — Test-E-Mails MÜSSEN dieses Muster behalten.
- Required env: `DATABASE_URL`, `SESSION_SECRET`. Optional: `RESEND_API_KEY` (Warn-Mails), `ERROR_ALERT_EMAIL`, `ERROR_ALERT_FROM`

## Where things live

- `lib/api-spec/openapi.yaml` — Vertrags-Quelle
- `lib/db/src/schema/` — Drizzle-Tabellen (users, teams, team_members, contracts, shifts, shift_models, time_tracking, allowance_settings, plan_changes, platform_errors, session)
- `lib/entitlements/src/index.ts` — Free/Premium-Config (Single Source)
- `artifacts/api-server/src/routes/` — Express-Routen; `src/lib/` — `plan.ts` (Plan-Enforcement), `teams.ts`, `default-shift-models.ts`
- `artifacts/dienstplan/src/pages/` — React-Seiten
- `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/` — generiert, NICHT manuell editieren

## Product

- **Rollen**: `admin` (Assistenznehmer, Vollzugriff), `assistant` (nur eigene Daten), `superadmin` (Betreiber; NUR direkt in DB/per Skript vergeben, nie über Registrierung). **Superadmin nutzt die normale App wie ein Admin** (eigene Teams/Daten; `isAdminLikeRole` in `middleware/auth.ts`, Frontend `lib/roles.ts` `isAdminRole`); zusätzlich exklusiv das Operator-Dashboard. `requireDienstleister` bleibt an `account_type` gebunden.
- **Konto-Typ** (`users.account_type`, `privat` | `dienstleister`): bei Registrierung fixiert, danach NICHT im UI änderbar. Privat = einzelner Assistenznehmer; Dienstleister = mehrere Teams.
- **Stammdaten**: Assistenten mit Vertragsdaten (Wochenstunden, Urlaubstage, Kontakt).
- **Dienstplan-Kalender** (Monatsansicht): Schichten tragen `planning_status` (VORLAEUFIG = Entwurf, ANGEBOTEN = Vorschlag, FIX = verbindlich). DB-Default FIX, neue Schichten im Dialog aber VORLAEUFIG — bewusst entkoppelt. **Nur FIX-Schichten zählen** in Auswertungen und PDF-Stundennachweis. Abwesenheiten sind Default-FIX. Admins können Entwürfe/Vorschläge per Ein-Klick (Badge/Dialog) und monatsweise sammelbestätigen (nur `planningStatus: FIX` + `force: true` via PATCH).
- **Standard-Dienste-Seeding**: Registrierung legt 4 Schichtmodelle an (Frühdienst, Spätdienst, 24h Dienst, Bereitschaft). Urlaub/Krankheit sind KEINE Modelle — Abwesenheits-System.
- **Zeiterfassung**: Ist-Zeiten mit Status offen / bestätigt / abgelehnt. **Auswertungen**: Soll/Ist pro Assistent und Monat.
- **Zuschlags-Einstellungen**: `allowance_settings` — eine Konto-Zeile je Admin (`team_id IS NULL`, lazy, Defaults 25/50/100, Nachtfenster 23:00–06:00) + optional EINE Override-Zeile je Team (`team_id` UNIQUE). Fallback-Kette überall: **Team-Override → Konto des Team-Eigentümers → Defaults** (`shifts.ts` `allowanceContext`, `dashboard.ts` hours-balance; bei `teamId`-Filter zeigen die Prozente die angewandten Team-Sätze). API `/allowance-settings?teamId=` nur für eigene Teams (403); UI in `allowance-settings-form.tsx` (nur Dienstleister).
- **Regionale Feiertage**: wählbares Bundesland in den Einstellungen → landesspezifische Feiertage; ohne Bundesland nur bundesweite. Keine rückwirkende Neuberechnung bestehender Schichten.
- **Farbkodierung nach `userId`** (deterministischer Hash, `lib/shift-model-colors.ts`), nicht nach Schichtart. Abwesenheiten behalten semantische Farben (Urlaub Gelb, Krankheit Grau). `shift_models.color` bleibt in der DB (Default `slate`), wird vom Frontend nicht mehr gesendet.
- **24h-Dienst-Hinweis**: identische Start-/Enduhrzeit über Tagesgrenze oder Legacy `full_day` → `ShiftBadge` zeigt „24h-Dienst".

## Dev-Testkonten (nur Dev-DB)

- Neuaufsetzen/Reparieren: `pnpm --filter @workspace/scripts run setup-test-accounts` (idempotent; trennt die Bestände, legt Dummys/Verträge/Modelle an).
- **Oliver Straub** `admin@dienstplan.local` — admin, privat, **premium**. Eigentümer „Standard-Team" (Team 1): 7 reale Assistenzkräfte inkl. Personalakten, 35 Schichten, 7 Verträge, 4 Modelle.
- **Betreiber** `betreiber@dienstplan.local` — superadmin, privat, **free**. „Betreiber-Team": Dummys Max Mustermann 1–4 + Test-Assistent, 4 Modelle, leerer Dienstplan; zusätzlich Operator-Dashboard.
- **Test-Dienstleister** `dienstleister@dienstplan.local` — admin, dienstleister, **premium**. „Dienstleister-Team": Dummys Max Mustermann 5–9, 4 Modelle, leerer Dienstplan.
- **Test-Assistent** `assistent@dienstplan.local` — assistant, Mitglied NUR im Betreiber-Team (Free-Eigentümer → Free-Gates wie historyMonths 1 greifen), eigener Vertrag (30h/30 Urlaubstage). Arbeitgeber-Plan-Features (Resturlaub-Karte/calendarSync) testet man, indem der Betreiber temporär auf premium gestellt wird. `setup-test-accounts` erzwingt diese Belegung mit einer Fail-fast-Endkontrolle; `migrate-teams` fügt Nutzer mit bestehender Mitgliedschaft NICHT mehr in Team 1 ein (Bootstrap-Semantik, sonst zerstörte jeder Task-Merge die Trennung).
- Dummys (max.mustermannN@dienstplan.local) haben kein Passwort und keine Premium-Lohndaten; Vertrag 30h/30 Urlaubstage ab 2026-01-01. Alt-Konten Maria Hoffmann/„Assistenzdienst" sind gelöscht.

## Multi-Team & Datentrennung

- **Erlaubte Teams** = besessene (`teams.owner_id`) ∪ Mitgliedschaften (`team_members`). Zentrale Helfer in `lib/teams.ts`: `getAllowedTeamIds`, `resolveReadTeamScope`, `resolveWriteTeamId`, `parseTeamIdParam`.
- **Team-CRUD** `/api/teams`: nur `requireDienstleister`, owner-scoped; DELETE 409 solange Daten/Mitglieder hängen; Member-Endpunkte mit IDOR-Check `assertTeamOwnership`.
- **Backend-Scoping-Invarianten** (alle Domänen-Routen, nicht nur UI):
  - GET-Listen: `inArray(teamId, teamScope)`; 403 bei fremdem `teamId`, `[]` bei leerem Scope.
  - POST: Ziel-Team via `resolveWriteTeamId`; `time_tracking` erbt `teamId` von der Schicht. **Member-of-Team-Invariante**: `body.userId` muss Mitglied des Ziel-Teams sein, sonst 403 (PII-Leak über user-gejointe Antworten). Gilt für POST shifts/contracts/time_tracking.
  - PATCH/DELETE/GET:id: Row-`teamId` muss in `getAllowedTeamIds` liegen, sonst 404 (IDOR).
  - `ShiftUpdate` erlaubt optionales `userId` (Assistenten-Wechsel, nur Massenbearbeitung) mit derselben Member-Invariante + Überschneidungsprüfung gegen den NEUEN Nutzer; Team der Schicht bleibt.
  - `GET /users` strikt gescoped, kein globaler Pool. Einzige Ausnahme: `privat`-Konto ohne jedes Team + ohne `teamId` → globaler Pool (Erst-Einrichtung); `dienstleister` NIE. `POST /users` legt via `teamId` eine Team-Mitgliedschaft an (keine `users`-Spalte → vor Insert strippen).
  - Dashboard-Admin-Branch team-gescoped (optionaler `teamId`); Assistant-Branch rein userId-personal.
- **`teamId` NOT NULL** auf shifts/contracts/shift_models/time_tracking — JEDER Insert (inkl. Abwesenheits-Auto-Booking) muss es liefern.
- Migration: `pnpm --filter @workspace/scripts run migrate-teams` (idempotent, läuft in post-merge VOR `db push`).
- Frontend: `context/team.tsx` (Teams nur für Dienstleister, `selectedTeamId` in localStorage), `components/team-switcher.tsx`.

## Free/Premium (SaaS-Entitlements)

- `users.plan` (`free` | `premium`, Default `free`), in OpenAPI an `AuthUser` UND `User` required.
- **`@workspace/entitlements`** = Single Source of Truth (Frontend + API). `PLAN_CONFIG`: Features (boolean) + Limits (number | null = unbegrenzt). Free: maxAssistants 6, maxTeams 1, maxShiftModels 4, historyMonths 1, Basis-Features. Helfer: `hasAccess`, `getLimit`, `isWithinLimit`, `resolvePlan`, `isPremium`.
- **Server autoritativ, Frontend-Gates reine UX.** `lib/plan.ts`: `getUserPlan` liest IMMER frisch aus der DB (manuelle Freischaltung wirkt sofort); `userHasFeature`, `userWithinLimit`, `requirePlanFeature`. Maßgeblich ist der Plan des **Team-Eigentümers**, nicht des Anfragers.
- **Durchgesetzte Gates** (403 `plan_limit_reached` / `plan_feature_required`):
  - Limits `maxShiftModels`/`maxAssistants`/`maxTeams` beim Anlegen. `maxShiftModels` = Seed-Anzahl (4): Free-Konten starten AM Limit; eigener Dienst erst nach Löschen eines Standard-Dienstes oder mit Premium (bewusste Produktentscheidung, Task #317). Abwesenheiten (Urlaub/Krankheit) sind für Free NICHT gegated (kein Feature-Gate im shifts-POST, nur historyMonths).
  - `historyMonths` (shifts POST + PATCH-mit-`startTime`): 403 wenn Monat weiter als erlaubt in der Zukunft; Vergangenheit nie blockiert; PATCH ohne `startTime` frei.
  - `bulkEdit`: Assistenten-Wechsel via `ShiftUpdate.userId` nur Premium; Einzel-Edit ohne Nutzerwechsel frei.
  - `advancedPersonnelFile` (users POST/PATCH): Lohn-/SV-Felder (birthDate, socialSecurityNumber, taxId, taxClass, healthInsurance, iban) nur Premium; PATCH blockt nur ECHTE Änderungen gegen den DB-Stand.
  - `advancedAnalytics` (`GET /dashboard/hours-balance`) — setzt transitiv `payrollExport` durch (Datenquelle des PDF-Nachweises; kein Eigenner Endpunkt). `dashboard/summary` bleibt frei.
  - `caregiverLogin` (`POST /users/:id/invite`): Einladungs-Token nur Premium. Bestandsschutz: bereits eingeladene Assistenten loggen sich weiter ein.
  - `absenceTracking`: Frontend-Gate in `abwesenheiten.tsx` (bei Free ersetzt Upgrade-Hinweis den Inhalt der Karte „Resturlaub {Jahr}"; Bilanz wird dort clientseitig berechnet) + Server-Gate auf dem Bilanz-Endpunkt `GET /contracts/:id/vacation-balance` (`requireAuth` + `requirePlanFeatureViaTeamOwner`, 403 `plan_feature_required`). **Assistenten** dürfen NUR die eigene Bilanz abrufen (fremder Vertrag → 404, auch team-intern); ihr Zugang hängt am Plan des ARBEITGEBERS (Team-Eigentümer, ein Premium-Arbeitgeber genügt — analog calendarSync). Admins unverändert (eigener Plan, Team-Scope). UI: Karte „Mein Resturlaub" im Dashboard (`AssistantVacationCard` in `dashboard.tsx`, nur Nicht-Admins; bei 403/Free-Arbeitgeber wird die Karte still ausgeblendet, kein Upsell an Assistenten). Das EINTRAGEN von Urlaub/Krankheit bleibt für alle Pläne frei; Rohdaten (`contracts.vacationDays`/`vacationDaysUsed`, Abwesenheits-Schichten) bleiben über die regulären Endpunkte für alle Pläne zugänglich, `vacationDaysUsed`-Buchhaltung läuft plan-unabhängig weiter (kein Datenverlust bei Upgrade).
  - `strictTimeTracking` (`PATCH /time-tracking/:id/confirm`): Bestätigen/Ablehnen nur Premium. `dashboard/summary` zählt Ist-Stunden plan-abhängig: bestätigte immer; „offene" zusätzlich in Teams mit Free-Eigentümer (`getLenientTimeTrackingTeamIds`, beide Branches); abgelehnte nie.
  - Warnung „offene Zeiteinträge" nur bei Freigabe-Workflow: `warnings.timeTrackingConfirmable` true, sobald ein Team im Scope einen Premium-Eigentümer hat; bei false blendet das Dashboard die Warnung aus (Produktentscheidung; kein Upsell im Hinweise-Block). Zähler/KPI-Kachel bleiben korrekt.
  - Upgrade-Transparenz: KEIN Auto-Bestätigen beim Upgrade (kein Hook, Freischaltung direkt in DB). `dashboard/summary` liefert `uncountedPendingHours`/`uncountedPendingEntries` (pending-Summe in STRIKTEN Teams); Dashboard zeigt `UncountedPendingNotice` mit Link auf `/zeiterfassung?status=pending`.
  - `calendarSync` (`routes/calendar.ts`): ICS-Export der FIX-Schichten (`GET /calendar-export`) + Abo-Feed `GET /calendar-feed/:token` (public; `users.calendar_token` unique/nullable; Premium-Gate über Token-EIGENTÜMER, 404 bei unbekanntem/widerrufenem Token, immer voller erlaubter Scope). `GET/POST /calendar-token` Premium (POST rotiert); `DELETE` bewusst OHNE Plan-Gate (Widerruf auch nach Downgrade). **Assistenten-Zugang via Arbeitgeber-Plan**: `userHasFeatureViaTeamOwner`/`requirePlanFeatureViaTeamOwner` (Owner-Fallback NUR für Rolle assistant, ein Premium-Arbeitgeber genügt) — gilt für Export, Token GET/POST und Feed-Gate. `CalendarExportCard` (einstellungen.tsx) nutzt für Assistenten `GET /calendar-token` als Probe (403 = gesperrt).
- **Frontend-Gates** (`PLAN_FEATURE_MESSAGES` in `lib/api-error.ts`): PDF-Nachweis-Buttons, Einladen-Button + InviteDialog, Zeiterfassungs-Bestätigen, Kalender-Export-Card.
- **Einfacher Monats-Export** (`basicExport`, auch Free): Button „Monats-PDF" im Dienstplan-Header für Admin UND Assistent (`exportSimpleMonthPdf` in `pdf-export.ts`). Rein aus `GET /shifts` (kein Premium-Endpunkt nötig): FIX-Dienste + Abwesenheiten Urlaub/Krank (ganztägig, „1 Tag"), OHNE Zeiterfassung/Soll-Ist/Zuschläge. Respektiert Assistenten-Filter; eine Seite pro Assistent mit Einträgen.
- **VERBINDLICHE REGEL — Bestandsschutz**: Free-Limits beschränken AUSSCHLIESSLICH neue Aktionen/Anlegen. Bestehende Daten (Teams, Lohndaten, geplante/vergangene Monate, Schichtmodelle) NIEMALS ausblenden, sperren oder löschen, nur weil ein Konto Free ist. `isWithinLimit` ist KEIN Anzeige-Filter.
- **Billing**: Abrechnung über Lexware API (Rechnungsentwürfe), NICHT Stripe; Premium-Freischaltung manuell im Operator-Dashboard nach Zahlungseingang. Auth hybrid (Plattform-SSO via JWT geplant + lokal E-Mail/Passwort/Einladung); Kommentare in `entitlements.ts`.
- **Upgrade-Weg**: `/preise` (Route nur `admin`) rendert den Vergleich direkt aus `PLAN_CONFIG`, CTA = mailto (`UPGRADE_CONTACT_EMAIL` in `preise.tsx`) — kein Self-Service-Checkout. Free-Limit-Hinweise über `components/plan-limit-banner.tsx`.

## Auth

- Session-basiert (`express-session`, Cookie `connect.sid`, 7 Tage). Middleware: `requireAuth`, `requireAdmin`, `requireDienstleister` (Admin + `dienstleister`, frisch aus DB).
- **Registrierung** (public): `/registrierung` → `POST /api/auth/register` legt einen Admin mit gewähltem `accountType` an, erzeugt initiales „Standard-Team" (owner + Mitgliedschaft), meldet direkt an.
- **Einladungsflow**: `POST /api/users/:id/invite` → Assistent setzt Passwort via `/einladung?token=...`. **Passwort vergessen**: `/passwort-vergessen` (verweist auf Admin, kein E-Mail-Self-Service).
- **Selbst-Profil**: `POST /api/auth/change-password`, `POST /api/auth/update-profile` (E-Mail normalisiert, 409 bei Kollision). **Logout**: `POST /api/auth/logout`; `App.tsx` leitet bei `!currentUser` nach `/login`.
- **PUBLIC_PATHS**: `/login`, `/registrierung`, `/einladung`, `/passwort-vergessen`.
- **Dev-Auto-Login**: In Vite-DEV feuert `bootstrap()` bei 401 automatisch `POST /api/auth/dev-login` → öffentliche Seiten im Dev-Vorschaufenster nicht sichtbar (im Prod-Build schon). Dev-Session-Cache (`assistenz_treff_session`, nur DEV) speichert NUR das nicht-sensible Profil; Cookie bleibt die Wahrheit.

## Operator-Dashboard & superadmin

- `pages/operator-dashboard.tsx`: interne Betreiber-Konsole. Nutzer-Monitoring + Premium-Freischaltung und Fehler-Tracking sind LIVE angebunden; Lexware-Buchungs-Log bleibt Platzhalter (sichtbar als „Demo-Daten" markiert, Badge `badge-lexware-demo`).
- **Serverseitige Autorisierung**: `requireSuperadmin`-Middleware (`middleware/auth.ts`, Rolle frisch aus DB — analog `requireDienstleister`) schützt alle `/api/operator/*`-Endpunkte. Admin/Assistant → 403, unauthentifiziert → 401. Frontend-Guard (`role === "superadmin"` in App.tsx) ist reine UX.
- **Operator-Endpunkte** (`routes/operator.ts`): `GET /operator/accounts` (alle Admin-Konten plattformweit mit Team-/Assistenten-Aggregaten), `PATCH /operator/accounts/:id/plan` (`{plan: free|premium}`). Plan-Flip wirkt sofort, da `getUserPlan` frisch liest. Ziel muss Rolle `admin` haben (sonst 404) — nur Admin-Konten sind zahlende Konten.
- **Plan-Audit-Log**: Jeder Plan-Flip schreibt append-only in `plan_changes` (`lib/db/src/schema/plan_changes.ts`: Konto, alter/neuer Plan, ausführender superadmin aus `req.session.userId`, Zeitstempel, optionale `note`; auch No-Op-Flips werden protokolliert). `note` = Rechnungs-/Zahlungsreferenz (z. B. Lexware-Belegnummer), optional in `OperatorPlanUpdate` (max. 500 Zeichen, Whitespace-only → NULL); erfasst im Bestätigungs-Dialog vor dem Plan-Flip im Operator-Dashboard, angezeigt als Spalte „Referenz / Notiz" im Protokoll. `GET /operator/plan-changes?limit=` (Default 50, max 200, neueste zuerst, Doppel-Join auf users via Drizzle-`alias`). Anzeige als Karte „Plan-Änderungsprotokoll" im Operator-Dashboard; der Plan-Toggle invalidiert beide Queries.
- **Fehler-Tracking**: Zentraler Express-Error-Handler (`app.ts`, ganz am Ende) fängt unbehandelte Fehler, loggt, antwortet 500-JSON (ohne Details) und persistiert via `recordPlatformError` (`lib/platform-errors.ts`) in `platform_errors` (Level error|warning, Meldung, Kontext=Route, Zeitstempel; Aufbewahrung auf die 500 zuletzt AUFGETRETENEN begrenzt). **Bündelung**: gleiche Meldung + Kontext = EINE Zeile (manueller Update-then-Insert-Upsert, bewusst OHNE UNIQUE-Index — message bis 2000 Zeichen sprengt Btree-Limit); Wiederauftreten zählt `count` hoch, setzt `last_seen_at` UND `resolved=false` (Abhaken gilt für die Gruppe, neues Auftreten öffnet wieder). **Details/Stacktrace**: `platform_errors.last_stack` (nullable, gekürzt auf 4000 Zeichen) speichert den Detailtext des LETZTEN Auftretens (Upsert überschreibt immer, auch mit NULL); Error-Handler übergibt `err.stack`; UI: „Details"-Button je Zeile (nur wenn vorhanden) klappt `<pre>` mit dem Trace auf. Liste sortiert nach `lastSeenAt`; UI zeigt Badge „N×" + „zuletzt …". Helfer kann auch aus try/catch-Stellen gerufen werden. `GET /operator/errors?limit=` (Default 50, max 200, neueste zuerst, requireSuperadmin) → Karte „Fehler-Tracking" (Leerzustand „Keine Fehler im Betrieb"). **Abhaken**: `platform_errors.resolved` (boolean, Default false), `PATCH /operator/errors/:id` (`{resolved}`, requireSuperadmin, 404 bei unbekannter ID); Karte hat Filter „Offene" (Default, blendet erledigte aus) / „Alle" (erledigte ausgegraut + durchgestrichen, Button „Wieder öffnen"); sind alle erledigt, zeigt „Offene" einen eigenen Leerzustand. **Sammel-Abhaken**: Button „Alle abhaken" (nur sichtbar bei offenen Einträgen, mit Bestätigungs-Dialog) → `POST /operator/errors/resolve-all` (requireSuperadmin, setzt `resolved = true` für alle offenen, antwortet `{resolvedCount}`). Aufbewahrungslimit gilt unverändert auch für erledigte. Dev-Route `GET /api/dev/boom` (nur NODE_ENV≠production, `routes/health.ts`) löst absichtlich einen 500er aus. E2E: `dienstplan-operator-fehler-tracking.spec.ts`.
- **Warn-E-Mail bei Level error**: `lib/alert-mailer.ts` sendet via Resend-API (fetch, fire-and-forget, wirft NIE — Versandfehler beeinträchtigen keinen Request). Ohne `RESEND_API_KEY` (Secret, optional) wird der Versand mit Log-Warnung übersprungen (graceful degradation). Empfänger: `ERROR_ALERT_EMAIL`, sonst E-Mail des ersten superadmin aus der DB; Absender: `ERROR_ALERT_FROM`, sonst onboarding@resend.dev. Drosselung: `AlertThrottle` (15 min pro Fehler-Schlüssel Meldung+Kontext, max 200 Schlüssel) — Unit-Tests in `platform-errors.test.ts`. **LIVE**: `RESEND_API_KEY` hinterlegt, Versand end-to-end verifiziert. Eigene Absender-Domain `mail.assistenztreff.de` bei Resend registriert (DNS-Einträge DKIM/SPF gesetzt, SPF verifiziert; DKIM-Verifizierung kann bis zu 72 h dauern), `ERROR_ALERT_FROM="Dienstplan-App <alerts@mail.assistenztreff.de>"` (shared Env). **Absender-Fallback**: Lehnt Resend den konfigurierten Absender ab (403/422, z. B. Domain noch nicht verifiziert), versucht der Mailer EINMAL den Testabsender onboarding@resend.dev — Warn-Mails fallen nie still aus; nach abgeschlossener Verifizierung greift der eigene Absender automatisch (kein Neustart nötig, Env wird pro Versand gelesen). Testabsender darf NUR an die Resend-Konto-Adresse senden → `ERROR_ALERT_EMAIL=kontakt@assistenztreff.de` (shared Env); freie Empfänger erst mit verifizierter Domain zuverlässig.
- Zugang: Route `/operator-dashboard` nur bei `role === "superadmin"`; versteckter Link im Footer-Platzhalter. `superadmin` wird weiterhin NUR direkt in der DB vergeben.

## PWA & Plattform-Einbettung (iframe)

- PWA-Meta-Tags in `index.html`; noch KEIN Manifest / Service Worker.
- App wird per `<iframe>` in die AssistenzTreff-Plattform (Symfony) eingebettet; eigene Postgres-DB bleibt.
- **Cross-Site-Cookie**: In Produktion (oder `SESSION_COOKIE_CROSS_SITE=1`) `SameSite=None; Secure` — sonst schlägt der Login im fremden iframe-Origin still fehl. Lokal/Dev `Lax`. Ggf. `Partitioned`/CHIPS nachrüsten.
- **Embed-Modus** `?embed=1` (sessionStorage, `src/lib/embed.ts`): blendet Plattform-Platzhalter aus. Keine `window.top`-Auto-Erkennung (Replit-Vorschau ist selbst ein iframe).
- Plattformseite (nicht im Repo): iframe-URL mit `?embed=1`; Deploy-Domain in `nelmio_security.yaml` unter `frame-src` (enforce UND report) eintragen.

## Layout & UI
