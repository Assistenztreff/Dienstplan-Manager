---
name: E-Mail-Verifizierungs-Ablauf und Zustellfehler
description: Token-Ablauf (48h) und emailDeliveryFailed-Flag in Registrierung
---

## Verifizierungslink-Ablauf (48h)

Spalte `email_verification_token_expiry` (Timestamp, nullable) in `users`.

- **Registrierung**: Token + Ablaufzeit werden gleichzeitig gesetzt (`now + 48h`).
- **verify-email**: Prüft Ablaufzeit VOR der Verifizierung. NULL = Bestandskonto, bleibt immer gültig.
- **resend-verification**: Setzt beim neuen Token ebenfalls frische 48h-Ablaufzeit.
- **Nach Verifizierung**: Token + Ablaufzeit werden auf NULL gesetzt.

**Warum:** Die Bestätigungs-E-Mail nennt 48h Gültigkeit — der Server muss das durchsetzen.

**Zu beachten:** Bestandskonten (expiry = NULL) sind nicht betroffen — nie rückwirkend ablaufen lassen.

## E-Mail-Zustellfehler bei Registrierung

`sendVerificationEmail()` gibt `boolean` zurück. Wenn `false`:
- Server liefert `{ emailVerificationSent: true, emailDeliveryFailed: true }` (Status 201).
- `auth.tsx` register-Funktion gibt `emailDeliveryFailed` im Return-Wert durch.
- `registrierung.tsx` zeigt Warning-Box mit "Erneut senden"-Button (ruft `resendVerification()` auf).

**Warum:** Nutzer waren dauerhaft ausgesperrt, wenn Resend-API nicht verfügbar war.

## E2E-Helfer

`dbSetEmailVerification(email, token, expiryDate?)` — optionaler dritter Parameter für Ablaufzeit-Tests.
