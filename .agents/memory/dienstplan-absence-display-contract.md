---
name: Abwesenheiten im Dienstplan — Anzeigeort & Test-Fallen
description: Wo Abwesenheiten im Dienstplan sichtbar sind (und wo bewusst nicht), plus zwei wiederkehrende E2E-Selektor-Fallen.
---

## Regel

Abwesenheiten (Urlaub, Krank, Freizeitausgleich …) erscheinen **nicht** als Dienst-Eintrag
in Kalenderzellen, Monatsgitter-Pillen oder der Tabellen-/Listenansicht. Sichtbar sind sie
ausschließlich in der zusammengefassten Übersicht „Team-Abwesenheiten“ (dort zu Zeiträumen
gebündelt) sowie in der Tagesleiste.

**Why:** Abwesenheiten würden die Dienstplanung optisch überlagern; die Trennung ist eine
bewusste Produktentscheidung, keine Lücke.

**How to apply:** E2E-Nachweise für angelegte/gelöschte Abwesenheiten niemals über
Dienst-Pillen führen — sie sind dort per Definition nie sichtbar und der Test wird
dauerhaft rot. Stattdessen die Abwesenheits-Übersicht aufklappen und den Zeitraum prüfen.

## Zwei wiederkehrende Selektor-Fallen

1. Die Abwesenheits-Übersicht liegt **außerhalb** der Container für Mobil- und
   Desktopansicht. Ein Selektor, der sie innerhalb eines dieser Container sucht, findet
   nichts.
2. Die Typ-Auswahl im Schicht-Dialog enthält neben „Urlaub“ auch „Urlaubsabgeltung
   (ausgezahlt)“. Eine Auswahl per Namen muss exakt matchen, sonst bricht der Lauf mit
   „strict mode violation“ ab.
