import { describe, it, expect } from "vitest";
import {
  dienstZeiten,
  planeRotation,
  zuweisungsStunden,
  type PlanDienst,
  type PlanPerson,
} from "./autoplanung";

const TAG24: PlanDienst = { id: 1, name: "24h Assistenz", startTime: "09:00", endTime: "09:00" };
const FRUEH: PlanDienst = { id: 2, name: "Frühdienst", startTime: "06:00", endTime: "14:00" };
const NACHT: PlanDienst = { id: 3, name: "Nachtdienst", startTime: "22:00", endTime: "06:00" };

const ANNA: PlanPerson = { id: 10, name: "Anna Muster" };
const BEN: PlanPerson = { id: 11, name: "Ben Beispiel" };
const CLARA: PlanPerson = { id: 12, name: "Clara Test" };

// September 2026: der 1. ist ein Dienstag.
const TAGE = (von: number, bis: number) =>
  Array.from({ length: bis - von + 1 }, (_, i) => `2026-09-${String(von + i).padStart(2, "0")}`);

function basis(over: Partial<Parameters<typeof planeRotation>[0]> = {}) {
  return {
    dienst: TAG24,
    offeneTage: TAGE(1, 6),
    personen: [ANNA, BEN, CLARA],
    blockLaenge: 1,
    ruhezeitStunden: 11,
    bestehende: [],
    abwesend: new Map<number, Set<string>>(),
    ...over,
  };
}

describe("dienstZeiten", () => {
  it("legt bei Ende gleich Start den 24-Stunden-Dienst auf den Folgetag", () => {
    const { start, ende } = dienstZeiten("2026-09-01", TAG24);
    expect(start).toEqual(new Date(2026, 8, 1, 9, 0));
    expect(ende).toEqual(new Date(2026, 8, 2, 9, 0));
  });

  it("legt bei Ende vor Start den Tagesuebergang an", () => {
    const { ende } = dienstZeiten("2026-09-01", NACHT);
    expect(ende).toEqual(new Date(2026, 8, 2, 6, 0));
  });

  it("bleibt bei normalen Zeiten am selben Tag", () => {
    const { start, ende } = dienstZeiten("2026-09-01", FRUEH);
    expect(start).toEqual(new Date(2026, 8, 1, 6, 0));
    expect(ende).toEqual(new Date(2026, 8, 1, 14, 0));
    expect(zuweisungsStunden({ start, ende })).toBe(8);
  });
});

describe("planeRotation — Reihum-Grundlauf", () => {
  it("wechselt bei Blocklaenge 1 jeden Tag die Person", () => {
    const { zuweisungen, offenGeblieben } = planeRotation(basis());
    expect(offenGeblieben).toEqual([]);
    expect(zuweisungen.map((z) => z.name.split(" ")[0])).toEqual([
      "Anna", "Ben", "Clara", "Anna", "Ben", "Clara",
    ]);
  });

  it("gibt bei Blocklaenge 2 jeder Person zwei Dienste am Stueck", () => {
    const { zuweisungen } = planeRotation(basis({ blockLaenge: 2 }));
    expect(zuweisungen.map((z) => z.name.split(" ")[0])).toEqual([
      "Anna", "Anna", "Ben", "Ben", "Clara", "Clara",
    ]);
  });

  it("laesst die Ruhezeit INNERHALB eines 24h-Blocks bewusst zu", () => {
    // Zwei 24h-Dienste am Stueck haben 0 h Abstand — genau das ist der Block.
    const { zuweisungen, offenGeblieben } = planeRotation(
      basis({ blockLaenge: 2, personen: [ANNA, BEN] }),
    );
    expect(offenGeblieben).toEqual([]);
    expect(zuweisungen).toHaveLength(6);
  });
});

describe("planeRotation — Hindernisse", () => {
  it("ueberspringt eine abwesende Person und macht mit der naechsten weiter", () => {
    const abwesend = new Map([[BEN.id, new Set(["2026-09-02"])]]);
    const { zuweisungen } = planeRotation(basis({ abwesend }));
    // Am 2. ist Ben abwesend -> Clara springt ein; die Rotation laeuft danach
    // bei der Person NACH Clara weiter (Fairness, kein doppeltes Anrechnen).
    expect(zuweisungen.map((z) => z.name.split(" ")[0])).toEqual([
      "Anna", "Clara", "Anna", "Ben", "Clara", "Anna",
    ]);
  });

  it("wertet einen bestehenden Dienst am selben Tag als belegt", () => {
    const bestehende = [
      { userId: BEN.id, startTime: "2026-09-02T18:00:00", endTime: "2026-09-02T20:00:00" },
    ];
    const { zuweisungen } = planeRotation(basis({ bestehende }));
    expect(zuweisungen.find((z) => z.datum === "2026-09-02")?.userId).toBe(CLARA.id);
  });

  it("haelt die Ruhezeit gegen bestehende Dienste ein", () => {
    // Anna arbeitet am 31.08. bis 23:00 — ein Fruehdienst am 1.9. um 06:00
    // hat nur 7 h Abstand und faellt bei 11 h Ruhezeit an Ben. Die Rotation
    // laeuft danach hinter Ben weiter (Clara), Annas Runde kommt spaeter.
    const bestehende = [
      { userId: ANNA.id, startTime: "2026-08-31T15:00:00", endTime: "2026-08-31T23:00:00" },
    ];
    const { zuweisungen } = planeRotation(
      basis({ dienst: FRUEH, offeneTage: TAGE(1, 2), bestehende }),
    );
    expect(zuweisungen.map((z) => z.userId)).toEqual([BEN.id, CLARA.id]);
  });

  it("meldet einen Tag als offen geblieben, wenn niemand kann — mit Gruenden", () => {
    const abwesend = new Map([
      [ANNA.id, new Set(["2026-09-01"])],
      [BEN.id, new Set(["2026-09-01"])],
      [CLARA.id, new Set(["2026-09-01"])],
    ]);
    const { zuweisungen, offenGeblieben } = planeRotation(basis({ offeneTage: TAGE(1, 1), abwesend }));
    expect(zuweisungen).toEqual([]);
    expect(offenGeblieben).toHaveLength(1);
    expect(offenGeblieben[0]!.datum).toBe("2026-09-01");
    expect(offenGeblieben[0]!.gruende.map((g) => g.grund)).toEqual([
      "abwesend", "abwesend", "abwesend",
    ]);
  });

  it("bricht einen Block ab, wenn die Person nicht mehr kann, und vergibt den Tag neu", () => {
    const abwesend = new Map([[ANNA.id, new Set(["2026-09-02"])]]);
    const { zuweisungen } = planeRotation(basis({ blockLaenge: 3, abwesend }));
    // Annas Block reisst am 2. — Ben beginnt seinen eigenen Dreierblock.
    expect(zuweisungen.map((z) => z.name.split(" ")[0])).toEqual([
      "Anna", "Ben", "Ben", "Ben", "Clara", "Clara",
    ]);
  });

  it("verteilt einen Mo-Fr-Dienst blockweise ueber die Wochenluecke hinweg", () => {
    // 3.-4.9. (Do/Fr) und 7.9. (Mo): Annas Zweierblock endet am Freitag,
    // der Montag beginnt regulaer mit Ben — kein Ruhezeit-Fehler ueber das
    // Wochenende, kein haengender Blockzustand.
    const { zuweisungen } = planeRotation(
      basis({ dienst: FRUEH, blockLaenge: 2, offeneTage: ["2026-09-03", "2026-09-04", "2026-09-07"] }),
    );
    expect(zuweisungen.map((z) => z.name.split(" ")[0])).toEqual(["Anna", "Anna", "Ben"]);
  });

  it("liefert ohne Personen alle Tage als offen geblieben", () => {
    const { zuweisungen, offenGeblieben } = planeRotation(basis({ personen: [] }));
    expect(zuweisungen).toEqual([]);
    expect(offenGeblieben).toHaveLength(6);
  });
});
