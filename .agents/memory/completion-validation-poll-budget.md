---
name: Completion-Validation vs. lange e2e-Suite
description: Was tun, wenn markTaskComplete wiederholt mit POLL_BUDGET_EXCEEDED scheitert
---

Die Abschluss-Validierung hat ein Poll-Budget von ~30 Min. Die volle e2e-Suite (api ~33 Min + smoke ~3 Min) überschreitet das strukturell — erst recht mit Wartezeit auf den lauf-übergreifenden E2E-Lock paralleler Task-Umgebungen. Ergebnis: POLL_BUDGET_EXCEEDED, obwohl alle Tests grün laufen.

**Rezept:**
1. Nicht endlos neu versuchen — jeder Versuch startet die Suite von vorn.
2. Die e2e-Suite stattdessen über den konfigurierten Workflow `e2e` laufen lassen (WorkflowsRestart; Workflows überleben lange Laufzeiten, Shell-Kommandos nicht > 5 Min). Ergebnis per RefreshAllLogs prüfen ("N passed").
3. Dann `markTaskComplete` mit `skip_validation_reason`, das die Run-IDs der gescheiterten Versuche, die grünen Einzel-Checks und den Workflow-Log-Pfad des grünen e2e-Laufs benennt.

**Why:** Drei Validierungsversuche in Folge scheiterten rein am Budget, während e2e jeweils fehlerfrei bis kurz vor Schluss lief.
**How to apply:** Sobald ein zweites POLL_BUDGET_EXCEEDED auftritt, direkt auf den Workflow-Weg wechseln.
