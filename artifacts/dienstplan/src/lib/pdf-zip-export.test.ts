/**
 * Unit-Tests für buildLohnnachweisBatch (pdf-zip-export.ts).
 *
 * PDF-Erzeugung wird injiziert (kein jspdf / Browser nötig).
 * ZIP-Assembly und Download werden NICHT getestet (Browser-Abhängigkeiten).
 */

import { describe, it, expect, vi } from "vitest";
import { buildLohnnachweisBatch } from "./pdf-zip-export";

const MONTH = 7;
const YEAR = 2026;
const MONTH_LABEL = "Juli 2026";

const makeBalance = (userId: number, userName: string) => ({ userId, userName });

// Einfacher Fake-PDF-Generator: gibt Uint8Array mit userId-Byte zurück.
function fakeGeneratePdf(balance: any) {
  return Promise.resolve(new Uint8Array([balance.userId]));
}

// Generator der null zurückgibt (= keine bestätigten Dienste).
function nullGeneratePdf(_balance: any) {
  return Promise.resolve(null);
}

// Generator der einen Fehler wirft.
function throwingGeneratePdf(_balance: any): Promise<Uint8Array | null> {
  return Promise.reject(new Error("PDF-Fehler"));
}

describe("buildLohnnachweisBatch", () => {
  it("erzeugt für jede Balance eine PDF-Datei mit korrektem Namen", async () => {
    const balances = [
      makeBalance(1, "Anna Müller"),
      makeBalance(2, "Ben Schulz"),
    ];
    const entries = await buildLohnnachweisBatch({
      balances,
      month: MONTH,
      year: YEAR,
      monthLabel: MONTH_LABEL,
      _generatePdf: fakeGeneratePdf,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].filename).toBe("lohnnachweis-anna-müller-2026-07.pdf");
    expect(entries[0].data).toEqual(new Uint8Array([1]));
    expect(entries[1].filename).toBe("lohnnachweis-ben-schulz-2026-07.pdf");
    expect(entries[1].data).toEqual(new Uint8Array([2]));
  });

  it("schreibt .fehler.txt wenn der Generator null zurückgibt (keine Dienste)", async () => {
    const balances = [makeBalance(5, "Clara Huber")];
    const entries = await buildLohnnachweisBatch({
      balances,
      month: MONTH,
      year: YEAR,
      monthLabel: MONTH_LABEL,
      _generatePdf: nullGeneratePdf,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toContain(".fehler.txt");
    expect(entries[0].data).toBeNull();
    expect(entries[0].errorMessage).toContain("Clara Huber");
    expect(entries[0].errorMessage).toContain("Keine bestätigten Dienste");
  });

  it("schreibt .fehler.txt bei einem geworfenen Fehler ohne den Export abzubrechen", async () => {
    const balances = [
      makeBalance(1, "Anna Müller"),
      makeBalance(2, "Crash Kraft"), // wirft Fehler
    ];
    // Erster Aufruf: ok; zweiter: Fehler
    let callCount = 0;
    const mixed = (_balance: any) => {
      callCount++;
      if (callCount === 2) return throwingGeneratePdf(_balance);
      return fakeGeneratePdf(_balance);
    };

    const entries = await buildLohnnachweisBatch({
      balances,
      month: MONTH,
      year: YEAR,
      monthLabel: MONTH_LABEL,
      _generatePdf: mixed,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].data).not.toBeNull();
    expect(entries[1].filename).toContain(".fehler.txt");
    expect(entries[1].errorMessage).toContain("PDF-Fehler");
  });

  it("ruft onProgress nach jeder Balance auf", async () => {
    const balances = [makeBalance(1, "A"), makeBalance(2, "B"), makeBalance(3, "C")];
    const calls: [number, number][] = [];
    await buildLohnnachweisBatch({
      balances,
      month: MONTH,
      year: YEAR,
      monthLabel: MONTH_LABEL,
      _generatePdf: fakeGeneratePdf,
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("gibt leeres Array zurück wenn keine Balances übergeben werden", async () => {
    const entries = await buildLohnnachweisBatch({
      balances: [],
      month: MONTH,
      year: YEAR,
      monthLabel: MONTH_LABEL,
      _generatePdf: fakeGeneratePdf,
    });
    expect(entries).toHaveLength(0);
  });

  it("sanitiert Sonderzeichen im Namen korrekt im Dateinamen", async () => {
    const balances = [makeBalance(1, "Dr. Frau von Muster-Beispiel")];
    const entries = await buildLohnnachweisBatch({
      balances,
      month: 1,
      year: 2025,
      monthLabel: "Januar 2025",
      _generatePdf: fakeGeneratePdf,
    });
    expect(entries[0].filename).toBe(
      "lohnnachweis-dr-frau-von-muster-beispiel-2025-01.pdf",
    );
  });

  it("ruft den injizierten generatePdf-Mock mit den richtigen Parametern auf", async () => {
    const mockFn = vi.fn().mockResolvedValue(new Uint8Array([42]));
    const balance = makeBalance(7, "Test User");
    await buildLohnnachweisBatch({
      balances: [balance],
      month: 3,
      year: 2024,
      monthLabel: "März 2024",
      teamId: 99,
      _generatePdf: mockFn,
    });
    expect(mockFn).toHaveBeenCalledWith(balance, 3, 2024, "März 2024", 99);
  });
});
