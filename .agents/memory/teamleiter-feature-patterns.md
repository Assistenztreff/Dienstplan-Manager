---
name: Teamleiter-Feature Implementierungsmuster
description: Muster für das Teamleiter-Konto-Feature (is_teamleiter + can_view_payroll auf team_members).
---

## Datenmodell
- Zwei neue Boolean-Spalten auf `team_members`: `isTeamleiter` (NOT NULL DEFAULT false) und `canViewPayroll` (NOT NULL DEFAULT false).
- Kein neuer Role-Typ: Teamleiter bleibt `role="assistant"` (oder "admin"), nur die Mitgliedschaftszeile hat das Flag.

## Backend-Hilfsfunktionen (`lib/teams.ts`)
- `getTeamleiterTeamIds(userId)` → Team-IDs wo is_teamleiter=true
- `hasAnyTeamleiterRole(userId)` → boolean
- `getEffectiveAdminTeamIds(userId, role)` → für Admins: alle allowed Teams; für Nicht-Admins: nur Teamleiter-Teams
- `resolveReadTeamScope(userId, requestedTeamId?, overrideAllowedIds?)` und `resolveWriteTeamId(userId, requestedTeamId?, overrideAllowedIds?)` haben jetzt `overrideAllowedIds` — für Teamleiter übergeben, damit nur Teamleiter-Teams erlaubt sind, nicht alle Mitglied-Teams.

## Middleware
- `requireTeamleiterOrAdmin` in `middleware/auth.ts`: lässt Admin-Rollen durch ODER Nutzer mit mind. einem `is_teamleiter=true` Eintrag in DB (Fresh-Read pro Request für sofortige Revokation).

## READ-Routes: effectiveUserId-Muster
In GET /shifts und GET /time-tracking gibt es diesen Check:
```typescript
const tlTeamIds = isAdminLikeRole(role) ? null : await getTeamleiterTeamIds(userId);
const isTeamleiterUser = tlTeamIds != null && tlTeamIds.length > 0;
const effectiveUserId = role === "assistant" && !isTeamleiterUser ? userId : query.data.userId;
const teamScope = await resolveReadTeamScope(userId, requestedTeamId, isTeamleiterUser ? tlTeamIds! : undefined);
```
Teamleiter sehen alle Schichten/Einträge ihrer Teamleiter-Teams (nicht nur eigene).

## WRITE-Routes: effectiveTeams-Muster
```typescript
const effectiveTeams = isAdminLikeRole(role) ? undefined : await getTeamleiterTeamIds(userId);
const write = await resolveWriteTeamId(userId, requestedTeamId, effectiveTeams?.length ? effectiveTeams : undefined);
```
Ohne overrideAllowedIds könnten Teamleiter auf alle Mitglied-Teams schreiben (Sicherheitslücke).

## Payroll-Gating in GET /users
- `BASIC_USER_SELECT` (kein birthDate, socialSecurityNumber, taxId, taxClass, healthInsurance, iban, hourlyWage) für Teamleiter ohne canViewPayroll.
- Bei spezifischem teamId + canViewPayrollInTeam: SAFE_USER_SELECT.

## Frontend
- `AuthUser` in auth.tsx hat neues optionales Feld `isTeamleiter?: boolean`.
- `context/team.tsx`: `isTeamleiterOnly` Bool; `showTeamSwitcher = isDienstleister || isTeamleiterUser`; beide Gruppen bekommen Team-Switcher und Team-Scope-Logik.
- `team-verwaltung.tsx`: `TeamleiterDialog` mit `useUpdateTeamMemberFlags` Hook (generiert aus openapi.yaml) + Toggle-Switches; "Rollen"-Button nur für Full-Admins.

## Rechtevergabe (PATCH /teams/:id/members/:userId)
- Zwei Autorisierungsstufen in-route (kein requireAdmin mehr): Konto-Inhaber (admin-like UND team.ownerId=caller) = alle Felder; sonst `isTeamleiterOfTeam` = NUR `accessLevel` (isTeamleiter/canViewPayroll im Body → 403, Ziel=Inhaber → 403), alles andere 404.
- Bewusst NICHT capability-basiert (`requireTeamManageOrAdmin`): Stufe 2 erlaubt Team-Verwaltung, aber KEINE Rechtevergabe — die bleibt Inhabern und Teamleitern vorbehalten. Konsistent halten, wenn Koordinatoren dazukommen.
- Frontend: `ZugriffsrechteDialog` hat `isOwnerView`-Prop (Teamleiter-Sicht: nur Stufen-Selects, Inhaber-Zeile read-only); Button für Nicht-Admins via eigener `TeamleiterRechteButton` (prüft eigene Mitgliedschaft im exakten Team).

## Teamkoordinatoren (eigener Zugang mit Team-Zuweisung)
- Neue users-Rolle `koordinator` + `users.managed_by_user_id` (Self-FK **ON DELETE CASCADE** — ohne Cascade blockiert jeder Koordinator die Löschung seines Dienstleister-Kontos; Test-Cleanup in `deleteAccountTrees` löscht sie zusätzlich explizit).
- Team-Zuweisung = `team_members`-Zeile mit `isTeamleiter=true` → gesamte Teamleiter-Maschinerie greift ohne Sonderpfade (Scoping, Rechtevergabe, Nav). Zuweisung deklarativ per PUT-Vollabgleich; Konto-Verknüpfung (nicht Membership) macht teamlose Koordinatoren für den Inhaber sichtbar, weil GET /users membership-gescoped ist.
- Rollen-Fanout beachten: `userHasFeatureViaTeamOwner` muss `koordinator` wie `assistant` behandeln (nie eigener Plan, Arbeitgeber zahlt); Routen mit `role === "assistant"`-Selbst-Scoping behandeln Koordinatoren wie Admins — das ist gewollt (Verwaltungsrolle), bleibt aber team- und mitgliedschafts-validiert (Ziel-Team ∈ allowedTeams + Ziel-User Mitglied des Ziel-Teams).
- Anlegen ist Premium-gegated (`caregiverLogin`); Einladung läuft über den bestehenden Invite-Flow (Guard erlaubt Team-Mitglied ODER eigenen Koordinator via managedByUserId, einheitlich 404).
- Offener Lifecycle-Rest: Koordinatoren können via API/UI weder gelöscht noch deaktiviert/bearbeitet werden (nur Teams entziehen).

## Wichtige Fallstricke
- `zod` ist NICHT direkt in api-server installiert: Inline-Zod-Schemas müssen als Import aus `@workspace/api-zod` (generierte Zod-Schemas) ersetzt werden, z.B. `UpdateTeamMemberFlagsBody` statt `z.object({...})`.
- GET /dashboard/hours-balance: Teamleiter müssen eine teamId mitgeben (Default: erstes Teamleiter-Team), kein globaler Dump.
- `isTeamleiter` in Session ist NICHT cachebaar für revocable Policies — immer fresh aus DB laden (in requireTeamleiterOrAdmin und effectiveUserId-Logik).

**Why:** Teamleiter-Konten geben feingranulare Delegation ohne neue Rollen/AccountTypes; Security erfordert fresh DB-Reads pro Request und strikt beschränkte Write-Scopes auf is_teamleiter=true Teams.
