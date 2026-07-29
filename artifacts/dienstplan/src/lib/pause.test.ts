import { describe, it, expect } from "vitest";
import { computeAutoPauseMinutes } from "./pause";

const gesetzlich = {
  pauseAutoEnabled: true,
  pauseThreshold1Hours: 6,
  pauseMinutes1: 30,
  pauseThreshold2Hours: 9,
  pauseMinutes2: 45,
};

describe("computeAutoPauseMinutes", () => {
  it("liefert 0, wenn die Regel ausgeschaltet ist", () => {
    expect(computeAutoPauseMinutes(10 * 60, { ...gesetzlich, pauseAutoEnabled: false })).toBe(0);
    expect(computeAutoPauseMinutes(10 * 60, {})).toBe(0);
  });

  it("gesetzliche Staffel: unter 6 h keine Pause", () => {
    expect(computeAutoPauseMinutes(0, gesetzlich)).toBe(0);
    expect(computeAutoPauseMinutes(4 * 60, gesetzlich)).toBe(0);
    expect(computeAutoPauseMinutes(6 * 60 - 1, gesetzlich)).toBe(0);
  });

  it("gesetzliche Staffel: ab 6 h → 30 min, ab 9 h → 45 min", () => {
    expect(computeAutoPauseMinutes(6 * 60, gesetzlich)).toBe(30);
    expect(computeAutoPauseMinutes(8 * 60, gesetzlich)).toBe(30);
    expect(computeAutoPauseMinutes(9 * 60, gesetzlich)).toBe(45);
    expect(computeAutoPauseMinutes(24 * 60, gesetzlich)).toBe(45);
  });

  it("nutzt Defaults, wenn nur der Schalter gesetzt ist", () => {
    expect(computeAutoPauseMinutes(7 * 60, { pauseAutoEnabled: true })).toBe(30);
    expect(computeAutoPauseMinutes(10 * 60, { pauseAutoEnabled: true })).toBe(45);
  });

  it("frei konfigurierbare Staffel", () => {
    const custom = {
      pauseAutoEnabled: true,
      pauseThreshold1Hours: 4,
      pauseMinutes1: 15,
      pauseThreshold2Hours: 8,
      pauseMinutes2: 60,
    };
    expect(computeAutoPauseMinutes(3 * 60, custom)).toBe(0);
    expect(computeAutoPauseMinutes(5 * 60, custom)).toBe(15);
    expect(computeAutoPauseMinutes(8 * 60, custom)).toBe(60);
  });

  it("vertauschte Schwellen: höchste erreichte Stufe gewinnt", () => {
    const swapped = {
      pauseAutoEnabled: true,
      pauseThreshold1Hours: 9,
      pauseMinutes1: 45,
      pauseThreshold2Hours: 6,
      pauseMinutes2: 30,
    };
    expect(computeAutoPauseMinutes(7 * 60, swapped)).toBe(30);
    expect(computeAutoPauseMinutes(10 * 60, swapped)).toBe(45);
  });

  it("ungültige Dauern ergeben 0", () => {
    expect(computeAutoPauseMinutes(-60, gesetzlich)).toBe(0);
    expect(computeAutoPauseMinutes(Number.NaN, gesetzlich)).toBe(0);
  });
});
