import fs from "node:fs";
import { test, expect, type Download, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Beweis: Der einfache Monats-PDF-Export mit Filter "Alle" erzeugt KEINE
 * leeren Seiten für Assistenten ohne verbindliche (FIX) Dienste.
 *
 * `exportSimpleMonthPdf` (src/lib/pdf-export.ts) baut Seiten nur für
 * Assistenten mit mindestens einem FIX-Eintrag im Monat
 * (`sections.filter(s => s.rows.length > 0)`). Dieser Filter war bislang
 * unbewiesen — eine Regression würde beim "Alle"-Export für jeden Assistenten
 * ohne Dienste eine leere Seite erzeugen und das Dokument bei größeren Teams
 * unbrauchbar machen.
 *
 * Aufbau (frisches Free-Konto, ZWEI Assistenten, aktueller Monat):
 * - Assistent A ("Alpha…"): eine FIX-Schicht → bekommt eine Seite.
 * - Assistent B ("Bravo…"): NUR einen VORLAEUFIG-Entwurf, keine FIX-Einträge
 *   → darf im PDF überhaupt nicht auftauchen (auch keine leere Seite).
 *   (Der Entwurf ist bewusst der härtere Fall als "gar nichts": B hat Daten
 *   im Monat, aber eben keine verbindlichen.)
 *
 * Geprüft (Done-Kriterien):
 * 1. Export mit Filter "Alle" (Default eines frischen Browser-Kontexts, kein
 *    localStorage): Das rohe PDF enthält den Namen von A, aber NICHT den von
 *    B. (jsPDF schreibt Text unkomprimiert in den Content-Stream, daher sind
 *    die Namens-Tokens im Roh-PDF per latin1-String auffindbar — gleiches
 *    Muster wie dienstplan-monats-pdf-nur-fix.spec.ts.)
 * 2. Positiv-Kontrolle gegen ein vakuum-grünes Ergebnis: Wird Bs Entwurf per
 *    PATCH auf FIX gehoben, erscheint Bs Name im nächsten Export — Namen von
 *    Assistenten MIT FIX-Einträgen sind also nachweislich im Roh-PDF
 *    auffindbar; der Seiten-Filter (und nichts anderes) hat B ausgeschlossen.
 *
 * Free-Plan genügt: basicExport ist bewusst auch im Free-Plan verfügbar.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MM = String(NOW.getMonth() + 1).padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Zwei Tage im aktuellen Monat für die Schichten von A und B. Die Tage müssen
 * nicht heute meiden (es werden NAMEN, keine Datums-Strings asserted), aber
 * das Fenster Tag 8/9 bzw. 15/16 ist in jedem Monat gültig und kollidiert nie
 * mit Monatsgrenzen.
 */
function pickDays(): { fixDay: number; draftDay: number } {
  const today = NOW.getDate();
  let base = 8;
  if (today >= base && today <= base + 1) base += 7;
  return { fixDay: base, draftDay: base + 1 };
}

const { fixDay, draftDay } = pickDays();
const dayIso = (d: number) => `${YEAR}-${MM}-${pad2(d)}`;

// Eindeutige, leerzeichenfreie Namens-Tokens: so ist der Treffer im Roh-PDF
// unabhängig davon, wie jsPDF den restlichen Namen setzt. ASCII-only, damit
// die latin1-Suche nicht an Font-Encoding scheitert. Kein Token ist Teilstring
// des anderen oder des Kontonamens ("E2E alleexport <stamp>").
const STAMP = `${Date.now()}`;
const NAME_A_TOKEN = `Alpha${STAMP}`;
const NAME_B_TOKEN = `Bravo${STAMP}`;

let acc: FreeAccount;
let assistantAId: number;
let assistantBId: number;
let draftShiftIdB = 0;

async function createAssistant(token: string): Promise<number> {
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E ${token}`,
      email: `e2e.alleexport.${token.toLowerCase()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten ${token} fehlgeschlagen (${res.status()})`).toBe(
    true,
  );
  return ((await res.json()) as { id: number }).id;
}

async function createShift(
  userId: number,
  day: number,
  planningStatus: "VORLAEUFIG" | "FIX",
): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId,
      startTime: `${dayIso(day)}T08:00:00.000Z`,
      endTime: `${dayIso(day)}T16:00:00.000Z`,
      type: "active",
      planningStatus,
    },
  });
  expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
  const shift = (await res.json()) as { id: number; planningStatus?: string };
  // Guard: Der Status darf vom Server nicht still gestrippt/überschrieben
  // werden — sonst würden die PDF-Assertions nichts beweisen.
  expect(shift.planningStatus, `planningStatus muss ${planningStatus} sein`).toBe(
    planningStatus,
  );
  return shift.id;
}

/** Löst den Monats-PDF-Export aus und liefert das rohe PDF als latin1-String. */
async function exportMonthPdf(page: Page): Promise<{ raw: string; download: Download }> {
  const exportButton = page.getByTestId("simple-month-export");
  await expect(exportButton, "Monats-PDF-Button muss sichtbar sein").toBeVisible();
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

  acc = await registerFreeAccount("privat", "alleexport");

  assistantAId = await createAssistant(NAME_A_TOKEN);
  assistantBId = await createAssistant(NAME_B_TOKEN);

  // A verbindlich, B nur unverbindlich (Entwurf) — B hat also Monatsdaten,
  // aber keinen einzigen FIX-Eintrag.
  await createShift(assistantAId, fixDay, "FIX");
  draftShiftIdB = await createShift(assistantBId, draftDay, "VORLAEUFIG");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Alle-Export enthaelt keine Seiten fuer Assistenten ohne FIX-Dienste", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Frischer Browser-Kontext => kein persistierter Assistenten-Filter im
  // localStorage => Default "all". Zur Sicherheit explizit verifizieren, dass
  // der Export tatsächlich der "Alle"-Export ist (Dateiname trägt dann "Alle").
  const first = await exportMonthPdf(page);
  expect(
    first.download.suggestedFilename().startsWith("Monatsuebersicht_Alle_"),
    `Export lief nicht mit Filter "Alle": ${first.download.suggestedFilename()}`,
  ).toBe(true);

  // Assistent A (mit FIX-Dienst) bekommt eine Seite …
  expect(first.raw, "Assistent A (FIX-Dienst) fehlt im Alle-Export").toContain(NAME_A_TOKEN);
  // … Assistent B (nur Entwurf, kein FIX) darf NIRGENDS im PDF auftauchen —
  // insbesondere keine leere Seite mit seinem Namen im Kopf.
  expect(
    first.raw,
    "Assistent B ohne FIX-Dienste hat eine (leere) Seite im Alle-Export bekommen",
  ).not.toContain(NAME_B_TOKEN);

  // --- Positiv-Kontrolle: Bs Entwurf -> FIX => B erscheint im Export ---
  // Beweist, dass Namens-Tokens im Roh-PDF grundsätzlich auffindbar sind und
  // wirklich der Seiten-Filter (nicht etwa ein Render-/Encoding-Artefakt) B
  // aus dem ersten Export herausgehalten hat.
  const patchRes = await acc.ctx.patch(`/api/shifts/${draftShiftIdB}`, {
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
    "Assistent B muss nach dem Hochstufen auf FIX im Alle-Export stehen",
  ).toContain(NAME_B_TOKEN);
  expect(second.raw, "Assistent A fehlt im zweiten Export").toContain(NAME_A_TOKEN);
});
