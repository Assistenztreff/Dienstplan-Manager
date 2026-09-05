import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Waechter gegen Latenz-Rueckfall (Kay-Vorgabe 01.09.2026: Echtzeit).
 *
 * Am 01.09.2026 gemessen: Die automatische Planung brauchte fuer einen Monat
 * 12-15 Sekunden, ein Drop rund eine Sekunde. Die RECHENZEIT war dabei nie
 * das Problem — lokal lief beides in gut einer Sekunde. Das Problem war die
 * Zahl der Roundtrips: 5 SEQUENZIELLE Schreib-Requests plus 7 Nachlade-
 * Requests. Auf einer Verbindung mit ~1 s Latenz je Roundtrip wird daraus
 * genau die erlebte Wartezeit.
 *
 * Dieses Spec misst deshalb nicht Millisekunden (die haengen an der Maschine,
 * auf der die Suite laeuft, und waeren als Schwelle wertlos), sondern das,
 * was die Wartezeit tatsaechlich verursacht:
 *   1. Wie viele Requests laufen NACHEINANDER? (Latenz multipliziert sich)
 *   2. Wie viele Requests insgesamt?
 *   3. Steht das Ergebnis im Raster, BEVOR der Server geantwortet hat?
 *
 * Punkt 3 ist der eigentliche Kern: Solange die Oberflaeche optimistisch
 * vorlegt, ist die Latenz fuer den Nutzer unsichtbar — egal wie gross sie ist.
 */

function isoTag(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const ANKER = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3);
  if (d.getDate() > 20) d.setMonth(d.getMonth() + 1, 5);
  return d;
})();
const ZIEL_ISO = isoTag(ANKER);

/** Obergrenzen — bewusst mit Luft, sie sollen Struktur-Rueckfaelle fangen. */
const MAX_REQUESTS_AUTOPLANUNG = 8;
const MAX_REQUESTS_DROP = 4;

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let dienstId: number;
const personIds: number[] = [];

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "roundtrip");
  await setAccountPlan(acc.email, "premium");
  ctx = acc.ctx;

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "E2E Latenzdienst",
      defaultStartTime: "08:00",
      defaultEndTime: "16:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: false,
      isActive: true,
    },
  });

  const stamp = Date.now();
  for (const name of ["Anna Muster", "Ben Beispiel", "Clara Test", "Dora Vier", "Emil Fuenf"]) {
    const res = await ctx.post("/api/users", {
      data: {
        name,
        email: `e2e.rt.${name.split(" ")[0]}.${stamp}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.ok()).toBe(true);
    personIds.push(((await res.json()) as { id: number }).id);
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("automatische Planung: parallel statt nacheinander, Ergebnis sofort sichtbar", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.getByTestId("month-grid")).toBeVisible();

  // Schreib-Requests kuenstlich verzoegern: So verhaelt sich der Test wie eine
  // echte Verbindung mit Latenz — und nur so wird sichtbar, ob die Oberflaeche
  // darauf WARTET oder vorlegt.
  const LATENZ_MS = 700;
  let schreibStart = 0;
  let schreibEnde = 0;
  let schreibende = 0;
  await page.route("**/api/shifts/bulk", async (route) => {
    if (schreibStart === 0) schreibStart = Date.now();
    schreibende += 1;
    await new Promise((r) => setTimeout(r, LATENZ_MS));
    await route.continue();
    schreibEnde = Date.now();
  });

  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests += 1;
  });

  // Seit dem 05.09.2026 sitzt die automatische Planung ausschliesslich in der
  // Planungsmodus-Leiste; der alte Dialog im Ueberlauf-Menue ist weg.
  await page.getByTestId("toggle-planungsmodus").click();
  await expect(page.getByTestId("planungsmodus-leiste")).toBeVisible();

  requests = 0;
  const t0 = Date.now();
  await page.getByTestId("planungsmodus-automatik").click();

  // Kern der Zusage: Die Pillen stehen im Raster, WAEHREND die Requests noch
  // unterwegs sind — deutlich vor Ablauf einer einzigen Latenz.
  await expect(desktop.locator('[data-testid^="day-chip-"]').first()).toBeVisible({
    timeout: 15_000,
  });
  const tSichtbar = Date.now() - t0;
  expect(
    tSichtbar,
    `Das Raster wartete ${tSichtbar} ms auf den Server (Latenz ${LATENZ_MS} ms) — die Anzeige muss vorlegen, nicht warten.`,
  ).toBeLessThan(LATENZ_MS);

  await expect(page.getByText(/Dienste als Entwurf eingeplant/)).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  // Parallel, nicht nacheinander: Fuenf Personen, aber die Schreibphase dauert
  // etwa EINE Latenz — nacheinander waeren es fuenf.
  expect(schreibende, "Erwartet einen Sammelauftrag je Person").toBe(personIds.length);
  const schreibDauer = schreibEnde - schreibStart;
  expect(
    schreibDauer,
    `Die ${schreibende} Sammelauftraege brauchten ${schreibDauer} ms — bei parallelem Versand darf das kaum ueber einer Latenz (${LATENZ_MS} ms) liegen.`,
  ).toBeLessThan(LATENZ_MS * 2);

  expect(
    requests,
    `${requests} API-Requests fuer eine Monatsplanung — jeder kostet auf einer langsamen Verbindung eine Latenz.`,
  ).toBeLessThanOrEqual(MAX_REQUESTS_AUTOPLANUNG);
});

test("Drop auf einen offenen Platz zeigt die Pille vor der Server-Antwort", async ({ page }) => {
  test.setTimeout(120_000);
  // Aufraeumen: der vorige Test hat den Monat gefuellt.
  const monat = Number(ZIEL_ISO.slice(5, 7));
  const jahr = Number(ZIEL_ISO.slice(0, 4));
  const liste = (await (await ctx.get(`/api/shifts?month=${monat}&year=${jahr}`)).json()) as {
    id: number;
  }[];
  if (liste.length > 0) {
    await ctx.post("/api/shifts/bulk-delete", { data: { ids: liste.map((s) => s.id) } });
  }

  await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);

  const LATENZ_MS = 700;
  await page.route("**/api/shifts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, LATENZ_MS));
    await route.continue();
  });

  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests += 1;
  });

  const reihe = page.getByTestId("stundenkonto-reihe-wrapper");
  const desktop = page.getByTestId("dienstplan-desktop");
  const quelle = reihe.getByTestId(`stundenkonto-pill-${personIds[0]}`);
  const platz = desktop.getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`);
  await expect(platz).toBeVisible();

  const von = (await quelle.boundingBox())!;
  const nach = (await platz.boundingBox())!;
  await page.mouse.move(von.x + von.width / 2, von.y + von.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      von.x + von.width / 2 + ((nach.x + nach.width / 2 - von.x - von.width / 2) * i) / 12,
      von.y + von.height / 2 + ((nach.y + nach.height / 2 - von.y - von.height / 2) * i) / 12,
    );
  }

  requests = 0;
  const t0 = Date.now();
  await page.mouse.up();
  await expect(desktop.locator('[data-testid^="day-chip-"]').first()).toBeVisible({
    timeout: 15_000,
  });
  const tSichtbar = Date.now() - t0;
  expect(
    tSichtbar,
    `Die Pille erschien erst nach ${tSichtbar} ms (Latenz ${LATENZ_MS} ms) — sie muss sofort stehen.`,
  ).toBeLessThan(LATENZ_MS);

  await expect(page.getByText(/eingeplant — als Entwurf/)).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  expect(
    requests,
    `${requests} API-Requests fuer einen einzigen Drop.`,
  ).toBeLessThanOrEqual(MAX_REQUESTS_DROP);
});
