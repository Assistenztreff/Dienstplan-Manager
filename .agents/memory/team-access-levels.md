---
name: Gestufte Team-Freischaltung (accessLevel)
description: Rechte pro team_members-Zeile statt globaler Rolle — Fallstricke bei Middleware/Assert-Paaren und Premium-Gates.
---

## Modell
Rechte hängen an der Mitgliedschaftszeile, nicht am Nutzer: `keine < basis < stufe1 < stufe2`.
`is_teamleiter` bleibt ein getrenntes Flag und zählt effektiv als höchste Stufe.
Keine Stufe gewährt Lohndaten — die bleiben an Teamleiter im Dienstleister-Konto gebunden.

**Why:** Eine Assistenzkraft kann bei mehreren Auftraggebern in mehreren Teams sein.
Eine globale Rolle würde Rechte über Mandantengrenzen tragen.

## Fallstrick 1: Route-Middleware und In-Route-Assert müssen dieselbe Stufe fordern
Eine Route kann per Middleware ab "basis" offen sein und trotzdem 404 liefern,
weil der Zugriffs-Assert im Routenkörper unverändert "manage" verlangt.
Der Fehler ist stumm: kein Typfehler, kein 403 — die Liste kommt einfach leer/404 zurück.

**How to apply:** Beim Öffnen einer Route für eine niedrigere Stufe IMMER beide Stellen
anfassen und die Capability als Parameter durchreichen, statt sie im Assert fest zu verdrahten.

## Fallstrick 2: Premium-Gates auf Routen, die Nicht-Admins erreichen
Assistenzkräfte sind immer Free. Sobald eine Premium-gegatete Route für eine Stufe
geöffnet wird, muss das Plan-Gate über den Team-Eigentümer prüfen, sonst 403 trotz
Premium-Arbeitgeber. Betrifft alles, was von einer Team-Capability-Middleware (statt
`requireAdmin`) geschützt ist.

## Fallstrick 3: Frontend-Scope
Freigeschaltete Nicht-Admins brauchen dieselbe Team-Scoping-Logik wie Teamleiter
(Team-Switcher aktiv, Anfragen team-gescoped). Ohne das laufen ihre Requests unscoped
und die Seiten bleiben leer, obwohl der Server den Zugriff erlaubt.
