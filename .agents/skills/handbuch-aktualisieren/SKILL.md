---
name: handbuch-aktualisieren
description: Aktualisiert das Benutzerhandbuch vollständig: Screenshots neu generieren, Bilder in die Handbuch-Seite einbinden (ScreenshotPlatzhalter ersetzen), Texte auf Aktualität prüfen und anpassen, Typecheck sicherstellen. Verwenden wenn der User schreibt "Handbuch aktualisieren", "Handbuch auf Stand bringen", "Screenshots regenerieren" oder "Handbuch neu aufbauen".
---

# Handbuch aktualisieren

Vollständiger Ablauf zur Aktualisierung des Benutzerhandbuchs nach UI-Änderungen.

## Trigger-Formulierungen

- „Handbuch aktualisieren"
- „Handbuch auf Stand bringen"
- „Screenshots regenerieren" / „Screenshots neu erstellen"
- „Handbuch neu aufbauen"

## Ablauf (immer in dieser Reihenfolge)

### Schritt 1 — Screenshots neu generieren

```bash
cd artifacts/dienstplan
pnpm run screenshots:handbuch
```

Dauer: ca. 3–4 Minuten (Playwright-Lauf mit eigenem Test-Stack).
Der Lauf registriert ein frisches Dienstleister-Konto, seedet realistische
Daten (Assistenzkräfte, Verträge, Dienste, Abwesenheiten), schießt alle
Seiten in Desktop (1440×900) und Mobil (390×844), räumt das Konto danach
wieder ab und schreibt den Fingerprint neu.

**Ergebnis:** Bilder landen in `artifacts/dienstplan/public/handbuch/`.

### Schritt 2 — ScreenshotPlatzhalter durch echte `<img>`-Tags ersetzen

Datei: `artifacts/dienstplan/src/pages/handbuch.tsx`

Für jeden `<ScreenshotPlatzhalter ...>` der ein passendes Bild hat:
- Desktop-Bild via `${import.meta.env.BASE_URL}handbuch/<name>-desktop.png`
- Mobil-Bild via `${import.meta.env.BASE_URL}handbuch/<name>-mobil.png`

Empfohlenes Markup:
```tsx
<div className="my-8 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
  <img
    src={`${import.meta.env.BASE_URL}handbuch/dashboard-desktop.png`}
    alt="Dashboard – Kennzahlen-Karten (Desktop)"
    className="hidden w-full sm:block"
    loading="lazy"
  />
  <img
    src={`${import.meta.env.BASE_URL}handbuch/dashboard-mobil.png`}
    alt="Dashboard – Kennzahlen-Karten (Mobil)"
    className="w-full sm:hidden"
    loading="lazy"
  />
</div>
```

#### Mapping: Platzhalter → Dateiname

| ScreenshotPlatzhalter label | Desktop-Datei | Mobil-Datei |
|---|---|---|
| „Screenshot: Monatsansicht" | `dienstplan-monatsansicht-desktop.png` | `dienstplan-monatsansicht-mobil.png` |
| „Screenshot: Dienst-Dialog (Status Fix/Entwurf)" | `dienst-dialog-desktop.png` | — |
| „Screenshot: Team-Übersicht (Dienstleister)" | `team-verwaltung-desktop.png` | `team-verwaltung-mobil.png` |
| „Screenshot: Dashboard (Kennzahlen-Karten)" | `dashboard-desktop.png` | `dashboard-mobil.png` |
| „Screenshot: Assistenten-Übersicht (Karten)" | `assistenten-desktop.png` | `assistenten-mobil.png` |
| „Screenshot: Zeiterfassung (Liste mit Status)" | `zeiterfassung-desktop.png` | `zeiterfassung-mobil.png` |
| „Screenshot: Abwesenheit eintragen (Formular)" | `abwesenheiten-desktop.png` | `abwesenheiten-mobil.png` |
| „Screenshot: Auswertungen (Matrix-Übersicht)" | `auswertungen-desktop.png` | `auswertungen-mobil.png` |
| „Screenshot: Einstellungen – Profilinformationen" | `einstellungen-desktop.png` | `einstellungen-mobil.png` |

Platzhalter **ohne** passendes Bild (noch nicht captured — bis auf weiteres stehen lassen):
- „Screenshot: Registrierung (Kontotyp-Auswahl)"
- „Screenshot: Einladung annehmen (Passwort setzen)"
- „Screenshot: App-Menü (Assistenznehmer vs. Assistent)"
- „Screenshot: Dialog Teammitglied einladen"
- „Screenshot: Sammelbestätigung (Dialog)"
- „Screenshot: Dialog Stundennachweis exportieren"
- „Screenshot: Einstellungen – Kalender-Export & Abo"
- „Screenshot: Einstellungen – Schichtmodelle"
- „Screenshot: Einstellungen – Zuschläge"

### Schritt 3 — Handbuch-Texte prüfen und anpassen

Prüfe für jeden geänderten UI-Bereich, ob die Beschreibungen in
`artifacts/dienstplan/src/pages/handbuch.tsx` noch stimmen.

Checkliste typischer Änderungsursachen:
- Neue oder umbenannte Buttons/Menüeinträge
- Geänderte Dialoge (z. B. Monatsabschluss, Export-Popover)
- Neue Felder in Formularen (z. B. Einstellungen)
- Neue Premium-Features

Betroffene Exportfunktionen (Stand nach letzter Überarbeitung):
- `HandbuchDienstplan` — Monatsplan, Schichten, Bestätigen
- `HandbuchTeamVerwaltung` — Teams, Einladungen
- `HandbuchRegistrierung` — Registrierung, Kontotyp-Wahl
- `HandbuchRollen` — Rollen (Admin, Assistent)
- `HandbuchDashboard` — Dashboard-Karten
- `HandbuchAssistenten` — Assistenten-Übersicht, Einladen
- `HandbuchZeiterfassung` — Zeiterfassung, Sammelbestätigung
- `HandbuchAbwesenheiten` — Abwesenheitstypen, Eintragen
- `HandbuchAuswertungen` — Auswertungen, Export-Popover im Header
- `HandbuchEinstellungen` — Profil, Schichtmodelle, Zuschläge, Kalender-Abo

### Schritt 4 — Typecheck

```bash
pnpm run typecheck
```

Muss grün sein. Häufige Fehlerquelle: neue `import.meta.env.BASE_URL`-URLs
in `<img src={...}>` sind typsicher — kein Cast nötig.

## Wichtige Dateipfade

| Datei | Zweck |
|---|---|
| `artifacts/dienstplan/src/pages/handbuch.tsx` | Gesamtes Handbuch (alle Seiten in einer Datei) |
| `artifacts/dienstplan/public/handbuch/` | Generierte Screenshots (nach Schritt 1) |
| `artifacts/dienstplan/scripts/check-handbuch-screenshots.mjs` | Fingerprint-Check + Update |
| `artifacts/dienstplan/e2e/handbuch-screenshots.capture.spec.ts` | Screenshot-Generator (Playwright) |

## Hinweise

- Die Funktion `ScreenshotPlatzhalter` in `handbuch.tsx` wird sukzessive
  durch echte `<img>`-Tags ersetzt; nach einer vollständigen Aktualisierung
  kann sie aus der Datei entfernt werden.
- Screenshots brauchen NICHT mehr nach jedem Merge aktualisiert zu werden —
  nur wenn der User „Handbuch aktualisieren" sagt.
- `pnpm run screenshots:handbuch` erzeugt die Bilder reproduzierbar und
  überschreibt sie bei jedem Lauf.
