---
name: Arbeitstage-Rechner & Bestätigungs-Feld
description: workdaysPerWeek ist real (0,5–7); Rechner-Vorschau muss Server-Formel spiegeln; Bestätigungen laufen über das Steuerfeld workdaysConfirm, nie über erneutes Senden des Ist-Werts.
---

# Arbeitstage-Rechner & Bestätigungs-Feld (workdaysConfirm)

`contracts.workdays_per_week` ist seit August 2026 `real` (0,5–7, Dezimalwerte), `workdays_confirmed_at` steuert den Datenpflege-Hinweis auf /abwesenheiten (NULL = Hinweis zeigen).

Zwei dauerhafte Regeln:

1. **Vorschau = Server-Formel.** Rechner-UI (lib/arbeitstage-rechner.ts) darf als Tageswert nur `round2(weeklyHours / workdaysPerWeek)` zeigen — exakt wie `vacation-hours.ts` bewertet. Nie die rohe Eingabe versprechen: gespeicherte 2-Dezimal-Werte können den Quotienten um Cents verschieben.
   **Why:** Code-Review-Befund: Vorschau „1 Urlaubstag = 24,01 h" vs. Server-Bewertung 24,02 h bei krummen Dezimalwerten.
   **How to apply:** Jeder Rechner/Vorschau, die einen persistierten abgeleiteten Wert zeigt, rechnet mit derselben Rundung wie der Server.

2. **Bestätigungen über Steuerfeld, nicht Wert-Erneutsendung.** `PATCH /api/contracts` akzeptiert `workdaysConfirm: true` (wird vor dem UPDATE entfernt, setzt nur den Zeitstempel). Das Hinweis-X schickt keinen (ggf. veralteten) Ist-Wert mehr mit.
   **Why:** Ein Wert-Resend konnte mit einem parallelen Rechner-PATCH racen und inkonsistente Paare (alte Arbeitstage + neue Wochenstunden) speichern.
   **How to apply:** Neue „als geprüft markieren"-Flows als reines Steuerfeld im Update-Schema, nie als verstecktes Wert-Update.
