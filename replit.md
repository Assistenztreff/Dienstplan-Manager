# Dienstplan-App

Eine Dienstplan- und Zeiterfassungs-App für Persönliche Assistenz im Arbeitgebermodell, orientiert an "Assistenz-Connect".

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API-Server starten (Port 8080, erreichbar über `/api`)
- `pnpm --filter @workspace/dienstplan run dev` — Frontend starten (Port dynamisch, Pfad `/`)
- `pnpm run typecheck` — Vollständiger Typecheck über alle Pakete
- `pnpm --filter @workspace/dienstplan run test:e2e` — Playwright-E2E-Tests. Laufen gegen einen **isolierten Test-Stack** (eigener API-Server Port 8099 + Vite Port 5199) auf einer **separaten Test-Datenbank** `<dbname>_test`; die echte Dev-DB wird NICHT berührt. Die Test-DB wird automatisch provisioniert (`setup-test-db`). Override: `E2E_BASE_URL=...` setzen, um stattdessen gegen einen laufenden Stack (z.B. Proxy localhost:80) zu testen. Admin-Login: admin@dienstplan.local / admin1234
- `pnpm --filter @workspace/scripts run setup-test-db` — Test-Datenbank anlegen/aktualisieren (Schema-Push + Admin + Team-Migration, idempotent); wird von `test:e2e` automatisch aufgerufen
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
- **Farbkodierung pro Assistenzkraft**: Schicht-Badges und Monats-Punkte werden im Dienstplan **nach `userId`** eingefärbt (deterministischer Hash → Palette in `lib/shift-model-colors.ts`, `userColor/userBadgeClass/userDotClass`), nicht mehr nach Schichtart/Schichtmodell — so erkennt man auf einen Blick, wer arbeitet. **Abwesenheiten (Urlaub = Gelb, Krankheit = Grau) behalten bewusst ihre semantische Farbe** (sonst nicht mehr als Abwesenheit erkennbar). Ein wählbarer **Farbcode pro Dienst (Schichtmodell) wurde entfernt** (keine Farbauswahl im Dienst-Dialog, keine Farb-Punkte in der Dienste-Liste/Schicht-Auswahl), da die Kalender-Einfärbung ohnehin pro `userId` erfolgt. Die DB-Spalte `shift_models.color` bleibt mit Default `slate` bestehen (Bestandsdaten unberührt); `color` ist in der OpenAPI-Eingabe optional und wird vom Frontend nicht mehr gesendet. Die Palette `SHIFT_MODEL_COLORS` bleibt nur noch als interne Basis der userId-Farbzuordnung erhalten (`colorBadgeClass`/`colorDotClass` entfernt).
- **24h-Dienst-Hinweis**: Stimmen Start- und Enduhrzeit überein (z. B. 08:00–08:00) bei unterschiedlichen Zeitpunkten (Folgetag) — oder Legacy-Typ `full_day` — zeigt `ShiftBadge` unter der Zeit ein Tag „24h-Dienst".
- **Standard-Dienste-Seeding**: Neue Nutzer bekommen beim Registrieren (und Dev-Login-Team-Anlage) 4 Standard-Schichtmodelle ins Standard-Team: Frühdienst, Spätdienst, 24h Dienst, Bereitschaft (`artifacts/api-server/src/lib/default-shift-models.ts`). Urlaub/Krankheit werden NICHT als Modelle geseedet — sie laufen über das Abwesenheits-System.

## Multi-Team (Task 42 — Stufe 1: Fundament & Team anlegen)

- **Konto-Typ** auf `users`: `account_type` Enum (`privat` | `dienstleister`, Default `privat`). Privat = einzelner Assistenznehmer; Dienstleister = Verwaltung mehrerer Teams.
- **Tabellen**: `teams` (owner_id → users, cascade) und `team_members` (unique team_id+user_id). Alle Domänen-Tabellen (shifts, contracts, shift_models, time_tracking) haben jetzt `team_id NOT NULL`.
- **Team-CRUD**: `/api/teams` (GET/POST/PATCH/DELETE), strikt owner-scoped (`owner_id = session.userId`). DELETE liefert 409, solange Mitglieder oder Daten am Team hängen.
- **Gating**: Middleware `requireDienstleister` (Admin + accountType `dienstleister`, frisch aus DB gelesen). Frontend: Nav + Route `/team-verwaltung` nur für Dienstleister. **Der Konto-Typ wird bei der Registrierung festgelegt (siehe Auth → Registrierung) und ist danach nicht mehr in den Einstellungen umschaltbar** (die frühere `AccountTypeCard` wurde entfernt). Eine Änderung des Konto-Typs ist nur noch direkt in der DB (Spalte `users.account_type`) möglich; der `useUpdateUser`-Pfad mit `accountType` existiert in der API weiterhin, wird im Frontend aber nicht mehr genutzt.
- **teamId-Injektion**: Helper `resolveTeamId(userId)` (bevorzugt eigenes Team, sonst erste Mitgliedschaft) wird in alle Insert-Handler eingehängt; time_tracking erbt team_id von der verknüpften Schicht.
- **Migration**: `pnpm --filter @workspace/scripts run migrate-teams` (idempotent, läuft in post-merge VOR `db push`). Datentrennung über Teams folgt in Stufe 2/3 (#43 Zuweisung, #44 Wechsler).

### Stufe 2: Personen den Teams zuweisen (#43)

- **Mitgliedschafts-Endpunkte** in `routes/teams.ts`, alle `requireDienstleister` + owner-scoped:
  - `GET /api/teams/:id/members` — Mitglieder eines Teams als `TeamMember`-DTO inkl. `teamCount`.
  - `POST /api/teams/:id/members` `{userId}` — 201; 404 wenn Nutzer unbekannt; 409 bei Doppelzuweisung.
  - `DELETE /api/teams/:id/members/:userId` — 204; 404 wenn keine Mitgliedschaft.
- **IDOR-Schutz**: Helper `assertTeamOwnership(teamId, ownerId, res)` liefert 404 bei fremdem Team, bevor irgendeine Mitglieds-Operation läuft.
- **teamCount**: Subquery in `selectMembers` zählt, in wie vielen Teams **dieses Owners** der Nutzer Mitglied ist → Frontend-Badge "in N Teams" zeigt Mehrfachzuweisung; Entfernen aus einem Team lässt andere Mitgliedschaften unberührt.
- **Frontend**: `team-verwaltung.tsx` → `MembersDialog` pro Team (Select zum Hinzufügen aus `useListUsers`, Liste mit Rolle- und Mehrfach-Badge zum Entfernen).
- **Bewusst NICHT in Stufe 2**: Es gibt noch KEINE Nutzer-Eigentümerschaft (`users` ist ein globaler Pool, `listUsers` zeigt allen Admins alle Nutzer). Jeder Dienstleister kann daher prinzipiell jeden vorhandenen Nutzer zuweisen. Strikte Mandanten-/Datentrennung (Nutzer pro Dienstleister, Sichtbarkeitsgrenzen) ist explizit Stufe 3 (#44) und erfordert ein Schema-Modell für Nutzer-Zugehörigkeit.

### Stufe 3: Team-Wechsler & strikte Datentrennung (#44)

- **Erlaubte Teams** eines Nutzers = Teams, die er **besitzt** (`teams.owner_id`) ∪ Teams, in denen er **Mitglied** ist (`team_members`). Zentral in `lib/teams.ts`:
  - `getAllowedTeamIds(userId)` — Vereinigungsmenge.
  - `resolveReadTeamScope(userId, reqTeamId?)` → `number[] | null` (null = 403 forbidden, wenn angefragtes Team nicht erlaubt; sonst Liste der erlaubten bzw. das eine angefragte Team).
  - `resolveWriteTeamId(userId, reqTeamId?)` → `{ok:true, teamId}` | `{ok:false, reason:"forbidden"|"none"}` (403 / 400).
  - `parseTeamIdParam(req)` — Query-Param `teamId` mit NaN-Guard.
- **Echtes Backend-Scoping** (nicht nur UI) auf allen Domänen-Routen:
  - GET-Listen (shifts, contracts, time_tracking, shift_models): `inArray(table.teamId, teamScope)`; 403 bei fremdem `teamId`, `[]` bei leerem Scope. `shift_models` GET war vorher ungescoped (Leak behoben).
  - POST: Ziel-Team aus `body.teamId` via `resolveWriteTeamId` (403 forbidden / 400 none); `time_tracking` erbt `teamId` von der verknüpften Schicht. **Member-of-Team-Invariante**: `body.userId` muss Mitglied des Ziel-Teams sein (`isUserMemberOfTeam`), sonst 403 — sonst ließe sich ein fremder Nutzer ins Team verknüpfen und seine PII über die user-gejointen Antworten auslesen. Greift bei POST shifts/contracts/time_tracking. PATCH-Bodies `ContractUpdate`/`TimeEntryUpdate` enthalten weiterhin bewusst kein `userId`. **Ausnahme `ShiftUpdate`**: erlaubt jetzt ein optionales `userId` (Assistenten-Wechsel, genutzt vom Massen-Ändern bestehender Schichten, #145). Der PATCH-Handler erzwingt dafür dieselbe Member-of-Team-Invariante (`isUserMemberOfTeam(body.userId, oldShift.teamId)` → 403) und prüft Überschneidung/Doppel-Abwesenheit gegen den NEUEN `effectiveUserId`; das Team der Schicht bleibt unverändert. Legacy-Heilung: `migrate-teams` backfillt `team_members` idempotent aus bestehenden (user_id, team_id)-Paaren.
  - PATCH/DELETE/GET:id: IDOR-Check — Row-`teamId` muss in `getAllowedTeamIds` liegen, sonst 404.
  - Dashboard (`summary` + `hours-balance`, Admin-Branch) gescoped (akzeptiert optionalen `teamId`); alle Schicht-/Zeit-/Assistenten-Queries gescoped (Assistenten = Team-Mitglieder via `team_members`-Join). Assistant-Branch bleibt rein userId-personal.
  - **`GET /users` strikt gescoped** (kein globaler Pool mehr): ohne `teamId` Union der erlaubten Teams (`inArray(team_members.teamId, allowedTeams)`, dedupliziert), mit `teamId` genau dieses Team (403 bei fremd). **Bewusste Bootstrap-Ausnahme (#48), nur für `privat`-Konten:** Hat ein **privat**-Admin (Einzel-Assistenznehmer, kein Mandant) gar kein erlaubtes Team (weder Besitz noch Mitgliedschaft) UND fragt kein `teamId` an, fällt die Antwort auf den globalen Pool zurück — sonst wäre die Liste bei Erst-Einrichtung leer (kein Selbsteintrag, keine Zuordnung möglich). Der Konto-Typ wird frisch aus der DB gelesen. **`dienstleister`-Konten bekommen NIE den globalen Pool** (auch nicht bei null Teams → leere Liste bis ein Team angelegt ist); echte Mandantentrennung bleibt strikt. Sobald ein privat-Admin ≥1 Team hat, greift ebenfalls wieder strikte Trennung. Damit neu angelegte Nutzer in gescopten Listen/Pickern (alle aus `useListUsers`, nicht aus Shifts) sichtbar bleiben, ordnet **`POST /users`** den Nutzer einem Team zu: optionales `teamId` (nur Mitgliedschaft, KEINE `users`-Spalte → vor Insert strippen) via `resolveWriteTeamId` (Default = Team des Erstellers), Mitgliedschaft per `onConflictDoNothing`. Frontend reicht `selectedTeamId` in `createUser`/`createContract` (assistenten) und `createShiftModel` (einstellungen) durch.
- **OpenAPI**: `teamId` als Query-Param (listShifts, listContracts, listTimeEntries, listShiftModels, getDashboardSummary, getHoursBalance, listUsers) und als optionales Body-Feld (Shift/Contract/ShiftModel/TimeEntry-Input). Nach Spec-Änderung Codegen ausgeführt.
- **Frontend Team-Wechsler**: `context/team.tsx` (`TeamProvider`/`useTeam`) lädt Teams nur für Dienstleister, persistiert `selectedTeamId` in localStorage (bereinigt Auswahl, wenn Team verschwindet oder Konto-Typ wechselt). `components/team-switcher.tsx` (Dropdown "Alle Teams" + Teams) nur sichtbar für Dienstleister mit ≥1 Team; eingebunden in Header von Dashboard, Dienstplan, Auswertungen. `teamId` wird an die List-Hooks und in das Shift-Create-Payload (`ShiftDialog`) durchgereicht; PDF-Export filtert per-User-Schichten ebenfalls auf das gewählte Team.
- **Verifiziert** (curl + temporäres 2. Team): fremdes `teamId` → 403; teamScopes liefern disjunkte Datenmengen (Team A + Team B = Gesamtmenge ohne `teamId`); `users?teamId` → nur Mitglieder dieses Teams.

## SaaS-Plan (Free vs. Premium) & Entitlements

- **`plan`-Spalte** auf `users` (`planEnum` `free` | `premium`, Default `free`). Wird in allen AuthUser-Responses (`/auth/login`, `/auth/me`, `/auth/register`, `/auth/dev-login` inkl. Switch-Branch, `/auth/set-password`) ausgeliefert; in OpenAPI an `AuthUser` UND `User` als **required** ergänzt. Frontend-`AuthUser`-Type (hand-gerollt in `context/auth.tsx`) + `readStoredSession`-Validierung kennen `plan`.
- **Entitlement-Schicht (geteiltes Paket)**: `@workspace/entitlements` (`lib/entitlements/src/index.ts`) ist die Single Source of Truth und wird von **Frontend UND API-Server** importiert (vorher lag die Config nur im Frontend). `PLAN_CONFIG` definiert pro Plan Features (boolean) und Limits (number | null = unbegrenzt). Helfer: `hasAccess(user, feature)`, `getLimit(user, limit)`, `isWithinLimit(user, limit, count)`, `resolvePlan` (Default `free`), `isPremium`. Free: maxAssistants 6, maxTeams 1, maxShiftModels 5, historyMonths 1, nur `basicPersonnelFile`/`basicExport`. Premium: Limits null/12, alle Features. Das Frontend-Modul `artifacts/dienstplan/src/lib/entitlements.ts` re-exportiert nur noch aus diesem Paket (bestehende `@/lib/entitlements`-Importe unverändert).
- **Serverseitige Durchsetzung (autoritativ, Task #205)**: Der Client ist nicht vertrauenswürdig — die Frontend-Gates sind reine UX. Der API-Server setzt die Limits jetzt verbindlich mit DERSELBEN Config durch. Helfer in `artifacts/api-server/src/lib/plan.ts`: `getUserPlan(userId)` (liest `users.plan` IMMER frisch aus der DB, analog `requireDienstleister` — manuelle Premium-Freischaltung wirkt sofort), `userHasFeature`, `userWithinLimit`, Middleware `requirePlanFeature(feature)`.
  - **maxShiftModels** in `routes/shift_models.ts` POST: zählt vorhandene Modelle im Ziel-Team und liefert 403 `{code:"plan_limit_reached", limit:"maxShiftModels"}`, wenn das Free-Limit (5) erreicht ist (Fehlertext nennt das Limit dynamisch via `getUserLimit`). **Bestandsschutz**: nur das Anlegen über dem Limit wird gesperrt; vorhandene Modelle bleiben editierbar/löschbar. **Seed/Limit-Abgleich (Task #207)**: Registrierung seedet 4 Standard-Modelle; das Free-Limit liegt bewusst bei 5 (= 4 Seeds + 1 eigener Dienst), damit ein frisch registriertes Free-Konto nicht bereits am Limit startet, sondern noch mindestens einen eigenen Dienst anlegen kann. Das Limit MUSS über der Seed-Anzahl bleiben.
  - **bulkEdit** in `routes/shifts.ts` PATCH: Der Assistenten-Wechsel an einer bestehenden Schicht (`ShiftUpdate.userId`, ausschließlich von der Massenbearbeitung gesendet — der Einzel-Dialog sendet nie `userId`) verlangt das Premium-Feature `bulkEdit`, sonst 403 `{code:"plan_feature_required", feature:"bulkEdit"}`. Das normale Bearbeiten einzelner Schichten (Zeiten/Notiz/Typ ohne Assistenten-Wechsel) bleibt für Free frei (Bestandsschutz).
  - **Test-Infrastruktur**: `setup-test-db` setzt den Test-Admin nach `setup-admin` auf `plan='premium'` (nur Test-DB), damit bestehende E2E-Specs (parallele Modell-Anlage, Massenbearbeitung) grün bleiben; die Free-Gates werden isoliert mit frisch registrierten Free-Konten getestet.
  - **Noch nicht serverseitig durchgesetzt** (reine Konfiguration/Frontend-UX): `maxAssistants`, `maxTeams`, `historyMonths` sowie die übrigen Feature-Flags. Beispiel-Frontend-Gates: 4. Schichtmodell (`einstellungen.tsx`), Massenbearbeitung „Mehrere bearbeiten" (`dienstplan.tsx`).
- **VERBINDLICHE REGEL — Bestandsschutz**: Free-Limits beschränken AUSSCHLIESSLICH das Anlegen von NEUEM (bzw. neue Aktionen). Bereits vorhandene Daten — Teams, Lohndaten, bereits geplante/vergangene Monate, vorhandene Schichtmodelle — dürfen NIEMALS ausgeblendet, gesperrt oder gelöscht werden, nur weil ein Konto auf dem Free-Plan ist. `isWithinLimit(user, limit, count)` prüft, ob ein WEITERER Eintrag erlaubt ist — es ist KEIN Anzeige-Filter. Konkret: `maxShiftModels` sperrt nur das Anlegen über dem Limit (vorhandene Modelle bleiben editierbar/löschbar), `maxAssistants`/`maxTeams` blockieren nur das Anlegen über dem Limit, `historyMonths` begrenzt nur die neue Planung/Vorwärts-Navigation (bereits erfasste Monate bleiben sichtbar), `advancedPersonnelFile`/`payrollExport` lassen bereits erfasste Lohndaten sichtbar. Aktuell sind nur `maxShiftModels` und `bulkEdit` durchgesetzt; alle weiteren Limits sind reine Konfiguration ohne Wirkung (blenden also nichts aus). Details siehe Kommentarblock in `entitlements.ts`.
- **Architektur-Hinweise** (als Kommentare in `entitlements.ts`): Auth ist hybrid (Plattform-SSO via JWT + lokal E-Mail/Passwort/Einladung). Billing läuft über die **Lexware API** (Rechnungsentwürfe), NICHT Stripe; Premium-Freischaltung erfolgt **manuell** im Operator-Dashboard nach Zahlungseingang.

## Operator-Dashboard & superadmin-Rolle

- **Rolle `superadmin`** als dritter Wert im `roleEnum` (DB + OpenAPI `AuthUser`/`User` + `express-session` `SessionData.role`). Wird NICHT über `UserInput`/Registrierung vergeben — superadmin nur direkt in der DB setzen.
- **`pages/operator-dashboard.tsx`**: interne Betreiber-Konsole (3 Platzhalter-Bereiche mit auskommentierten API-Andockpunkten): (1) Nutzer-/Team-Monitoring + manuelle Premium-Freischaltung, (2) Lexware-Buchungs-Log, (3) Fehler-Tracking. Reiner Platzhalter, keine API-Calls.
- **Zugang**: Route `/operator-dashboard` in `App.tsx` nur gerendert wenn `role === "superadmin"`. Dezenter, versteckter Link im `PlatformFooterPlaceholder` (`layout.tsx`) nur für superadmin — NICHT in `ALL_NAV_ITEMS`. **Noch offen**: Bevor das Dashboard echte privilegierte Aktionen ausführt, braucht es serverseitige `requireSuperadmin`-Middleware + geschützte Operator-Endpunkte (Frontend-Guard allein ist keine Autorisierung).

## PWA

- `artifacts/dienstplan/index.html` enthält PWA-Meta-Tags (`mobile-web-app-capable`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title`, `theme-color`) für Homescreen-Installation. Noch KEIN Web-App-Manifest / Service Worker (nur Meta-Tag-Grundlage).

## Einbettung in die Assistenztreff-Plattform (iframe, Weg 1)

Die Dienstplan-App wird als eigenständige React/Express-App in die externe Assistenztreff-Plattform (proprietäres Symfony-Produkt von Lulububu Software GmbH) per `<iframe>` unter dem Menüpunkt **Connect** eingebettet. Eigene Postgres-DB bleibt erhalten.

- **Cross-Site-Cookie**: In Produktion (oder mit `SESSION_COOKIE_CROSS_SITE=1`) setzt der API-Server das Session-Cookie als `SameSite=None; Secure` — sonst wird es im fremden iframe-Origin nicht mitgesendet und der Login schlägt still fehl. Lokal/Dev bleibt es `Lax` (kein HTTPS-Zwang). Siehe `artifacts/api-server/src/app.ts`.
- **Embed-Modus**: `?embed=1` in der iframe-URL aktiviert den Modus (gemerkt in sessionStorage, `src/lib/embed.ts`). Dann blendet `layout.tsx` das AssistenzTreff-Logo aus, damit nur die Plattform-Hülle (Header/Footer) als Chrome sichtbar ist. Bewusst keine `window.top`-Auto-Erkennung (die Replit-Vorschau ist selbst ein iframe).
- **Plattformseite (nicht im Repo)**: (1) iframe-Snippet in die Connect-CMS-Seite einsetzen, URL inkl. `?embed=1`; (2) Deploy-Domain der Dienstplan-App in `config/packages/nelmio_security.yaml` unter `frame-src` (Blöcke `enforce` UND `report`) eintragen, sonst blockt die CSP der Plattform den iframe.
- **Caveat (Chrome 3rd-party cookies)**: `SameSite=None` kann in iframes künftig partitioniert/blockiert werden; ggf. `Partitioned`/CHIPS nachrüsten, falls der Login speziell in Chrome scheitert.

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
- Passwort vergessen: Öffentliche Seite `/passwort-vergessen` (in `PUBLIC_PATHS`), verlinkt aus dem Anmeldefenster. Kein E-Mail-Self-Service — verweist auf den Administrator, der einen neuen Einladungslink schickt.
- Eigenes Passwort ändern: `POST /api/auth/change-password` (`{currentPassword, newPassword}`, session-scoped, prüft aktuelles Passwort, min. 8 Zeichen, strikte `typeof`-String-Validierung vor dem Hashing). Frontend: Karte "Profilinformationen" unter Einstellungen (Name/E-Mail/Passwort) mit `useChangePassword`-Dialog.
- Eigenen Namen/E-Mail ändern: `POST /api/auth/update-profile` (`{name, email}`, session-scoped, validiert nicht-leeren Namen + E-Mail-Format, E-Mail wird normalisiert (lowercase/trim), 409 wenn E-Mail bereits von anderem Nutzer belegt, liefert aktualisierten `AuthUser`). Frontend: `EditProfileDialog` in der Profilinformationen-Karte (`useUpdateProfile` + `refreshUser`).
- Logo (blauer Schriftzug): Das neue Asset `attached_assets/20260626_094418_0000_1782459883949.png` wird überall verwendet, wo ein Logo mit blauer Schrift auf hellem Hintergrund erscheint (Login, Passwort-vergessen, Einladung, PDF-Stundennachweis-Standardlogo). Das weiße Logo in der dunklen Sidebar (`layout.tsx`, `Arbeitgebermodell oder Assistenzdienst.png`) bleibt bewusst erhalten (Kontrast).
- Registrierung (Self-Service): Öffentliche Seite `/registrierung` (in `PUBLIC_PATHS`, verlinkt vom Anmeldefenster). Endpoint `POST /api/auth/register` (`{name, email, password, accountType}`, public, kein Auth). Legt einen **Admin**-Nutzer mit dem gewählten `accountType` (`privat` | `dienstleister`) an, erzeugt ein initiales Team („Standard-Team", owner = neuer Nutzer) inkl. Mitgliedschaft (sonst schlüge das spätere Anlegen von Assistenten via `resolveWriteTeamId` mit „none"/400 fehl) und meldet direkt an (Session gesetzt). Validierung: nicht-leerer Name, E-Mail-Format, Passwort ≥ 8 Zeichen, `accountType` aus Enum; 409 bei bereits vergebener E-Mail. **Der Konto-Typ ist damit bei der Registrierung festgelegt** und in den Einstellungen nicht mehr änderbar. Hinweis: In Vite-DEV verhindert das Auto-Dev-Login das Rendern der öffentlichen Seiten (man ist sofort als Admin eingeloggt) — `/registrierung` ist im Dev-Vorschaufenster daher nicht sichtbar, funktioniert aber im Prod-Build und per API.
- Erster Admin-User anlegen: `pnpm --filter @workspace/scripts run setup-admin` (Standard: admin@dienstplan.local / admin1234)
- Session-Secret via Umgebungsvariable `SESSION_SECRET` (bereits als Secret gesetzt)

## Layout & UI-Verhalten

- **Fixierte Desktop-Sidebar** (`components/layout.tsx`): Die linke Sidebar ist ab `md` `position: fixed` über die volle Höhe (`md:fixed md:inset-y-0 md:left-0 md:w-64 md:h-screen`). Der Navigationsbereich scrollt bei Bedarf intern (`flex-1 min-h-0 overflow-y-auto`), der Block mit Nutzername + „Abmelden" bleibt unten fixiert (`shrink-0`). Der Hauptbereich hat `md:ml-64` (kein Überlappen) und scrollt unabhängig (`overflow-y-auto`). Mobil unverändert (Sheet-Drawer, nur `md:`-Klassen betroffen).
- **Firmenlogo nur für Dienstleister** (`pages/einstellungen.tsx`): Die `LogoSettingsCard` (PDF-Logo-Upload) wird ausschließlich gerendert, wenn `currentUser.accountType === "dienstleister"`. Beim Umschalten Dienstleister→Privat wird die Karte sauber aus dem DOM entfernt (verhindert den früheren Render-Crash). **Bewusste Folge:** Privat-Konten können kein eigenes PDF-Logo mehr setzen — es gilt das Standard-Logo. Falls Privat-Konten wieder ein globales Logo verwalten sollen, Karte für alle Admins rendern und nur die team-spezifischen Hinweise/Parameter per Konto-Typ gaten.

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
