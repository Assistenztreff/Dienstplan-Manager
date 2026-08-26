import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * DayDetailRow-Aufbau (Task #850/852/853/854): Avatar links, Uhrzeit neben
 * dem Namen, Statusfarbbalken rechts — gegen stille Regressionen absichern.
 *
 * Für vier Eintrags-Typen wird geprüft:
 *  1. Avatar-Kreis (erstes span[aria-hidden], Hintergrundfarbe gesetzt,
 *     linke Kante liegt links von Uhrzeit und Statusblock — Bounding-Box-Check)
 *  2. Uhrzeit/Tageslabel im linken Bereich: linke Kante liegt LINKS des
 *     rechten Statusblocks (Bounding-Box-Check)
 *  3. Rechter 4-px-Statusfarbbalken: rechte Kante bündig mit der Zeilen-
 *     rechten Kante (≤4 px Toleranz), Breite ≈ 4 px, erwartete Farbe
 *  4. Statustext sichtbar ("Dienst · bestätigt", "Dienst · Entwurf",
 *     "Abwesenheit · Urlaub", "Dienst · Vertretung · bestätigt")
 *
 * Task #853 ergänzt den vierten Fall — Vertretungsdienst (isVertretung):
 * teal Statusfarbbalken (#0f6e8c), Statustext enthält "Vertretung", Avatar
 * bleibt die Personenfarbe (dienstStatusColor/-Label haben Vorrang vor dem
 * Basis-Status, der Avatar ist davon aber unabhängig — isTeam-Check).
 *
 * Task #854 lässt exakt dieselben vier Prüfungen zusätzlich bei 800 px
 * Breite (schmales Tablet, oberhalb des md-Breakpoints) laufen — reine
 * Breiten-Robustheit der (seit der UI-Vereinheitlichung 26.08.2026 überall
 * einheitlich kompakten) Zeile, kein separates "comfortable"-Padding mehr
 * zu unterscheiden.
 *
 * Aufbau: Desktop-Viewport, Monatsansicht, die vereinheitlichte Wochen-Liste
 * (schedule-list) auf Zeitraum "Dieser Monat" gestellt, damit alle Schichten
 * ohne Tageszellen-Klick sichtbar sind.
 *
 * Farb-Mapping (dienstStatusColor):
 *   FIX        → #1e8f4e → rgb(30, 143, 78)
 *   VORLAEUFIG → #b5790a → rgb(181, 121, 10)
 *   Vertretung → #0f6e8c → rgb(15, 110, 140)
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
/** Vertretungsdienst (Aushilfe im Fremdteam, isVertretung=true, FIX). */
let vertretungShiftId: number;

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

  // Vier verschiedene Tage: keine Überschneidungen, kein Absenz-löscht-Dienst-Problem.
  fixShiftId = await createShift(10, "active"); // FIX (server-default)
  draftShiftId = await createShift(11, "active", "VORLAEUFIG");

  // Abwesenheit — Urlaub, FIX. Muss der ganztägigen 00:00–23:59-UTC-Konvention
  // folgen (isPlainFullDayIso, #862 Halbtägiger Urlaub), sonst zeigt die
  // Tagesleiste seit #862 korrekt eine echte Zeitspanne statt "ganztägig".
  const absenceRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${YEAR}-${MONTH}-12T00:00:00.000Z`,
      endTime: `${YEAR}-${MONTH}-12T23:59:00.000Z`,
      type: "vacation",
    },
  });
  expect(absenceRes.status(), "POST /api/shifts Tag 12 (Abwesenheit)").toBe(201);
  absenceShiftId = ((await absenceRes.json()) as { id: number }).id;

  // Vertretungsdienst (#853): isVertretung=true, sonst wie ein normaler
  // FIX-Arbeitsdienst — direkt über den API-Body gesetzt (kein eigener
  // Aushilfe-/Einsatzteam-Aufbau nötig, dienstStatusColor/-Label reagieren
  // allein auf das Flag).
  const vertretungRes = await acc.ctx.post("/api/shifts", {
    data: { userId: assistantId, ...shiftTimes(13), type: "active", isVertretung: true },
  });
  expect(vertretungRes.status(), "POST /api/shifts Tag 13 (Vertretung)").toBe(201);
  vertretungShiftId = ((await vertretungRes.json()) as { id: number }).id;
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

/**
 * Führt alle DayDetailRow-Geometrie-/Farb-/Textprüfungen für die vier
 * Eintrags-Typen bei der übergebenen Viewport-Größe aus (#854: dieselben
 * Prüfungen müssen auch bei schmaler Tablet-Breite halten, nicht nur bei
 * voller Desktop-Breite).
 */
async function runDayDetailRowChecks(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
): Promise<void> {
    // Desktop-Viewport: die Wochen-Liste (schedule-list) steht seit der
    // UI-Vereinheitlichung (26.08.2026) außerhalb von dienstplan-mobile/
    // -desktop und existiert daher nur EIN einziges Mal im DOM.
    await page.setViewportSize(viewport);
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

    // Die vereinheitlichte Wochen-Liste (schedule-list) existiert seit der
    // UI-Vereinheitlichung (26.08.2026) nur noch EIN einziges Mal im DOM
    // (kein separater Mobile-/Desktop-Zweig mehr) — kein Scoping mehr nötig.
    const scheduleList = page.getByTestId("schedule-list");
    await expect(scheduleList).toBeVisible();

    // Zeitraum auf "Dieser Monat" umstellen (Standard, hier explizit gesetzt) —
    // alle drei Schichten werden ohne Tageszellen-Klick gerendert.
    await scheduleList.getByTestId("schedule-list-range-menu").click();
    await page.getByRole("option", { name: "Dieser Monat" }).click();

    // ── Bestätigter Dienst (FIX) ────────────────────────────────────────────
    await assertDayDetailRowLayout(
      scheduleList.getByTestId(`shift-badge-${fixShiftId}`),
      {
        // FIX → grün (#1e8f4e = rgb(30, 143, 78))
        expectedBarColor: "rgb(30, 143, 78)",
        expectedStatusText: /Dienst\s*·\s*bestätigt/i,
        timeLabel: /\d{2}:\d{2}/,
      },
    );
    await expect(
      scheduleList.getByTestId(`shift-badge-${fixShiftId}`),
    ).toHaveAttribute("data-planning-status", "FIX");

    // ── Entwurf (VORLAEUFIG) ────────────────────────────────────────────────
    await assertDayDetailRowLayout(
      scheduleList.getByTestId(`shift-badge-${draftShiftId}`),
      {
        // VORLAEUFIG → amber/gold (#b5790a = rgb(181, 121, 10))
        expectedBarColor: "rgb(181, 121, 10)",
        expectedStatusText: /Dienst\s*·\s*Entwurf/i,
        timeLabel: /\d{2}:\d{2}/,
      },
    );
    await expect(
      scheduleList.getByTestId(`shift-badge-${draftShiftId}`),
    ).toHaveAttribute("data-planning-status", "VORLAEUFIG");

    // ── Abwesenheit — Urlaub (vacation, FIX) ────────────────────────────────
    // Abwesenheits-Einträge zeigen "ganztägig" statt einer Uhrzeit.
    await assertDayDetailRowLayout(
      scheduleList.getByTestId(`shift-badge-${absenceShiftId}`),
      {
        // Vacation FIX, kein Ausfall, keine Vertretung → grün (#1e8f4e)
        expectedBarColor: "rgb(30, 143, 78)",
        expectedStatusText: /Abwesenheit\s*·\s*Urlaub/i,
        timeLabel: "ganztägig",
      },
    );
    await expect(
      scheduleList.getByTestId(`shift-badge-${absenceShiftId}`),
    ).toHaveAttribute("data-planning-status", "FIX");

    // ── Vertretungsdienst (isVertretung, FIX) ───────────────────────────────
    // Teal-Statusfarbbalken + "Vertretung" im Statustext (Vorrang vor dem
    // Basis-Status "bestätigt", der als eingefärbtes Wort danach folgt).
    await assertDayDetailRowLayout(
      scheduleList.getByTestId(`shift-badge-${vertretungShiftId}`),
      {
        // Vertretung → teal (#0f6e8c = rgb(15, 110, 140))
        expectedBarColor: "rgb(15, 110, 140)",
        expectedStatusText: /Dienst\s*·\s*Vertretung\s*·\s*bestätigt/i,
        timeLabel: /\d{2}:\d{2}/,
      },
    );
    await expect(
      scheduleList.getByTestId(`shift-badge-${vertretungShiftId}`),
    ).toHaveAttribute("data-planning-status", "FIX");

    // Avatar bleibt die Personenfarbe, NICHT die teal Vertretungsfarbe: exakt
    // dieselbe Hintergrundfarbe wie beim FIX-Dienst desselben Assistenten,
    // und explizit ungleich dem Statusbalken-Teal.
    const fixAvatar = scheduleList
      .getByTestId(`shift-badge-${fixShiftId}`)
      .locator('span[aria-hidden="true"]')
      .first();
    const vertretungAvatar = scheduleList
      .getByTestId(`shift-badge-${vertretungShiftId}`)
      .locator('span[aria-hidden="true"]')
      .first();
    const fixAvatarBg = await fixAvatar.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    const vertretungAvatarBg = await vertretungAvatar.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    expect(
      vertretungAvatarBg,
      "Avatar des Vertretungsdienstes muss dieselbe Personenfarbe wie der FIX-Dienst behalten",
    ).toBe(fixAvatarBg);
    expect(
      vertretungAvatarBg,
      "Avatar darf NICHT die teal Vertretungsfarbe des Statusbalkens übernehmen",
    ).not.toBe("rgb(15, 110, 140)");
}

test(
  "DayDetailRow: Avatar links, Uhrzeit links, Statusfarbbalken rechts, Statustext (Desktop 1280px)",
  async ({ page }) => {
    await runDayDetailRowChecks(page, { width: 1280, height: 800 });
  },
);

test(
  "DayDetailRow: dieselbe Geometrie/Farben/Texte halten auch bei schmaler Tablet-Breite (800px, #854)",
  async ({ page }) => {
    // 800 px liegt oberhalb des md-Breakpoints (Desktop-Zweig bleibt aktiv),
    // ist aber deutlich schmaler als die volle Desktop-Breite — Kandidat für
    // Overflow/Umbruch im rechten Statusblock (max-w-[160px] + Icon-Stack).
    await runDayDetailRowChecks(page, { width: 800, height: 1000 });
  },
);
