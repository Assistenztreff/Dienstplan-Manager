---
name: Container-Query-Schwellen exakt kalibrieren
description: Wie man Tailwind @container-Breakpoints (z.B. @[Npx]:inline-flex, @max-[Npx]:hidden) korrekt bemisst statt zu schätzen
---

Von Auge geschätzte `@[...]px`-Schwellen (z.B. für „Label ausblenden ab X px Pillenbreite") sind
in diesem Projekt wiederholt deutlich zu konservativ ausgefallen — Inhalte verschwanden weit
bevor der Platz tatsächlich knapp wurde (z.B. Status-Label + Uhrzeit-Endzeit einer Kalenderpille
verschwanden gleichzeitig bei ~215px, obwohl die Uhrzeit allein erst ab ~98px eng wurde).

**Warum:** Schätzwerte werden meist am breitesten/bequemsten Fall im Editor "über den Daumen"
gepeilt, nicht am tatsächlichen Content (Icon-Breite + Font-Metrik + Gaps + Padding + längster
vorkommender Text). Mehrere unabhängige Zustände (z.B. "volle Uhrzeit" und "Status-Label") auf
denselben Schwellenwert zu legen, obwohl sie unterschiedlich viel Platz brauchen, lässt weniger
wichtige UND wichtigere Inhalte gleichzeitig verschwinden.

**Wie anwenden:** Miss die exakt benötigte Breite headless im echten DOM (Playwright gegen den
laufenden Dev-Server, `chromium.launch({ executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE })`):
1. Klone den echten Pillen-Node (`cloneNode(true)`), damit Icon/Font/Classes exakt stimmen.
2. Erzwinge auf den relevanten Kindern `flex-shrink:0` + `white-space:nowrap` (sonst schrumpft
   Flexbox den Text unbemerkt mit und `scrollWidth` misst nie einen echten Overflow).
3. Setze für den Worst-Case-Text (längste vorkommende Beschriftung, z.B. "Vertretung" statt
   "Krank") und binärsuche die Container-Breite, ab der `scrollWidth > clientWidth` kippt.
4. Setze getrennte Schwellen pro Zustand in Prioritätsreihenfolge (wichtigster Inhalt bekommt
   die niedrigste Schwelle, "nice-to-have" wie ein Status-Label verschwindet zuerst).
Damit verschwinden Inhalte exakt dann, wenn der Platz wirklich nicht mehr reicht — nicht früher.
