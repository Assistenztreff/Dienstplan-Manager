# Dienstplan-App

Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell.

## User preferences

- (keine)

## Stack & Betrieb

- **Single Responsive Web App (PWA)** — EINE React-Codebasis, KEINE native App; Geräteanpassung nur über Tailwind-Breakpoints.
- **Contract-first**: `lib/api-spec/openapi.yaml` = Single Source of Truth. Orval-Codegen → React-Query-Hooks (`@workspace/api-client-react`) + Zod-Schemas (`@workspace/api-zod`). Routen validieren mit generierten Zod-Schemas; Frontend nutzt NUR generierte Hooks; generierte Verzeichnisse NIE manuell editieren.
- pnpm workspaces, Node 24, TS 5.9. API: Express 5 (`artifacts/api-server`, `/api`, Port 8080). Frontend: React + Vite + Tailwind + wouter (`artifacts/dienstplan`). DB: PostgreSQL + Drizzle (`lib/db`, kein Raw-SQL in Routen).
- Befehle: `pnpm run typecheck`; Codegen nach openapi.yaml-Änderung: `pnpm --filter @workspace/api-spec run codegen`; DB-Push (nur Dev): `pnpm --filter @workspace/db run push`.
- Skripte (`pnpm --filter @workspace/scripts run <name>`): `setup-admin` (erster Admin admin@dienstplan.local / admin1234); `setup-superadmin -- <email> <pw> [name]` (idempotent, min. 8 Zeichen, Befördern bestehender Konten nur mit `--promote`); `migrate-teams` (idempotent, läuft in post-merge VOR `db push`).
- **Veröffentlichen auf Produktion** (Schema zuerst, Code danach — additive Änderungen sind abwärtskompatibel): 1) Tests grün (`typecheck` + Merge-Validierung), 2) Dry-Run `PROD_DATABASE_URL='postgres://…' pnpm --filter @workspace/scripts run migrate-prod` (zeigt nur geplante Statements, ändert NICHTS), 3) Anwenden mit Bestätigung `… run migrate-prod -- --yes <dbname>` (`<dbname>` = exakter DB-Name der Ziel-URL; führt zuerst die Daten-Migrationen wie im Post-Merge aus, dann Schema-Push + Verifikation), 4) Republish. Sicherheitsnetze: läuft NIE gegen `DATABASE_URL`/`APP_DATABASE_URL` (Abbruch bei gleichem Host+DB), interaktive drizzle-Prompts ⇒ klarer Abbruch mit Handlungsanweisung (idempotenter SQL-Vorab-Schritt, Vorbild `PRE_PUSH_SQL`/`post-merge.sh`), DROP der Session-Tabelle wird immer blockiert; Scaleway: URL-Normalisierung automatisch, selbstsignierte Zertifikate via `DATABASE_SSL_NO_VERIFY=1`.
- Env required: `DATABASE_URL`, `SESSION_SECRET`. Optional (Warn-Mails): `RESEND_API_KEY`, `ERROR_ALERT_EMAIL`, `ERROR_ALERT_FROM`.

## Produktregeln

- **Rollen**: `admin` (Assistenznehmer, Vollzugriff), `assistant` (nur eigene Daten), `superadmin` (Betreiber; NUR per DB/Skript, nie über Registrierung; nutzt App wie Admin via `isAdminLikeRole`, plus Operator-Dashboard). `requireDienstleister` bleibt an `account_type` gebunden.
- **Konto-Typ** (`users.account_type`: `privat` | `dienstleister`): bei Registrierung fixiert, danach NICHT im UI änderbar. Privat = ein Assistenznehmer; Dienstleister = mehrere Teams.
- **Planungsstatus** (Monatskalender): VORLAEUFIG / ANGEBOTEN / FIX. DB-Default FIX, neue Schichten im Dialog aber VORLAEUFIG (bewusst entkoppelt). **Nur FIX-Schichten zählen** in Auswertungen und PDF. Abwesenheiten Default FIX. Bestätigen einzeln oder monatsweise (PATCH `planningStatus: FIX` + `force: true`).
- **Schichtmodelle** (`shift_models`) tragen selbst Standard-Zeiten + `default_weekdays` (1–7, Mo=1) — keine separaten Arbeitszeit-Vorlagen. Dialog füllt Zeiten vor; Bulk-Anlage gleicht Wochentage nur als Hinweis ab, Anlegen an „unpassenden" Tagen bleibt erlaubt. „+ Neuen Dienst" für Free UND Premium sichtbar (Limit greift erst beim Speichern).
- **Seeding**: Registrierung legt 5 Standard-Modelle an (Frühdienst, Spätdienst, Nachtdienst, Bereitschaft, 24h Dienst). Urlaub/Krankheit sind KEINE Modelle (eigenes Abwesenheits-System).
- **Vergütungstyp pro Dienst** (`shift_models.compensation_type`): `regular` = Stundenlohn × bewertete Stunden (Basis nach `billingMethod`: SOLL = geplante, IST = bestätigte Ist-Stunden); `percentage` = zusätzlich × `compensation_percent`/100; `flat` = fester Betrag `compensation_flat_cents` unabhängig von Stunden.
- **Zeiterfassung**: IST-Zeiten offen/bestätigt/abgelehnt. Schalter „Stundenzettel automatisch genehmigen" (`allowance_settings.auto_approve_timesheets`): neue IST-Zeiten sofort bestätigt. Auswertungen: Soll/Ist je Assistent & Monat.
- **Geld folgt der Abrechnungsart**: Zuschlags-Stunden UND Zuschlags-**Vergütung** (Nacht/Sonntag/Feiertag) folgen dem `billingMethod`-Toggle SOLL/IST — gleiche Basis wie die Stunden-Spalten. Abwesenheits-Zuschläge werden in beiden Modi fortgezahlt.
- **Zeiterfassung AUS ⇒ planbasierte Lohnrechnung**: Bei deaktiviertem Konto-Schalter „Zeiterfassung aktivieren" (`allowance_settings.time_tracking_enabled`, Default AUS) ist die effektive Abrechnungsart IMMER SOLL (`resolveEffectiveBillingMethod`) — Grundvergütung + Zuschläge kommen komplett aus den geplanten FIX-Schichten, der konfigurierte SOLL/IST-Toggle bleibt gespeichert. `GET /dashboard/summary` liefert dann `timeTrackingEnabled=false`, keine Zeiterfassungs-Kennzahlen (pending/uncounted=0, recentTimeEntries leer) und `monthlyActualHours` = FIX-Plan-Stunden; das Dashboard blendet die Zeiterfassungs-Kacheln aus. Bei EIN alles unverändert.
- **Premium-Lohnauswertung** (`GET /dashboard/hours-balance`, Param `hourlyWage`): Geldwerte nach `billingMethod` (SOLL = geplante FIX-Dienste, IST = bestätigte Ist-Zeiten); Grundvergütung je Dienst/Eintrag nach `compensationType` (SOLL aus dem Schichtmodell der Schicht); **Lohnfortzahlung**: Urlaub/Krank zählen mit Stundenlohn × valuedHours in den Grundlohn (beide Modi). **0%-Zuschläge werden NICHT aufgelistet** (UI + PDF filtern `percent>0`).
- **Zuschlags-Sätze** (`allowance_settings`): eine Konto-Zeile je Admin (`team_id IS NULL`, lazy, Defaults 25/50/100, Nachtfenster 23–06 Uhr) + optional EINE Override-Zeile je Team (`team_id` UNIQUE). Fallback-Kette: **Team-Override → Konto des Team-Eigentümers → Defaults**. API `?teamId=` nur für eigene Teams (403); UI nur Dienstleister.
- **Urlaub nur im Vertragszeitraum**: Hat die Assistenzkraft ≥1 Vertrag (irgendwo), aber KEINER **im Schicht-Team** deckt das Urlaubsdatum (Start- UND End-Tag), lehnen POST/PATCH `/shifts` mit 400 `vacation_outside_contract` ab (deutsche Meldung mit „Vertrag ab/bis"-Hinweis; Deckung + Hinweise NUR aus Verträgen des Schicht-Teams — kein teamfremder Vertragsdaten-Leak). Ohne jeden Vertrag kein Block; Krankheit/Freizeitausgleich ungegated; Bestandsschutz: Notiz-/Status-Edits bestehender Alt-Urlaube bleiben erlaubt.
- **Vortags-Nachtdienst bleibt bei Urlaub stehen** (Produktentscheidung): Die Abwesenheits-Ersetzung matcht bewusst nur Dienste mit `DATE(startTime) = Urlaubstag`. Ein Nachtdienst, der am Vortag beginnt und in den Urlaubstag hineinragt (z. B. 20:00–06:00), wird NICHT ersetzt — er gehört zum Vortag und bleibt voll im Soll; der Urlaub am Folgetag zählt als Lohnfortzahlung (ganztägig 00:00–23:59 ⇒ kein zusätzliches Soll). Kein Bug; per API-e2e-Test festgeschrieben (`dienstplan-vortags-nachtdienst-bleibt-bei-urlaub-api.spec.ts`).
- **Urlaub stundenbasiert**: 1 Tag = 8 h (`hoursPerDay`); 24h-Urlaubsdienst = 3,0 Tage. `contracts.vacationHoursUsed` ist der EINZIGE Zähler; Tage sind ÜBERALL abgeleitet (`vacationHoursUsed / hoursPerDay`, gerundet auf 0,1). Methode `bwavg` oder `factor`. `GET /contracts/:id/vacation-balance` liefert Stunden UND abgeleitete Tage. Ohne Vertrag Fallback in der UI = geplante Urlaubs-Schichten des Jahres. `vacationHoursUsed` MUSS im `CONTRACT_SELECT` der Route stehen, sonst rechnet die UI mit 0.
- **Regionale Feiertage**: wählbares Bundesland (Einstellungen); ohne Bundesland nur bundesweite. Keine rückwirkende Neuberechnung.
- **Farbkodierung nach `userId`** (deterministischer Hash, `lib/shift-model-colors.ts`), nicht nach Schichtart. Abwesenheiten behalten semantische Farben (Urlaub Gelb, Krankheit Grau). `shift_models.color` bleibt in der DB, Frontend sendet sie nicht.
- **24h-Dienst**: identische Start-/Enduhrzeit über Tagesgrenze oder Legacy `full_day` → Anzeige „24h-Dienst".
- **Monatsabschluss (Soft-Close)** (`month_closings`, append-only): Admin friert die Lohnauswertung eines VERGANGENEN oder des LAUFENDEN Monats ein (POST `/month-closings`, nur ZUKÜNFTIGER Monat → 400 `month_not_closable`); Premium-Gate wie `advancedAnalytics`, team-gescoped. Bearbeiten bleibt IMMER möglich (nur Warn-Toast via `month-closing-warning.ts`, 1× pro Monat, 403 wird verschluckt). Abweichungen zum eingefrorenen Stand = „Nachberechnung" (GET `/month-closings/diff`, nur Zeilen mit Differenz, inkl. `diffBasePay`/`diffSurchargePay`) in der Auswertung des Folgemonats; die Summen fließen als klar beschriftete Position „Nachberechnung {Vormonat}" in die Gesamtsummen-Karte (`PayrollTotalsCard`) UND in den PDF-Stundennachweis ein. Erneuter Abschluss ersetzt die Referenz (neueste Zeile zählt), Historie bleibt. Status liefert `pendingTimeEntries` (Plausibilitätswarnung im Abschluss-Dialog); Dashboard-Erinnerung, wenn Vormonat offen.
- **Team-Dienst (Teamsitzung)** (`shifts.type = team`): Konto-globaler Schalter `allowance_settings.team_meeting_enabled` (Default AUS) + `team_meeting_hours` (Default 1,0). Anlegen nur bei EIN (400 `team_meeting_disabled`), EIN Eintrag pro Team+Tag (409 `team_meeting_duplicate`), serverseitig FIX + ganztägig erzwungen, kein Einsatz/Überschneidungs-Konflikt. Gutschrift in der Auswertung: FIX-Team-Tage × Stunden für ALLE Team-Mitglieder, bilanz-neutral (Soll UND Erfüllung), Grundlohn = Stundenlohn × Stunden (beide Abrechnungsarten, keine Zuschläge); füllt `teamsitzungStunden`/`teamsitzungEuro` in hours-balance (Matrix-Zeile nicht mehr ausgegraut). Semantische Farbe Sky (nicht Personen-Palette); im einfachen Monats-PDF eigene Zählzeile, NICHT in Plan-Stunden. Bestandsschutz: Schalter AUS blendet nur die Auswahl aus, bestehende Einträge + Gutschrift bleiben.
- **Aushilfe-Einsatz** (`shifts.einsatz_team_id`, nullable FK): Schicht bleibt im Stammteam (Stunden/Auswertung/PDF zählen NUR dort), optional „Einsatz für" ein ANDERES eigenes Team. Server: gleiches Team → 400, fremdes Team → 403, Abwesenheiten → 400; Typwechsel zu Abwesenheit nullt den Einsatz. GET-Liste liefert Spiegel-Schichten (`einsatzTeamId ∈ Scope`); Spiegel im Ziel-Team schreibgeschützt (kein Edit/Bestätigen/Sammelbestätigung, nicht im Monats-PDF). Kein fester Dienst „Aushilfe".

## Multi-Team & Datentrennung (Sicherheits-Invarianten)

- **Erlaubte Teams** = besessene (`teams.owner_id`) ∪ Mitgliedschaften (`team_members`); Helfer in `lib/teams.ts`.
- **Team-CRUD** `/api/teams`: nur `requireDienstleister`, owner-scoped; DELETE 409 solange Daten/Mitglieder hängen; Member-Endpunkte mit IDOR-Check `assertTeamOwnership`.
- **Überführen** `POST /teams/:id/members/:userId/move`: atomarer Team-Wechsel in EINER Transaktion; Ownership auf Quell- UND Ziel-Team (fremd → 404), Quelle=Ziel/bereits im Ziel → 409. Bestehende Daten behalten ihr Team. Team-Wechsel läuft AUSSCHLIESSLICH über Überführen (keine Zuordnen-Sektion).
- **Backend-Scoping-Invarianten** (alle Domänen-Routen):
  - GET-Listen: nur Teams im Scope; 403 bei fremdem `teamId`, `[]` bei leerem Scope.
  - POST: Ziel-Team via `resolveWriteTeamId`; `time_tracking` erbt `teamId` von der Schicht. **Member-of-Team-Invariante**: `body.userId` muss Mitglied des Ziel-Teams sein, sonst 403 — gilt für POST shifts/contracts/time_tracking (keine Aushilfen-Ausnahme).
  - PATCH/DELETE/GET:id: Row-`teamId` muss in `getAllowedTeamIds` liegen, sonst 404 (IDOR).
  - `ShiftUpdate` erlaubt optionales `userId` (Assistenten-Wechsel, nur Massenbearbeitung) mit derselben Member-of-Team-Invariante + Überschneidungsprüfung gegen den NEUEN Nutzer; Team der Schicht bleibt.
  - `GET /users` strikt gescoped, kein globaler Pool. Einzige Ausnahme: `privat`-Konto ohne jedes Team + ohne `teamId` (Erst-Einrichtung); `dienstleister` NIE. `POST /users` legt via `teamId` eine Mitgliedschaft an.
  - Dashboard: Admin-Branch team-gescoped (optionaler `teamId`); Assistant-Branch rein userId-personal.
- **`teamId` NOT NULL** auf shifts/contracts/shift_models/time_tracking — JEDER Insert (inkl. Abwesenheits-Auto-Booking) muss es liefern.
- Frontend: `context/team.tsx` + Team-Switcher (nur Dienstleister, `selectedTeamId` in localStorage). **Kein „Alle Teams"**: Dienstleister haben IMMER genau ein Team gewählt (leerer/ungültiger Wert → erstes Team).

## Free/Premium (Entitlements)

- `users.plan` (`free` | `premium`, Default `free`), in OpenAPI an `AuthUser` UND `User` required.
- **`@workspace/entitlements`** = Single Source of Truth (`PLAN_CONFIG`). Free-Limits: maxAssistants 6, maxTeams 1, maxShiftModels 5 (= Seed-Anzahl, Free startet AM Limit), historyMonths 1.
- **Server autoritativ, Frontend-Gates reine UX.** `getUserPlan` liest IMMER frisch aus der DB. Maßgeblich ist der Plan des **Team-Eigentümers**; Assistenten-Zugang via Arbeitgeber-Plan (`requirePlanFeatureViaTeamOwner`, Owner-Fallback NUR für Rolle assistant, ein Premium-Arbeitgeber genügt).
- **Gates** (403 `plan_limit_reached` / `plan_feature_required`):
  - Limits beim Anlegen; `historyMonths` bei shifts POST + PATCH-mit-`startTime` (Zukunft blockiert, Vergangenheit nie). Abwesenheiten NICHT gegated.
  - `bulkEdit`: Assistenten-Wechsel via `ShiftUpdate.userId` nur Premium.
  - `advancedPersonnelFile`: Lohn-/SV-Felder (birthDate, socialSecurityNumber, taxId, taxClass, healthInsurance, iban) nur Premium; PATCH blockt nur ECHTE Änderungen gegen den DB-Stand.
  - `advancedAnalytics` (`GET /dashboard/hours-balance`) — setzt transitiv `payrollExport` durch; `dashboard/summary` bleibt frei.
  - `caregiverLogin` (`POST /users/:id/invite`): Einladen nur Premium. Bestandsschutz: bereits eingeladene Assistenten loggen sich weiter ein.
  - `absenceTracking`: Frontend-Gate in `abwesenheiten.tsx` + Server-Gate `GET /contracts/:id/vacation-balance`. Assistenten NUR eigene Bilanz (fremder Vertrag → 404). Eintragen von Urlaub/Krankheit + Rohdaten bleiben für ALLE Pläne zugänglich.
  - `strictTimeTracking` (`PATCH /time-tracking/:id/confirm`): Bestätigen/Ablehnen nur Premium. `dashboard/summary`: bestätigte IST immer, offene zusätzlich in Free-Eigentümer-Teams, abgelehnte nie; KEIN Auto-Bestätigen beim Upgrade; `uncountedPendingHours`/`-Entries` fürs Dashboard.
  - `calendarSync`: ICS-Export der FIX-Schichten + öffentlicher Abo-Feed `GET /calendar-feed/:token` (`users.calendar_token` unique/nullable; Premium-Gate über Token-Eigentümer, 404 bei unbekanntem Token). `GET/POST /calendar-token` Premium (POST rotiert); `DELETE` bewusst OHNE Gate (Widerruf auch nach Downgrade).
- **Einfacher Monats-Export** (`basicExport`, auch Free): „Monats-PDF" für Admin UND Assistent, rein aus `GET /shifts` (FIX + Abwesenheiten), OHNE Zeiterfassung/Soll-Ist/Zuschläge.
- **VERBINDLICHE REGEL — Bestandsschutz**: Free-Limits beschränken AUSSCHLIESSLICH neues Anlegen. Bestehende Daten NIEMALS ausblenden/sperren/löschen nur wegen Free. `isWithinLimit` ist KEIN Anzeige-Filter.
- **Billing**: Lexware API (Rechnungsentwürfe), NICHT Stripe; Premium-Freischaltung manuell im Operator-Dashboard. `/preise` (nur `admin`) rendert Vergleich aus `PLAN_CONFIG`, CTA = mailto — kein Self-Service-Checkout.

## Auth

- Session-basiert (`express-session`, Cookie `connect.sid`, 7 Tage). Middleware `requireAuth`/`requireAdmin`/`requireDienstleister`/`requireSuperadmin` — Rollen/Typ jeweils frisch aus DB.
- **Registrierung** (public): `/registrierung` legt Admin mit gewähltem `accountType` an, erzeugt „Standard-Team", meldet direkt an.
- **Einladungsflow**: `POST /api/users/:id/invite` → Passwort via `/einladung?token=...`. Passwort vergessen: `/passwort-vergessen` verweist auf den Admin (kein E-Mail-Self-Service).
- **PUBLIC_PATHS**: `/login`, `/registrierung`, `/einladung`, `/passwort-vergessen`.
- **Dev-Auto-Login**: In Vite-DEV feuert die App bei 401 automatisch `POST /api/auth/dev-login` (öffentliche Seiten in Dev-Vorschau daher nicht sichtbar). Dev-Session-Cache (`assistenz_treff_session`, nur DEV) speichert NUR das nicht-sensible Profil; Cookie bleibt die Wahrheit.

## Operator-Dashboard & superadmin

- `/operator-dashboard` (nur `superadmin`, Frontend-Guard = UX): Nutzer-Monitoring, Premium-Freischaltung, Fehler-Tracking, Lexware-Log. Serverseitig schützt `requireSuperadmin` ALLE `/api/operator/*` (Admin/Assistant → 403, unauthentifiziert → 401).
- **Plan-Freischaltung**: `PATCH /operator/accounts/:id/plan` (Ziel muss Rolle `admin` haben, sonst 404; wirkt sofort). Jeder Plan-Flip append-only in `plan_changes` (Audit-Log, `note` ≤500 Zeichen), `GET /operator/plan-changes`.
- **Fehler-Tracking**: zentraler Express-Error-Handler antwortet 500-JSON ohne Details, persistiert gebündelt in `platform_errors` (gleiche Meldung+Kontext = EINE Zeile, `count`/`last_seen_at`). Retention 500 Einträge. Abhaken einzeln oder gesammelt; Dev-Route `GET /api/dev/boom` (nur NODE_ENV≠production).
- **Warn-E-Mail bei Level error** (Resend, fire-and-forget, wirft NIE): ohne `RESEND_API_KEY` Skip; Drosselung 15 min pro Meldung+Kontext; Fallbacks für Empfänger/Absender.
- **Lexware-Buchungs-Log**: Dummy mit Adapter (`lib/lexware.ts`); ohne `LEXWARE_API_KEY` Mock (`source: "demo"`, Badge „Demo-Daten"); mit Key wirft `getLexwareClient()` bewusst LAUT (echter Client folgt nach DB-Migration auf deutschen Server) — späterer Umbau = nur Adapter-Tausch.

## PWA & Standalone-Betrieb

- PWA-Meta-Tags vorhanden; noch KEIN Manifest/Service Worker. Die App läuft eigenständig (First-Party) unter der Subdomain dienstplan.assistenztreff.de — KEINE iframe-Einbettung mehr; eigene Postgres-DB bleibt.
- **Session-Cookie**: immer `SameSite=Lax`; in Produktion zusätzlich `Secure` (HTTPS via Proxy, `trust proxy` gesetzt). Kein Embed-Modus, kein `SESSION_COOKIE_CROSS_SITE` mehr; Plattform-Header-/Footer-Platzhalter werden IMMER gerendert (die App liefert die „Plattform-Optik" selbst).

## Tests

- `pnpm run typecheck` prüft auch `e2e/**/*` + `playwright.config.ts` (`tsconfig.e2e.json`) — Typfehler in Specs fallen sofort auf.
- **Merge-Validierung** bei jedem Task-Abschluss (Kommandos laufen PARALLEL, Gesamt ≈ 7 min): `typecheck` + `unit` (Vitest dienstplan + db + api-server `test:unit`, alles DB-frei) + `e2e` (SERIELLE Kette, da alle drei die `_test`-DB teilen: api-server `test:db` = Retention-Test → `test:e2e:api` = alle `*-api.spec.ts` → `test:e2e:smoke` = kuratiertes UI-Smoke-Subset aus `e2e/smoke-specs.txt`). Rote Specs/Unit-Tests blockieren den Merge. Smoke-Liste erweitern: eine Spec-Datei pro Zeile in `smoke-specs.txt`.
- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright gegen isolierten Test-Stack (API 8099 + Vite 5199, DB `<dbname>_test`); Dev-DB unberührt. Config-Load: `setup-test-db` + Regressionschecks automatisch, Waisen-Prozesse werden erkannt/beendet. Skips: `E2E_SKIP_SEPARATION_CHECK=1`, `E2E_SKIP_CLEANUP_CHECK=1`, `E2E_SKIP_DB_SETUP=1`, `E2E_BASE_URL`. Test-Konten MÜSSEN dem Muster `e2e.*@dienstplan.test` folgen.
- Neue team-gebundene Tabellen → `TEAM_BOUND_TABLES` in `lib/test-fixtures/src/account-tree.ts` (FK-Wächter der Cleanup-Checks).

### Dev-Testkonten (nur Dev-DB)

- Neuaufsetzen: `setup-test-accounts` (idempotent).
- **Oliver Straub** `admin@dienstplan.local` — admin, privat, **premium**; „Standard-Team": 7 reale Assistenzkräfte inkl. Personalakten, Schichten, Verträge, 5 Modelle.
- **Betreiber** `betreiber@dienstplan.local` — superadmin, privat, **free**; „Betreiber-Team": Max Mustermann 1–4 + Test-Assistent.
- **Test-Dienstleister** `dienstleister@dienstplan.local` — admin, dienstleister, **premium**; „Dienstleister-Team": Max Mustermann 5–9.
- **Test-Assistent** `assistent@dienstplan.local` — assistant, NUR im Betreiber-Team (Free-Gates greifen). Für Arbeitgeber-Plan-Features Betreiber temporär auf premium.
- Dummys (max.mustermannN@dienstplan.local): kein Passwort; Dummys + Test-Assistent: Vertrag 30h/30 Urlaubstage ab 2026-01-01.
