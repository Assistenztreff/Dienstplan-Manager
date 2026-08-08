---
name: Bulk-Absence-Endpunkt Invarianten
description: Regeln für POST /shifts/bulk-absence und das Muster "Sammel-Route spiegelt Einzel-Route"
---

# Bulk-Absence-Endpunkt (Zeitraum-Anlage von Abwesenheiten)

**Regel:** Eine Sammel-Route muss die Semantik der Einzel-Route exakt spiegeln
(Authz-Reihenfolge, Guards, Ersetzungslogik) — bewusste Abweichungen nur:
Duplikate werden übersprungen+gemeldet statt 409, Urlaubskonto wird einmal am
Ende je Vertrag gebündelt gebucht, Transaktion statt Teil-Anlage.

**Why:** Zwei Pfade mit driftender Semantik erzeugen schwer findbare
Buchungsdifferenzen; bekannte Einzel-Pfad-Eigenheiten (z. B. Vertragswahl ohne
Team-Scope) NICHT still nur im Bulk-Pfad "fixen" — sonst liefern beide Pfade
verschiedene Ergebnisse. Solche Punkte als Folgeaufgabe für BEIDE Pfade.

**How to apply:**
- Schreib-Helfer (insert/delete/metrics/time-tracking/vacation-delta) nehmen
  einen optionalen `Dbx`-Executor (`typeof db | tx`); Reads bleiben bewusst auf
  globalem `db` (gleiche Race-Toleranz wie Einzel-Pfad).
- Pro-Tag-Einträge serverseitig validieren (0 < Dauer ≤ 24 h) und nach
  ISO-Datum deduplizieren — sonst umgeht EIN monatelanger Eintrag das
  Tage-Limit bzw. batch-interne Duplikate den Duplikatschutz.
- Urlaubskonto-Parität testen ohne die Stundenformel zu kennen: Delta nach
  Bulk vs. Delta nach N Einzel-POSTs derselben Tage vergleichen
  (e2e/dienstplan-bulk-absence-api.spec.ts) — robust gegen Wochenend-/
  Feiertagslogik.
- `applyVacationDelta` ist jetzt atomarer SQL-Inkrement
  (GREATEST(0, ROUND(col + delta))) — kein Read-Modify-Write mehr einführen.
- Frontend-Eingänge (Kalender-Mehrfachauswahl, Von/Bis-Formular,
  Dialog-Bis-Datum) haben KEINEN Client-Duplikat-Prefilter mehr; Toast/Fehler
  speisen sich aus createdCount/skippedCount der Server-Antwort.
