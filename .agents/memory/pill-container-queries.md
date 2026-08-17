---
name: Dienstpillen — Container-Queries & Zustände
description: Formatregeln der Monatsraster-Pillen (Breiten-Schwellen, Minimiert-Modus, Smartphone-Dauerzustand) und wie man sie testet.
---

## Regeln

- Jede Desktop-/Tablet-Pille ist ihr eigener `@container`; Kurz-/Vollformat folgt der
  **tatsächlichen Pillenbreite**, nie der Fensterbreite (Tailwind v4 `@max-[214px]` /
  `@max-[154px]` / `@max-[114px]`): ≥215 px Vollformat (HH:mm–HH:mm, „Vertretung"-Text,
  voller Name), <215 px Kurzformat („:00" gestrippt), <155 px nur Nachname,
  <115 px (nur minimiert) nur der Dienstbeginn.
- Minimiert-Modus (persistiert `dienstplan.pillMinimiert`, Toggle `toggle-pill-minimiert`,
  nur Monatsansicht Desktop/Tablet): Zeile 2 entfällt, Zeit wandert in Zeile 1,
  Vertretung-Icon rückt in den Badge-Stack (`calendarCompact`).
- Alle drei Pillen-Varianten tragen den 19×19-px-`PillAvatar` (Initialen, Personenfarbe)
  links und einen 4-px-Status-Farbbalken rechts (`dienstStatusColor`: Krank > Vertretung >
  FIX/Entwurf — gleiche Hex-Werte wie StatusBadge).
- Smartphone hat NUR den Dauerzustand `variant="collapsed"` (Name bewusst behalten —
  Scroll-zur-Tagesleiste hängt daran): einzeilige Avatar-Pille OHNE separates Namensfeld
  (siehe smartphone-pill-width-budget.md), Status-Icon immer sichtbar (auch
  Bestätigt-Haken), Abwesenheiten als Kategorie-Text „Geplant"/„Ausfall"/„Absage"
  (testid `day-absence-text-<datum>`, Kategoriefarbe), festes 2-Pillen-Limit.
  Auf-/Zuklapp-Toggle existiert nicht mehr.

**Why:** Spaltenbreite hängt von Sidebar/Viewport ab; Fenster-Breakpoints formatieren
falsch. Die ~48-px-Smartphone-Pille hat kein Breiten-Budget für ein Namensfeld.

**How to apply:** E2E-Zeit-Asserts TZ-unabhängig per Regex
(`/\d{1,2}(:\d{2})?–\d{1,2}(:\d{2})?/`), nie exakte Strings (Seeds sind UTC, Browser-TZ
variiert). Specs: Smartphone-Dauerzustand in dienstplan-smartphone-aufklappen.spec.ts,
Minimiert-Umschalter in dienstplan-pillen-minimiert.spec.ts.
