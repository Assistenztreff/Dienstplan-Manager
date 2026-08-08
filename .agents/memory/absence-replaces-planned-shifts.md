---
name: Abwesenheit löscht geplante Dienste des Tages (Primary-Lookup-Ersetzung)
description: POST /shifts mit Abwesenheitstyp erbt die Zeiten des längsten geplanten Dienstes und LÖSCHT alle Arbeitsdienste des Nutzers an dem Tag (gleiches Team).
---

Regel: Beim Anlegen einer Abwesenheit (vacation/sick/kind_krank/…) über POST /shifts findet der Server alle geplanten Arbeitsdienste des Nutzers an diesem Kalendertag im Ziel-Team, übernimmt die Zeiten des längsten und löscht ALLE (inkl. deren Zeiterfassung). Umgekehrt prüft das Anlegen eines Arbeitsdienstes NICHT auf bestehende Abwesenheiten (Overlap-Check ignoriert Abwesenheiten) — Dienst und Krankmeldung koexistieren nur in der Reihenfolge „Abwesenheit zuerst, Dienst danach".

**Why:** E2E-Fixture „Dienst + danach Krankmeldung" ließ die Dienst-Pille verschwinden (Dienst serverseitig gelöscht) — der Ausfall-Warnfall (Task-Kontext „Ausfall-Icon in Tageszelle") entsteht nur, wenn ein Dienst auf einen Tag mit BESTEHENDER Krankmeldung geplant wird.

**How to apply:** Fixtures/Features rund um „Dienst trotz Abwesenheit": Abwesenheit zuerst anlegen, dann den Dienst. Bei Cross-Team gilt die Löschung nur im Team der Abwesenheit.
