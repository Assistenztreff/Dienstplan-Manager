---
name: PDF-Stundennachweis-Export zurückgestellt
description: StatementExportDialog/export-fix-only-hint ist seit der Menü-Neustruktur nicht mehr aus der UI erreichbar — Specs dürfen nicht darauf aufbauen.
---

# PDF-Stundennachweis-Export ist bewusst zurückgestellt

Seit der Menü-Neustruktur (Auswertungen-Header mit XLSX/ZIP-Popover) gibt es
keinen sichtbaren Öffnen-Pfad mehr für den `StatementExportDialog` (PDF-
Stundennachweis): `exportOpen` auf /auswertungen wird nirgends auf true gesetzt,
das Testid `export-pdf-button` existiert nicht mehr im Code. Der Dialog samt
`export-fix-only-hint` bleibt bewusst im Code (Kommentar „PDF-Export wird
zurückgestellt"); auf /assistenten wird der Dialog ohne `showFixOnlyHint`
genutzt.

**Why:** Eine ältere E2E-Spec (dienstplan-entwurf-kennzeichnung) prüfte den
Dialog-Hinweis und lief nach der Neustruktur deterministisch rot — unentdeckt,
weil die Merge-Validierung nur API-Specs läuft und lange kein voller
UI-E2E-Lauf stattfand.

**How to apply:** Neue Specs nicht auf `export-pdf-button`/Dialog-Hinweis
aufbauen. Wenn der PDF-Export reaktiviert wird, die Prüfung des
`export-fix-only-hint` im Dialog in dienstplan-entwurf-kennzeichnung.spec.ts
wieder herstellen (dort ist der Ist-Zustand kommentiert).
