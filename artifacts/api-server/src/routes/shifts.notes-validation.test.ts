/**
 * Unit-Tests für die 500-Zeichen-Validierung im Notizfeld der Schichten.
 *
 * Prüft, dass CreateShiftBody und UpdateShiftBody korrekt mit zu langen Notizen
 * umgehen. Die Validierung erfolgt über den Zod-Parser (maxLength: 500 aus
 * OpenAPI → Codegen → Zod).
 */

import { describe, it, expect } from "vitest";
import { CreateShiftBody, UpdateShiftBody } from "@workspace/api-zod";

const EXACTLY_500 = "a".repeat(500);
const EXACTLY_501 = "a".repeat(501);

const validCreateBase = {
  userId: 1,
  startTime: "2026-01-01T08:00:00.000Z",
  endTime: "2026-01-01T16:00:00.000Z",
  type: "work",
} as const;

describe("CreateShiftBody — notes maxLength", () => {
  it("akzeptiert eine Notiz mit exakt 500 Zeichen", () => {
    const result = CreateShiftBody.safeParse({
      ...validCreateBase,
      notes: EXACTLY_500,
    });
    expect(result.success).toBe(true);
  });

  it("lehnt eine Notiz mit 501 Zeichen ab (400-äquivalent)", () => {
    const result = CreateShiftBody.safeParse({
      ...validCreateBase,
      notes: EXACTLY_501,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const notesError = result.error.issues.find((i) =>
        i.path.includes("notes")
      );
      expect(notesError).toBeDefined();
    }
  });

  it("akzeptiert fehlende Notiz (optional)", () => {
    const result = CreateShiftBody.safeParse({ ...validCreateBase });
    expect(result.success).toBe(true);
  });

  it("akzeptiert leeren String als Notiz", () => {
    const result = CreateShiftBody.safeParse({
      ...validCreateBase,
      notes: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateShiftBody — notes maxLength", () => {
  it("akzeptiert eine Notiz mit exakt 500 Zeichen", () => {
    const result = UpdateShiftBody.safeParse({ notes: EXACTLY_500 });
    expect(result.success).toBe(true);
  });

  it("lehnt eine Notiz mit 501 Zeichen ab", () => {
    const result = UpdateShiftBody.safeParse({ notes: EXACTLY_501 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const notesError = result.error.issues.find((i) =>
        i.path.includes("notes")
      );
      expect(notesError).toBeDefined();
    }
  });

  it("akzeptiert null als Notiz (Loeschen)", () => {
    const result = UpdateShiftBody.safeParse({ notes: null });
    expect(result.success).toBe(true);
  });

  it("akzeptiert undefined / nicht gesetzt", () => {
    const result = UpdateShiftBody.safeParse({});
    expect(result.success).toBe(true);
  });
});
