import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Ein-Klick-Bestätigung im Dienstplan-Kalender (Task #302).
 *
 * Entwürfe (VORLAEUFIG) und Vorschläge (ANGEBOTEN) lassen sich ohne manuellen
 * Status-Wechsel im Formular direkt auf FIX (verbindlich) setzen — über zwei
 * Wege, die dieser Spec gegen stille Regressionen absichert:
 *
 * 1. Badge-Button (`shift-confirm-{id}`) direkt im Kalender: Klick → Status
 *    FIX, Button verschwindet, Entwurf-Kennzeichnung fällt weg.
 * 2. Dialog-Banner (`shift-dialog-quick-confirm`) mit Bestätigen-Button
 *    (`shift-dialog-confirm-fix`): Klick → Dialog schließt, Status FIX.
 *
 * Negativfälle:
 * - FIX-Schichten tragen KEINEN Bestätigen-Button und der Dialog zeigt KEIN
 *   Quick-Confirm-Banner (sonst würde "Bestätigen" bedeutungslos).
 * - Abwesenheiten (Urlaub) sind sofort verbindlich → nie ein Bestätigen-Button.
 *
 * Setup: frisches Free-Konto über den Self-Service (eigenes Standard-Team,
 * keine Kollisionen mit parallelen Specs). Die Ein-Klick-Bestätigung ist
 * plan-unabhängig — kein Premium-Flip nötig. Schichten liegen im aktuellen
 * Monat (Free-Vorausplanungsfenster immer erfüllt), je ein eigener Tag.
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
// Entwurf (VORLAEUFIG) — wird per Badge-Button bestätigt (Test 1).
let draftShiftId: number;
// Vorschlag (ANGEBOTEN) — wird per Dialog-Banner bestätigt (Test 2).
let offeredShiftId: number;
// Verbindlich (FIX) — Negativfall: kein Button, kein Banner.
let fixShiftId: number;
// Abwesenheit (Urlaub) — Negativfall: nie ein Bestätigen-Button.
let vacationShiftId: number;

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "einklick");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Einklick Assistent ${Date.now()}`,
      email: `e2e.einklick.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  async function createShift(
    day: number,
    opts: { planningStatus?: string; type?: string } = {},
  ): Promise<number> {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        ...shiftTimes(day),
        type: opts.type ?? "active",
        ...(opts.planningStatus ? { planningStatus: opts.planningStatus } : {}),
      },
    });
    expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }

  draftShiftId = await createShift(10, { planningStatus: "VORLAEUFIG" });
  offeredShiftId = await createShift(11, { planningStatus: "ANGEBOTEN" });
  fixShiftId = await createShift(12); // Default FIX
  vacationShiftId = await createShift(13, { type: "vacation" });
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

/**
 * Öffnet den Dienstplan in der mobilen LISTEN-Ansicht und liefert den
 * Mobile-Container. WICHTIG: auf `dienstplan-mobile` scopen — dieselben Badges
 * existieren auch im per CSS versteckten Desktop-Zweig (Strict-Mode-Verletzung).
 */
async function openListView(page: import("@playwright/test").Page) {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  // Der Ansicht-Umschalter lebt seit der adaptiven Kopfzeile AUSSERHALB des
  // Mobile-Containers (sticky Header) — über die Header-Testids ansteuern.
  await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();
  // Standard-Zeitraum der Wochen-Liste ist seit 27.08.2026 „Heute" — dieser
  // Test prueft Eintraege an festen Monatstagen und braucht den Monatsblick.
  await page.getByTestId("schedule-list-range-menu").click();
  await page.getByRole("option", { name: "Dieser Monat" }).click();
  return mobile;
}

test("Badge-Button: Entwurf mit einem Klick bestätigen → Status FIX, Button verschwindet", async ({
  page,
}) => {
  await loginViaUi(page, acc.email, PASSWORD);
  const mobile = await openListView(page);

  const draftBadge = page.getByTestId("schedule-list").getByTestId(`shift-badge-${draftShiftId}`);
  await expect(draftBadge, "Entwurf-Schicht muss im Kalender sichtbar sein").toBeVisible();
  await expect(draftBadge).toHaveAttribute("data-planning-status", "VORLAEUFIG");

  const confirmButton = page.getByTestId("schedule-list").getByTestId(`shift-confirm-${draftShiftId}`);
  await expect(
    confirmButton,
    "Entwurf-Badge muss den Ein-Klick-Bestätigen-Button tragen",
  ).toBeVisible();
  await confirmButton.click();

  // Nach der Bestätigung: Status FIX, Button weg, Entwurf-Kennzeichnung weg.
  await expect(draftBadge).toHaveAttribute("data-planning-status", "FIX");
  await expect(
    page.getByTestId("schedule-list").getByTestId(`shift-confirm-${draftShiftId}`),
    "Bestätigen-Button muss nach der Bestätigung verschwinden",
  ).toHaveCount(0);
  await expect(draftBadge).not.toContainText(/Entwurf/i);
  await expect(draftBadge).not.toHaveClass(/border-dashed/);

  // Serverseitige Gegenprobe: Der Status ist wirklich persistiert (kein reiner
  // UI-Effekt) — sonst wäre die Schicht nach einem Reload wieder Entwurf.
  const res = await acc.ctx.get(`/api/shifts/${draftShiftId}`);
  expect(res.ok(), "GET /api/shifts/:id nach Bestätigung fehlgeschlagen").toBe(true);
  expect(((await res.json()) as { planningStatus: string }).planningStatus).toBe("FIX");
});

test("Dialog-Banner: Vorschlag über Quick-Confirm bestätigen → Dialog schließt, Status FIX", async ({
  page,
}) => {
  await loginViaUi(page, acc.email, PASSWORD);
  const mobile = await openListView(page);

  const offeredBadge = page.getByTestId("schedule-list").getByTestId(`shift-badge-${offeredShiftId}`);
  await expect(offeredBadge, "Vorschlag-Schicht muss im Kalender sichtbar sein").toBeVisible();
  await expect(offeredBadge).toHaveAttribute("data-planning-status", "ANGEBOTEN");

  // Badge (NICHT den Bestätigen-Button) anklicken → Bearbeiten-Dialog öffnet.
  // Auf den Zeit-Text klicken, damit der Klick nicht auf dem Button landet.
  await offeredBadge.click({ position: { x: 10, y: 5 } });
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();

  // Quick-Confirm-Banner mit Erklärtext + Bestätigen-Button.
  const banner = dialog.getByTestId("shift-dialog-quick-confirm");
  await expect(banner, "Quick-Confirm-Banner muss für Vorschläge sichtbar sein").toBeVisible();
  await expect(banner).toContainText(/zählt noch nicht in Auswertungen/i);
  await dialog.getByTestId("shift-dialog-confirm-fix").click();

  // Dialog schließt; Badge zeigt FIX ohne Bestätigen-Button.
  await expect(dialog).not.toBeVisible();
  await expect(offeredBadge).toHaveAttribute("data-planning-status", "FIX");
  await expect(page.getByTestId("schedule-list").getByTestId(`shift-confirm-${offeredShiftId}`)).toHaveCount(0);

  const res = await acc.ctx.get(`/api/shifts/${offeredShiftId}`);
  expect(res.ok(), "GET /api/shifts/:id nach Bestätigung fehlgeschlagen").toBe(true);
  expect(((await res.json()) as { planningStatus: string }).planningStatus).toBe("FIX");
});

test("Negativfälle: kein Bestätigen-Button auf FIX-Schichten und Abwesenheiten", async ({
  page,
}) => {
  await loginViaUi(page, acc.email, PASSWORD);
  const mobile = await openListView(page);

  // FIX-Schicht: sichtbar, aber ohne Bestätigen-Button.
  const fixBadge = page.getByTestId("schedule-list").getByTestId(`shift-badge-${fixShiftId}`);
  await expect(fixBadge).toBeVisible();
  await expect(fixBadge).toHaveAttribute("data-planning-status", "FIX");
  await expect(
    page.getByTestId("schedule-list").getByTestId(`shift-confirm-${fixShiftId}`),
    "FIX-Schichten dürfen KEINEN Bestätigen-Button tragen",
  ).toHaveCount(0);

  // Abwesenheit (Urlaub): sofort verbindlich, nie ein Bestätigen-Button.
  const vacationBadge = page.getByTestId("schedule-list").getByTestId(`shift-badge-${vacationShiftId}`);
  await expect(vacationBadge).toBeVisible();
  await expect(
    page.getByTestId("schedule-list").getByTestId(`shift-confirm-${vacationShiftId}`),
    "Abwesenheiten dürfen KEINEN Bestätigen-Button tragen",
  ).toHaveCount(0);

  // Dialog-Gegenprobe: FIX-Schicht öffnen → KEIN Quick-Confirm-Banner.
  await fixBadge.click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByTestId("shift-dialog-quick-confirm"),
    "FIX-Schichten dürfen im Dialog KEIN Quick-Confirm-Banner zeigen",
  ).toHaveCount(0);
});
