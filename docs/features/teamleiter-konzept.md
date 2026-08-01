# Feature-Konzept: Teamleiter-Konten

> Gesprächsprotokoll vom 01. August 2026  
> Status: **In Planung** – noch kein Task angelegt

---

## Ziel

Dienstleister-Admins und Assistenznehmer sollen die Möglichkeit bekommen, einzelnen Personen **begrenzte Verwaltungsrechte für ein bestimmtes Team** zu geben – ohne ihnen vollen Admin-Zugriff zu erteilen.

---

## Zwei Kontexte

### 1. Privatpersonen-Account

| Rolle | Rechte |
|---|---|
| **Assistenznehmer** | Immer voller Zugriff (entspricht dem heutigen Admin des Teams) |
| **Assistenzkraft mit erhöhten Rechten** | Eingeschränkt (nur Schichten) bis voll – der Assistenznehmer legt das fest |

- Der Assistenznehmer entscheidet selbst, welche Assistenzkraft aus seinem Team welche Rechte bekommt.
- Mindestumfang: Schichten erstellen und bearbeiten.
- Maximalumfang: alle Teamleiter-Rechte (siehe Tabelle unten).

---

### 2. Gewerblicher Assistenzdienst (Dienstleister-Account)

| Rolle | Rechte |
|---|---|
| **Unternehmens-Teamleiter** | Vollzugriff auf alle ihm zugewiesenen Teams |
| **Assistenznehmer im Team** | Eingeschränkter Zugriff (Schichten, Zeiterfassung, Mitglieder) |
| **Assistenzkraft mit Rechten** | Dieselben eingeschränkten Rechte wie der Assistenznehmer |

Ein Unternehmens-Teamleiter kann **einem oder mehreren Teams** zugeordnet sein.

---

## Berechtigungsmatrix

| Berechtigung | Unternehmens-Teamleiter | Assistenznehmer (Dienstleister) | Assistenzkraft mit Rechten | Assistenznehmer (Privat) |
|---|:---:|:---:|:---:|:---:|
| Schichten erstellen / bearbeiten / löschen | ✅ | ✅ | ✅ | ✅ |
| Zeiterfassungen bestätigen | ✅ | ✅ | ✅ | ✅ |
| Assistenzkräfte zum Team hinzufügen / entfernen | ✅ | ✅ | ✅ | ✅ |
| Stundenlöhne und Abrechnungsdaten sehen | ✅ | ❌ | ❌ | ✅ |
| Dokumente / Verträge der Assistenzkräfte sehen | ✅ | ❌ | ❌ | ✅ |

> **Hinweis offen:** Sollen Unternehmens-Teamleiter Lohndaten auch *bearbeiten* dürfen, oder nur einsehen? Noch nicht besprochen.

---

## Offene Fragen

1. **Lohndaten für Assistenzkraft-Teamleiter?**  
   Aktuell angenommen: Assistenzkräfte mit Teamleiterrechten sehen *keine* Lohndaten. Nur Unternehmens-Teamleiter sehen sie. Bitte bestätigen.

2. **Eigener Account-Typ für den Assistenznehmer?**  
   Noch nicht entschieden. Zwei Optionen:
   - Eigener Account-Typ „Assistenznehmer" mit fixer Rechtestruktur
   - Einfach die Teamleiter-Rolle zuweisen (kein neuer Account-Typ nötig)

3. **Einladungsflow:**  
   Wie bekommt ein zukünftiger Teamleiter seinen Zugang? Per E-Mail-Einladung vom Admin, oder anderes Verfahren?

---

## Technischer Aufwand (Grobschätzung)

| Bereich | Aufwand |
|---|---|
| Datenbank: Team-Mitgliedschaft um Rolle erweitern | klein (~1–2 Tage) |
| Backend: alle Routen auf Team-Rollen absichern | groß (~1,5–2 Wochen) |
| Admin-UI: Teamleiter/Rollen pro Team zuweisen | mittel (~1 Woche) |
| Teamleiter-Ansicht im Frontend | mittel-groß (~1 Woche) |
| Eingeschränkte Ansicht für Assistenzkräfte | mittel (~1 Woche) |
| Tests | mittel (~1 Woche) |
| **Gesamt** | **ca. 4–7 Wochen** |

---

## Nächste Schritte

- [ ] Offene Fragen klären (siehe oben)
- [ ] Feature als Projekt-Task anlegen
- [ ] Datenbankschema entwerfen (neue Spalte `role` in `team_memberships`)
- [ ] API-Konzept: Welche Endpunkte brauchen neue Berechtigungsprüfungen?
