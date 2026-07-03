# Dienstplan-App

Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell.

## User preferences

- (keine)

## Architektur & Stack

- **Single Responsive Web App (PWA)** — EINE React-Codebasis, bewusst KEINE separate native App; Endgeräte-Anpassung nur über Tailwind-Breakpoints.
- **Contract-first**: `lib/api-spec/openapi.yaml` ist Single Source of Truth. Orval-Codegen → React-Query-Hooks (`@workspace/api-client-react`) + Zod-Schemas (`@workspace/api-zod`). Routen validieren mit den generierten Zod-Schemas; Frontend nutzt NUR die generierten Hooks.
- pnpm workspaces, Node.js 24, TS 5.9. API: Express 5 (`artifacts/api-server`, `/api`, Port 8080). Frontend: React + Vite + Tailwind (`artifacts/dienstplan`, wouter). DB: PostgreSQL + Drizzle (`lib/db`, kein Raw-SQL in Routen); Zod (`zod/v4`) + drizzle-zod; Build esbuild (CJS).
- Generierte Verzeichnisse (`lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`) NICHT manuell editieren.

## Betrieb (Befehle & Env)

- Dev-Server: `pnpm --filter @workspace/api-server run dev` / `pnpm --filter @workspace/dienstplan run dev`; `pnpm run typecheck`; `pnpm run build`
- `pnpm --filter @workspace/api-spec run codegen` — nach jeder openapi.yaml-Änderung; `pnpm --filter @workspace/db run push` — DB-Push (nur Dev)
- Skripte laufen via `pnpm --filter @workspace/scripts run <name>`: `setup-admin` — erster Admin (admin@dienstplan.local / admin1234); `setup-superadmin -- <email> <passwort> [name]` — Betreiber-Konto (idempotent; alternativ Env `SUPERADMIN_*`; min. 8 Zeichen, kein Default; Befördern eines BESTEHENDEN Kontos nur mit `--promote`/`SUPERADMIN_ALLOW_PROMOTE=1`, Passwort bleibt unverändert); `migrate-teams` — idempotent, läuft in post-merge VOR `db push`
- Required env: `DATABASE_URL`, `SESSION_SECRET`. Optional: `RESEND_API_KEY` (Warn-Mails), `ERROR_ALERT_EMAIL`, `ERROR_ALERT_FROM`

## Produktregeln

- **Rollen**: `admin` (Assistenznehmer, Vollzugriff), `assistant` (nur eigene Daten), `superadmin` (Betreiber; NUR per DB/Skript, nie über Registrierung; nutzt die App wie ein Admin via `isAdminLikeRole`/`isAdminRole`, exklusiv plus Operator-Dashboard). `requireDienstleister` bleibt an `account_type` gebunden.
- **Konto-Typ** (`users.account_type`, `privat` | `dienstleister`): bei Registrierung fixiert, danach NICHT im UI änderbar. Privat = einzelner Assistenznehmer; Dienstleister = mehrere Teams.
- **Dienstplan-Kalender** (Monatsansicht): `planning_status` VORLAEUFIG / ANGEBOTEN / FIX. DB-Default FIX, neue Schichten im Dialog aber VORLAEUFIG — bewusst entkoppelt. **Nur FIX-Schichten zählen** in Auswertungen und PDF-Stundennachweis. Abwesenheiten Default-FIX. Bestätigen einzeln oder monatsweise gesammelt (PATCH `planningStatus: FIX` + `force: true`).
- **Standard-Dienste-Seeding**: Registrierung legt 4 Modelle an (Frühdienst, Spätdienst, 24h Dienst, Bereitschaft). Urlaub/Krankheit sind KEINE Modelle — eigenes Abwesenheits-System.
- **Zeiterfassung**: Ist-Zeiten (offen/bestätigt/abgelehnt). **Auswertungen**: Soll/Ist je Assistent & Monat.
- **Zuschläge** (`allowance_settings`): eine Konto-Zeile je Admin (`team_id IS NULL`, lazy, Defaults 25/50/100, Nachtfenster 23–06 Uhr) + optional EINE Override-Zeile je Team (`team_id` UNIQUE). Fallback-Kette überall: **Team-Override → Konto des Team-Eigentümers → Defaults**; bei `teamId`-Filter zeigen die Prozente die angewandten Team-Sätze. API `?teamId=` nur für eigene Teams (403); UI nur Dienstleister.
- **Regionale Feiertage**: wählbares Bundesland (Einstellungen); ohne Bundesland nur bundesweite. Keine rückwirkende Neuberechnung bestehender Schichten.
- **Farbkodierung nach `userId`** (deterministischer Hash, `lib/shift-model-colors.ts`), nicht nach Schichtart. Abwesenheiten behalten semantische Farben (Urlaub Gelb, Krankheit Grau). `shift_models.color` bleibt in der DB (Default `slate`), Frontend sendet sie nicht.
- **24h-Dienst**: identische Start-/Enduhrzeit über Tagesgrenze oder Legacy `full_day` → `ShiftBadge` zeigt „24h-Dienst".

## Multi-Team & Datentrennung

- **Erlaubte Teams** = besessene (`teams.owner_id`) ∪ Mitgliedschaften (`team_members`); Helfer in `lib/teams.ts`.
- **Team-CRUD** `/api/teams`: nur `requireDienstleister`, owner-scoped; DELETE 409 solange Daten/Mitglieder hängen; Member-Endpunkte mit IDOR-Check `assertTeamOwnership`.
- **Backend-Scoping-Invarianten** (alle Domänen-Routen):
  - GET-Listen: nur Teams im Scope; 403 bei fremdem `teamId`, `[]` bei leerem Scope.
  - POST: Ziel-Team via `resolveWriteTeamId`; `time_tracking` erbt `teamId` von der Schicht. **Member-of-Team-Invariante**: `body.userId` muss Mitglied des Ziel-Teams sein, sonst 403 (PII-Leak). Gilt für POST shifts/contracts/time_tracking.
  - PATCH/DELETE/GET:id: Row-`teamId` muss in `getAllowedTeamIds` liegen, sonst 404 (IDOR).
  - `ShiftUpdate` erlaubt optionales `userId` (Assistenten-Wechsel, nur Massenbearbeitung) mit derselben Member-Invariante + Überschneidungsprüfung gegen den NEUEN Nutzer; Team der Schicht bleibt.
  - `GET /users` strikt gescoped, kein globaler Pool. Einzige Ausnahme: `privat`-Konto ohne jedes Team + ohne `teamId` (Erst-Einrichtung); `dienstleister` NIE. `POST /users` legt via `teamId` eine Mitgliedschaft an (keine `users`-Spalte → vor Insert strippen).
  - Dashboard-Admin-Branch team-gescoped (optionaler `teamId`); Assistant-Branch rein userId-personal.
- **`teamId` NOT NULL** auf shifts/contracts/shift_models/time_tracking — JEDER Insert (inkl. Abwesenheits-Auto-Booking) muss es liefern.
- Frontend: `context/team.tsx` (Teams nur für Dienstleister, `selectedTeamId` in localStorage) + Team-Switcher.

## Free/Premium (Entitlements)

- `users.plan` (`free` | `premium`, Default `free`), in OpenAPI an `AuthUser` UND `User` required.
- **`@workspace/entitlements`** = Single Source of Truth. `PLAN_CONFIG`: Features (boolean) + Limits (number | null = unbegrenzt). Free: maxAssistants 6, maxTeams 1, maxShiftModels 4, historyMonths 1.
- **Server autoritativ, Frontend-Gates reine UX.** `getUserPlan` liest IMMER frisch aus der DB (manuelle Freischaltung wirkt sofort). Maßgeblich ist der Plan des **Team-Eigentümers**, nicht des Anfragers. Assistenten-Zugang via Arbeitgeber-Plan: `requirePlanFeatureViaTeamOwner` (Owner-Fallback NUR für Rolle assistant, ein Premium-Arbeitgeber genügt).
- **Durchgesetzte Gates** (403 `plan_limit_reached` / `plan_feature_required`):
  - Limits `maxShiftModels`/`maxAssistants`/`maxTeams` beim Anlegen. `maxShiftModels` = Seed-Anzahl (4): Free startet AM Limit; eigener Dienst erst nach Löschen eines Standard-Dienstes oder mit Premium (bewusst). Abwesenheiten für Free NICHT gegated (nur historyMonths).
  - `historyMonths` (shifts POST + PATCH-mit-`startTime`): 403 wenn Monat weiter als erlaubt in der Zukunft; Vergangenheit nie blockiert; PATCH ohne `startTime` frei.
  - `bulkEdit`: Assistenten-Wechsel via `ShiftUpdate.userId` nur Premium; Einzel-Edit ohne Nutzerwechsel frei.
  - `advancedPersonnelFile` (users POST/PATCH): Lohn-/SV-Felder (birthDate, socialSecurityNumber, taxId, taxClass, healthInsurance, iban) nur Premium; PATCH blockt nur ECHTE Änderungen gegen den DB-Stand.
  - `advancedAnalytics` (`GET /dashboard/hours-balance`) — setzt transitiv `payrollExport` durch (Datenquelle des PDF-Nachweises). `dashboard/summary` bleibt frei.
  - `caregiverLogin` (`POST /users/:id/invite`): Einladungs-Token nur Premium. Bestandsschutz: bereits eingeladene Assistenten loggen sich weiter ein.
  - `absenceTracking`: Frontend-Gate in `abwesenheiten.tsx` (bei Free ersetzt Upgrade-Hinweis den Inhalt der Karte „Resturlaub {Jahr}"; Bilanz wird dort clientseitig berechnet) + Server-Gate auf dem Bilanz-Endpunkt `GET /contracts/:id/vacation-balance` (`requireAuth` + `requirePlanFeatureViaTeamOwner`, 403 `plan_feature_required`). **Assistenten** dürfen NUR die eigene Bilanz abrufen (fremder Vertrag → 404, auch team-intern); ihr Zugang hängt am Plan des ARBEITGEBERS (Team-Eigentümer, ein Premium-Arbeitgeber genügt — analog calendarSync). Admins unverändert (eigener Plan, Team-Scope). UI: Karte „Mein Resturlaub" im Dashboard (`AssistantVacationCard` in `dashboard.tsx`, nur Nicht-Admins; bei 403 `plan_feature_required`/Free-Arbeitgeber zeigt die Karte einen dezenten Info-Hinweis „Resturlaub-Anzeige über den Arbeitgeber verfügbar" ohne Upgrade-Aufforderung — Produktentscheidung Task #334; ohne Vertrag oder bei anderen Fehlern weiterhin still ausgeblendet). Das EINTRAGEN von Urlaub/Krankheit bleibt für alle Pläne frei; Rohdaten (`contracts.vacationDays`/`vacationDaysUsed`, Abwesenheits-Schichten) bleiben über die regulären Endpunkte für alle Pläne zugänglich, `vacationDaysUsed`-Buchhaltung läuft plan-unabhängig weiter (kein Datenverlust bei Upgrade).
  - `strictTimeTracking` (`PATCH /time-tracking/:id/confirm`): Bestätigen/Ablehnen nur Premium. `dashboard/summary` zählt Ist-Stunden plan-abhängig: bestätigte immer; „offene" zusätzlich in Teams mit Free-Eigentümer (`getLenientTimeTrackingTeamIds`, beide Branches); abgelehnte nie. Warnung „offene Zeiteinträge" nur bei Freigabe-Workflow: `warnings.timeTrackingConfirmable` true, sobald ein Team im Scope einen Premium-Eigentümer hat; bei false blendet das Dashboard die Warnung aus (Produktentscheidung; kein Upsell im Hinweise-Block). Zähler/KPI-Kachel bleiben korrekt. KEIN Auto-Bestätigen beim Upgrade; `dashboard/summary` liefert `uncountedPendingHours`/`uncountedPendingEntries` (pending-Summe in STRIKTEN Teams); Dashboard zeigt `UncountedPendingNotice` mit Link auf `/zeiterfassung?status=pending`.
  - `calendarSync` (`routes/calendar.ts`): ICS-Export der FIX-Schichten (`GET /calendar-export`) + Abo-Feed `GET /calendar-feed/:token` (public; `users.calendar_token` unique/nullable; Premium-Gate über Token-EIGENTÜMER, 404 bei unbekanntem/widerrufenem Token, immer voller erlaubter Scope). `GET/POST /calendar-token` Premium (POST rotiert); `DELETE` bewusst OHNE Plan-Gate (Widerruf auch nach Downgrade). **Assistenten-Zugang via Arbeitgeber-Plan**: `userHasFeatureViaTeamOwner`/`requirePlanFeatureViaTeamOwner` (Owner-Fallback NUR für Rolle assistant, ein Premium-Arbeitgeber genügt) — gilt für Export, Token GET/POST und Feed-Gate. `CalendarExportCard` (einstellungen.tsx) nutzt für Assistenten `GET /calendar-token` als Probe (403 = gesperrt).
- **Frontend-Gates** (`PLAN_FEATURE_MESSAGES` in `lib/api-error.ts`): PDF-Nachweis-Buttons, Einladen-Button + InviteDialog, Zeiterfassungs-Bestätigen, Kalender-Export-Card. Limit-Hinweise: `plan-limit-banner.tsx`.
- **Einfacher Monats-Export** (`basicExport`, auch Free): Button „Monats-PDF" im Dienstplan-Header für Admin UND Assistent (`exportSimpleMonthPdf` in `pdf-export.ts`). Rein aus `GET /shifts` (kein Premium-Endpunkt nötig): FIX-Dienste + Abwesenheiten Urlaub/Krank (ganztägig, „1 Tag"), OHNE Zeiterfassung/Soll-Ist/Zuschläge. Respektiert Assistenten-Filter; eine Seite pro Assistent mit Einträgen.
- **VERBINDLICHE REGEL — Bestandsschutz**: Free-Limits beschränken AUSSCHLIESSLICH neue Aktionen/Anlegen. Bestehende Daten (Teams, Lohndaten, geplante/vergangene Monate, Schichtmodelle) NIEMALS ausblenden, sperren oder löschen, nur weil ein Konto Free ist. `isWithinLimit` ist KEIN Anzeige-Filter.
- **Billing**: Lexware API (Rechnungsentwürfe), NICHT Stripe; Premium-Freischaltung manuell im Operator-Dashboard. **Upgrade-Weg**: `/preise` (nur `admin`) rendert den Vergleich aus `PLAN_CONFIG`, CTA = mailto (`UPGRADE_CONTACT_EMAIL` in `preise.tsx`) — kein Self-Service-Checkout.

## Auth

- Session-basiert (`express-session`, Cookie `connect.sid`, 7 Tage). Middleware `requireAuth` / `requireAdmin` / `requireDienstleister` (Admin + `dienstleister`) / `requireSuperadmin` — Rollen/Typ jeweils frisch aus DB.
- **Registrierung** (public): `/registrierung` → `POST /api/auth/register` legt einen Admin mit gewähltem `accountType` an, erzeugt „Standard-Team" (owner + Mitgliedschaft), meldet direkt an.
- **Einladungsflow**: `POST /api/users/:id/invite` → Passwort setzen via `/einladung?token=...`. **Passwort vergessen**: `/passwort-vergessen` verweist auf den Admin (kein E-Mail-Self-Service).
- **Selbst-Profil**: `POST /api/auth/change-password` / `update-profile` (E-Mail normalisiert, 409 bei Kollision). **Logout**: `POST /api/auth/logout`; bei `!currentUser` Redirect nach `/login`.
- **PUBLIC_PATHS**: `/login`, `/registrierung`, `/einladung`, `/passwort-vergessen`.
- **Dev-Auto-Login**: In Vite-DEV feuert die App bei 401 automatisch `POST /api/auth/dev-login` → öffentliche Seiten in der Dev-Vorschau nicht sichtbar (im Prod-Build schon). Dev-Session-Cache (`assistenz_treff_session`, nur DEV) speichert NUR das nicht-sensible Profil; Cookie bleibt die Wahrheit.

## Operator-Dashboard & superadmin

- `/operator-dashboard` (nur `role === "superadmin"`, Frontend-Guard = UX; versteckter Footer-Link): Nutzer-Monitoring, Premium-Freischaltung, Fehler-Tracking; Lexware-Buchungs-Log via `GET /api/operator/lexware/bookings` mit austauschbarem Adapter (s. u.), aktuell Demo-Daten (Badge `badge-lexware-demo`).
- **Lexware-Buchungs-Log (Dummy mit Adapter)**: echte Anbindung bewusst verschoben bis zur DB-Migration auf einen deutschen Server. `GET /operator/lexware/bookings` (requireSuperadmin) liefert `{source: "demo"|"live", bookings}` (`LexwareBookingList`). Adapter-Interface `LexwareClient` (`api-server/src/lib/lexware.ts`): ohne Secret `LEXWARE_API_KEY` → `MockLexwareClient` mit statischen Beispieldaten (`source: "demo"`); Env pro Aufruf gelesen. Ist `LEXWARE_API_KEY` gesetzt, wirft `getLexwareClient()` bewusst LAUT (echter Client noch nicht implementiert — kein stilles „demo als live"). **Späterer Umbau = nur Adapter-Tausch** (LiveLexwareClient, `source: "live"`); Frontend + OpenAPI-Schema bleiben unverändert. Badge „Demo-Daten" + Warnhinweis NUR bei `source === "demo"` (verschwinden mit live automatisch).
- **Serverseitig**: `requireSuperadmin` schützt alle `/api/operator/*`. Admin/Assistant → 403, unauthentifiziert → 401.
- **Endpunkte**: `GET /operator/accounts` (Admin-Konten mit Team-/Assistenten-Aggregaten), `PATCH /operator/accounts/:id/plan` (`{plan, note?}`); Ziel muss Rolle `admin` haben (sonst 404). Plan-Flip wirkt sofort.
- **Plan-Audit-Log**: Jeder Plan-Flip (auch No-Op) append-only in `plan_changes` (Konto, alter/neuer Plan, superadmin, Zeitstempel, optionale `note` = Rechnungs-/Zahlungsreferenz, max. 500 Zeichen, Whitespace-only → NULL). `GET /operator/plan-changes?limit=` (Default 50, max 200, neueste zuerst).
- **Fehler-Tracking**: Zentraler Express-Error-Handler (`app.ts`, ganz am Ende) loggt, antwortet 500-JSON ohne Details, persistiert via `recordPlatformError` (auch aus try/catch nutzbar) in `platform_errors`:
  - **Bündelung**: gleiche Meldung + Kontext = EINE Zeile (Upsert, bewusst OHNE UNIQUE-Index — message bis 2000 Zeichen sprengt Btree-Limit); Wiederauftreten erhöht `count`, setzt `last_seen_at` UND `resolved=false`.
  - **Retention**: 500 zuletzt aufgetretene (`MAX_STORED_ERRORS`, Env `PLATFORM_ERRORS_MAX_STORED`); gilt auch für erledigte. `GET /operator/errors?limit=` → `{errors, totalStored, retentionLimit}`; am Limit zeigt die Karte einen Unvollständigkeits-Hinweis.
  - **Stacktrace**: `last_stack` (4000 Zeichen, Upsert überschreibt immer, auch mit NULL).
  - **Abhaken**: `resolved` via `PATCH /operator/errors/:id`; Filter „Offene" (Default) / „Alle"; Sammel-Abhaken `POST /operator/errors/resolve-all` mit Bestätigungs-Dialog.
  - Dev-Route `GET /api/dev/boom` (nur NODE_ENV≠production) → absichtlicher 500er.
- **Warn-E-Mail bei Level error** (Resend, fire-and-forget, wirft NIE): ohne `RESEND_API_KEY` Skip mit Log-Warnung. Empfänger `ERROR_ALERT_EMAIL` (Fallback: erster superadmin), Absender `ERROR_ALERT_FROM` (Fallback: onboarding@resend.dev; liefert NUR an die Resend-Konto-Adresse). Drosselung 15 min pro Meldung+Kontext. Lehnt Resend den Absender ab (403/422), wird EINMAL der Testabsender versucht — Warn-Mails fallen nie still aus (Env pro Versand gelesen). Domain `mail.assistenztreff.de` registriert; shared Env: `ERROR_ALERT_FROM=alerts@mail.assistenztreff.de`, `ERROR_ALERT_EMAIL=kontakt@assistenztreff.de`.

## PWA & Plattform-Einbettung (iframe)

- PWA-Meta-Tags in `index.html`; noch KEIN Manifest / Service Worker. Einbettung per `<iframe>` in die AssistenzTreff-Plattform (Symfony); eigene Postgres-DB bleibt.
- **Cross-Site-Cookie**: In Produktion (oder `SESSION_COOKIE_CROSS_SITE=1`) `SameSite=None; Secure` — sonst schlägt der Login im fremden iframe-Origin still fehl. Lokal/Dev `Lax`.
- **Embed-Modus** `?embed=1` (sessionStorage): blendet Plattform-Platzhalter aus. Keine `window.top`-Auto-Erkennung (Replit-Vorschau ist selbst ein iframe). Plattformseite (nicht im Repo): iframe-URL mit `?embed=1`; Deploy-Domain in `nelmio_security.yaml` unter `frame-src` (enforce UND report).

## Tests & Dev-Testkonten

- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright gegen **isolierten Test-Stack** (API 8099 + Vite 5199, DB `<dbname>_test`); Dev-DB unberührt. Beim Config-Load (auch Einzel-Specs) laufen automatisch `setup-test-db`, dann `verify-account-separation` (~20s, Fehlschlag bricht hart ab). Skips: `E2E_SKIP_SEPARATION_CHECK=1` (nur Check), `E2E_SKIP_DB_SETUP=1` (beides), `E2E_BASE_URL` (Setup + Stack). Test-Konten MÜSSEN dem Muster `e2e.*@dienstplan.test` folgen — `cleanup-test-accounts` räumt sie vor/nach jedem Lauf ab.
- Skript `setup-test-db` — Test-DB anlegen/aktualisieren (idempotent)
- Skript `verify-account-separation` — Regressionscheck Testkonten-Trennung in der `_test`-DB (asserted 7/5/5 aktive Assistenten für Oliver/Dienstleister/Betreiber); heilt veraltetes Schema selbst, räumt restlos auf.
- Skript `verify-test-db-cleanup` — beweist die Test-DB-Selbstheilung. FK-Wächter: neue team-gebundene Tabellen (FK auf `teams.id` ohne Cascade) MÜSSEN in `TEAM_BOUND_TABLES` (`scripts/src/lib/account-tree.ts`) ergänzt werden.
- Retention-Regressionstest `platform-errors.retention.test.ts` gegen die `_test`-DB (provisioniert sich selbst); Seed-Skript `seed-platform-errors` (Env `SEED_PLATFORM_ERRORS_*`) für den Retention-Hinweis-E2E.

### Dev-Testkonten (nur Dev-DB)

- Neuaufsetzen/Reparieren: Skript `setup-test-accounts` (idempotent, Fail-fast-Endkontrolle). `migrate-teams` fügt Nutzer mit bestehender Mitgliedschaft NICHT in Team 1 ein (Bootstrap-Semantik — sonst zerstörte jeder Task-Merge die Trennung).
- **Oliver Straub** `admin@dienstplan.local` — admin, privat, **premium**. „Standard-Team" (Team 1): 7 reale Assistenzkräfte inkl. Personalakten, Schichten, Verträgen, 4 Modelle.
- **Betreiber** `betreiber@dienstplan.local` — superadmin, privat, **free**. „Betreiber-Team": Max Mustermann 1–4 + Test-Assistent, 4 Modelle.
- **Test-Dienstleister** `dienstleister@dienstplan.local` — admin, dienstleister, **premium**. „Dienstleister-Team": Max Mustermann 5–9, 4 Modelle.
- **Test-Assistent** `assistent@dienstplan.local` — assistant, NUR im Betreiber-Team (Free-Eigentümer → Free-Gates greifen). Arbeitgeber-Plan-Features testen: Betreiber temporär auf premium.
- Dummys (max.mustermannN@dienstplan.local): kein Passwort, keine Premium-Lohndaten. Dummys + Test-Assistent: Vertrag 30h/30 Urlaubstage ab 2026-01-01.
