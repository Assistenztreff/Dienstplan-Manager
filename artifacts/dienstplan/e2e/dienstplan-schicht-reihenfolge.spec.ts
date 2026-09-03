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
 * Kay-Fehlermeldungen 03.09.2026, Punkte 4 und 5.
 *
 * 5. Im Drei-Schicht-Modell rutschte der Nachtdienst nach oben, sobald Frueh-
 *    und Spaetdienst am selben Tag noch offen waren. Dienste muessen immer
 *    nach Uhrzeit stehen — besetzt oder offen.
 * 4. Ein Klick auf eine Pille im Planungsmodus loeschte den Dienst, sobald der
 *    Rundlauf durch war. Er soll nur noch die Person wechseln.
 */

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

const SCHICHTEN = [
  { name: "Frühdienst", start: "06:00", ende: "14:00" },
  { name: "Spätdienst", start: "14:00", ende: "22:00" },
  { name: "Nachtdienst", start: "22:00", ende: "06:00" },
];

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
const modellIds: number[] = [];
const personen: { id: number; name: string }[] = [];

async function schichtenDesMonats() {
  const monat = Number(ZIEL_ISO.slice(5, 7));
  const jahr = Number(ZIEL_ISO.slice(0, 4));
  const res = await ctx.get(`/api/shifts?month=${monat}&year=${jahr}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: number; userId: number; shiftModelId: number | null }[];
}

async function raeumeAb() {
  const ids = (await schichtenDesMonats()).map((s) => s.id);
  if (ids.length > 0) await ctx.post("/api/shifts/bulk-delete", { data: { ids } });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "reihenfolge");
  ctx = acc.ctx;
  await setAccountPlan(acc.email, "premium");

  // Drei Schichtmodelle, alle im Regelplan und an jedem Wochentag.
  const vorhanden = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  for (const [i, s] of SCHICHTEN.entries()) {
    const daten = {
      name: s.name,
      defaultStartTime: s.start,
      defaultEndTime: s.ende,
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: false,
      isActive: true,
      sortOrder: i,
    };
    if (vorhanden[i]) {
      const res = await ctx.patch(`/api/shift-models/${vorhanden[i]!.id}`, { data: daten });
      expect(res.ok(), await res.text()).toBe(true);
      modellIds.push(vorhanden[i]!.id);
    } else {
      const res = await ctx.post("/api/shift-models", { data: daten });
      expect(res.ok(), await res.text()).toBe(true);
      modellIds.push(((await res.json()) as { id: number }).id);
    }
  }
  // Alle uebrigen Modelle aus dem Regelplan nehmen, damit die Zelle genau
  // drei Zeilen zeigt.
  for (const m of vorhanden.slice(SCHICHTEN.length)) {
    await ctx.patch(`/api/shift-models/${m.id}`, { data: { imRegelplan: false, isActive: false } });
  }

  const stamp = Date.now();
  for (const name of ["Anna Muster", "Ben Beispiel", "Clara Test"]) {
    const res = await ctx.post("/api/users", {
      data: {
        name,
        email: `e2e.reihe.${name.split(" ")[0]}.${stamp}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    personen.push({ id: ((await res.json()) as { id: number }).id, name });
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Punkt 5: der Nachtdienst bleibt unten, auch wenn Früh und Spät offen sind", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await raeumeAb();
  // NUR den Nachtdienst besetzen — Frueh und Spaet bleiben offene Plaetze.
  const res = await ctx.post("/api/shifts", {
    data: {
      userId: personen[0]!.id,
      shiftModelId: modellIds[2],
      type: "work",
      startTime: `${ZIEL_ISO}T22:00:00`,
      endTime: `${ZIEL_ISO}T06:00:00`,
      planningStatus: "VORLAEUFIG",
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const nachtId = ((await res.json()) as { id: number }).id;

  await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.getByTestId("month-grid")).toBeVisible();

  const frueh = desktop.getByTestId(`day-slot-${ZIEL_ISO}-${modellIds[0]}`);
  const spaet = desktop.getByTestId(`day-slot-${ZIEL_ISO}-${modellIds[1]}`);
  const nacht = desktop.getByTestId(`day-chip-${nachtId}`);
  await expect(frueh).toBeVisible();
  await expect(spaet).toBeVisible();
  await expect(nacht).toBeVisible();

  // Gemessen wird die SICHTBARE Lage, nicht die Reihenfolge im Dokument:
  // Die Zelle ordnet ueber CSS, damit der Zellen-Aufbau unangetastet bleibt.
  const yVon = async (l: ReturnType<typeof desktop.getByTestId>) => {
    const box = await l.boundingBox();
    expect(box, "Element muss sichtbar sein").not.toBeNull();
    return box!.y;
  };
  const [yFrueh, ySpaet, yNacht] = await Promise.all([yVon(frueh), yVon(spaet), yVon(nacht)]);
  expect(yFrueh, `Früh (06:00) muss über Spät (14:00) stehen`).toBeLessThan(ySpaet);
  expect(
    ySpaet,
    `Spät (14:00) muss über dem Nachtdienst (22:00) stehen — der rutschte vorher nach oben`,
  ).toBeLessThan(yNacht);
});

test("Punkt 4: ein Klick auf die Pille wechselt die Person und löscht sie nie", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await raeumeAb();
  const res = await ctx.post("/api/shifts", {
    data: {
      userId: personen[0]!.id,
      shiftModelId: modellIds[0],
      type: "work",
      startTime: `${ZIEL_ISO}T06:00:00`,
      endTime: `${ZIEL_ISO}T14:00:00`,
      planningStatus: "VORLAEUFIG",
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const schichtId = ((await res.json()) as { id: number }).id;

  await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.getByTestId("month-grid")).toBeVisible();
  await page.getByTestId("toggle-planungsmodus").click();

  const pille = desktop.getByTestId(`day-chip-${schichtId}`);
  await expect(pille).toContainText("Anna");

  // Vier Klicks bei drei Personen: einmal ganz herum und einen darueber
  // hinaus. Frueher war der Dienst nach dem dritten Klick geloescht.
  await pille.click();
  await expect(pille).toContainText("Ben");
  await pille.click();
  await expect(pille).toContainText("Clara");
  await pille.click();
  await expect(pille, "nach der letzten Person faengt der Rundlauf wieder vorn an").toContainText(
    "Anna",
  );
  await pille.click();
  await expect(pille).toContainText("Ben");

  const uebrig = await schichtenDesMonats();
  expect(uebrig.map((s) => s.id), "Der Dienst darf nie verschwinden").toEqual([schichtId]);
  expect(uebrig[0]!.userId).toBe(personen[1]!.id);
});
