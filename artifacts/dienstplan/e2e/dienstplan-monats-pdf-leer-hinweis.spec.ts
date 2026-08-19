import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { openHeaderOverflow } from "./helpers/header";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Beweis (Grenzfall zum Produktversprechen "Nur FIX zählt im PDF"):
 * Enthält der sichtbare Monat KEINEN einzigen verbindlichen (FIX) Eintrag —
 * nur Entwürfe (VORLAEUFIG) und Vorschläge (ANGEBOTEN) —, dann darf der
 * "Monats-PDF"-Button KEIN Dokument erzeugen. Stattdessen meldet die Seite
 * ehrlich per Toast: "Keine bestätigten Dienste oder Abwesenheiten in diesem
 * Monat." (`handleSimpleExport` in dienstplan.tsx reagiert auf den
 * `false`-Rückgabewert von `exportSimpleMonthPdf`).
 *
 * Regressionsrisiko, das dieser Spec abdeckt: Ein leeres/kaputtes PDF würde
 * heruntergeladen oder der Klick täte still gar nichts — der Nutzer wüsste
 * nicht, warum kein brauchbares Dokument entsteht.
 *
 * Aufbau (frisches Free-Konto, eigener Assistent, aktueller Monat):
 * - NUR ein VORLAEUFIG-Entwurf und ein ANGEBOTEN-Vorschlag, keinerlei
 *   FIX-Schicht und keine Abwesenheit (Abwesenheiten wären Default-FIX).
 *
 * Geprüft (Done-Kriterien):
 * 1. Der Klick auf `data-testid="simple-month-export"` löst KEINEN Download
 *    aus (Negativprobe über einen page-Download-Listener, der jeden Download
 *    protokolliert).
 * 2. Der sonner-Fehler-Toast mit der exakten Meldung wird sichtbar.
 *
 * Free-Plan genügt: basicExport ist bewusst auch im Free-Plan verfügbar.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MM = String(NOW.getMonth() + 1).padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");
const dayIso = (d: number) => `${YEAR}-${MM}-${pad2(d)}`;

// Zwei feste Tage in der Monatsmitte — in jedem Monat gültig; auf das heutige
// Datum kommt es hier nicht an (es wird ja gerade KEIN PDF erzeugt).
const DRAFT_DAY = 10;
const OFFERED_DAY = 11;

const TOAST_MESSAGE = "Keine bestätigten Dienste oder Abwesenheiten in diesem Monat.";
const PASSWORD = "free12345"; // registerFreeAccount vergibt dieses Passwort.

let acc: FreeAccount;
let assistantId: number;

async function createShift(
  day: number,
  planningStatus: "VORLAEUFIG" | "ANGEBOTEN",
): Promise<void> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${dayIso(day)}T08:00:00.000Z`,
      endTime: `${dayIso(day)}T16:00:00.000Z`,
      type: "active",
      planningStatus,
    },
  });
  expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
  const shift = (await res.json()) as { planningStatus?: string };
  // Guard: Würde der Server den Status still auf FIX heben, bewiese der Spec
  // nichts mehr — der Export hätte dann ja einen verbindlichen Eintrag.
  expect(shift.planningStatus, `planningStatus muss ${planningStatus} sein`).toBe(
    planningStatus,
  );
}

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "pdfleer");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E PdfLeer Assistent ${Date.now()}`,
      email: `e2e.pdfleer.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // AUSSCHLIESSLICH unverbindliche Einträge — keine FIX-Schicht, keine
  // Abwesenheit (die wäre Default-FIX und würde den Grenzfall zerstören).
  await createShift(DRAFT_DAY, "VORLAEUFIG");
  await createShift(OFFERED_DAY, "ANGEBOTEN");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Monats-PDF ohne verbindliche Eintraege: kein Download, ehrlicher Hinweis-Toast", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, PASSWORD);

  // Negativprobe: JEDER Download während des gesamten Tests wird protokolliert.
  const downloads: string[] = [];
  page.on("download", (d) => {
    downloads.push(d.suggestedFilename());
  });

  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Sichtprobe: Die unverbindlichen Einträge sind im Kalender vorhanden — der
  // Monat ist also NICHT leer, nur eben ohne verbindliche Einträge.
  await openHeaderOverflow(page);
  const exportButton = page.getByTestId("simple-month-export");
  await expect(exportButton, "PDF-Menüpunkt muss sichtbar sein").toBeVisible();

  await exportButton.click();

  // 1. Der ehrliche Hinweis-Toast (sonner toast.error) erscheint mit exakt der
  //    Meldung aus handleSimpleExport.
  const toast = page.locator("[data-sonner-toast]", { hasText: TOAST_MESSAGE });
  await expect(toast, "Hinweis-Toast fehlt oder hat falschen Text").toBeVisible({
    timeout: 15_000,
  });

  // 2. Kein Download: Der Toast ist bereits da (der Export-Pfad ist also
  //    vollständig durchlaufen) — trotzdem kurz nachwarten, damit auch ein
  //    verzögert feuernder Download sicher erfasst würde.
  await page.waitForTimeout(2_000);
  expect(
    downloads,
    `Es darf KEIN Download ausgelöst werden, aber es kam: ${downloads.join(", ")}`,
  ).toHaveLength(0);
});
