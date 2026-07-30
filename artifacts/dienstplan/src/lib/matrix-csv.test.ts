import { describe, expect, it } from "vitest";
import { buildMatrixCsv } from "./matrix-csv";
import type { MatrixBalance } from "@/components/gesamt-auswertung-matrix";

function makeBalance(overrides: Partial<MatrixBalance> & Pick<MatrixBalance, "userId" | "userName">): MatrixBalance {
  return {
    valuedHours: 0,
    plannedHours: 0,
    totalFulfilledHours: 0,
    sickHours: 0,
    vacationDaysTaken: 0,
    nightPercent: 0,
    nightHours: 0,
    nightSurchargeHours: 0,
    sundayPercent: 0,
    sundayHours: 0,
    sundaySurchargeHours: 0,
    holidayPercent: 0,
    holidayHours: 0,
    holidaySurchargeHours: 0,
    ...overrides,
  };
}

describe("buildMatrixCsv", () => {
  it("beginnt mit UTF-8-BOM", () => {
    const csv = buildMatrixCsv([makeBalance({ userId: 1, userName: "Anna" })]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("erste Kopfzeile enthält 'Name' und Stunden-Kategorien", () => {
    const csv = buildMatrixCsv([makeBalance({ userId: 1, userName: "Anna" })]);
    const [header] = csv.slice(1).split("\r\n");
    expect(header).toContain("Name");
    expect(header).toContain("Geleistete Stunden (IST)");
    expect(header).toContain("Soll-Stunden");
    expect(header).toContain("Urlaubstage (genommen)");
  });

  it("erzeugt eine Datenzeile pro Assistenz", () => {
    const balances = [
      makeBalance({ userId: 1, userName: "Anna" }),
      makeBalance({ userId: 2, userName: "Bob" }),
    ];
    const csv = buildMatrixCsv(balances);
    const lines = csv.slice(1).split("\r\n");
    // 1 Kopfzeile + 2 Datenzeilen
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Anna");
    expect(lines[2]).toContain("Bob");
  });

  it("verwendet Semikolon als Trennzeichen", () => {
    const csv = buildMatrixCsv([makeBalance({ userId: 1, userName: "Anna" })]);
    const [header] = csv.slice(1).split("\r\n");
    expect(header).toContain(";");
    // kein Komma als Feldtrenner
    const cols = header.split(";");
    expect(cols.length).toBeGreaterThan(2);
  });

  it("formatiert Stunden mit deutschem Dezimalkomma", () => {
    const balance = makeBalance({
      userId: 1,
      userName: "Anna",
      valuedHours: 160.5,
      plannedHours: 160,
    });
    const csv = buildMatrixCsv([balance]);
    // 160,5 muss im CSV stehen (Komma, nicht Punkt)
    expect(csv).toContain("160,5");
    // 160 als ganze Zahl ohne Komma
    expect(csv).toContain(";160;");
  });

  it("enthält Nacht-/Sonntag-/Feiertagsspalten nur, wenn mind. eine Kraft einen Satz hat", () => {
    const noSurcharges = makeBalance({ userId: 1, userName: "Anna" });
    const csvNo = buildMatrixCsv([noSurcharges]);
    expect(csvNo).not.toContain("Nachtstunden");
    expect(csvNo).not.toContain("Sonntagsstunden");

    const withNight = makeBalance({
      userId: 1,
      userName: "Anna",
      nightPercent: 25,
      nightHours: 8,
      nightSurchargeHours: 2,
    });
    const csvYes = buildMatrixCsv([withNight]);
    expect(csvYes).toContain("Nachtstunden");
    expect(csvYes).toContain("Nachtzuschlag");
  });

  it("enthält Lohn-Spalten nur, wenn ein Stundenlohn hinterlegt ist", () => {
    const noWage = makeBalance({ userId: 1, userName: "Anna" });
    expect(buildMatrixCsv([noWage])).not.toContain("Grundlohn");

    const withWage = makeBalance({
      userId: 1,
      userName: "Anna",
      hourlyWage: 14.5,
      basePay: 2320,
      totalPay: 2320,
    });
    const csv = buildMatrixCsv([withWage]);
    expect(csv).toContain("Grundlohn");
    expect(csv).toContain("GESAMT brutto");
  });

  it("schreibt Lohnwerte als deutsches Währungsformat", () => {
    const balance = makeBalance({
      userId: 1,
      userName: "Anna",
      hourlyWage: 14,
      basePay: 2240,
      totalPay: 2240,
    });
    const csv = buildMatrixCsv([balance]);
    // Deutsches Währungsformat: Komma als Dezimaltrenner, €-Zeichen
    expect(csv).toContain("2.240,00");
  });

  it("enthält SV-pflichtig-Spalten nur, wenn Abwesenheitszuschläge vorhanden", () => {
    const noAbsence = makeBalance({ userId: 1, userName: "Anna" });
    expect(buildMatrixCsv([noAbsence])).not.toContain("SV-pflichtig");

    const withAbsence = makeBalance({
      userId: 1,
      userName: "Anna",
      absenceSundayHours: 8,
      absenceSundaySurchargeHours: 2,
    });
    expect(buildMatrixCsv([withAbsence])).toContain("SV-pflichtig");
  });

  it("quotet Zellwerte mit Semikolons korrekt", () => {
    const balance = makeBalance({ userId: 1, userName: "Müller; Anna" });
    const csv = buildMatrixCsv([balance]);
    expect(csv).toContain('"Müller; Anna"');
  });

  it("enthält Nachberechnungs-Spalte, wenn recalcByUser übergeben wird", () => {
    const balance = makeBalance({ userId: 1, userName: "Anna", hourlyWage: 14, totalPay: 2240 });
    const recalc = new Map([[1, { diffPay: 50, diffBasePay: 50, diffSurchargePay: 0 }]]);
    const csv = buildMatrixCsv([balance], recalc, "Juni 2026");
    expect(csv).toContain("Nachberechnung Juni 2026");
  });
});
