---
name: Koordinator ist nie Personal
description: Invariante für Teamkoordinatoren (role=koordinator) — Ablehnung an allen Personal-Schreibpunkten und Mitgliedschafts-Lebenszyklus nur über den Zuweisungsbereich.
---

# Koordinator ist nie Personal

Teamkoordinatoren (`role='koordinator'`, `managedByUserId` = Konto-Inhaber) sind
Verwaltungspersonen. Ihre Team-Zuweisung ist eine `team_members`-Zeile mit
`isTeamleiter=true` — dadurch greift die komplette Teamleiter-Maschinerie.

**Regel:** Jeder Personal-Schreibpunkt muss Koordinator-Ziele mit 403 ablehnen,
sonst tauchen sie als Pseudo-Assistenzkraft in Dienstplan/Auswertungen auf oder
verlieren still ihre Rechte:

- Verträge, Dienste (Einzel, bulk-absence, Nutzer-Tausch im PATCH), Ist-Zeiten
  (als ZIEL-Nutzer — als Erfasser für andere bleiben sie erlaubt).
- Generische Mitglieder-Operationen (add/patch/delete/move): Der Lebenszyklus
  der Koordinator-Mitgliedschaft gehört ausschließlich dem deklarativen
  Vollabgleich (`PUT /koordinatoren/:id/teams`). Generisches move/patch würde
  die Zeile ohne `isTeamleiter` neu anlegen bzw. entwerten — der Vollabgleich
  sieht „Team vorhanden" und repariert nichts (deshalb normalisiert PUT
  gehaltene Zeilen jetzt defensiv auf `isTeamleiter=true`).

**Why:** Architect-Review fand genau diese zwei High-Lücken, nachdem die
Grundfunktion längst grün getestet war — die Invariante bricht nicht am
Feature selbst, sondern an den GENERISCHEN Endpunkten drumherum.

**How to apply:** Bei jedem neuen Endpunkt, der einen Ziel-`userId` in
Personal-Daten oder Mitgliedschaften schreibt, `isKoordinatorUser()` (in
`lib/teams.ts` des api-servers) prüfen. Reihenfolge beachten: Mitgliedschafts-
/Scope-404 VOR dem Rollen-403, sonst entsteht ein Cross-Tenant-Rollen-Orakel
(fremder Koordinator 403 vs. fremde Assistenz 404).
