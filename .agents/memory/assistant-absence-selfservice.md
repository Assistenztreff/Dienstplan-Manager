---
name: Assistenz-Abwesenheits-Selbstservice
description: Authz-Regeln für POST/DELETE /api/shifts durch reine Assistenzkräfte (Menü-Neustrukturierung §3)
---

Reine Assistenzkräfte (kein Admin, keine Teamleiter-Teams) dürfen über die Shifts-Routen NUR:
- POST: eigene Abwesenheiten (`isAbsenceType` + `userId === session.userId`), sonst 403 — Check steht VOR allen inhaltlichen Prüfungen (kein Daten-Orakel).
- DELETE: eigene Abwesenheiten, deren `teamId ∈ getAllowedTeamIds`; alles andere 404 (kein ID-Orakel). PATCH bleibt Admin/Teamleiter-only.

**Mehr-Team-Falle:** Ohne explizite `teamId` fällt `resolveWriteTeamId` aufs ERSTE Mitglieds-Team zurück. Deshalb leitet der POST-Pfad für Nicht-Privilegierte die `teamId` aus dem gewählten `shiftModelId` ab (Modell-Team, sofern Mitglied) — sonst landen Abwesenheiten von Mehr-Team-Assistenzkräften im falschen Team (Urlaubskonto!).

**Why:** Architect-Review fand die Falsch-Team-Buchung als einzige ernste Lücke; `isShiftModelInTeam` fängt nur den Fall Modell ≠ aufgelöstes Team ab, nicht die stille Fehl-Auflösung.

**How to apply:** Jede neue Assistenz-Schreibfähigkeit auf shifts/time-tracking braucht dieselben drei Bausteine: Authz vor Inhalt, 404 statt 403 bei fremden IDs, explizite Team-Absicht (Modell oder teamId) statt First-Team-Fallback. E2E-Abdeckung: dienstplan-abwesenheiten-selbstservice-api.spec.ts (inkl. Mehr-Team-Test via dienstleister-Zweitkonto + addTeamMemberViaDb).
