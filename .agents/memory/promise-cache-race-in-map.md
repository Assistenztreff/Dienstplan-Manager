---
name: Promise-Cache-Race in Promise.all(map(async...))-Schleifen
description: Ein lazy Per-Key-Cache muss das Promise selbst synchron cachen, nicht den aufgelösten Wert, sonst dupliziert paralleles Mapping teure Arbeit.
---

Wenn eine Funktion pro Schlüssel (z. B. Team-ID) ein Ergebnis lazy berechnet und
cached, und diese Funktion aus einer äußeren `Promise.all(items.map(async ...))`
heraus für mehrere Items mit demselben Schlüssel gleichzeitig aufgerufen wird,
reicht ein Cache-Muster wie:

```js
if (cache.has(key)) return cache.get(key);
const value = await computeExpensive(key);
cache.set(key, value);
return value;
```

**nicht aus** — bei gleichzeitigem Aufruf für denselben Schlüssel sehen alle
Aufrufe `cache.has(key) === false` (der Wert wird erst NACH dem `await`
gesetzt) und lösen `computeExpensive` mehrfach parallel aus.

**Fix:** Das Promise selbst synchron beim ersten Aufruf in den Cache legen
(nicht erst nach dem Await):

```js
if (!cache.has(key)) {
  cache.set(key, computeExpensive(key)); // Promise sofort cachen, nicht await'en
}
return cache.get(key);
```

**Warum:** In `assistenz-treff` trat das bei `vacationOpsForTeam` in
`hours-balance-service.ts` auf — mehrere Assistenzkräfte desselben Teams
wurden im äußeren `Promise.all(assistants.map(...))` parallel verarbeitet,
jede rief `vacationOpsForTeam(teamId)` auf; ohne den Fix wurde
`resolveAllowanceOps` pro Team mehrfach parallel ausgeführt.

**Wann prüfen:** Immer wenn ein Per-Key-Lazy-Cache aus einer
`Promise.all(...map(async ...))`-Schleife heraus aufgerufen wird — nicht nur
bei neuem Code, sondern auch beim Review bestehender Caches, die vorher nur
seriell aufgerufen wurden und jetzt parallelisiert werden.
