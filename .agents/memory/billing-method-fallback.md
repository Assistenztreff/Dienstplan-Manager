---
name: Abrechnungsart (SOLL/IST) Fallback-Auflösung
description: Wie die Abrechnungsart pro Team/Konto im hours-balance aufgelöst wird und warum die Team-Ebene das Vertrags-Team gegen den Scope prüfen muss.
---

Abrechnungsart (`billingMethod` SOLL|IST) gilt EINHEITLICH pro Team/Konto — der frühere Vertrags-Override (`contracts.billing_method`) wurde aus API/UI/Auswertung entfernt (Spalte bleibt vorerst VERALTET in der DB, Cleanup nullt sie idempotent in pre-push-sql). Fallback-Kette: **Team-Override → Konto des Team-Eigentümers → SOLL** (Default = Bestandsschutz). IST berechnet gewertete Stunden UND Zuschläge aus den erfassten Ist-Zeiten (`computeShiftMetrics` je Eintrag mit dem Nachtfenster/Bundesland des jeweiligen Team-Kontos); `plannedHours` bleibt IMMER planbasiert.

**Warum die Team-Auflösung heikel ist:** `activeContractFor(userId, date)` im dashboard ist NICHT team-gescoped (nur userId+Datum, latest by startDate). Bei Multi-Team-Assistenten kann der Vertrag ein Team außerhalb des angefragten `teamScope` liefern.

**How to apply:** Für die Team-Ebene der Kette nie blind `contract.teamId` nehmen. Guard: Vertrags-Team nur nutzen, wenn es im Scope liegt (`teamMetaByTeam.has(contract.teamId)`); sonst `requestedTeamId`; sonst — wenn der Scope genau ein Team umfasst — dieses; sonst SOLL. So greift die Team-/Konto-Ebene auch, wenn gar kein aktiver Vertrag existiert. `teamMetaByTeam` faltet Override + Team-Eigentümer-Konto bereits zusammen.

Regressionsschutz: `dienstplan-abrechnungsart-einheitlich-api.spec.ts` seedet einen historischen Vertrags-Altwert per DB-Helfer (`dbSetContractBillingMethod`) und beweist, dass er wirkungslos ist.

Stundenlohn (`users.hourly_wage`, `real`) ist Teil der `ADVANCED_PERSONNEL_FIELDS` → automatisch premium-gated über `advancedPersonnelFile` (gleiche Änderungs-gegen-DB-Stand-Prüfung wie andere Lohn-/SV-Felder).
