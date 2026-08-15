---
name: set-password emailVerified fix
description: POST /auth/set-password (invite flow) muss emailVerified=true setzen, sonst schlägt Login mit 403 email_not_verified fehl.
---

## Regel

Wenn ein Admin einen Nutzer per `/api/users/:id/invite` einlädt und der Nutzer
via `POST /auth/set-password` sein Passwort setzt, muss `emailVerified: true`
im selben DB-Update gesetzt werden.

**Why:** `/api/auth/login` prüft `user.emailVerified === false` → 403. Über
`POST /api/users` erstellte Nutzer starten mit `emailVerified = false` (oder
NULL). Der Invite-Flow ist semantisch eine Admin-Verifikation der E-Mail-Adresse
— ohne das Flag schlägt jeder darauf folgende Login-Versuch fehl.

**How to apply:** In `artifacts/api-server/src/routes/auth.ts` im
`POST /auth/set-password`-Handler: `{ passwordHash, inviteToken: null,
inviteTokenExpiry: null, emailVerified: true }` im drizzle `.set()`.

Betroffen: E2E-Tests, die über `POST /api/users` + invite + set-password einen
Assistenten anlegen und sich dann als dieser einloggen (z. B.
`dienstplan-assistant.spec.ts`, `dienstplan-assistant-delete.spec.ts`).
