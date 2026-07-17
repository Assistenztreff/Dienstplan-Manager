---
name: Barrierefreies assistenz-Farbsystem
description: App-weite WCAG-AA-Palette der Dienstplan-App — wo sie liegt und welche Regeln gelten
---
- Personen-Palette = 8 feste Hell/Dunkel-Paarungen (`lib/barrierefreie-farben.ts`, Tokens `--color-assistenz-*` im @theme von index.css). `getBarrierefreieFarbe(key)` ist die zentrale Quelle; userBadgeClass läuft darüber.
- Tailwind v4 erhält camelCase-Tokennamen (`text-assistenz-darkText` funktioniert) — keine tailwind.config anlegen.
- `--primary` ist Hellgelb (#ebf18b): `text-primary` als Textfarbe auf hellen Flächen ist IMMER kontrastarm — stattdessen `text-assistenz-brand` nutzen.
- Abwesenheiten bewusst NICHT aus der Personen-Palette: Urlaub amber, Krank slate, Freizeitausgleich emerald (satte Rahmen). Plattform-Hülle (`--color-brand-*`, Sidebar) unangetastet lassen.

**Why:** Doppelbedeutung (Gelb = Person UND Urlaub UND Entwurf) wäre mehrdeutig; Status bleibt Badge/Text-basiert.
**How to apply:** Neue UI-Farben immer aus getBarrierefreieFarbe bzw. den assistenz-Tokens ableiten, Kontrast ≥ 4,5:1.
