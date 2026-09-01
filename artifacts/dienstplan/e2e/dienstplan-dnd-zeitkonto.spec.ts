import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Hauptweg fuer Drag-and-Drop aus dem Zeitkonto (Baustein 2, 01.09.2026).
 *
 * Eine Zeitkonto-Pille wird auf das Monatsraster gezogen:
 *  - auf einen OFFENEN Platz des Dienstgeruests -> Dienst entsteht als
 *    Entwurf fuer diese Person (Zeiten des Platzes),
 *  - auf eine BESETZTE Pille -> die gezogene Person uebernimmt den Dienst,
 *    Rueckgaengig im Hinweis stellt die vorherige Person wieder her.
 * Ausserdem: Ein einfacher KLICK auf die Pille bleibt ein Klick (Filter) —
 * der Maus-Sensor zieht erst ab 8 px Bewegung.
 *
 * Eigenes, frisch registriertes Konto (auf Premium gehoben — das Zeitkonto
 * ist ein Premium-Merkmal), damit der Regelplan keine anderen Specs stoert.
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

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let dienstId: number;
let annaId: number;
let benId: number;
const angelegteSchichten: number[] = [];

/**
 * Zieht per Maus von der Mitte der Quelle zur Mitte des Ziels — in mehreren
 * Schritten, damit dnd-kit die Aktivierungsdistanz (8 px) ueberschreitet und
 * die Kollisionserkennung unterwegs feuert.
 */
async function ziehe(page: Page, quelle: Locator, ziel: Locator): Promise<void> {
  const von = await quelle.boundingBox();
  const nach = await ziel.boundingBox();
  expect(von, "Quelle hat keine sichtbare Flaeche").not.toBeNull();
  expect(nach, "Ziel hat keine sichtbare Flaeche").not.toBeNull();
  const start = { x: von!.x + von!.width / 2, y: von!.y + von!.height / 2 };
  const ende = { x: nach!.x + nach!.width / 2, y: nach!.y + nach!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const schritte = 12;
  for (let i = 1; i <= schritte; i++) {
    await page.mouse.move(
      start.x + ((ende.x - start.x) * i) / schritte,
      start.y + ((ende.y - start.y) * i) / schritte,
    );
  }
  await page.mouse.up();
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "dnd");
  await setAccountPlan(acc.email, "premium");
  ctx = acc.ctx;

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  const patch = await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "E2E Zugdienst",
      defaultStartTime: "06:00",
      defaultEndTime: "14:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: false,
      isActive: true,
    },
  });
  expect(patch.ok(), `Dienst vorbereiten fehlgeschlagen (${patch.status()})`).toBe(true);

  const stamp = Date.now();
  for (const [name, setzen] of [
    ["Anna Muster", (id: number) => (annaId = id)],
    ["Ben Beispiel", (id: number) => (benId = id)],
  ] as const) {
    const res = await ctx.post("/api/users", {
      data: { name, email: `e2e.dnd.${name.split(" ")[0]}.${stamp}@dienstplan.test`, role: "assistant" },
    });
    expect(res.ok(), `Assistenzkraft anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    setzen(((await res.json()) as { id: number }).id);
  }
});

test.afterAll(async () => {
  for (const id of angelegteSchichten) {
    try {
      await ctx.delete(`/api/shifts/${id}`);
    } catch {
      /* Aufraeumen darf den Lauf nicht kippen */
    }
  }
  await deleteFreeAccount(acc);
});

test.describe("Drag-and-Drop aus dem Zeitkonto", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    // 1000 px: Zeitkonto als REIHE ueber dem Kalender (unter 1100 px kein
    // Platz fuer das seitliche Panel), Monatsraster als Desktop-Ansicht.
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  });

  test("Pille auf offenen Platz ziehen legt einen Entwurf an — Klick bleibt Filter", async ({
    page,
  }) => {
    const reihe = page.getByTestId("stundenkonto-reihe-wrapper");
    const desktop = page.getByTestId("dienstplan-desktop");
    const annaPille = reihe.getByTestId(`stundenkonto-pill-${annaId}`);
    const platz = desktop.getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`);
    await expect(platz).toBeVisible();

    // Erst der Klick-Beweis: ein schlichter Klick filtert auf Anna (Bens
    // Pille verliert die Auswahl), er darf KEINEN Dienst anlegen.
    const benPille = reihe.getByTestId(`stundenkonto-pill-${benId}`);
    await expect(benPille).toHaveAttribute("aria-pressed", "true"); // "Alle" aktiv
    await annaPille.click();
    await expect(benPille).toHaveAttribute("aria-pressed", "false");
    await reihe.getByTestId("stundenkonto-alle").click(); // Filter zuruecksetzen
    await expect(benPille).toHaveAttribute("aria-pressed", "true");
    await expect(platz).toBeVisible(); // kein Dienst entstanden

    await ziehe(page, annaPille, platz);

    // Der Platz ist jetzt besetzt, an seiner Stelle steht die Entwurfs-Pille.
    await expect(platz).toHaveCount(0);
    const chip = desktop.locator(`[data-testid^="day-chip-"]`).first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Muster");
    await expect(page.getByText("Anna eingeplant — als Entwurf.")).toBeVisible();

    // Fuers Aufraeumen und den naechsten Test die Schicht-ID einsammeln.
    const testId = await chip.getAttribute("data-testid");
    angelegteSchichten.push(Number(testId!.replace("day-chip-", "")));

    // Als Entwurf angelegt? Ueber die API gegenpruefen.
    const monat = ZIEL_ISO.slice(0, 7);
    const liste = (await (
      await ctx.get(`/api/shifts?month=${Number(monat.slice(5))}&year=${monat.slice(0, 4)}`)
    ).json()) as { id: number; userId: number; planningStatus: string; shiftModelId: number }[];
    const angelegt = liste.find((s) => s.id === angelegteSchichten[0]);
    expect(angelegt?.userId).toBe(annaId);
    expect(angelegt?.planningStatus).toBe("VORLAEUFIG");
    expect(angelegt?.shiftModelId).toBe(dienstId);
  });

  test("Pille auf besetzten Dienst ziehen ersetzt die Person — Rueckgaengig stellt sie wieder her", async ({
    page,
  }) => {
    // Der Dienst aus dem ersten Test gehoert Anna; Ben uebernimmt ihn.
    const schichtId = angelegteSchichten[0]!;
    const desktop = page.getByTestId("dienstplan-desktop");
    const reihe = page.getByTestId("stundenkonto-reihe-wrapper");
    const chip = desktop.getByTestId(`day-chip-${schichtId}`);
    await expect(chip).toContainText("Muster");

    await ziehe(page, reihe.getByTestId(`stundenkonto-pill-${benId}`), chip);

    await expect(chip).toContainText("Beispiel");
    await expect(page.getByText("Ben übernimmt den Dienst von Anna.")).toBeVisible();

    // Rueckgaengig direkt im Hinweis: Anna kehrt zurueck.
    await page.getByRole("button", { name: "Rückgängig" }).click();
    await expect(chip).toContainText("Muster");
  });
});
