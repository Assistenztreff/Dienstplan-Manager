import { describe, it, expect } from "vitest";
import {
  pruefeMeldungMoeglich,
  istSeitherKorrigiert,
  type MeldungDienst,
} from "@workspace/shift-defaults/deviation-rules";

// Fester "jetzt"-Zeitpunkt: die Regel haengt an der Vergangenheit, ein
// echtes Date.now() macht den Test datumsabhaengig (genau der Fehler, der die
// Abwesenheitskalender-Spec ab dem 10. eines Monats hat kippen lassen).
const JETZT = Date.parse("2026-08-29T12:00:00Z");
const VORGESTERN = "2026-08-27T10:00:00Z";
const GESTERN = "2026-08-28T10:00:00Z";
const HEUTE_FRUEH = "2026-08-29T06:00:00Z";
const MORGEN = "2026-08-30T10:00:00Z";

function dienst(over: Partial<MeldungDienst> = {}): MeldungDienst {
  return {
    planningStatus: "FIX",
    endTime: GESTERN,
    istAbwesenheit: false,
    istTeamTermin: false,
    ...over,
  };
}

describe("pruefeMeldungMoeglich — Eignung des Dienstes", () => {
  it("erlaubt die Meldung an einem vergangenen, bestaetigten Arbeitsdienst", () => {
    expect(pruefeMeldungMoeglich({ shift: dienst(), jetzt: JETZT })).toEqual({ erlaubt: true });
  });

  it("blockiert Entwuerfe und Vorschlaege", () => {
    for (const planningStatus of ["VORLAEUFIG", "ANGEBOTEN"]) {
      expect(pruefeMeldungMoeglich({ shift: dienst({ planningStatus }), jetzt: JETZT })).toEqual({
        erlaubt: false,
        grund: "kein_bestaetigter_arbeitsdienst",
      });
    }
  });

  it("blockiert Abwesenheiten und Team-Termine", () => {
    expect(
      pruefeMeldungMoeglich({ shift: dienst({ istAbwesenheit: true }), jetzt: JETZT }),
    ).toEqual({ erlaubt: false, grund: "kein_bestaetigter_arbeitsdienst" });
    expect(
      pruefeMeldungMoeglich({ shift: dienst({ istTeamTermin: true }), jetzt: JETZT }),
    ).toEqual({ erlaubt: false, grund: "kein_bestaetigter_arbeitsdienst" });
  });

  it("blockiert kuenftige und gerade laufende Dienste", () => {
    expect(pruefeMeldungMoeglich({ shift: dienst({ endTime: MORGEN }), jetzt: JETZT })).toEqual({
      erlaubt: false,
      grund: "nicht_vergangen",
    });
    // Exakt jetzt endend zaehlt noch nicht als vergangen.
    expect(
      pruefeMeldungMoeglich({ shift: dienst({ endTime: new Date(JETZT) }), jetzt: JETZT }),
    ).toEqual({ erlaubt: false, grund: "nicht_vergangen" });
  });
});

describe("pruefeMeldungMoeglich — Melde-Kreislauf", () => {
  it("blockiert eine zweite Meldung, solange eine offen ist", () => {
    expect(
      pruefeMeldungMoeglich({
        shift: dienst(),
        letzteMeldung: { status: "PENDING", reportedAt: VORGESTERN, resolvedAt: null },
        jetzt: JETZT,
      }),
    ).toEqual({ erlaubt: false, grund: "offene_meldung" });
  });

  it("blockiert nach einer angenommenen Meldung ohne erneute Korrektur", () => {
    expect(
      pruefeMeldungMoeglich({
        shift: dienst(),
        letzteMeldung: { status: "ACCEPTED", reportedAt: VORGESTERN, resolvedAt: GESTERN },
        letzteAenderung: { changeSource: "deviation_accepted", createdAt: GESTERN },
        jetzt: JETZT,
      }),
    ).toEqual({ erlaubt: false, grund: "abschliessend_bearbeitet" });
  });

  it("oeffnet den Melde-Kanal, wenn der Planer SEITHER erneut korrigiert hat", () => {
    // Kay-Test 28.08.2026, Punkt 4: genau dieser Fall fehlte im Frontend.
    expect(
      pruefeMeldungMoeglich({
        shift: dienst(),
        letzteMeldung: { status: "ACCEPTED", reportedAt: VORGESTERN, resolvedAt: GESTERN },
        letzteAenderung: { changeSource: "planner_edit", createdAt: HEUTE_FRUEH },
        jetzt: JETZT,
      }),
    ).toEqual({ erlaubt: true });
  });

  it("oeffnet NICHT, wenn die Korrektur des Planers AELTER ist als die Erledigung", () => {
    expect(
      pruefeMeldungMoeglich({
        shift: dienst(),
        letzteMeldung: { status: "ACCEPTED", reportedAt: VORGESTERN, resolvedAt: HEUTE_FRUEH },
        letzteAenderung: { changeSource: "planner_edit", createdAt: GESTERN },
        jetzt: JETZT,
      }),
    ).toEqual({ erlaubt: false, grund: "abschliessend_bearbeitet" });
  });

  it("eine offene Meldung schlaegt eine seitherige Korrektur", () => {
    expect(
      pruefeMeldungMoeglich({
        shift: dienst(),
        letzteMeldung: { status: "PENDING", reportedAt: VORGESTERN, resolvedAt: null },
        letzteAenderung: { changeSource: "planner_edit", createdAt: HEUTE_FRUEH },
        jetzt: JETZT,
      }),
    ).toEqual({ erlaubt: false, grund: "offene_meldung" });
  });
});

describe("istSeitherKorrigiert", () => {
  it("ist ohne Meldung oder ohne Aenderung falsch", () => {
    expect(istSeitherKorrigiert(null, { changeSource: "planner_edit", createdAt: GESTERN })).toBe(
      false,
    );
    expect(
      istSeitherKorrigiert({ status: "ACCEPTED", reportedAt: VORGESTERN, resolvedAt: GESTERN }, null),
    ).toBe(false);
  });

  it("zaehlt nur Aenderungen des Planers, nicht die Annahme der Meldung selbst", () => {
    const meldung = { status: "ACCEPTED", reportedAt: VORGESTERN, resolvedAt: GESTERN };
    expect(istSeitherKorrigiert(meldung, { changeSource: "deviation_accepted", createdAt: HEUTE_FRUEH })).toBe(false);
    expect(istSeitherKorrigiert(meldung, { changeSource: "planner_edit", createdAt: HEUTE_FRUEH })).toBe(true);
  });

  it("faellt bei fehlendem resolvedAt auf reportedAt zurueck", () => {
    // Eine nie ausdruecklich erledigte Meldung: Bezugspunkt ist die Meldung.
    expect(
      istSeitherKorrigiert(
        { status: "ACCEPTED", reportedAt: GESTERN, resolvedAt: null },
        { changeSource: "planner_edit", createdAt: HEUTE_FRUEH },
      ),
    ).toBe(true);
    expect(
      istSeitherKorrigiert(
        { status: "ACCEPTED", reportedAt: HEUTE_FRUEH, resolvedAt: null },
        { changeSource: "planner_edit", createdAt: GESTERN },
      ),
    ).toBe(false);
  });
});
