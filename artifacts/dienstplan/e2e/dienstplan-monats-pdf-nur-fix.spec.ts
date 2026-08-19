import fs from "node:fs";
import { test, expect, type Download, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { openHeaderOverflow } from "./helpers/header";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Beweis (Task-Kontext: Produktversprechen "Nur FIX-Schichten zählen in
 * Auswertungen UND PDF"): Auch der EINFACHE Monats-PDF-Export (Free-Feature
 * "basicExport", Button "Monats-PDF" auf /dienstplan, `exportSimpleMonthPdf`)
 * weist ausschließlich verbindliche (FIX) Dienste aus — Entwürfe (VORLAEUFIG)
 * und Vorschläge (ANGEBOTEN) landen NIE im Dokument.
 *
 * Der Premium-Stundennachweis ist bereits separat bewiesen
 * (dienstplan-nachweis-nur-fix-schichten.spec.ts); dieser Spec schließt die
 * verbleibende Lücke für den Monats-PDF-Export, der rein aus GET /shifts
 * gespeist wird und dessen FIX-Filter ausschließlich im Frontend liegt —
 * genau die Stelle, an der eine Frontend-Regression sonst unbemerkt bliebe.
 *
 * Aufbau (frisches Free-Konto, eigener Assistent, aktueller Monat):
 * - FIX-Dienst (8h), Urlaubs-Abwesenheit (Default-FIX), VORLAEUFIG-Entwurf,
 *   ANGEBOTEN-Vorschlag — jeweils an einem eigenen Tag.
 *
 * Geprüft (Done-Kriterien):
 * 1. Der Monats-PDF-Download enthält die Datums-Strings der FIX-Schicht UND
 *    der Urlaubs-Abwesenheit (Abwesenheiten sind Default-FIX und gehören in
 *    den Monatsüberblick), aber NICHT die Daten des Entwurfs/Vorschlags.
 *    (jsPDF schreibt Text unkomprimiert in den Content-Stream, daher sind die
 *    dd.MM.yyyy-Zellen der Tabelle im Roh-PDF direkt auffindbar.)
 * 2. Positiv-Kontrolle: Wird der Entwurf per PATCH auf FIX gehoben, taucht
 *    sein Datum im nächsten Export auf — der FIX-Filter (und nichts anderes)
 *    war also der Grund für den Ausschluss. Der ANGEBOTEN-Vorschlag bleibt
 *    weiterhin außen vor.
 *
 * Free-Plan genügt: basicExport ist bewusst auch im Free-Plan verfügbar,
 * ein Premium-Flip ist NICHT nötig.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Vier aufeinanderfolgende Tage im aktuellen Monat. Die Tage der NICHT-FIX-
 * Einträge dürfen nicht auf HEUTE fallen, weil der PDF-Footer "Erstellt am
 * <heute>" enthält — sonst schlüge die "Datum kommt NICHT im PDF vor"-
 * Assertion fälschlich fehl. Basisfenster Tag 8-11; kollidiert heute damit,
 * wird um 7 Tage verschoben (Tag 15-18, in jedem Monat gültig).
 */
function pickDays(): { fixDay: number; vacationDay: number; draftDay: number; offeredDay: number } {
  const today = NOW.getDate();
  let base = 8;
  if (today >= base && today <= base + 3) base += 7;
  return { fixDay: base, vacationDay: base + 1, draftDay: base + 2, offeredDay: base + 3 };
}

const { fixDay, vacationDay, draftDay, offeredDay } = pickDays();
const dayIso = (d: number) => `${YEAR}-${MM}-${pad2(d)}`;
// Datums-Strings, wie die Detail-Tabelle des Monats-PDFs sie rendert (dd.MM.yyyy).
const datePdf = (d: number) => `${pad2(d)}.${MM}.${YEAR}`;

const FIX_DATE_PDF = datePdf(fixDay);
const VACATION_DATE_PDF = datePdf(vacationDay);
const DRAFT_DATE_PDF = datePdf(draftDay);
const OFFERED_DATE_PDF = datePdf(offeredDay);

const PASSWORD = "free12345"; // registerFreeAccount vergibt dieses Passwort.

let acc: FreeAccount;
let assistantId: number;
let draftShiftId = 0;

async function createShift(
  day: number,
  opts: { planningStatus?: "VORLAEUFIG" | "ANGEBOTEN" | "FIX"; type?: string } = {},
): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${dayIso(day)}T08:00:00.000Z`,
      endTime: `${dayIso(day)}T16:00:00.000Z`,
      type: opts.type ?? "active",
      ...(opts.planningStatus ? { planningStatus: opts.planningStatus } : {}),
    },
  });
  expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
  const shift = (await res.json()) as { id: number; planningStatus?: string };
  if (opts.planningStatus) {
    // Guard: Der Status darf vom Server nicht still gestrippt/überschrieben
    // werden — sonst würden die PDF-Assertions nichts beweisen.
    expect(
      shift.planningStatus,
      `planningStatus muss ${opts.planningStatus} sein`,
    ).toBe(opts.planningStatus);
  }
  return shift.id;
}

/** Löst den Monats-PDF-Export aus und liefert das rohe PDF als latin1-String. */
async function exportMonthPdf(page: Page): Promise<{ raw: string; download: Download }> {
  await openHeaderOverflow(page);
  const exportButton = page.getByTestId("simple-month-export");
  await expect(exportButton, "PDF-Menüpunkt muss sichtbar sein").toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;

  const path = await download.path();
  expect(path, "Download-Datei nicht verfügbar").toBeTruthy();
  const raw = fs.readFileSync(path!, "latin1");
  expect(raw.startsWith("%PDF"), "Download ist kein PDF").toBe(true);
  return { raw, download };
}

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "monatspdf");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E MonatsPdf Assistent ${Date.now()}`,
      email: `e2e.monatspdf.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Verbindlich: eine FIX-Arbeitsschicht + eine Urlaubs-Abwesenheit (Default-
  // FIX). Unverbindlich: ein Entwurf (VORLAEUFIG) + ein Vorschlag (ANGEBOTEN).
  await createShift(fixDay, { planningStatus: "FIX" });
  await createShift(vacationDay, { type: "vacation" });
  draftShiftId = await createShift(draftDay, { planningStatus: "VORLAEUFIG" });
  await createShift(offeredDay, { planningStatus: "ANGEBOTEN" });
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Monats-PDF weist nur verbindliche (FIX) Dienste und Abwesenheiten aus", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, PASSWORD);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // --- Export 1: Entwurf + Vorschlag existieren, sind aber unverbindlich ---
  const first = await exportMonthPdf(page);
  expect(
    first.download.suggestedFilename().startsWith("Monatsuebersicht_"),
    `Unerwarteter Dateiname: ${first.download.suggestedFilename()}`,
  ).toBe(true);

  // Verbindliche Einträge stehen in der Tabelle …
  expect(first.raw, "FIX-Dienst fehlt im Monats-PDF").toContain(FIX_DATE_PDF);
  expect(first.raw, "Urlaubs-Abwesenheit (Default-FIX) fehlt im Monats-PDF").toContain(
    VACATION_DATE_PDF,
  );
  // … Entwürfe/Vorschläge dürfen NIRGENDS im PDF auftauchen.
  expect(first.raw, "VORLAEUFIG-Entwurf ist im Monats-PDF gelandet").not.toContain(
    DRAFT_DATE_PDF,
  );
  expect(first.raw, "ANGEBOTEN-Vorschlag ist im Monats-PDF gelandet").not.toContain(
    OFFERED_DATE_PDF,
  );

  // --- Positiv-Kontrolle: Entwurf -> FIX erscheint im nächsten Export ---
  const patchRes = await acc.ctx.patch(`/api/shifts/${draftShiftId}`, {
    data: { planningStatus: "FIX" },
  });
  expect(patchRes.ok(), `Hochstufen auf FIX fehlgeschlagen (${patchRes.status()})`).toBe(true);

  // Der Export speist sich aus dem React-Query-Cache der Seite — nach der
  // API-seitigen Änderung neu laden, damit die Schichtliste frisch ist.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  const second = await exportMonthPdf(page);
  expect(
    second.raw,
    "Hochgestufter Dienst (FIX) muss jetzt im Monats-PDF stehen",
  ).toContain(DRAFT_DATE_PDF);
  // Der Vorschlag bleibt unverbindlich und damit weiterhin draußen.
  expect(
    second.raw,
    "ANGEBOTEN-Vorschlag darf auch nach der Kontrolle nicht im PDF stehen",
  ).not.toContain(OFFERED_DATE_PDF);
  expect(second.raw, "FIX-Dienst fehlt im zweiten Export").toContain(FIX_DATE_PDF);
});
