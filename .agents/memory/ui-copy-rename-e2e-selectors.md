---
name: UI-Text-Umbenennungen brechen E2E-String-Selektoren
description: Sichtbare Begriffs-Umstellungen (z. B. geschlechtsneutral) müssen per grep in e2e/ nachgezogen werden, sonst werden Specs dauerhaft rot und ignoriert.
---

Regel: Wird sichtbarer UI-Text umbenannt (Seitentitel, Dialogtitel, Button-Labels) — insbesondere bei der verbindlichen Umstellung auf „Assistenzkraft/Assistenzkräfte" statt „Assistent/Assistenten" —, dann IMMER `rg` über `artifacts/dienstplan/e2e/` nach den alten Strings laufen lassen und alle `getByRole(... name)`- / `getByText`-Selektoren mitziehen.

**Why:** Die Umstellung der Assistenten-Seite auf neutrale Begriffe („Assistenzkräfte", „Assistenzkraft bearbeiten", „Neue Assistenzkraft anlegen", „Assistenzkraft loeschen?") ließ 5 Spec-Dateien dauerhaft rot zurück; die Prüfungen wurden dadurch wochenlang ignoriert und hätten echte Fehler nicht mehr aufgedeckt.

**How to apply:** Nach jedem Copy-Rename: `rg -n "<alter Text>" artifacts/dienstplan/e2e/` und betroffene Specs anpassen; danach nur die betroffenen Specs gezielt laufen lassen (`pnpm exec playwright test <spec>` im Artifact-Verzeichnis).
