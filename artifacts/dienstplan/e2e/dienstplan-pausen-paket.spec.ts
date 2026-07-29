import { test, expect, type Page } from "@playwright/test";
import { format } from "date-fns";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E: Pausen-Paket (Vorbefüllung + Überschreib-Schutz + Bestandsschutz).
 *
 * - Schicht-Dialog: Pausenfeld wird gemäß Pausenregelung (Staffel) vorbefüllt
 *   und folgt Zeitänderungen — bis der Nutzer das Feld selbst anfasst.
 * - Bearbeiten eines BESTEHENDEN Dienstes befüllt NICHT automatisch nach
 *   (Bestandsschutz: keine rückwirkende Neuberechnung).
 * - Zeiterfassung (Stundenzettel, manueller Eintrag): gleiches Verhalten über
 *   die assistenten-taugliche pauseRule aus /time-tracking-status.
 *
 * Eigenes frisch registriertes Konto — der geteilte Seed-Admin bleibt
 * unberührt (parallel laufende Specs werden nicht gestört).
 */

// Mobile Viewport: die Listenansicht (agenda-day-Testids) gibt es nur mobil.
test.use({ viewport: { width: 402, height: 874 } });

let acc: FreeAccount;

async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "pausenpaket");
  // Pausenregelung (gesetzliche Staffel) + Zeiterfassung aktivieren.
  const putRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: 25,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: 50,
      holidayPercent: 100,
      timeTrackingEnabled: true,
      pauseAutoEnabled: true,
      pauseThreshold1Hours: 6,
      pauseMinutes1: 30,
      pauseThreshold2Hours: 9,
      pauseMinutes2: 45,
    },
  });
  expect(putRes.ok(), `PUT allowance-settings fehlgeschlagen (${putRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

/** Dienstplan in der mobilen Listenansicht öffnen (agenda-day-Testids). */
async function openDienstplanList(page: Page): Promise<void> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible();
  await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();
}

const todayKey = format(new Date(), "yyyy-MM-dd");

test("Schicht-Dialog: Pause folgt der Staffel und respektiert Überschreiben", async ({ page }) => {
  test.setTimeout(60000);
  await adoptSession(page, acc);
  await openDienstplanList(page);

  await page.getByTestId(`agenda-day-${todayKey}`).locator("button").first().click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

  const pause = dialog.getByTestId("shift-dialog-pause");
  // Default-Zeiten 08–16 (8h) erreichen Stufe 1 -> 30 Minuten vorbefüllt.
  await expect(pause).toHaveValue("30");

  // 10h-Dienst -> Stufe 2 (45 Minuten).
  await dialog.getByTestId("shift-dialog-end").fill("18:00");
  await expect(pause).toHaveValue("45");

  // Unter Stufe 1 (5h) -> keine Pause (leer).
  await dialog.getByTestId("shift-dialog-end").fill("13:00");
  await expect(pause).toHaveValue("");

  // Nutzer überschreibt -> spätere Zeitänderung überschreibt NICHT mehr.
  await pause.fill("10");
  await dialog.getByTestId("shift-dialog-end").fill("18:00");
  await expect(pause).toHaveValue("10");

  await page.keyboard.press("Escape");
});

test("Schicht-Dialog: Bearbeiten eines bestehenden Dienstes befüllt nicht nach (Bestandsschutz)", async ({
  page,
}) => {
  test.setTimeout(60000);
  // Bestehender 8h-Dienst OHNE Pause (z.B. vor Aktivierung der Regel angelegt).
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: acc.id,
      type: "active",
      startTime: `${todayKey}T08:00:00.000Z`,
      endTime: `${todayKey}T16:00:00.000Z`,
      pauseMinutes: 0,
    },
  });
  expect(res.status(), `POST /shifts fehlgeschlagen (${res.status()})`).toBe(201);
  const shift = (await res.json()) as { id: number };

  await adoptSession(page, acc);
  await openDienstplanList(page);

  // Eintrag des Dienstes im Tages-Container anklicken -> Bearbeiten-Dialog.
  await page.getByTestId(`shift-badge-${shift.id}`).click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();
  // Bestandsschutz: Pausenfeld bleibt leer (0), trotz aktiver Regel und 8h Dauer.
  await expect(dialog.getByTestId("shift-dialog-pause")).toHaveValue("");
  await page.keyboard.press("Escape");

  await acc.ctx.delete(`/api/shifts/${shift.id}`);
});

test("Stundenzettel: Pause wird vorbefüllt und respektiert Überschreiben", async ({ page }) => {
  test.setTimeout(60000);
  await adoptSession(page, acc);
  await page.goto("/zeiterfassung");
  await expect(page.getByRole("heading", { name: "Zeiterfassung" })).toBeVisible();

  await page.getByTestId("manual-entry").click();
  const dialog = page.getByTestId("manual-dialog");
  await expect(dialog).toBeVisible();

  const pause = dialog.getByTestId("manual-pause");
  // 8h -> Stufe 1 (30 Minuten).
  await dialog.getByTestId("manual-start").fill("08:00");
  await dialog.getByTestId("manual-end").fill("16:00");
  await expect(pause).toHaveValue("30");

  // 10h -> Stufe 2 (45 Minuten).
  await dialog.getByTestId("manual-end").fill("18:00");
  await expect(pause).toHaveValue("45");

  // Nutzer überschreibt -> Zeitänderung überschreibt nicht mehr.
  await pause.fill("5");
  await dialog.getByTestId("manual-end").fill("17:00");
  await expect(pause).toHaveValue("5");
});
