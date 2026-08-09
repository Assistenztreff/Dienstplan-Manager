---
name: Kontowechsel-Erkennung im Web-Client
description: Wie die Dienstplan-App einen Session-Wechsel im selben Browser erkennt und warum Auth-Zustand nur über applyUser mit Epoch-Guard laufen darf.
---

# Kontowechsel-Erkennung (Web-Client)

**Regel:** Jede Anwendung von Auth-Zustand läuft über den zentralen Setter
(`applyUser` in `context/auth.tsx`). Frischeprüfungen (/auth/me aus Bootstrap,
Fokus-/Sichtbarkeits-Check, 401/403-Resync) müssen (a) single-flight laufen und
(b) vor dem Anwenden einen Epoch-Guard prüfen (Epoche wird bei jeder Anwendung
erhöht). Explizite Nutzeraktionen (Login/Logout/Set-Password) wenden
unbedingt an.

**Why:** Öffnet der Inhaber einen Einladungslink im selben Browser, ersetzt das
die Cookie-Session; die offene Inhaber-Seite bleibt veraltet stehen und
Aktionen scheitern mit rohem 403. Ohne Epoch-Guard kann eine verspätet
eintreffende /auth/me-Antwort (noch unter dem alten Cookie gestartet) die neue
Identität wieder überschreiben und die veraltete privilegierte Ansicht
wiederherstellen (Architect-Befund bei der Erstumsetzung).

**How to apply:**
- Nie `setCurrentUser`+`storeSession` direkt paaren — immer `applyUser`.
- Kontowechsel (andere Nutzer-ID nach dem initialen Bootstrap) meldet an den
  in App.tsx registrierten Handler: `queryClient.clear()` (verwirft auch
  pausierte Offline-Mutationen — gewollt) + sonner-Toast „Anmeldung gewechselt".
- 403 in Query-/MutationCache stößt gedrosselt `resyncAuthAfter401()` an;
  legitime 403s desselben Nutzers bleiben folgenlos (gleiche ID = kein Clear).
- UI-Meldung für Inhaber-Aktionen: `ownerSessionMessage(err)` in
  `lib/api-error.ts` (nur nicht-Plan-403s), NACH `planUpgradeMessage` ketten.
- Fokus-Check wendet nur 200 an (401 → bestehende Selbstheilung, 5xx loggt
  nicht aus); Bootstrap darf bei 4xx/5xx (kein TypeError) auf null leeren.
- E2E-Muster: `page.request.post('/api/auth/login', …)` teilt den Cookie-Jar
  der Seite und simuliert so den „Einladungslink im selben Browser".
