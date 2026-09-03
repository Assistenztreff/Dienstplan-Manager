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
 * E2E-Hauptweg des Planungsmodus (Etappe 2, Kay-Auftrag 02.09.2026).
 *
 * Der Modus ändert, was ein Klick auf eine Dienstpille bedeutet: Statt des
 * Bearbeiten-Dialogs dreht er die Person weiter. Genau deshalb muss er
 * sichtbar sein — ohne ihn wäre jeder Fehlklick eine stille Umbesetzung.
 *
 * Geprüft:
 *  1. Free sieht den Umschalter nicht (Premium-Recht autoScheduling).
 *  2. Umschalter zeigt die Leiste; außerhalb öffnet ein Pillen-Klick wie
 *     gewohnt den Dialog, innerhalb wechselt er die Person.
 *  3. Die automatische Planung füllt die offenen Plätze als ENTWÜRFE und
 *     merkt Vertretungen vor.
 *  4. Ein zweiter Lauf bei vollem Monat legt nichts doppelt an und bietet im
 *     Hinweis „Neu würfeln" an (Kays Variante 1 — ein Knopf, beide Wege).
 */

function isoTag(offset: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Anker im laufenden Monat; weicht gegen Monatsende auf den Folgemonat aus. */
const ANKER = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3);
  if (d.getDate() > 20) d.setMonth(d.getMonth() + 1, 5);
  return d;
})();
const ZIEL_ISO = [
  ANKER.getFullYear(),
  String(ANKER.getMonth() + 1).padStart(2, "0"),
  String(ANKER.getDate()).padStart(2, "0"),
].join("-");

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let dienstId = 0;
const personen: { id: number; name: string }[] = [];

async function schichtenDesMonats(): Promise<
  { id: number; userId: number; planningStatus: string; standbyUserId: number | null; startTime: string; shiftModelId: number | null }[]
> {
  const monat = Number(ZIEL_ISO.slice(5, 7));
  const jahr = Number(ZIEL_ISO.slice(0, 4));
  const res = await ctx.get(`/api/shifts?month=${monat}&year=${jahr}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as never;
}

async function raeumeMonatAb(): Promise<void> {
  const ids = (await schichtenDesMonats()).map((s) => s.id);
  if (ids.length > 0) await ctx.post("/api/shifts/bulk-delete", { data: { ids } });
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "planungsmodus");
  ctx = acc.ctx;

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  // Ein Regeldienst mit Vertretungsplatz, taeglich — so ist jeder Tag offen.
  const patch = await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "E2E Rotationsdienst",
      defaultStartTime: "08:00",
      defaultEndTime: "16:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: true,
      isActive: true,
    },
  });
  expect(patch.ok(), `Dienst vorbereiten fehlgeschlagen (${patch.status()})`).toBe(true);

  const stamp = Date.now();
  for (const name of ["Anna Muster", "Ben Beispiel", "Clara Test"]) {
    const res = await ctx.post("/api/users", {
      data: {
        name,
        email: `e2e.pm.${name.split(" ")[0]}.${stamp}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.ok()).toBe(true);
    personen.push({ id: ((await res.json()) as { id: number }).id, name });
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Free sieht den Umschalter nicht", async ({ page }) => {
  await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  // Anker ist die Seite selbst, nicht das Raster: Ohne gesetzte Ansicht steht
  // ein frisches Konto in der Tabelle, und dort gibt es kein month-grid.
  await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible();
  await expect(page.getByTestId("toggle-planungsmodus")).toHaveCount(0);
});

test.describe("Premium", () => {
  test.beforeEach(async ({ page }) => {
    await setAccountPlan(acc!.email, "premium");
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  });

  test("der Modus schaltet um, was ein Klick auf die Pille bedeutet", async ({ page }) => {
    await raeumeMonatAb();
    const res = await ctx.post("/api/shifts", {
      data: {
        userId: personen[0]!.id,
        shiftModelId: dienstId,
        type: "work",
        startTime: `${ZIEL_ISO}T08:00:00`,
        endTime: `${ZIEL_ISO}T16:00:00`,
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const schichtId = ((await res.json()) as { id: number }).id;

    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    const desktop = page.getByTestId("dienstplan-desktop");
    const pille = desktop.getByTestId(`day-chip-${schichtId}`);
    await expect(pille).toBeVisible();

    // AUSSERHALB des Modus: Klick oeffnet den Dialog wie bisher.
    await pille.click();
    await expect(page.getByTestId("shift-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shift-dialog")).toHaveCount(0);

    // Modus an: die Leiste erscheint.
    await page.getByTestId("toggle-planungsmodus").click();
    await expect(page.getByTestId("planungsmodus-leiste")).toBeVisible();

    // INNERHALB: Klick wechselt die Person, kein Dialog.
    await expect(pille).toContainText("Anna");
    await pille.click();
    await expect(page.getByTestId("shift-dialog")).toHaveCount(0);
    await expect(pille, "Der Klick muss die naechste Person setzen").toContainText("Ben");

    const nachher = (await schichtenDesMonats()).find((s) => s.id === schichtId);
    expect(nachher!.userId, "Auch serverseitig gewechselt").toBe(personen[1]!.id);

    await ctx.delete(`/api/shifts/${schichtId}`);
  });

  test("die automatische Planung füllt den Monat als Entwürfe, mit Vertretung", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await raeumeMonatAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();

    await page.getByTestId("toggle-planungsmodus").click();
    await page.getByTestId("planungsmodus-automatik").click();
    await expect(page.getByText(/Dienste als Entwurf eingeplant/)).toBeVisible({
      timeout: 20_000,
    });

    const angelegt = (await schichtenDesMonats()).filter((s) => s.shiftModelId === dienstId);
    expect(angelegt.length, "Der Monat muss gefuellt sein").toBeGreaterThan(3);
    expect(
      angelegt.every((s) => s.planningStatus === "VORLAEUFIG"),
      "Die Automatik legt Entwuerfe an, nie verbindliche Dienste",
    ).toBe(true);
    expect(
      angelegt.some((s) => s.standbyUserId != null),
      "Der Dienst sieht eine Vertretung vor — sie muss vorgemerkt sein",
    ).toBe(true);
    // Rotation: nicht alles auf eine Person.
    expect(new Set(angelegt.map((s) => s.userId)).size).toBeGreaterThan(1);
    // Nie zwei Dienste derselben Person am selben Tag.
    const proTagPerson = angelegt.map((s) => `${s.startTime.slice(0, 10)}#${s.userId}`);
    expect(new Set(proTagPerson).size).toBe(proTagPerson.length);
  });

  test("ein zweiter Lauf legt nichts doppelt an und bietet Neu würfeln", async ({ page }) => {
    test.setTimeout(90_000);
    // Der vorige Test hat den Monat gefuellt — Stand festhalten.
    const vorher = (await schichtenDesMonats()).filter((s) => s.shiftModelId === dienstId);
    expect(vorher.length, "Voraussetzung: der Monat ist gefuellt").toBeGreaterThan(3);

    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();
    await page.getByTestId("planungsmodus-automatik").click();

    // Variante 1: Ist alles besetzt, sagt der Hinweis das — und traegt das
    // Wuerfeln, damit es dafuer keinen zweiten Knopf braucht.
    await expect(page.getByText(/Alles besetzt/)).toBeVisible({ timeout: 20_000 });

    const nachher = (await schichtenDesMonats()).filter((s) => s.shiftModelId === dienstId);
    expect(nachher.length, "Ein zweiter Lauf darf nichts doppelt anlegen").toBe(vorher.length);
  });

  test("Auswahl: alles auf einen Druck, einzelne Pillen wieder abwaehlen", async ({ page }) => {
    test.setTimeout(90_000);
    // Der Monat ist aus den vorigen Tests gefuellt.
    const vorhanden = (await schichtenDesMonats()).filter((s) => s.shiftModelId === dienstId);
    expect(vorhanden.length, "Voraussetzung: der Monat ist gefuellt").toBeGreaterThan(3);

    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();

    const auswahl = page.getByTestId("planungsmodus-auswahl");
    await expect(auswahl).toHaveAttribute("aria-pressed", "false");
    await auswahl.click();

    // Ein Druck: alle Dienste ausgewaehlt, der Zaehler steht im Knopf.
    await expect(auswahl).toHaveAttribute("aria-pressed", "true");
    await expect(auswahl).toContainText(String(vorhanden.length));
    await expect(page.getByTestId("planungsmodus-loeschen")).toBeVisible();

    // Weg 1: Die Pille IST der Haken — ein Klick waehlt sie wieder ab.
    const erste = vorhanden.slice().sort((a, b) => a.startTime.localeCompare(b.startTime))[0]!;
    const pille = desktop.getByTestId(`day-chip-${erste.id}`);
    await expect(pille).toHaveAttribute("data-ausgewaehlt", "true");
    await pille.click();
    await expect(pille).not.toHaveAttribute("data-ausgewaehlt", "true");
    await expect(auswahl).toContainText(String(vorhanden.length - 1));
    // Und kein Dialog, kein Personenwechsel — der Klick hat nur ausgewaehlt.
    await expect(page.getByTestId("shift-dialog")).toHaveCount(0);

    // Loeschen trifft genau die Auswahl: der abgewaehlte Dienst bleibt.
    await page.getByTestId("planungsmodus-loeschen").click();
    await page.getByTestId("auswahl-loeschen-bestaetigen").click();
    await expect(page.getByText(/gelöscht/)).toBeVisible({ timeout: 20_000 });

    const uebrig = (await schichtenDesMonats()).filter((s) => s.shiftModelId === dienstId);
    expect(uebrig.map((s) => s.id)).toEqual([erste.id]);
    // Nach dem Loeschen ist der Auswahlmodus wieder aus.
    await expect(auswahl).toHaveAttribute("aria-pressed", "false");
  });

  test("das Zahnrad speichert die Grenzen am Team", async ({ page }) => {
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();

    await page.getByTestId("planungsmodus-zahnrad").click();
    const block = page.getByTestId("planung-block");
    await expect(block).toBeVisible();
    await block.fill("3");
    await page.getByTestId("planung-ruhezeit").fill("9");
    // Unter 11 h erscheint der ArbZG-Hinweis.
    await expect(page.getByTestId("planung-ruhezeit-hinweis")).toBeVisible();
    // Zuklappen speichert.
    await page.keyboard.press("Escape");

    await expect
      .poll(
        async () => {
          const s = (await (await ctx.get("/api/allowance-settings")).json()) as {
            planungBlockLaenge: number;
            planungRuhezeitStunden: number;
          };
          return `${s.planungBlockLaenge}/${s.planungRuhezeitStunden}`;
        },
        { message: "Die Grenzen müssen serverseitig ankommen" },
      )
      .toBe("3/9");
  });
});
