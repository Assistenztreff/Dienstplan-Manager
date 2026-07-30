/**
 * Unit-Tests für buildMatrixCsv (#674):
 * Sichert ab, dass der CSV-Export der Auswertungs-Matrix
 * korrekte Struktur, bedingte Spalten und CSV-Escaping liefert.
 */

import { describe, it, expect } from "vitest";
import { buildMatrixCsv } from "./matrix-csv";
import type { MatrixBalance } from "@/components/gesamt-auswertung-matrix";

// ---- Fixture-Daten --------------------------------------------------------

const BASE: MatrixBalance = {
  userId: 1,
  userName: "Anna Muster",
  valuedHours: 160,
  plannedHours: 160,
  totalFulfilledHours: 168,
  sickHours: 8,
  vacationDaysTaken: 1,
  nightPercent: 0,
  nightHours: 0,
  nightSurchargeHours: 0,
  sundayPercent: 0,
  sundayHours: 0,
  sundaySurchargeHours: 0,
  holidayPercent: 0,
  holidayHours: 0,
  holidaySurchargeHours: 0,
};

// ---- Tests ----------------------------------------------------------------

describe("buildMatrixCsv (#674)", () => {
  it("liefert CSV mit UTF-8-BOM, Kopfzeile und einer Datenzeile", () => {
    const csv = buildMatrixCsv([BASE]);

    expect(csv.startsWith("\uFEFF"), "CSV muss mit UTF-8-BOM für Excel-Kompatibilität beginnen").toBe(
      true,
    );

    const lines = csv.replace("\uFEFF", "").split("\r\n").filter(Boolean);
    expect(lines.length, "Kopfzeile + 1 Datenzeile = mindestens 2 Zeilen").toBeGreaterThanOrEqual(2);

    expect(lines[0]!.startsWith("Name;"), "Kopfzeile muss mit 'Name;' beginnen").toBe(true);
    expect(lines[1], "Datenzeile muss mit dem Namen beginnen").toMatch(/^Anna Muster;/);
  });

  it("Pflichtkolumnen sind in der Kopfzeile vorhanden", () => {
    const csv = buildMatrixCsv([BASE]);
    const header = csv.replace("\uFEFF", "").split("\r\n")[0]!;

    expect(header).toContain("Geleistete Stunden (IST)");
    expect(header).toContain("Soll-Stunden");
    expect(header).toContain("Erfüllt gesamt (inkl. Urlaub/Krank)");
    expect(header).toContain("Krankheitsstunden");
    expect(header).toContain("Urlaubstage (genommen)");
    expect(header).toContain("Bereitschaften (Anz.)");
    expect(header).toContain("Bereitschaften (h)");
  });

  it("Nachtzuschlag-Spalten erscheinen nur wenn nightPercent > 0", () => {
    const csvOhne = buildMatrixCsv([BASE]);
    expect(csvOhne, "Ohne Nachtprozent: keine Nachtstunden-Spalte").not.toContain("Nachtstunden");

    const mitNacht: MatrixBalance = {
      ...BASE,
      nightPercent: 25,
      nightHours: 4,
      nightSurchargeHours: 1,
    };
    const csvMit = buildMatrixCsv([mitNacht]);
    expect(csvMit, "Mit nightPercent=25: Nachtstunden-Spalte vorhanden").toContain(
      "Nachtstunden (25%)",
    );
    expect(csvMit, "Mit nightPercent=25: Nachtzuschlag-Spalte vorhanden").toContain(
      "Nachtzuschlag (+25% h)",
    );
  });

  it("Sonntagszuschlag-Spalten erscheinen nur wenn sundayPercent > 0", () => {
    const csvOhne = buildMatrixCsv([BASE]);
    expect(csvOhne).not.toContain("Sonntagsstunden");

    const mitSonntag: MatrixBalance = {
      ...BASE,
      sundayPercent: 50,
      sundayHours: 2,
      sundaySurchargeHours: 1,
    };
    const csvMit = buildMatrixCsv([mitSonntag]);
    expect(csvMit).toContain("Sonntagsstunden (50%)");
    expect(csvMit).toContain("Sonntagszuschlag (+50% h)");
  });

  it("Feiertagszuschlag-Spalten erscheinen nur wenn holidayPercent > 0", () => {
    const mitFeiertag: MatrixBalance = {
      ...BASE,
      holidayPercent: 100,
      holidayHours: 8,
      holidaySurchargeHours: 8,
    };
    const csv = buildMatrixCsv([mitFeiertag]);
    expect(csv).toContain("Feiertagsstunden (100%)");
    expect(csv).toContain("Feiertagszuschlag (+100% h)");
  });

  it("SV-pflichtig-Spalten erscheinen wenn Abwesenheits-Zuschlag vorhanden", () => {
    const mitSv: MatrixBalance = {
      ...BASE,
      sundayPercent: 50,
      absenceSundayHours: 8,
      absenceSundaySurchargeHours: 4,
    };
    const csv = buildMatrixCsv([mitSv]);
    expect(csv).toContain("SV-pflichtig Basis h (Urlaub/Krank)");
    expect(csv).toContain("SV-pflichtig Zuschlag h (Urlaub/Krank)");
  });

  it("mehrere Assistenten erzeugen eine Zeile je Person", () => {
    const zweite: MatrixBalance = {
      ...BASE,
      userId: 2,
      userName: "Ben Test",
      valuedHours: 80,
    };
    const csv = buildMatrixCsv([BASE, zweite]);
    const lines = csv
      .replace("\uFEFF", "")
      .split("\r\n")
      .filter(Boolean);

    expect(lines, "Kopfzeile + 2 Datenzeilen = 3 Zeilen").toHaveLength(3);
    expect(lines[1]).toMatch(/^Anna Muster;/);
    expect(lines[2]).toMatch(/^Ben Test;/);
  });

  it("Semikolon im Namen wird durch Anführungszeichen geschützt", () => {
    const mitSemikolon: MatrixBalance = {
      ...BASE,
      userName: 'Muster; Anna "Tester"',
    };
    const csv = buildMatrixCsv([mitSemikolon]);
    const dataLine = csv.replace("\uFEFF", "").split("\r\n")[1]!;

    // Zelle muss in Anführungszeichen eingeschlossen sein; interne
    // Anführungszeichen werden durch Verdoppelung escaped.
    expect(dataLine, "Name mit Semikolon muss korrekt quoted sein").toMatch(
      /^"Muster; Anna ""Tester""";/,
    );
  });

  it("Stundenwerte ohne Nachkommastellen werden ohne Dezimaltrennzeichen ausgegeben", () => {
    const csv = buildMatrixCsv([BASE]);
    const dataLine = csv.replace("\uFEFF", "").split("\r\n")[1]!;
    // 160 Stunden: in DE-Locale "160", niemals "160.0" oder "160,0"
    expect(dataLine).toContain(";160;");
  });

  it("Stundenwerte mit Dezimalstellen nutzen deutsches Kommaformat", () => {
    const mitDezimal: MatrixBalance = {
      ...BASE,
      valuedHours: 160.5,
    };
    const csv = buildMatrixCsv([mitDezimal]);
    const dataLine = csv.replace("\uFEFF", "").split("\r\n")[1]!;
    // DE-Locale: "160,5" (Komma, kein Punkt)
    expect(dataLine, "Dezimalstunden müssen mit Komma formatiert sein").toContain("160,5");
    expect(dataLine).not.toContain("160.5");
  });
});
