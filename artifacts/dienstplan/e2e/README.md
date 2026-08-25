# E2E-Specs: Datumsangaben in Fixtures

Kurzleitfaden für alle, die eine Spec schreiben oder ändern, die Schichten
oder Abwesenheiten (Urlaub/Krank/Freistellung/...) mit einem konkreten
Kalenderdatum anlegt.

## Warum das wichtig ist

Ein fest einprogrammiertes Datum wie `"2027-03-10"` funktioniert heute – und
bricht lautlos, sobald die reale Zeit daran vorbeigelaufen ist. Zwei
unabhängige, echte Business-Guards reagieren darauf:

1. **`absence_delete_past_blocked`** — das Aufräumen (`DELETE /api/shifts/:id`)
   einer Abwesenheit in `afterAll`/`afterEach` schlägt fehl, sobald ihr Datum
   in die Vergangenheit gerutscht ist.
2. **`forwardPlanningBlocked`** (`artifacts/api-server/src/routes/shifts.ts`)
   — das Anlegen schlägt fehl, wenn das Datum mehr als `historyMonths` Monate
   (Free = 1, Premium = 12) in der Zukunft liegt.

Ein naives "+1 Jahr" auf ein hartkodiertes Datum ist KEIN verlässlicher Fix:
Monate, die im Kalenderjahr später liegen als der aktuelle Monat, können nach
der Jahres-Verschiebung das 12-Monats-Limit überschreiten. Und ein
Resolver, der jedes verwendete Datum unabhängig auf sein "nächstes
Vorkommen" abbildet, kann die chronologische Reihenfolge zwischen den Daten
einer Datei invertieren (z. B. ein Vertragsbeginn, der nach dem davon
abhängigen Abwesenheitsdatum landet).

## Das robuste Muster: Anker + Offset

Einen Referenzpunkt **"heute + kleiner Puffer (z. B. 1–2 Monate), Tag 1"**
festlegen und alle anderen Daten der Datei als **Tages-/Monats-Offset** vom
Anker ausdrücken — nie unabhängig voneinander neu berechnen. Das garantiert
sowohl die Einhaltung des Vorausplanungslimits als auch die chronologische
Reihenfolge, unabhängig davon, in welchem Kalendermonat die Suite läuft.

```ts
const ANCHOR = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 2, 1),
);
function testDay(offsetDays: number): string {
  return new Date(ANCHOR.getTime() + offsetDays * 86_400_000)
    .toISOString()
    .split("T")[0]!;
}
const DAY_ONE = testDay(0);
const DAY_TWO = testDay(1);
```

Für Monatsraster (statt Tagesoffsets) siehe die `futureYearFor`/`dayString`-
Helfer in `dienstplan-bulk-absence-api.spec.ts` — dasselbe Prinzip, nur je
Monat statt je Tag aufgelöst.

Ein echtes Kalenderdatum (z. B. ein konkreter DST-Umstellungstag) bleibt
weiterhin nötig, wenn der Test genau dieses reale Ereignis prüft — dafür den
`lastSundayOnOrBefore(...)`-Helfer aus derselben Datei verwenden, angewandt
auf einen ankerbasierten Monat statt auf ein festes Kalenderjahr.

Nicht jedes `${YEAR}`/`getFullYear()`-Datum in der Suite ist unsicher —
Relativ-zu-heute-Muster (z. B. "letzter Monat"-Snapshots) treffen keinen der
beiden Guards. Nur Dateien umbauen, die nachweislich eines der beiden Risiken
tragen.

## Automatischer Wächter

`pnpm --filter @workspace/scripts run check-e2e-date-fixtures` (Teil von
`pnpm run typecheck`) scannt alle Specs, die eine Abwesenheit anlegen
(`type: "urlaub"|"krank"|...` oder `/shifts/bulk-absence`), auf hartkodierte
ISO-Datumsliterale (`"2027-03-10"`) und schlägt bei neuen Treffern fehl.
Details und die Begründung für geprüfte Ausnahmen stehen in
`scripts/src/check-e2e-date-fixtures.ts`.
