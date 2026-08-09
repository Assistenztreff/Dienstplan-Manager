---
name: Playwright-Worker-Neustart nach Fehlschlag
description: Nach jedem Test-Fehlschlag startet Playwright den Worker neu — Modul-State (IDs aus früheren Tests) ist weg, Folgetests scheitern mit irreführenden Fehlern.
---

Playwright startet nach JEDEM fehlgeschlagenen Test den Worker-Prozess neu:
`beforeAll` läuft erneut (neue Fixtures, neuer `Date.now()`-RUN), aber bereits
gelaufene Tests laufen NICHT erneut — deren Modul-Variablen (z. B. eine in
Test 2 gesetzte `koordId`) stehen wieder auf ihrem Initialwert (0/leer).

**Symptom:** Nach einem echten Fehlschlag scheitern spätere Tests derselben
Datei mit scheinbar unabhängigen Fehlern (z. B. 400 „Ungültige ID" wegen
`/api/xyz/0/...`).

**How to apply:** Bei mehreren Fehlschlägen in einer Spec-Datei zuerst NUR den
ersten analysieren und fixen — die Folgefehler sind meist Kaskade durch den
Worker-Neustart. Specs, deren spätere Tests von in früheren Tests gesetzten
IDs abhängen, sind sequentiell-gekoppelt; das ist okay, solange man diese
Kaskaden-Eigenschaft beim Debuggen kennt.
