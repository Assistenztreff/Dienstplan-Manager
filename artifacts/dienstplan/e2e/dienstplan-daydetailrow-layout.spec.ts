import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * DayDetailRow-Aufbau (Task #850/852): Avatar links, Uhrzeit neben dem Namen,
 * Statusfarbbalken rechts — gegen stille Regressionen absichern.
 *
 * Für drei Eintrags-Typen wird geprüft:
 *  1. Avatar-Kreis (erstes span[aria-hidden], Hintergrundfarbe gesetzt,
 *     linke Kante liegt links von Uhrzeit und Statusblock — Bounding-Box-Check)
 *  2. Uhrzeit/Tageslabel im linken Bereich: linke Kante liegt LINKS des
 *     rechten Statusblocks (Bounding-Box-Check)
 *  3. Rechter 4-px-Statusfarbbalken: rechte Kante bündig mit der Zeilen-
 *     rechten Kante (≤4 px Toleranz), Breite ≈ 4 px, erwartete Farbe
 *  4. Statustext sichtbar ("Dienst · bestätigt", "Dienst · Entwurf",
 *     "Abwesenheit · Urlaub")
 *
 * Aufbau: Desktop-Viewport (1280×800), Monatsansicht, Tagesdetail-Panel auf
 * Zeitraum "Dieser Monat" gestellt, damit alle drei Schichten ohne
 * Tageszellen-Klick sichtbar sind.
 *
 * Farb-Mapping (dienstStatusColor):
 *   FIX        → #1e8f4e → rgb(30, 143, 78)
 *   VORLAEUFIG → #b5790a → rgb(181, 121, 10)
 */

const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = String(now.getUTCMonth() + 1).padStart(2, "0");

function shiftTimes(day: number): { startTime: string; endTime: string } {
  const d = String(day).padStart(2, "0");
  return {
    startTime: `${YEAR}-${MONTH}-${d}T08:00:00.000Z`,
    endTime: `${YEAR}-${MONTH}-${d}T16:00:00.000Z`,
  };
}

const PASSWORD = "free12345"; // registerFreeAccount vergibt dieses Passwort.

let acc: FreeAccount;
let assistantId: number;
/** Bestätigter Dienst (FIX, default). */
let fixShiftId: number;
/** Entwurf (VORLAEUFIG). */
let draftShiftId: number;
/** Abwesenheit — Urlaub (vacation, FIX). */
let absenceShiftId: number;

test.beforeAll(async () => {
  // Konto-Registrierung + Shift-Aufbau können den Default-Timeout sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "daydetailrow");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E DayDetailRow ${Date.now()}`,
      email: `e2e.daydetailrow.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Assistent anlegen fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  async function createShift(
    day: number,
    type: string,
    planningStatus?: string,
  ): Promise<number> {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        ...shiftTimes(day),
        type,
        ...(planningStatus ? { planningStatus } : {}),
      },
    });
    expect(res.status(), `POST /api/shifts Tag ${day}`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }

  // Drei verschiedene Tage: keine Überschneidungen, kein Absenz-löscht-Dienst-Problem.
  fixShiftId = await createShift(10, "active"); // FIX (server-default)
  draftShiftId = await createShift(11, "active", "VORLAEUFIG");
  absenceShiftId = await createShift(12, "vacation"); // Abwesenheit, FIX
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

/**
 * Prüft für eine DayDetailRow-Zeile, dass:
 *  - Avatar (links), Zeitlabel (links nach Avatar), Statusbalken (ganz rechts)
 *    geometrisch korrekt angeordnet sind (Bounding-Box-Vergleich)
 *  - Statusbalken hat Breite ≈ 4 px und rechte Kante bündig mit Zeile (≤ 4 px Toleranz)
 *  - Avatar-Hintergrundfarbe ist gesetzt
 *  - Statusbalken-Hintergrundfarbe entspricht erwartetem Wert (computedStyle RGB)
 *  - Statustext ist sichtbar
 */
async function assertDayDetailRowLayout(
  row: import("@playwright/test").Locator,
  opts: {
    expectedBarColor: string; // RGB-String z. B. "rgb(30, 143, 78)"
    expectedStatusText: RegExp;
    timeLabel: string | RegExp; // Text im linken Zeitspan (Uhrzeit oder "ganztägig")
  },
): Promise<void> {
  await expect(row).toBeVisible();

  // ── Elemente lokalisieren ────────────────────────────────────────────────
  // Avatar: erstes span[aria-hidden="true"] im Row
  const avatar = row.locator('span[aria-hidden="true"]').first();
  // Statusbalken: letztes span[aria-hidden="true"] — ist stets ein absolut
  // positioniertes Kind ganz rechts (w-[4px], right-0).
  const bar = row.locator('span[aria-hidden="true"]').last();
  // Zeitspan: liegt in der flex-1-Gruppe, enthält Uhrzeit oder "ganztägig"
  const timeEl = row.locator(".flex-1 .tabular-nums");
  // Rechter Statusblock (flex shrink-0, nach dem flex-1-Bereich)
  const statusBlock = row.locator(".flex-1 ~ span.shrink-0").first();

  await expect(avatar, "Avatar muss sichtbar sein").toBeVisible();
  await expect(bar, "Statusbalken muss sichtbar sein").toBeVisible();
  await expect(timeEl, "Zeitlabel muss sichtbar und im linken Bereich stehen").toBeVisible();
  await expect(timeEl).toContainText(opts.timeLabel);

  // ── Bounding-Box-Checks (Geometrie) ─────────────────────────────────────
  const rowBox = (await row.boundingBox())!;
  const avatarBox = (await avatar.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  const timeBox = (await timeEl.boundingBox())!;

  // 1. Avatar liegt ganz links: linke Kante des Avatars muss deutlich links
  //    des Mittelpunkts der Zeile sein.
  expect(
    avatarBox.x,
    "Avatar muss links (x < Zeilenmitte) liegen",
  ).toBeLessThan(rowBox.x + rowBox.width / 2);

  // 2. Zeitlabel liegt im linken Bereich: linke Kante liegt links der Zeilenmitte.
  expect(
    timeBox.x,
    "Zeitlabel muss links (x < Zeilenmitte) liegen",
  ).toBeLessThan(rowBox.x + rowBox.width / 2);

  // 3. Avatar kommt LINKS vom Zeitlabel (Avatar-Mittelpunkt ≤ Zeit-linke-Kante).
  expect(
    avatarBox.x + avatarBox.width / 2,
    "Avatar muss links vom Zeitlabel liegen",
  ).toBeLessThanOrEqual(timeBox.x + 2); // 2 px Toleranz für Sub-Pixel-Rendering

  // 4. Zeitlabel kommt LINKS des Statusbalkens (rechte Kante des Zeitlabels
  //    liegt klar links der rechten Kante des Statusbalkens).
  expect(
    timeBox.x + timeBox.width,
    "Zeitlabel muss links des Statusbalkens enden",
  ).toBeLessThan(barBox.x);

  // 5. Statusbalken ist bündig rechts: seine rechte Kante weicht ≤ 4 px von
  //    der rechten Kante der Zeile ab.
  const barRightEdge = barBox.x + barBox.width;
  const rowRightEdge = rowBox.x + rowBox.width;
  expect(
    Math.abs(barRightEdge - rowRightEdge),
    `Statusbalken-Rechte (${barRightEdge.toFixed(1)}) muss bündig mit Zeile-Rechte (${rowRightEdge.toFixed(1)}) sein (≤ 4 px)`,
  ).toBeLessThanOrEqual(4);

  // 6. Statusbalken hat Breite ≈ 4 px (±2 px für Sub-Pixel-Rendering).
  expect(
    barBox.width,
    `Statusbalken muss ≈ 4 px breit sein (tatsächlich: ${barBox.width.toFixed(1)} px)`,
  ).toBeGreaterThanOrEqual(2);
  expect(barBox.width).toBeLessThanOrEqual(6);

  // ── Farb- und Textprüfungen ──────────────────────────────────────────────
  // Avatar-Hintergrundfarbe gesetzt
  const avatarBg = await avatar.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  expect(avatarBg, "Avatar: Hintergrundfarbe muss gesetzt sein")
    .not.toBe("rgba(0, 0, 0, 0)");
  expect(avatarBg).not.toBe("transparent");

  // Statusbalken-Farbe
  const barColor = await bar.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  expect(
    barColor,
    `Statusbalken-Farbe muss ${opts.expectedBarColor} sein`,
  ).toBe(opts.expectedBarColor);

  // Statustext
  await expect(row).toContainText(opts.expectedStatusText);
}

test(
  "DayDetailRow: Avatar links, Uhrzeit links, Statusfarbbalken rechts, Statustext",
  async ({ page }) => {
    // Desktop-Viewport: day-detail-panel ist nur in der Desktop-Monatsansicht
    // sichtbar (data-testid="dienstplan-desktop", hidden md:flex).
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginViaUi(page, acc.email, PASSWORD);
    await page.goto("/dienstplan");
    await expect(
      page.getByRole("heading", { name: "Dienstplan", exact: true }),
    ).toBeVisible();

    // Monats-Gitter sicherstellen (nicht Tabelle).
    await page
      .getByTestId("view-toggles-desktop")
      .getByTestId("view-toggle-grid")
      .click();

    // Alle weiteren Lokalisierungen auf den Desktop-Container scopen:
    // das day-detail-panel existiert auch im CSS-hidden Mobile-Zweig,
    // was sonst eine Strict-Mode-Verletzung auslöst.
    const desktop = page.getByTestId("dienstplan-desktop");

    // Tagesdetail-Panel öffnen.
    const panel = desktop.getByTestId("day-detail-panel");
    await expect(panel).toBeVisible();

    // Zeitraum auf "Dieser Monat" umstellen — alle drei Schichten werden ohne
    // Tageszellen-Klick gerendert.
    await desktop.getByTestId("day-detail-range-menu").click();
    await page.getByRole("option", { name: "Dieser Monat" }).click();

    // ── Bestätigter Dienst (FIX) ────────────────────────────────────────────
    await assertDayDetailRowLayout(
      panel.getByTestId(`day-detail-shift-${fixShiftId}`),
      {
        // FIX → grün (#1e8f4e = rgb(30, 143, 78))
        expectedBarColor: "rgb(30, 143, 78)",
        expectedStatusText: /Dienst\s*·\s*bestätigt/i,
        timeLabel: /\d{2}:\d{2}/,
      },
    );
    await expect(
      panel.getByTestId(`day-detail-shift-${fixShiftId}`),
    ).toHaveAttribute("data-planning-status", "FIX");

    // ── Entwurf (VORLAEUFIG) ────────────────────────────────────────────────
    await assertDayDetailRowLayout(
      panel.getByTestId(`day-detail-shift-${draftShiftId}`),
      {
        // VORLAEUFIG → amber/gold (#b5790a = rgb(181, 121, 10))
        expectedBarColor: "rgb(181, 121, 10)",
        expectedStatusText: /Dienst\s*·\s*Entwurf/i,
        timeLabel: /\d{2}:\d{2}/,
      },
    );
    await expect(
      panel.getByTestId(`day-detail-shift-${draftShiftId}`),
    ).toHaveAttribute("data-planning-status", "VORLAEUFIG");

    // ── Abwesenheit — Urlaub (vacation, FIX) ────────────────────────────────
    // Abwesenheits-Einträge zeigen "ganztägig" statt einer Uhrzeit.
    await assertDayDetailRowLayout(
      panel.getByTestId(`day-detail-shift-${absenceShiftId}`),
      {
        // Vacation FIX, kein Ausfall, keine Vertretung → grün (#1e8f4e)
        expectedBarColor: "rgb(30, 143, 78)",
        expectedStatusText: /Abwesenheit\s*·\s*Urlaub/i,
        timeLabel: "ganztägig",
      },
    );
    await expect(
      panel.getByTestId(`day-detail-shift-${absenceShiftId}`),
    ).toHaveAttribute("data-planning-status", "FIX");
  },
);
