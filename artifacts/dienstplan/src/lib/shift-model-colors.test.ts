import { describe, expect, it } from "vitest";
import {
  buildPersonColorAssignment,
  SHIFT_MODEL_COLORS,
} from "./shift-model-colors";

describe("buildPersonColorAssignment", () => {
  it("gibt 8 beliebigen (unsortierten, doppelten) IDs 8 verschiedene Farben", () => {
    const ids = [42, 7, 999, 7, 13, 100, 3, 55, 999, 21];
    const assignment = buildPersonColorAssignment(ids);
    expect(assignment.size).toBe(8);
    const colors = [...assignment.values()].map((c) => c.value);
    expect(new Set(colors).size).toBe(8);
  });

  it("ist unabhängig von der Eingabereihenfolge stabil", () => {
    const ids = [42, 7, 999, 13, 100, 3, 55, 21];
    const a = buildPersonColorAssignment(ids);
    const b = buildPersonColorAssignment([...ids].reverse());
    const c = buildPersonColorAssignment([13, 999, 3, 42, 21, 55, 7, 100]);
    for (const id of ids) {
      expect(b.get(id)?.value).toBe(a.get(id)?.value);
      expect(c.get(id)?.value).toBe(a.get(id)?.value);
    }
  });

  it("verschiebt bestehende Farben nicht, wenn eine höhere ID hinzukommt", () => {
    const ids = [42, 7, 999, 13, 100, 3, 55, 21];
    const before = buildPersonColorAssignment(ids);
    const after = buildPersonColorAssignment([...ids, 5000]);
    for (const id of ids) {
      expect(after.get(id)?.value).toBe(before.get(id)?.value);
    }
    expect(after.get(5000)).toBeDefined();
  });

  it("weist die Farben in Palettenreihenfolge nach aufsteigender ID zu", () => {
    const ids = [30, 10, 20];
    const assignment = buildPersonColorAssignment(ids);
    expect(assignment.get(10)?.value).toBe(SHIFT_MODEL_COLORS[0]!.value);
    expect(assignment.get(20)?.value).toBe(SHIFT_MODEL_COLORS[1]!.value);
    expect(assignment.get(30)?.value).toBe(SHIFT_MODEL_COLORS[2]!.value);
  });

  it("ignoriert nicht-endliche IDs", () => {
    const assignment = buildPersonColorAssignment([NaN, Infinity, 5]);
    expect(assignment.size).toBe(1);
    expect(assignment.get(5)).toBeDefined();
  });
});
