---
name: Pausen-Abzug zur Lesezeit
description: Konto-Schalter deductPausesEnabled wirkt in der Auswertungsrechnung, nie in gespeicherten valuedHours; Pausenregel für Assistenten via /time-tracking-status.
---

**Regel:** Der Konto-Schalter „Pausen von bezahlten Stunden abziehen" (`deductPausesEnabled`, konto-global wie `timeTrackingEnabled`) wird ausschließlich zur LESEZEIT in `computeHoursBalanceRow` angewandt (SOLL: `shifts.pauseMinutes`, IST: `time_tracking.pause_minutes`; je Eintrag auf ≥0 geklemmt, Grundlohn nutzt dieselben effektiven Stunden). Gespeicherte `valuedHours` bleiben roh; Zuschläge und die `pausenzeitStunden`-Infospalte unberührt.

**Why:** Rückwirkend/reversibel schaltbar ohne Neuberechnung von Bestandsdaten; Pausenlage innerhalb des Dienstes ist unbekannt, daher kein Zuschlags-Abzug.

**How to apply:** Neue Auswertungsflächen müssen durch `computeHoursBalances` gehen (Map `deductPausesByTeam` aus der Konto-Zeile des Team-Eigentümers), nie roh `valuedHours` summieren. Die Pausenregel für Assistenten (kein Zugriff auf `/allowance-settings`) kommt als `pauseRule` aus `GET /time-tracking-status` (`getPauseRuleForUser`, deterministisch kleinste Team-ID).
