/**
 * #662 – Bestätigen, dass der SV-pflichtig-Hinweis im PDF-Lohnnachweis
 *        korrekt erscheint.
 *
 * Prüft, dass generateLohnnachweisPdfBlob() bei einer Balance mit
 * Urlaubs-/Krankheitsstunden auf Sonntagen / Feiertagen / Nachtstunden
 * den Hinweis "SV-pflichtig" in das erzeugte PDF einbettet.
 *
 * Das Gegenteil wird ebenfalls verifiziert: ohne Abwesenheitszuschläge
 * taucht "SV-pflichtig" nicht auf.
 *
 * Implementierungsreferenz: pdf-export.ts Zeilen 223–331
 *   - Sonntagsstunden, Urlaub/Krank (XX%, SV-pflichtig)  → balance.sundayPercent > 0 && absenceSundayH > 0
 *   - Nachtstunden, Urlaub/Krank (XX%, SV-pflichtig)     → balance.nightPercent > 0 && absenceNightH > 0
 *   - Feiertagsstunden, Urlaub/Krank (XX%, SV-pflichtig) → balance.holidayPercent > 0 && absenceHolidayH > 0
 */

import { describe, it, expect, vi } from "vitest";
import { generateLohnnachweisPdfBlob } from "./pdf-export";

// renderStatementPage ruft listShifts auf und gibt nur dann hadContent=true
// zurück, wenn mindestens eine FIX-Schicht in der Liste ist. Im Unit-Test
// gibt es keine echte API — deshalb wird ein Vacation-FIX-Dienst am
// Test-Sonntag 2026-07-05 zurückgegeben. getBrandingSettings wird ebenfalls
// gemockt (kein Logo-Load-Fehler im Node-Umfeld nötig).
vi.mock("@workspace/api-client-react", () => ({
  listShifts: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      startTime: "2026-07-05T08:00:00.000Z",
      endTime: "2026-07-05T16:00:00.000Z",
      type: "vacation",
      planningStatus: "FIX",
      notes: null,
    },
  ]),
  getBrandingSettings: vi.fn().mockResolvedValue(null),
}));

// Minimale Balance-Basis — alle Felder die der PDF-Generator über ?? 0 absichert.
const BASE_BALANCE = {
  userId: 1,
  userName: "E2E Test Assistent",
  balance: 0,
  totalFulfilledHours: 8,
  valuedHours: 8,
  plannedHours: 8,
  vacationFulfilledHours: 8,
  sickHours: 0,
  vacationDaysTaken: 1,
  vacationDaysRemaining: 29,
  nightHours: 0,
  nightSurchargeHours: 0,
  sundayHours: 0,
  sundaySurchargeHours: 0,
  holidayHours: 0,
  holidaySurchargeHours: 0,
  absenceNightHours: 0,
  absenceNightSurchargeHours: 0,
  absenceSundayHours: 0,
  absenceSundaySurchargeHours: 0,
  absenceHolidayHours: 0,
  absenceHolidaySurchargeHours: 0,
  nightPercent: 0,
  sundayPercent: 0,
  holidayPercent: 0,
  hourlyWage: null,
  teamsitzungEuro: null,
  nightSurchargePay: null,
  absenceNightSurchargePay: null,
  sundaySurchargePay: null,
  absenceSundaySurchargePay: null,
  holidaySurchargePay: null,
  absenceHolidaySurchargePay: null,
};

/** Sucht nach einem UTF-8/Latin-1-Text in den Roh-Bytes eines PDF. */
function pdfContains(bytes: Uint8Array, text: string): boolean {
  const raw = Buffer.from(bytes).toString("binary");
  return raw.includes(text);
}

describe("generateLohnnachweisPdfBlob — SV-pflichtig (#662)", () => {
  it("gibt eine nicht-leere Uint8Array zurück wenn Urlaubstag auf Sonntag fällt", async () => {
    const balance = {
      ...BASE_BALANCE,
      sundayPercent: 25,
      sundayHours: 8,
      absenceSundayHours: 8,
      absenceSundaySurchargeHours: 2,
    };

    const result = await generateLohnnachweisPdfBlob(balance, 7, 2026, "Juli 2026");
    expect(result, "generateLohnnachweisPdfBlob soll nicht null zurückgeben").not.toBeNull();
    expect(result!.length, "PDF-Bytes sollen nicht leer sein").toBeGreaterThan(0);
  });

  it("bettet SV-pflichtig-Hinweis ein, wenn Sonntagszuschlag auf Urlaubstag anfällt", async () => {
    const balance = {
      ...BASE_BALANCE,
      sundayPercent: 25,
      sundayHours: 8,
      absenceSundayHours: 8,
      absenceSundaySurchargeHours: 2,
    };

    const result = await generateLohnnachweisPdfBlob(balance, 7, 2026, "Juli 2026");
    expect(result).not.toBeNull();
    expect(
      pdfContains(result!, "SV-pflichtig"),
      "PDF muss 'SV-pflichtig' enthalten wenn Urlaub/Krank-Sonntagszuschlag vorhanden",
    ).toBe(true);
  });

  it("bettet SV-pflichtig-Hinweis ein, wenn Nachtzuschlag auf Urlaubstag anfällt", async () => {
    const balance = {
      ...BASE_BALANCE,
      nightPercent: 20,
      nightHours: 4,
      nightSurchargeHours: 4,
      absenceNightHours: 4,
      absenceNightSurchargeHours: 4,
    };

    const result = await generateLohnnachweisPdfBlob(balance, 7, 2026, "Juli 2026");
    expect(result).not.toBeNull();
    expect(
      pdfContains(result!, "SV-pflichtig"),
      "PDF muss 'SV-pflichtig' enthalten wenn Urlaub/Krank-Nachtzuschlag vorhanden",
    ).toBe(true);
  });

  it("bettet SV-pflichtig-Hinweis ein, wenn Feiertagszuschlag auf Urlaubstag anfällt", async () => {
    const balance = {
      ...BASE_BALANCE,
      holidayPercent: 100,
      holidayHours: 8,
      holidaySurchargeHours: 8,
      absenceHolidayHours: 8,
      absenceHolidaySurchargeHours: 8,
    };

    const result = await generateLohnnachweisPdfBlob(balance, 7, 2026, "Juli 2026");
    expect(result).not.toBeNull();
    expect(
      pdfContains(result!, "SV-pflichtig"),
      "PDF muss 'SV-pflichtig' enthalten wenn Urlaub/Krank-Feiertagszuschlag vorhanden",
    ).toBe(true);
  });

  it("enthält KEIN SV-pflichtig wenn keine Abwesenheitszuschläge vorhanden sind", async () => {
    // Normale Arbeitsstunden ohne Abwesenheitszuschläge → kein SV-pflichtig.
    const balance = {
      ...BASE_BALANCE,
      sundayPercent: 25,
      sundayHours: 8,
      absenceSundayHours: 0, // Arbeitstag, kein Urlaubstag am Sonntag
      sundaySurchargeHours: 8,
    };

    const result = await generateLohnnachweisPdfBlob(balance, 7, 2026, "Juli 2026");
    expect(result).not.toBeNull();
    expect(
      pdfContains(result!, "SV-pflichtig"),
      "PDF darf kein 'SV-pflichtig' enthalten wenn keine Abwesenheitszuschläge vorhanden",
    ).toBe(false);
  });
});
