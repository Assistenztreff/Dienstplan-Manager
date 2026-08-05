---
name: DESIGN-GUIDELINES Pflicht
description: DESIGN-GUIDELINES.md im Repo-Root muss vor jedem UI-Auftrag gelesen werden — Tonalität, Begriffe, UI-Text, Farbsystem.
---

## Regel

Vor jeder Aufgabe mit sichtbaren Texten oder UI-Elementen **zuerst `DESIGN-GUIDELINES.md` im Repo-Root lesen**.

Die Datei ist die verbindliche Quelle für:
- Tonalität und Ansprache (du/Sie, Wortwahl, Satzlänge)
- Feste Begriffe (z. B. „Assistenzkraft" vs. „Assistent", Produktnamen)
- UI-Textregeln (Button-Labels, Fehlermeldungen, Hinweistexte)
- Barrierefreiheits-Farbsystem (ergänzt / konkretisiert `accessible-color-system.md`)

**Why:** Der Auftraggeber hat diese Quelle explizit als verbindlich erklärt; ohne nachzuschlagen riskiert jeder UI-Auftrag inkonsistente Begriffe oder falsche Farbwahl.

**How to apply:** `ReadFile({ path: "DESIGN-GUIDELINES.md" })` als allerersten Schritt, bevor Texte oder Farben festgelegt werden. Existiert die Datei noch nicht, Auftraggeber darauf hinweisen und bis zur Erstellung auf `accessible-color-system.md` + Codebase-Konventionen zurückgreifen.
