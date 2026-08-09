import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  deleteAccountByEmail,
  setAccountPlan,
  enableTimeTracking,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Handbuch-Screenshot-Generator (Task #615).
 *
 * Erzeugt echte, reproduzierbare App-Screenshots (Desktop + Mobil) für alle
 * Handbuch-Kapitel und legt sie unter
 * `artifacts/mockup-sandbox/src/components/mockups/handbuch/_assets/` ab.
 *
 * Läuft NICHT in der normalen E2E-Suite: ohne die Umgebungsvariable
 * `HANDBUCH_SCREENSHOTS=1` wird die Datei übersprungen. Aufruf:
 *
 *   pnpm --filter @workspace/dienstplan run screenshots:handbuch
 *
 * Der Lauf nutzt den isolierten Playwright-Test-Stack (Test-DB), registriert
 * ein frisches Dienstleister-Konto mit realistisch benannten Testdaten
 * (Assistenzkräfte, Verträge, Dienste, Abwesenheiten, Ist-Zeiten) und räumt
 * das Konto am Ende wieder ab. Nach UI-Änderungen einfach erneut ausführen —
 * die Bilder werden überschrieben und vom Handbuch-Mockup direkt importiert.
 */

test.skip(
  !process.env.HANDBUCH_SCREENSHOTS,
  "Nur für den manuellen Screenshot-Lauf (HANDBUCH_SCREENSHOTS=1, npm-Skript screenshots:handbuch).",
);

const OUT_DIR = path.resolve(process.cwd(), "public/handbuch");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Zweistellig auffüllen (Monats-/Tages-Strings). */
const p2 = (n: number) => String(n).padStart(2, "0");

/** Aktueller Monat als {year, month1} plus ISO-Helper für einen Tag. */
function currentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month1 = now.getMonth() + 1;
  const day = (d: number) => `${year}-${p2(month1)}-${p2(d)}`;
  return { year, month1, day };
}

let acc: FreeAccount;
let teamId: number;
const { year, month1, day } = currentMonth();

async function createUser(ctx: APIRequestContext, name: string, email: string): Promise<number> {
  const res = await ctx.post("/api/users", {
    data: { name, email, role: "assistant" },
  });
  expect(res.ok(), `Nutzer ${name} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

async function createContract(ctx: APIRequestContext, userId: number, weeklyHours: number) {
  const res = await ctx.post("/api/contracts", {
    data: {
      userId,
      teamId,
      weeklyHours,
      vacationDays: 30,
      startDate: `${year}-01-01`,
    },
  });
  expect(res.ok(), `Vertrag anlegen fehlgeschlagen (${res.status()})`).toBe(true);
}

async function createShift(
  ctx: APIRequestContext,
  userId: number,
  isoDay: string,
  startTime: string,
  endTime: string,
  type = "active",
) {
  const res = await ctx.post("/api/shifts", {
    data: {
      userId,
      teamId,
      startTime: `${isoDay}T${startTime}:00.000Z`,
      endTime: `${isoDay}T${endTime}:00.000Z`,
      type,
    },
  });
  expect(res.ok(), `Schicht ${isoDay} ${type} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
}

test.beforeAll(async () => {
  // Registrierung + umfangreiches Seeding sprengen beim Cold-Start die
  // Standard-Hook-Zeit.
  test.setTimeout(240_000);
  mkdirSync(OUT_DIR, { recursive: true });

  // Dienstleister-Konto (Premium), damit auch die Team-Verwaltung sichtbar ist
  // und Zukunfts-Dienste/mehrere Assistenten erlaubt sind. Bewusst NICHT
  // registerFreeAccount: Name/E-Mail erscheinen auf den Screenshots
  // (Einstellungen, Kopfzeile) und sollen freundlich lesbar sein.
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const email = `maria.beispiel.${Date.now()}@dienstplan.test`;
  const regRes = await ctx.post("/api/auth/register", {
    data: {
      name: "Maria Beispiel",
      email,
      password: "handbuch1234",
      accountType: "dienstleister",
    },
  });
  expect(regRes.status(), `Registrierung fehlgeschlagen (${regRes.status()})`).toBe(201);
  acc = { ctx, id: ((await regRes.json()) as { id: number }).id, email };
  await setAccountPlan(acc.email, "premium");

  // Standard-Team der Registrierung verwenden (TeamSwitcher wählt das ERSTE
  // Team automatisch — Fixtures müssen dort liegen).
  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  const teams = (await teamsRes.json()) as { id: number }[];
  expect(teams.length).toBeGreaterThan(0);
  teamId = teams[0].id;

  // Realistisch benannte Assistenzkräfte mit Verträgen.
  const anna = await createUser(acc.ctx, "Anna Schmidt", `anna.schmidt.${acc.id}@beispiel.de`);
  const jonas = await createUser(acc.ctx, "Jonas Weber", `jonas.weber.${acc.id}@beispiel.de`);
  const leyla = await createUser(acc.ctx, "Leyla Kaya", `leyla.kaya.${acc.id}@beispiel.de`);
  await createContract(acc.ctx, anna, 30);
  await createContract(acc.ctx, jonas, 40);
  await createContract(acc.ctx, leyla, 20);

  // Dienste über den aktuellen Monat verteilen (Früh/Spät/Nacht-Mix).
  for (const d of [2, 4, 9, 11, 16, 18, 23]) {
    await createShift(acc.ctx, anna, day(d), "06:00", "14:00");
  }
  for (const d of [3, 5, 10, 12, 17, 19, 24]) {
    await createShift(acc.ctx, jonas, day(d), "14:00", "22:00");
  }
  for (const d of [6, 13, 20]) {
    await createShift(acc.ctx, leyla, day(d), "08:00", "16:00");
  }

  // Abwesenheiten (Kapitel „Abwesenheiten"): Urlaub + Krankheit.
  for (const d of [25, 26]) {
    await createShift(acc.ctx, anna, day(d), "08:00", "16:00", "vacation");
  }
  await createShift(acc.ctx, jonas, day(26), "08:00", "16:00", "sick");

  // Zeiterfassung aktivieren + Ist-Zeiten für vergangene Tage.
  await enableTimeTracking(acc.ctx);
  const today = new Date().getDate();
  const pastDays = [2, 3, 4, 5].filter((d) => d < today);
  for (const d of pastDays) {
    const res = await acc.ctx.post("/api/time-tracking", {
      data: {
        userId: d % 2 === 0 ? anna : jonas,
        teamId,
        actualStart: `${day(d)}T${d % 2 === 0 ? "06:02" : "14:04"}:00.000Z`,
        actualEnd: `${day(d)}T${d % 2 === 0 ? "14:11" : "22:01"}:00.000Z`,
      },
    });
    expect(res.ok(), `Ist-Zeit ${day(d)} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  }
});

test.afterAll(async () => {
  try {
    await deleteAccountByEmail(acc.email);
  } catch {
    /* Best effort. */
  }
  await acc.ctx.dispose();
});

/** Frischer Browser-Kontext mit der Seed-Session im gewünschten Viewport. */
async function openPage(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: await acc.ctx.storageState(),
    viewport,
  });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** Seite laden, zur Ruhe kommen lassen, Viewport-Screenshot schreiben. */
async function capture(page: Page, route: string, file: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  // Dev-only Test-Nutzer-Wechsler ausblenden — er existiert im Production-Build
  // nicht und gehört nicht in Handbuch-Bilder.
  await page.addStyleTag({
    content: 'div:has(> [aria-label="Test-Nutzer wechseln"]) { display: none !important; }',
  });
  // Skeleton-/Lade-Zustände abwarten (React Query rendert nach networkidle noch um).
  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(OUT_DIR, file),
    animations: "disabled",
  });
}

/** Kapitel-Routen → Dateibasisnamen (Desktop und Mobil identisch). */
const CHAPTERS: Array<[route: string, base: string]> = [
  ["/", "dashboard"],
  ["/dienstplan", "dienstplan-monatsansicht"],
  ["/zeiterfassung", "zeiterfassung"],
  ["/abwesenheiten", "abwesenheiten"],
  ["/auswertungen", "auswertungen"],
  ["/team-verwaltung", "team-verwaltung"],
  ["/einstellungen", "einstellungen"],
];

test("Desktop-Screenshots aller Handbuch-Kapitel", async ({ browser }) => {
  test.setTimeout(300_000);
  const { page, close } = await openPage(browser, DESKTOP);
  try {
    for (const [route, base] of CHAPTERS) {
      await capture(page, route, `${base}-desktop.png`);
    }
  } finally {
    await close();
  }
});

test("Mobil-Screenshots aller Handbuch-Kapitel", async ({ browser }) => {
  test.setTimeout(300_000);
  const { page, close } = await openPage(browser, MOBILE);
  try {
    for (const [route, base] of CHAPTERS) {
      await capture(page, route, `${base}-mobil.png`);
    }
  } finally {
    await close();
  }
});

test("Dienst-Dialog-Screenshot (Desktop, Zwei-Stufen-Klick)", async ({ browser }) => {
  test.setTimeout(300_000);
  const { page, close } = await openPage(browser, DESKTOP);
  try {
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    // Monatsgitter im Desktop-Zweig erzwingen (localStorage-Drift möglich).
    const gridToggle = page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid");
    await gridToggle.click();
    await expect(gridToggle).toHaveAttribute("data-active", "true");
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();

    // Zieltag: ein Tag mit Dienst, der nicht "heute" ist (Klick markiert,
    // das Plus in der Zellen-Kopfzeile öffnet den Schicht-Dialog — 3.4).
    const today = new Date().getDate();
    const target = [9, 16, 11, 4].find((d) => d !== today) ?? 9;
    const cell = desktop.getByTestId(`day-cell-${year}-${p2(month1)}-${p2(target)}`);
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");
    await desktop.getByTestId(`day-add-${year}-${p2(month1)}-${p2(target)}`).click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    await dialog.screenshot({
      path: path.join(OUT_DIR, "dienst-dialog-desktop.png"),
      animations: "disabled",
    });
  } finally {
    await close();
  }
});
