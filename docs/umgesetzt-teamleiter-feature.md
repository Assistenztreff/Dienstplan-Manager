# Umgesetztes Feature: Teamleiter-Konten (Arbeitsanweisungen #687 + Nachprüfung)

Erstellt: 2026-08-01

---

## Übersicht

In zwei aufeinanderfolgenden Arbeitsanweisungen wurde die **Teamleiter-Rolle** vollständig implementiert und anschließend anhand einer 4-Punkte-Prüfliste nachgeprüft und korrigiert.

---

## Arbeitsanweisung 1 — Grundimplementierung (Task #687)

### Ziel
Teamleiter sind Assistenzkräfte, die vom Dienstleister (oder privaten Assistenznehmer) benannt werden und eingeschränkte Planungs- und Verwaltungsrechte erhalten — ohne volle Admin-Rechte.

### Datenbankschema (`packages/db/src/schema.ts`)

- Neues Feld `is_teamleiter BOOLEAN NOT NULL DEFAULT FALSE` auf `team_members`
- Neues Feld `can_view_payroll BOOLEAN NOT NULL DEFAULT FALSE` auf `team_members`
- Bedeutung:
  - `is_teamleiter = true` → Mitglied kann Dienstplan anderer Mitglieder bearbeiten, Abwesenheiten eintragen, Auswertungen einsehen
  - `can_view_payroll = true` → zusätzlich: Verträge anderer Mitglieder lesen/schreiben, Lohnfelder in Auswertungen sehen (nur bei Dienstleister-Konten sinnvoll)

### API-Server

#### `GET /api/auth/me`
- Gibt jetzt `isTeamleiter` und `canViewPayroll` für das aktuelle Team zurück
- Wird aus der `team_members`-Zeile des angemeldeten Nutzers gelesen

#### `GET /api/teams/:id/members` / `PATCH /api/teams/:id/members/:userId`
- `PATCH` ermöglicht das Setzen von `isTeamleiter` und `canViewPayroll`
- Ursprünglich hinter `requireDienstleister` (→ in Nachprüfung korrigiert auf `requireAdmin`)

#### Hilfsfunktionen (`src/lib/teamleiter.ts`)
- `getTeamleiterTeamIds(userId)` — liefert alle Team-IDs, in denen ein Nutzer Teamleiter ist
- `canViewPayrollInTeam(userId, teamId)` — prüft, ob der Nutzer in einem Team Lohndaten sehen darf
- `resolveReadTeamId` / `resolveWriteTeamId` — berücksichtigen `overrideAllowedIds` für Teamleiter

#### Schutz von Schreibrouten (Shifts, Abwesenheiten)
- Teamleiter können Schichten und Abwesenheiten für Mitglieder ihrer Teams anlegen/bearbeiten/löschen
- Alle bestehenden `requireAdmin`-Guards auf relevanten Routen bleiben erhalten; Teamleiter erhalten Ausnahmen nur in den explizit erlaubten Bereichen

### Frontend

#### `src/types/auth.ts`
- `AuthUser` um `isTeamleiter: boolean` und `canViewPayroll: boolean` erweitert

#### Navigation (`src/components/layout.tsx`)
- Teamleiter sehen: Dienstplan, Assistenten, Abwesenheiten, Auswertungen
- Teamleiter sehen **nicht**: Team-Verwaltung, Einstellungen (Zuschläge, Abos, Abonnement)

#### Team-Verwaltungsseite (`src/pages/team-verwaltung.tsx`)
- Neuer „Teamleiter ernennen"-Button in der Mitgliederliste
- `TeamleiterDialog`-Komponente mit Toggles für `isTeamleiter` und (für Dienstleister) `canViewPayroll`

---

## Arbeitsanweisung 2 — Nachprüfung anhand 4-Punkte-Checkliste

### Prüfpunkt 1 — Privater Assistenznehmer kann Teamleiter ernennen

**Befund:** Fehler — `PATCH /teams/:id/members/:userId` war hinter `requireDienstleister`. Privat-Admins konnten keine Teamleiter ernennen. UI-Button ebenfalls nur für Dienstleister sichtbar.

**Korrekturen:**

`artifacts/api-server/src/routes/teams.ts`:
- `requireDienstleister` → `requireAdmin` auf der PATCH-Route
- AccountType wird frisch aus der DB gelesen (nicht aus der Session)
- Privat-Admins dürfen `isTeamleiter` setzen, aber **nicht** `canViewPayroll` — bei Versuch: 403

`artifacts/dienstplan/src/pages/team-verwaltung.tsx`:
- `isFullAdmin`-Bedingung entfernt den `accountType === "dienstleister"`-Check
- Rollen-Button erscheint nun auch für privat-Admins
- `canViewPayroll`-Toggle im Dialog bleibt nur sichtbar, wenn `isDienstleister === true`
- `isDienstleister`-Prop wird berechnet und an `TeamleiterDialog` übergeben

---

### Prüfpunkt 2 — Verträge hinter canViewPayroll gesperrt

**Befund:** Fehler — Teamleiter ohne `canViewPayroll` konnten Verträge aller Mitglieder lesen, anlegen, bearbeiten und löschen.

**Korrekturen in `artifacts/api-server/src/routes/contracts.ts`:**

| Endpunkt | Vorher | Nachher |
|---|---|---|
| `GET /contracts` (Liste) | Teamleiter sah alle Team-Verträge | Ohne canViewPayroll: nur eigener Vertrag; mit canViewPayroll: alle |
| `GET /contracts/:id` | Teamleiter konnte beliebige Verträge lesen | Ohne canViewPayroll + fremder Vertrag → 404 |
| `POST /contracts` | Teamleiter konnte Verträge für andere anlegen | Ohne canViewPayroll → 403 |
| `PATCH /contracts/:id` | Teamleiter konnte beliebige Verträge bearbeiten | Ohne canViewPayroll + fremder Vertrag → 403 |
| `DELETE /contracts/:id` | Teamleiter konnte beliebige Verträge löschen | Ohne canViewPayroll + fremder Vertrag → 403 |

Importierte Hilfsfunktionen: `canViewPayrollInTeam`, `getTeamleiterTeamIds`

---

### Prüfpunkt 3 — Globale Einstellungen für Teamleiter gesperrt

**Befund:** API-seitig bereits korrekt gesperrt. Navigationsfehler — Assistenten, Abwesenheiten und Auswertungen waren `adminOnly: true` ohne Teamleiter-Ausnahme.

**Korrekturen in `artifacts/dienstplan/src/components/layout.tsx`:**

- Neues Feld `teamleiterAllowed: boolean` in `ALL_NAV_ITEMS`
- Assistenten, Abwesenheiten, Auswertungen → `teamleiterAllowed: true`
- Team-Verwaltung → `teamleiterAllowed: false` (bleibt für Teamleiter verborgen)
- Nav-Filter in `MobileFullMenu` und `AppSubNavigation` erweitert:
  ```
  !item.adminOnly || isAdminRole || (item.teamleiterAllowed && currentUser?.isTeamleiter)
  ```

**API-seitig bereits korrekt (keine Änderung nötig):**
- Team-Anlegen/Löschen: `requireDienstleister` ✅
- Zuschlags-Einstellungen: `requireAdmin` ✅
- Abo-Verwaltung: `requireAdmin` ✅

---

### Prüfpunkt 4 — Lohnwerte in Auswertungen nur mit canViewPayroll

**Befund:** Fehler — `GET /dashboard/hours-balance` lieferte Geldfelder auch an Teamleiter ohne `canViewPayroll`.

**Korrekturen in `artifacts/api-server/src/routes/dashboard.ts`:**

Nach dem Berechnen der Stundenbilanz wird für Teamleiter ohne `canViewPayroll` ein Stripping-Pass ausgeführt. Folgende Felder werden auf `null` oder `0` gesetzt:

```
hourlyWage, basePay,
nightSurchargePay, sundaySurchargePay, holidaySurchargePay,
totalPay, teamsitzungEuro, urlaubsabgeltungEuro,
absenceNightSurchargePay, absenceSundaySurchargePay, absenceHolidaySurchargePay
```

Reine Stundenwerte (geplante Stunden, Ist-Stunden, Urlaubstage, etc.) bleiben erhalten — Teamleiter können weiterhin die Schichtplanung einsehen.

---

## Geänderte Dateien (Gesamtübersicht)

| Datei | Inhalt der Änderung |
|---|---|
| `packages/db/src/schema.ts` | `is_teamleiter`, `can_view_payroll` auf `team_members` |
| `artifacts/api-server/src/lib/teamleiter.ts` | Neue Hilfsbibliothek: getTeamleiterTeamIds, canViewPayrollInTeam |
| `artifacts/api-server/src/routes/auth.ts` | `isTeamleiter`, `canViewPayroll` in `/auth/me`-Antwort |
| `artifacts/api-server/src/routes/teams.ts` | PATCH /members/:userId: requireAdmin + canViewPayroll-Schutz für privat-Konten |
| `artifacts/api-server/src/routes/contracts.ts` | canViewPayroll-Gates auf alle CRUD-Endpunkte |
| `artifacts/api-server/src/routes/dashboard.ts` | Lohnfeld-Stripping für Teamleiter ohne canViewPayroll |
| `artifacts/dienstplan/src/types/auth.ts` | AuthUser um isTeamleiter + canViewPayroll erweitert |
| `artifacts/dienstplan/src/components/layout.tsx` | teamleiterAllowed-Flag + Nav-Filterlogik |
| `artifacts/dienstplan/src/pages/team-verwaltung.tsx` | TeamleiterDialog, isFullAdmin ohne accountType-Check, isDienstleister-Prop |

---

## Selbstchecks

| Prüfung | Ergebnis |
|---|---|
| `pnpm run typecheck` | ✅ Keine Fehler |
| Unit-Tests (300 Tests) | ✅ 300/300 |
| Handbuch-Screenshots | ✅ Neu erzeugt + Fingerprint aktuell |
| API-Server | ✅ Läuft |
| E2E-Suite (scoped-e2e) | 🔄 Läuft noch |

---

## Offene Punkte (kein akutes Problem)

- **`/contracts/:id/vacation-balance`**: Teamleiter bekommen 404 (Route ist nur für Eigentümer-Teams zugänglich). Kein canViewPayroll-Gate nötig, da sie die Route gar nicht erreichen. Ggf. späterer Follow-up.
- **Task #686** (Muster-Assistenzkraft einloggen): Separates Thema, noch in PROPOSED.
