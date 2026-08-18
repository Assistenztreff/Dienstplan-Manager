---
name: Absence surcharge calculation (§11 BUrlG / §2 EFZG)
description: Full-day vacation/sick surcharges for Sunday/holiday — architectural decision, tax note, and export impact
---

# Abwesenheits-Zuschläge auf Sonntag/Feiertag

## Entscheidung
Seit Umsetzung von Task #542 berechnet `resolveShiftMetrics` in
`artifacts/api-server/src/lib/shift-metrics-resolve.ts` für ganztägige Abwesenheiten
(00:00–23:59) Sonntags- und Feiertagsstunden aus `plannedHours`, statt 0 zu liefern.

**Why:** §11 BUrlG + §2 EFZG verlangen Lohnausfallprinzip: Arbeitnehmer erhält bei
Urlaub/Krankheit an Sonn-/Feiertagen dieselben Zuschläge wie bei geleisteter Arbeit.

**How to apply:**
- Nachtstunden bleiben 0 (kein konkretes Zeitfenster bei Ganztag-Abwesenheit)
- Feiertag hat Vorrang vor Sonntag (kein Doppelzuschlag), identisch zu `computeDayCategoryHours`
- `isGermanHoliday(start, state)` aus `@workspace/db` nutzen (via `export * from "./shift-metrics"`)
- `start.getUTCDay() === 0` für Sonntag-Erkennung (UTC wie restliche Engine)

## Steuerrecht
Diese Zuschläge sind **SV-pflichtig und lohnsteuerpflichtig** (§3b EStG gilt nur für
geleistete Arbeit). Das PDF-Export und die Auswertung unterscheiden diese Kategorien
aktuell NICHT — separate Darstellung ist Folge-Task.

## UI-Affordanz „Dienst (optional)"
Nachtzuschlag bei Abwesenheit setzt ein konkretes Zeitfenster voraus: geplanter Dienst am Tag
(Zeiten werden geerbt) ODER beim Buchen gewähltes Schichtmodell mit Standardzeiten
(Server-Fallback in POST /shifts + /shifts/bulk-absence). Beide Buchungsoberflächen
(Abwesenheiten-Seite UND ShiftDialog) bieten dafür ein „Dienst (optional)"-Select —
bei Erweiterungen der Abwesenheits-Buchung beide synchron halten. Ganztags-Einträge
ohne Modell bekommen NIE Nachtzuschlag (kein Bug, dokumentierte Grenze).

## Einstellungen-Hinweis
Info-Box in `artifacts/dienstplan/src/components/allowance-settings-form.tsx` nach
dem Feiertagszuschlag-Input erklärt die SV-Pflichtig-Regel für Nutzer.
