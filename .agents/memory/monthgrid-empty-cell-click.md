---
name: MonthGrid Klick-Verhalten (seit Arbeitsanweisung 3.4)
description: Zellenklick/Enter wählt nur aus; Anlegen ausschließlich über das day-add-Plus bzw. den Tagesleisten-Button; Zelle ist div role="button".
---

Seit der Arbeitsanweisung 06.08.2026 (Punkt 3.4) gilt im MonthGrid:

- Klick oder Enter/Space auf eine Tageszelle (auch leere, auch wiederholt) WÄHLT den Tag nur aus — nie einen Dialog öffnen.
- Das Anlegen erfolgt ausschließlich über das Plus in der Zellen-Kopfzeile (`data-testid="day-add-<iso>"`) oder den „Dienst anlegen"-Button der Tagesleiste.
- Die Zelle ist ein `div role="button"` (Roving Tabindex), das Plus ein echter `<button>` — niemals interaktive Elemente in einen nativen `<button>`-Zellencontainer verschachteln. Der Plus-Keydown stoppt nur das Bubbling; Enter/Space-Aktivierung läuft nativ über den Klick.
- Der alte Zwei-Stufen-Klick (2. Klick öffnet Dialog) und das Direkt-Öffnen bei leeren Zellen existieren nicht mehr.

**Why:** Anweisung 3.4 trennt Auswahl und Anlage explizit (Done-Kriterium „Klick auf Datum wählt nur; nur Plus legt an"). Code-Review-Befund: `span role="button"` in nativem `<button>` ist invalides HTML und tastatur-unzugänglich.

**How to apply:** Specs, die einen Dialog aus dem Grid öffnen wollen, klicken `day-add-<iso>` (nicht zweimal die Zelle). Auswahl-Assertions laufen über `data-selected` auf `day-cell-<iso>`. Neue interaktive Elemente in der Zelle müssen echte Buttons außerhalb bzw. mit Bubbling-Stopp sein.
