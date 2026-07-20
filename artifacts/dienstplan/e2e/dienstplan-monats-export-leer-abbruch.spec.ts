import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Beweis: Der einfache Monats-PDF-Export bricht sauber ab, wenn KEIN
 * Assistent im Monat einen verbindlichen (FIX) Eintrag hat — statt ein
 * leeres/kaputtes PDF auszuliefern.
 *
 * `exportSimpleMonthPdf` (src/lib/pdf-export.ts) gibt `false` zurück, wenn
 * nach dem Seiten-Filter keine Sektion übrig bleibt; `handleSimpleExport`
 * (src/pages/dienstplan.tsx) zeigt dann den Fehler-Toast
 * "Keine bestätigten Dienste oder Abwesenheiten in diesem Monat." und lädt
 * KEINE Datei herunter. Beide Seiten dieses Leer-Pfads waren bislang
 * unbewiesen — eine Regression könnte still ein leeres PDF ausliefern oder
 * den Nutzer ohne jede Rückmeldung lassen.
 *
 * Aufbau (frisches Free-Konto, aktueller Monat):
 * - Ein Assistent mit NUR einem VORLAEUFIG-Entwurf, kein einziger
 *   FIX-Eintrag im Konto. (Bewusst der härtere Fall als "gar nichts":
 *   es GIBT Monatsdaten, aber keine verbindlichen.)
 *
 * Geprüft (Done-Kriterien):
 * 1. Klick auf "Monats-PDF" (Testid `simple-month-export`): innerhalb einer
 *    kurzen Frist startet KEIN `download`-Event.
 * 2. Der Fehler-Toast mit "Keine bestätigten Dienste" erscheint.
 *
 * Free-Plan genügt: basicExport ist bewusst auch im Free-Plan verfügbar.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MM = String(NOW.getMonth() + 1).padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Ein Tag im aktuellen Monat, sicher innerhalb jeder Monatslänge. */
function pickDraftDay(): number {
  const today = NOW.getDate();
  let day = 10;
  if (today === day) day += 5;
  return day;
}

const draftDay = pickDraftDay();
const draftIso = `${YEAR}-${MM}-${pad2(draftDay)}`;

let acc: FreeAccount;

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "leerexport");

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Leerexport${Date.now()}`,
      email: `e2e.leerexport.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(
    true,
  );
  const assistantId = ((await userRes.json()) as { id: number }).id;

  // NUR ein VORLAEUFIG-Entwurf — kein FIX-Eintrag im ganzen Monat.
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${draftIso}T08:00:00.000Z`,
      endTime: `${draftIso}T16:00:00.000Z`,
      type: "active",
      planningStatus: "VORLAEUFIG",
    },
  });
  expect(shiftRes.status(), "POST /api/shifts sollte 201 liefern").toBe(201);
  const shift = (await shiftRes.json()) as { planningStatus?: string };
  // Guard: Würde der Server den Entwurf still auf FIX heben, wäre der Test
  // vakuum-falsch (Export hätte dann Daten).
  expect(shift.planningStatus, "Entwurf darf nicht still FIX werden").toBe("VORLAEUFIG");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Monats-Export ohne FIX-Eintraege: kein Download, Fehler-Toast", async ({ page }) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  const exportButton = page.getByTestId("simple-month-export");
  await expect(exportButton, "Monats-PDF-Button muss sichtbar sein").toBeVisible();

  // Download-Beobachtung VOR dem Klick starten, damit kein Event verpasst
  // wird; kurze Frist genügt, da der (synchron gebaute) Export sofort
  // entweder abbricht oder speichert.
  let downloadFired = false;
  const downloadWatch = page
    .waitForEvent("download", { timeout: 7_000 })
    .then(() => {
      downloadFired = true;
    })
    .catch(() => {
      // Timeout = erwarteter Fall (kein Download).
    });

  await exportButton.click();

  // 1. Fehler-Toast erscheint (Sonner-Toast im App-Root).
  await expect(
    page.getByText("Keine bestätigten Dienste", { exact: false }),
    "Fehler-Toast über den leeren Monat fehlt",
  ).toBeVisible({ timeout: 10_000 });

  // 2. Kein Download innerhalb der Frist.
  await downloadWatch;
  expect(downloadFired, "Es darf KEIN Download gestartet werden").toBe(false);
});
