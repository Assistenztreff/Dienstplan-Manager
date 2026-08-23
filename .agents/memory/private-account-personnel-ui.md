---
name: Privatkonto-Personalverwaltung
description: Produktregel für die vereinfachte Personal- und Rechteverwaltung von Privatkonten
---

Privatkonten behalten technisch genau ein Standard-Team. Für den Konto-Inhaber ist dieses Team jedoch ein unsichtbares Implementierungsdetail: kein Teamname, keine aufklappbare Teamkopfzeile, kein Teamwechsel und keine Aktionen zum Anlegen, Umbenennen, Löschen oder Überführen. Teamkoordinatoren gehören ebenfalls nur zur Dienstleister-Ansicht. Die Seite und Route bleiben erhalten, weil dort weiterhin Assistenzkräfte sowie Teamleiter-Berechtigungen verwaltet werden.

**Why:** Privatkonten brauchen keine Mehrteam-Organisation. Die interne Teamzuordnung wird aber weiterhin für Daten-Scope und Rechte benötigt; eine vollständige Entfernung des Teams würde bestehende Berechtigungen und Fachlogik unnötig gefährden.

**How to apply:** Änderungen an Personalverwaltung, Navigation oder leeren Zuständen müssen für Privat-Inhaber ohne Team-Organisationssprache und Mehrteam-Einstiege funktionieren. Den Zugriffsrechte-Dialog und die Teamleiter-Auswahl immer erreichbar lassen. Dienstleister behalten die vollständige Mehrteam-Oberfläche.