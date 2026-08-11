# Sammelaufträge für Abwesenheiten: Messwerte

> Messungen zur Beschleunigung von `POST /api/shifts/bulk-absence` (Task #757)
> Status: **umgesetzt**

---

## Ausgangslage

Mehrere Urlaubs- oder Krankheitstage wurden bereits mit **einem** HTTP-Auftrag
übertragen. Der Server verarbeitete den Zeitraum intern jedoch Tag für Tag: pro
Kalendertag liefen eigene Abfragen für Duplikatprüfung, geplante Dienste,
aktiven Vertrag, Urlaubseinstellungen und den 13-Wochen-Durchschnitt. Die
Laufzeit wuchs dadurch linear mit der Zahl der Tage.

## Was geändert wurde

- **Zeitraumdaten gesammelt laden:** bestehende Abwesenheiten, geplante Dienste,
  Verträge und Einstellungen werden einmal für den gesamten Zeitraum geladen
  statt einmal pro Tag.
- **13-Wochen-Durchschnitt gebündelt:** eine Abfrage über das gesamte Fenster,
  der Durchschnitt wird weiterhin **je Stichtag** aus diesen Daten berechnet
  (rollierendes Fenster wie bisher).
- **Schreibvorgänge gebündelt:** Schichten und die zugehörigen Zeiterfassungen
  werden gesammelt eingefügt; das Urlaubskonto wird je betroffenem Vertrag mit
  einem atomaren Inkrement fortgeschrieben.
- **Unverändert:** Transaktion, Advisory-Lock gegen parallele identische
  Aufträge, Dienst-Ersetzung, Vertragsgrenzen und alle Urlaubs-, Vertrags- und
  Stundenregeln.

## Messwerte (isolierter Test-Stack, identische Umgebung)

Sammelauftrag mit ganztägigen Abwesenheiten, Zeit für den gesamten Request:

| Zeitraum | Vorher | Nachher | Faktor |
|---|---|---|---|
| 1 Tag | 5.332 ms | 4.129 ms | 1,3× |
| 7 Tage | 17.862 ms | 3.166 ms | 5,6× |
| 14 Tage | 33.518 ms | 3.152 ms | 10,6× |
| 30 Tage | 66.898 ms | 3.157 ms | 21,2× |

Zeit pro Tag: vorher ~2.230–2.550 ms/Tag und damit praktisch konstant (lineares
Wachstum). Nachher sinkt sie mit der Zeitraumlänge (105 ms/Tag bei 30 Tagen) —
die Gesamtdauer ist nun weitgehend unabhängig von der Zahl der Tage.

Zum Vergleich derselbe Zeitraum als Einzel-Anlagen (14 Urlaubstage über 14
Einzel-Requests): **77.733 ms** gegenüber **4.295 ms** als Sammelauftrag (18×).

## Fachliche Absicherung

Geprüft in `artifacts/dienstplan/e2e/dienstplan-bulk-absence-performance-api.spec.ts`
sowie den bestehenden Bulk- und Abwesenheits-Specs:

- Urlaubskonto, angelegte Zeiten und gewertete Stunden sind identisch zur
  Einzel-Anlage (14-Tage-Vergleich).
- Zeitumstellungs-Wochenende liefert dasselbe Ergebnis wie die Einzel-Anlage.
- Vorhandene Tage werden übersprungen, Dienste nur an tatsächlich angelegten
  Tagen ersetzt, Urlaub außerhalb des Vertragszeitraums legt keinen Tag an,
  zwei gleichzeitige identische Aufträge buchen jeden Tag nur einmal.

Zusätzlich vergleicht `dienstplan-bulk-absence-typen-api.spec.ts` **alle acht**
vom Sammelauftrag unterstützten Abwesenheitsarten (vacation, sick,
freizeitausgleich, kind_krank, freistellung, abgesagt_ag, abgesagt_an,
urlaubsabgeltung) einzeln gegen die Einzel-Anlage — geprüft werden gewertete
Stunden, Nacht-/Sonntags-/Feiertagsstunden und die gebuchte Zeiterfassung.
Damit sind insbesondere die unbezahlten Kategorien (kind_krank, abgesagt_an)
dauerhaft abgesichert: die Unterscheidung bezahlt/unbezahlt trifft
`resolveShiftMetrics` anhand des Typs, der Sammelweg reicht ihn unverändert
durch.

`dienstplan-bulk-absence-multiteam-vertrag-api.spec.ts` sichert die
Vertrags-Auswahl bei Verträgen in mehreren Teams ab. Die Tages-Soll-Stunden
und der zu belastende Urlaubsvertrag folgen — wie im Einzelpfad
(`activeContractFor`) — dem aktiven Vertrag mit dem jüngsten Beginn OHNE
Team-Filter; nur die Stunden-Auflösung über `absenceHoursFor` ist
team-gescoped. Der Test stellt eine Assistenzkraft mit zwei gleichzeitig
aktiven Verträgen unterschiedlicher Wochenstunden (Team A 40 h ab 01.01.,
Team B 20 h ab 01.03.) auf und prüft, dass Sammelauftrag und Einzel-Anlage
denselben Vertrag belasten.

`dienstplan-bulk-absence-vertragsaenderung-api.spec.ts` deckt den
Konkurrenzfall ab: Der Vertragsbestand wird — wie alle anderen Zeitraumdaten —
erst INNERHALB der schreibenden, per Advisory-Lock geschützten Transaktion
gelesen. Vertrags-Guard, Tages-Soll-Stunden und Urlaubskonto-Buchung arbeiten
damit garantiert auf einem Stand. Der Test schickt eine Vertragsänderung
(40 h → 20 h Wochenstunden) gleichzeitig mit einem Sammelauftrag über sechs
Tage und prüft, dass alle Tage demselben Vertragsstand folgen — ein
Mischergebnis (einzelne Tage alt, andere neu) wäre ein Lohn- und
Urlaubskontofehler. Welcher der beiden Stände gewinnt, ist timing-abhängig und
wird bewusst nicht festgeschrieben.

Da der Vertrags-Guard nun in der Transaktion läuft, verlässt er sie über eine
eigene Fehlerklasse (`VacationOutsideContractError`) und antwortet weiterhin
mit 400 und `code: "vacation_outside_contract"`, während alles zurückgerollt
wird. Auch die Einstellungs- und Durchschnitts-Abfragen (`resolveAllowanceOps`,
`allowanceContext`, `bwavgDailyHoursForDates`) nehmen jetzt einen
Executor-Parameter und lesen über `tx` statt über die globale `db`-Instanz.

### Reihenfolge von Ersetzen und Rechnen

Der Sammelauftrag löscht die ersetzten Dienste **vor** der Stundenberechnung —
genau wie der Einzelpfad, der `deleteReplacedWorkShift` vor
`storeShiftMetrics` aufruft. Das ist beim §11-BUrlG-Durchschnitt (`bwavg`)
relevant: Der ersetzte Dienst eines früheren Tages liegt im 13-Wochen-Fenster
eines späteren Tages desselben Zeitraums. Bei N Einzel-Requests ist er dann
bereits gelöscht; würde der Sammelweg zuerst rechnen, zählte er noch mit und
käme auf einen höheren Durchschnitt.

`dienstplan-bulk-absence-bwavg-ersetzung-api.spec.ts` fixiert das mit einer
Vorgeschichte aus bestätigten Arbeitszeiten (3 × 6 h → Durchschnitt 6,0 h) und
einem ersetzten 12-h-Dienst am ersten Abwesenheitstag. Der zweite, leere Tag
muss 6,0 h bekommen; würde der ersetzte Dienst mitzählen, wären es 7,5 h. Der
Test vergleicht Sammel- gegen Einzelweg **und** prüft den erwarteten Wert —
ein reiner Pfadvergleich würde auch grün, wenn beide Wege gemeinsam falsch
rechnen.
