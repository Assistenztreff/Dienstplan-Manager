---
name: Substanz-Änderung an FIX-Diensten fällt auf ANGEBOTEN zurück -> verschwindet aus hours-balance
description: PATCH /shifts/:id setzt planningStatus stillschweigend von FIX auf ANGEBOTEN zurück, wenn Zeiten/Modell/Nutzer eines bestätigten Dienstes ohne explizites planningStatus geändert werden; hours-balance zählt nur FIX.
---

`routes/shifts.ts` PATCH /shifts/:id enthält eine `faelltZurueck`-Regel: Ändert
sich an einem bereits bestätigten (`planningStatus: "FIX"`) Arbeitsdienst ein
"substanzielles" Feld (Zeiten, `userId`, `shiftModelId`, `pauseMinutes`), OHNE
dass der Aufrufer gleichzeitig `planningStatus` explizit mitsendet, setzt der
Server den Status automatisch auf `"ANGEBOTEN"` zurück (Dienst muss neu
bestätigt werden — Schutz gegen einseitige nachträgliche Änderung bestätigter
Zeiten).

`computeHoursBalances`/`hours-balance-service.ts` filtert Schichten aber
strikt auf `planningStatus = "FIX"`. Ein Aufrufer, der ein Feld wie
`shiftModelId` per PATCH ändert, OHNE `planningStatus` mitzusenden, sieht die
Schicht danach also nicht mehr in der Stunden-Bilanz — obwohl
`storeShiftMetrics` die Kennzahlen (valuedHours etc.) korrekt neu berechnet
hat und `GET /shifts/:id` sie korrekt zurückgibt. Nur die Aggregation fällt
raus.

**Konkret betroffen:** Die "Massen-Dienstart-Wechsel"-Bearbeitung
(`bulk-edit-dialog.tsx`, sendet je Ziel-Schicht ein `PATCH .../shifts/:id`
mit `{ type, shiftModelId, force: true }`, kein `planningStatus`) lässt
bestätigte Dienste nach dem Modellwechsel klammheimlich aus der
Stunden-Bilanz verschwinden, bis sie erneut bestätigt werden.

**Wann prüfen:** Jede Schreiboperation gegen bestätigte (FIX) Dienste, die
Substanzfelder ändert, ohne den Aufrufer zu zwingen `planningStatus`
mitzusenden — insbesondere Massen-/Bulk-Bearbeitungspfade, die den
Einzel-PATCH-Endpunkt in einer Schleife wiederverwenden.
