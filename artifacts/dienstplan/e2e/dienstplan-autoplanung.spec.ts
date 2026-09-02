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
 * E2E-Hauptweg der Automatischen Planung (Baustein 3, 01.09.2026).
 *
 * Der Assistent verteilt die offenen Plaetze eines Regelplan-Dienstes reihum
 * auf die gewaehlten Personen und legt sie nach Bestaetigung der Vorschau als
 * ENTWUERFE an. Geprueft wird:
 *  1. Free sieht den Menuepunkt nur GESPERRT (Premium-Gate, fuehrt zu /preise).
 *  2. Premium: Dialog oeffnen, zwei Personen in Reihenfolge waehlen, Vorschau
 *     zeigt die Rotation, Anlegen erzeugt die Dienste als VORLAEUFIG mit
 *     Protokoll-Notiz — und das Raster zeigt die Pillen statt der Plaetze.
 *  3. Abwesenheit: Wer abwesend ist, taucht an dem Tag nicht im Plan auf.
 */

function isoTag(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// Anker weit genug vorn im Monat, dass mehrere Folgetage im selben Raster
// liegen; Free darf bis zum naechsten Monat planen (fuer den Lock-Teil egal).
const ANKER = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3);
  if (d.getDate() > 15) d.setMonth(d.getMonth() + 1, 5);
  return d;
})();
const T1 = isoTag(ANKER);
// Erster Tag, den der Assistent ueberhaupt plant: heute — ausser der Anker
// musste in den Folgemonat ausweichen, dann dessen Monatserster.
const START_ISO = (() => {
  const heute = new Date();
  heute.setHours(12, 0, 0, 0);
  if (heute.getFullYear() === ANKER.getFullYear() && heute.getMonth() === ANKER.getMonth()) {
    return isoTag(heute);
  }
  return isoTag(new Date(ANKER.getFullYear(), ANKER.getMonth(), 1));
})();
const START_FOLGETAG = (() => {
  const d = new Date(`${START_ISO}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return isoTag(d);
})();

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let dienstId: number;
let annaId: number;
let benId: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "autoplan");
  ctx = acc.ctx;

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  // Regeldienst NUR an den drei Zieltagen (ueber validFrom nicht machbar —
  // deshalb Wochentage aller drei Tage; das haelt die Vorschau klein und
  // deterministisch genug fuer Namens-Assertions je Tag).
  const patch = await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "E2E Rotationsdienst",
      defaultStartTime: "08:00",
      defaultEndTime: "16:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: false,
      isActive: true,
    },
  });
  expect(patch.ok(), `Dienst vorbereiten fehlgeschlagen (${patch.status()})`).toBe(true);

  const stamp = Date.now();
  const anna = await ctx.post("/api/users", {
    data: { name: "Anna Muster", email: `e2e.autoplan.anna.${stamp}@dienstplan.test`, role: "assistant" },
  });
  expect(anna.ok()).toBe(true);
  annaId = ((await anna.json()) as { id: number }).id;
  const ben = await ctx.post("/api/users", {
    data: { name: "Ben Beispiel", email: `e2e.autoplan.ben.${stamp}@dienstplan.test`, role: "assistant" },
  });
  expect(ben.ok()).toBe(true);
  benId = ((await ben.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test.describe("Automatische Planung", () => {
  test("Free sieht den Menuepunkt nur gesperrt", async ({ page }) => {
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/dienstplan?date=${T1}`);
    await page.getByTestId("header-overflow").click();
    await expect(page.getByTestId("open-autoplanung-locked")).toBeVisible();
    await expect(page.getByTestId("open-autoplanung")).toHaveCount(0);
  });

  test("Premium: Rotation planen, Vorschau pruefen, als Entwuerfe anlegen", async ({ page }) => {
    await setAccountPlan(acc!.email, "premium");
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
    await page.goto(`/dienstplan?date=${T1}`);

    await page.getByTestId("header-overflow").click();
    await page.getByTestId("open-autoplanung").click();
    const dialog = page.getByTestId("autoplanung-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("E2E Rotationsdienst");

    // Personen in Reihenfolge: erst Anna (1), dann Ben (2).
    await dialog.getByTestId(`autoplanung-person-${annaId}`).click();
    await dialog.getByTestId(`autoplanung-person-${benId}`).click();

    // Vorschau: Blocklaenge 1 -> ab dem ersten geplanten Tag wechseln sich
    // Anna und Ben ab (Klick-Reihenfolge = Rotationsreihenfolge).
    const zeilen = dialog.locator('[data-testid^="autoplanung-tag-"]');
    await expect(zeilen.nth(0)).toContainText("Anna Muster");
    await expect(zeilen.nth(1)).toContainText("Ben Beispiel");
    await expect(zeilen.nth(2)).toContainText("Anna Muster");
    // Und: geplant wird ab heute — kein Tag vor START_ISO in der Liste.
    const ersterTag = await zeilen.nth(0).getAttribute("data-testid");
    expect(ersterTag).toBe(`autoplanung-tag-${START_ISO}`);

    await dialog.getByTestId("autoplanung-anlegen").click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/Dienste als Entwurf angelegt/)).toBeVisible();

    // Raster: die geplanten Tage tragen jetzt Pillen statt offener Plaetze.
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId(`day-slot-${START_ISO}-${dienstId}`)).toHaveCount(0);
    await expect(desktop.getByTestId(`day-slot-${T1}-${dienstId}`)).toHaveCount(0);

    // API-Gegenprobe: VORLAEUFIG, richtiges Modell, Protokoll-Notiz.
    const monat = Number(T1.slice(5, 7));
    const jahr = Number(T1.slice(0, 4));
    const liste = (await (
      await ctx.get(`/api/shifts?month=${monat}&year=${jahr}`)
    ).json()) as {
      id: number; userId: number; startTime: string; planningStatus: string;
      shiftModelId: number | null; notes?: string | null;
    }[];
    const startSchicht = liste.find(
      (s) => s.startTime.slice(0, 10) === START_ISO && s.shiftModelId === dienstId,
    );
    expect(startSchicht, `Kein automatisch geplanter Dienst am ${START_ISO} gefunden`).toBeTruthy();
    expect(startSchicht!.userId).toBe(annaId);
    expect(startSchicht!.planningStatus).toBe("VORLAEUFIG");
    expect(startSchicht!.notes).toContain("Automatisch geplant");
  });

  test("Abwesenheit haelt die Person aus der Rotation heraus", async ({ page }) => {
    // Alle automatisch geplanten Dienste wieder abraeumen, damit die Plaetze
    // erneut offen sind; dann Anna am ersten Zieltag krank melden.
    const monat = Number(T1.slice(5, 7));
    const jahr = Number(T1.slice(0, 4));
    const liste = (await (
      await ctx.get(`/api/shifts?month=${monat}&year=${jahr}`)
    ).json()) as { id: number; shiftModelId: number | null }[];
    for (const s of liste.filter((x) => x.shiftModelId === dienstId)) {
      const del = await ctx.delete(`/api/shifts/${s.id}`);
      expect(del.ok(), `Aufraeumen fehlgeschlagen (${del.status()})`).toBe(true);
    }
    const krank = await ctx.post("/api/shifts", {
      data: {
        userId: annaId,
        type: "sick",
        startTime: `${START_ISO}T00:00:00`,
        endTime: `${START_ISO}T23:59:00`,
      },
    });
    expect(krank.ok(), `Krankmeldung fehlgeschlagen (${krank.status()})`).toBe(true);
    const krankId = ((await krank.json()) as { id: number }).id;

    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/dienstplan?date=${T1}`);
    await page.getByTestId("header-overflow").click();
    await page.getByTestId("open-autoplanung").click();
    const dialog = page.getByTestId("autoplanung-dialog");
    await dialog.getByTestId(`autoplanung-person-${annaId}`).click();
    await dialog.getByTestId(`autoplanung-person-${benId}`).click();

    // Anna ist am ersten Plantag krank -> Ben uebernimmt; danach ist Anna
    // regulaer wieder dran.
    await expect(dialog.getByTestId(`autoplanung-tag-${START_ISO}`)).toContainText("Ben Beispiel");
    await expect(dialog.getByTestId(`autoplanung-tag-${START_FOLGETAG}`)).toContainText("Anna Muster");

    // Nicht anlegen — nur die Vorschau war Gegenstand. Krankmeldung abraeumen.
    await page.keyboard.press("Escape");
    const del = await ctx.delete(`/api/shifts/${krankId}`);
    expect(del.ok(), `Krankmeldung abraeumen fehlgeschlagen (${del.status()})`).toBe(true);
  });
});
