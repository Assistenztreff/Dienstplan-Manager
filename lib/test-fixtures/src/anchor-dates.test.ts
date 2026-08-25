import { describe, expect, it } from "vitest";
import { computeAnchorOffsetDay } from "./anchor-dates";

describe("computeAnchorOffsetDay", () => {
  it("bleibt innerhalb eines Monats fuer Tage <= 28, unabhaengig vom Anker-Monat", () => {
    // Anker-Monat0 = 1 (Februar, 0-indiziert) -> Monats-Offset 0 bleibt Februar.
    expect(computeAnchorOffsetDay(2027, 1, 0, 27)).toBe("2027-02-27");
    expect(computeAnchorOffsetDay(2027, 1, 0, 28)).toBe("2027-02-28");
  });

  it("Tag 29/30 in einem Nicht-Schaltjahr-Februar ueberlaeuft still in den Maerz (Date.UTC-Normalisierung)", () => {
    // 2027 ist kein Schaltjahr -> Februar hat nur 28 Tage.
    expect(computeAnchorOffsetDay(2027, 1, 0, 29)).toBe("2027-03-01");
    expect(computeAnchorOffsetDay(2027, 1, 0, 30)).toBe("2027-03-02");
  });

  it("REGRESSION: ein Monatsgrenzen-Zeitraum mit Tagen 29/30 + naechster-Monat 1/2 kann kollabieren, wenn der fruehere Monat Februar ist", () => {
    // Das ist genau das Muster, das dienstplan-bulk-absence-api.spec.ts vor
    // der Korrektur verwendet hat: Anker-Monat +6 = Februar (Nicht-
    // Schaltjahr), Anker-Monat +7 = Maerz. "Tag 29" und "Tag 30" von Februar
    // rollen beide in den Maerz und kollidieren dort mit den fuer Maerz
    // gedachten Tagen 1 und 2 -> aus vier beabsichtigten Tagen werden nur
    // zwei reale Kalendertage.
    // Direkter, von der Jahreswahl unabhaengiger Nachweis: fixiere den
    // fruehen Monat direkt auf einen bekannten Nicht-Schaltjahr-Februar.
    const brokenFirstRange = [
      computeAnchorOffsetDay(2027, 1, 0, 29), // faelschlich gedacht als "Februar Tag 29"
      computeAnchorOffsetDay(2027, 1, 0, 30), // faelschlich gedacht als "Februar Tag 30"
      computeAnchorOffsetDay(2027, 1, 1, 1), // Maerz Tag 1
      computeAnchorOffsetDay(2027, 1, 1, 2), // Maerz Tag 2
    ];
    // Vier vermeintlich verschiedene Tage kollabieren auf nur zwei reale
    // Kalendertage - das ist der Fehler, den die reparierte Spec-Datei durch
    // Tage <= 28 im frueheren Monats-Offset vermeidet.
    expect(new Set(brokenFirstRange).size).toBe(2);

    // Die tatsaechlich in der Spec verwendete, korrigierte Tageswahl
    // (<=28 im frueheren Monat, 1/2 im spaeteren Monat) bleibt dagegen IMMER
    // vier unterscheidbare, chronologisch aufsteigende Tage - unabhaengig
    // davon, welcher reale Kalendermonat auf den Anker-Offset faellt.
    const fixedFirstRange = [
      computeAnchorOffsetDay(2027, 1, 0, 27),
      computeAnchorOffsetDay(2027, 1, 0, 28),
      computeAnchorOffsetDay(2027, 1, 1, 1),
      computeAnchorOffsetDay(2027, 1, 1, 2),
    ];
    expect(new Set(fixedFirstRange).size).toBe(4);
    expect(fixedFirstRange).toEqual([...fixedFirstRange].sort());
  });

  it("bleibt fuer die korrigierte Tageswahl auch bei einem Schaltjahr-Februar unterscheidbar", () => {
    // 2028 ist ein Schaltjahr (Februar hat 29 Tage) - Tage <=28 sind erst
    // recht unproblematisch, aber zur Vollstaendigkeit mitgeprueft.
    const fixedFirstRange = [
      computeAnchorOffsetDay(2028, 1, 0, 27),
      computeAnchorOffsetDay(2028, 1, 0, 28),
      computeAnchorOffsetDay(2028, 1, 1, 1),
      computeAnchorOffsetDay(2028, 1, 1, 2),
    ];
    expect(new Set(fixedFirstRange).size).toBe(4);
    expect(fixedFirstRange).toEqual([...fixedFirstRange].sort());
  });
});
