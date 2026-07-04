---
name: Abrechnungsart (SOLL/IST) Fallback-Auflösung
description: Wie die Abrechnungsart pro Assistent/Team/Konto im hours-balance aufgelöst wird und warum die Team-Ebene das Vertrags-Team gegen den Scope prüfen muss.
---

Abrechnungsart (`billingMethod` SOLL|IST) ist auf drei Ebenen einstellbar: Vertrag (`contracts.billing_method`, pro Assistent), Team-Override + Konto (`allowance_settings.billing_method`, `team_id`-Override bzw. Konto-Zeile mit `team_id IS NULL`). Fallback-Kette: **Assistent (Vertrag) → Team-Override → Konto des Team-Eigentümers → SOLL** (Default = Bestandsschutz, kein Verhaltenswechsel für Bestandskonten). IST berechnet gewertete Stunden UND Zuschläge aus den erfassten Ist-Zeiten (`computeShiftMetrics` je Eintrag mit dem Nachtfenster/Bundesland des jeweiligen Team-Kontos); `plannedHours` bleibt IMMER planbasiert.

**Warum die Team-Auflösung heikel ist:** `activeContractFor(userId, date)` im dashboard ist NICHT team-gescoped (nur userId+Datum, latest by startDate). Bei Multi-Team-Assistenten kann der Vertrag ein Team außerhalb des angefragten `teamScope` liefern.

**How to apply:** Für die Team-Ebene der Kette nie blind `contract.teamId` nehmen. Guard: Vertrags-Team nur nutzen, wenn es im Scope liegt (`teamMetaByTeam.has(contract.teamId)`); sonst `requestedTeamId`; sonst — wenn der Scope genau ein Team umfasst — dieses; sonst SOLL. So greift die Team-/Konto-Ebene auch, wenn gar kein aktiver Vertrag existiert (Bug, den man sonst leicht übersieht: `contract?.billingMethod ?? teamBilling ?? "SOLL"` überspringt bei fehlendem Vertrag die Team-Ebene, weil teamBilling aus `contract.teamId` kommt). `teamMetaByTeam` faltet Override + Team-Eigentümer-Konto bereits zusammen.

Stundenlohn (`users.hourly_wage`, `real`) ist Teil der `ADVANCED_PERSONNEL_FIELDS` → automatisch premium-gated über `advancedPersonnelFile` (gleiche Änderungs-gegen-DB-Stand-Prüfung wie andere Lohn-/SV-Felder).
