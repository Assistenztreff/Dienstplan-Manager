import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { registerFreeAccount, deleteFreeAccount, setAccountPlan, FREE_ACCOUNT_PASSWORD, type FreeAccount } from "./helpers/teams";

let acc: FreeAccount | undefined;

test("perf messung", async ({ page }) => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "perf");
  await setAccountPlan(acc.email, "premium");
  const ctx = acc.ctx;
  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  const dienstId = models[0]!.id;
  await ctx.patch(`/api/shift-models/${dienstId}`, { data: { name: "24h Assistenz", defaultStartTime: "09:00", defaultEndTime: "09:00", defaultWeekdays: [1,2,3,4,5,6,7], imRegelplan: true, isActive: true } });
  const stamp = Date.now();
  const ids: number[] = [];
  for (const n of ["Anna Muster", "Ben Beispiel", "Clara Test", "Dora Vier", "Emil Fuenf"]) {
    const r = await ctx.post("/api/users", { data: { name: n, email: `perf.${n.split(" ")[0]}.${stamp}@dienstplan.test`, role: "assistant" } });
    ids.push(((await r.json()) as { id: number }).id);
    await ctx.post("/api/contracts", { data: { userId: ids[ids.length-1], weeklyHours: 30, vacationDays: 30, startDate: "2026-01-01" } });
  }

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  await page.goto("/dienstplan");
  await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();

  // Netzwerk-Zaehler
  let requests = 0;
  const urls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) { requests += 1; urls.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); } });

  // ---- Messung 1: Automatische Planung, ganzer Monat ----
  await page.getByTestId("header-overflow").click();
  await page.getByTestId("open-autoplanung").click();
  const dialog = page.getByTestId("autoplanung-dialog");
  for (const id of ids) await dialog.getByTestId(`autoplanung-person-${id}`).click();
  await expect(dialog.getByTestId("autoplanung-vorschau")).toBeVisible();

  requests = 0;
  const t0 = Date.now();
  await dialog.getByTestId("autoplanung-anlegen").click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  const tDialogZu = Date.now() - t0;
  // Warten bis die Pillen wirklich im Raster stehen
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.locator('[data-testid^="day-chip-"]').first()).toBeVisible({ timeout: 60_000 });
  // Warten bis Netzwerk ruhig ist (Refetch-Sturm abgeklungen)
  await page.waitForLoadState("networkidle");
  const tKomplett = Date.now() - t0;
  console.log(`AUTOPLANUNG: Dialog zu nach ${tDialogZu} ms, alles fertig nach ${tKomplett} ms, ${requests} API-Requests`);
  console.log("AUTOPLANUNG-URLS:\n" + urls.join("\n"));

  // ---- Messung 2: Drag-and-Drop auf offenen Platz ----
  // Erst alles abraeumen, damit wieder Plaetze offen sind
  const jetzt = new Date();
  const liste = (await (await ctx.get(`/api/shifts?month=${jetzt.getMonth()+1}&year=${jetzt.getFullYear()}`)).json()) as { id: number }[];
  await ctx.post("/api/shifts/bulk-delete", { data: { ids: liste.map((s) => s.id) } });
  await page.reload();
  await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();

  const quelle = page.getByTestId("stundenkonto-panel-wrapper").getByTestId(`stundenkonto-pill-${ids[0]}`);
  const zielPlatz = desktop.locator('[data-testid^="day-slot-"]').first();
  await expect(zielPlatz).toBeVisible();
  const von = (await quelle.boundingBox())!;
  const nach = (await zielPlatz.boundingBox())!;
  await page.mouse.move(von.x + von.width/2, von.y + von.height/2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(von.x + von.width/2 + ((nach.x + nach.width/2 - von.x - von.width/2)*i)/8, von.y + von.height/2 + ((nach.y + nach.height/2 - von.y - von.height/2)*i)/8);
  }
  requests = 0;
  urls.length = 0;
  const d0 = Date.now();
  await page.mouse.up();
  await expect(desktop.locator('[data-testid^="day-chip-"]').first()).toBeVisible({ timeout: 30_000 });
  const tPille = Date.now() - d0;
  await page.waitForLoadState("networkidle");
  const tDndKomplett = Date.now() - d0;
  console.log(`DND: Pille sichtbar nach ${tPille} ms, alles fertig nach ${tDndKomplett} ms, ${requests} API-Requests`);
  console.log("DND-URLS:\n" + urls.join("\n"));
});

test.afterAll(async () => { await deleteFreeAccount(acc); });
