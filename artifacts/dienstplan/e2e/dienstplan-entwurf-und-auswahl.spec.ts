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
 * Kays Rueckmeldung vom 05.09.2026, Punkte 2 und 4-7 am echten Stack.
 *
 * Alles dreht sich um die Frage, WAS ein neuer Entwurf anfassen darf und was
 * die Mehrfachauswahl damit zu tun hat:
 *  2. Nach einem Monatswechsel muss sich weiter neu wuerfeln lassen; nur
 *     Entwuerfe werden abgeraeumt, nie Versendetes oder Bestaetigtes.
 *  4. Bestaetigen schliesst die Auswahl.
 *  5. Monatswechsel schliesst die Auswahl.
 *  6. Abgewaehlte Dienste ueberleben einen neuen Entwurf.
 *  7. Der Personenfilter erzeugt keine Platzhalter fuer besetzte Dienste.
 */

const NAECHSTER = (() => {
  const heute = new Date();
  return new Date(heute.getFullYear(), heute.getMonth() + 1, 1, 12);
})();
const MONAT = NAECHSTER.getMonth() + 1;
const JAHR = NAECHSTER.getFullYear();
const tag = (n: number) => `${JAHR}-${String(MONAT).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
const ZIEL_ISO = tag(5);

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
const dienstIds: number[] = [];
const personIds: number[] = [];

type ShiftRow = {
  id: number;
  userId: number;
  type: string;
  planningStatus: string;
  shiftModelId: number | null;
  startTime: string;
  endTime: string;
};

async function schichten(): Promise<ShiftRow[]> {
  const res = await ctx.get(`/api/shifts?month=${MONAT}&year=${JAHR}`);
  expect(res.ok(), `Schichten lesen fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as ShiftRow[];
}

async function raeumeAb(): Promise<void> {
  const weg = (await schichten()).map((s) => s.id);
  if (weg.length > 0) await ctx.post("/api/shifts/bulk-delete", { data: { ids: weg } });
}

/** Wartet, bis der Lauf durch ist: Hinweis sichtbar UND Zahl stabil. */
async function planeUndWarte(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("planungsmodus-automatik").click();
  await expect(page.locator("[data-sonner-toast]").last()).toBeVisible({ timeout: 30_000 });
  let vorher = -1;
  await expect
    .poll(
      async () => {
        const jetzt = (await schichten()).length;
        const stabil = jetzt === vorher && jetzt > 0;
        vorher = jetzt;
        return stabil;
      },
      { message: "Der Lauf muss zur Ruhe kommen", timeout: 40_000 },
    )
    .toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "entwurfauswahl");
  ctx = acc.ctx;
  await setAccountPlan(acc.email, "premium");

  // Drei-Schicht-Modell — genau Kays Aufbau.
  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  const schichten3 = [
    { name: "Frühschicht", defaultStartTime: "06:00", defaultEndTime: "14:00", sortOrder: 1 },
    { name: "Spätschicht", defaultStartTime: "14:00", defaultEndTime: "22:00", sortOrder: 2 },
    { name: "Nachtschicht", defaultStartTime: "22:00", defaultEndTime: "06:00", sortOrder: 3 },
  ];
  for (const [i, m] of schichten3.entries()) {
    const daten = {
      ...m,
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: false,
      isActive: true,
    };
    if (models[i]) {
      const res = await ctx.patch(`/api/shift-models/${models[i]!.id}`, { data: daten });
      expect(res.ok(), `Dienst ${m.name} anpassen (${res.status()})`).toBe(true);
      dienstIds.push(models[i]!.id);
    } else {
      const res = await ctx.post("/api/shift-models", { data: daten });
      expect(res.ok(), `Dienst ${m.name} anlegen (${res.status()})`).toBe(true);
      dienstIds.push(((await res.json()) as { id: number }).id);
    }
  }
  // Alle weiteren Dienste aus dem Regelplan nehmen, damit die Zelle genau
  // drei Plaetze kennt.
  for (const m of models.slice(schichten3.length)) {
    await ctx.patch(`/api/shift-models/${m.id}`, { data: { imRegelplan: false } });
  }

  const stamp = Date.now();
  for (const name of ["Anna Muster", "Ben Beispiel", "Clara Test", "Dora Vier"]) {
    const res = await ctx.post("/api/users", {
      data: {
        name,
        email: `e2e.ea.${name.split(" ")[0]!.toLowerCase()}.${stamp}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.ok(), `${name} anlegen (${res.status()})`).toBe(true);
    personIds.push(((await res.json()) as { id: number }).id);
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test.describe("Entwurf und Mehrfachauswahl", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  });

  test("Punkt 2: nach einem Monatswechsel laesst sich weiter neu wuerfeln", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();
    await planeUndWarte(page);
    const erster = await schichten();
    expect(erster.length, "Voraussetzung: der Monat ist gefuellt").toBeGreaterThan(3);

    // Einen Monat vor und wieder zurueck — der Knopf darf sich nicht
    // „vergessen", nur weil ein State beim Wechsel geleert wurde.
    await page.getByTestId("next-month").click();
    await page.waitForTimeout(500);
    await page.getByTestId("prev-month").click();
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();

    const knopf = page.getByTestId("planungsmodus-automatik");
    await expect(knopf, "Der Monat steht voller Entwuerfe — der Knopf muss das wissen").toContainText(
      "Neuer Entwurf",
    );
    await knopf.click();
    await expect
      .poll(
        async () => {
          const jetzt = await schichten();
          return jetzt.length > 3 && jetzt.every((s) => !erster.some((a) => a.id === s.id));
        },
        { message: "Auch nach dem Monatswechsel muss neu gewuerfelt werden", timeout: 60_000 },
      )
      .toBe(true);
    await expect(page.getByText("Alles besetzt")).toHaveCount(0);
  });

  test("Punkt 2b: Versendetes und Bestaetigtes fasst der Lauf nie an", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();
    await planeUndWarte(page);

    // Je einen Dienst versenden und bestaetigen.
    const vorher = await schichten();
    const fix = vorher[0]!;
    const angeboten = vorher[1]!;
    for (const [s, status] of [
      [fix, "FIX"],
      [angeboten, "ANGEBOTEN"],
    ] as const) {
      const res = await ctx.patch(`/api/shifts/${s.id}`, {
        data: { planningStatus: status, force: true },
      });
      expect(res.ok(), `Status ${status} setzen (${res.status()})`).toBe(true);
    }
    await page.reload();
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();

    // Mitschreiben, WAS der Lauf loeschen will. Der Server wuerde bestaetigte
    // Dienste ohnehin schuetzen — geprueft wird hier, dass die Oberflaeche sie
    // gar nicht erst anfasst.
    const loeschVersuche: number[] = [];
    await page.route("**/api/shifts/bulk-delete", async (route) => {
      const body = route.request().postDataJSON() as { ids?: number[] } | null;
      loeschVersuche.push(...(body?.ids ?? []));
      await route.continue();
    });

    await page.getByTestId("planungsmodus-automatik").click();
    await expect(page.locator("[data-sonner-toast]").last()).toBeVisible({ timeout: 30_000 });
    expect(loeschVersuche.length, "Voraussetzung: der Lauf raeumt ueberhaupt ab").toBeGreaterThan(0);
    expect(
      loeschVersuche.includes(fix.id),
      "Ein bestaetigter Dienst darf nicht einmal zum Loeschen angeboten werden",
    ).toBe(false);
    expect(
      loeschVersuche.includes(angeboten.id),
      "Ein versendeter Dienst darf nicht einmal zum Loeschen angeboten werden",
    ).toBe(false);

    await expect
      .poll(
        async () => {
          const jetzt = await schichten();
          const beide = jetzt.filter((s) => s.id === fix.id || s.id === angeboten.id);
          return beide.length;
        },
        {
          message: "Der bestaetigte und der versendete Dienst muessen stehen bleiben",
          timeout: 40_000,
        },
      )
      .toBe(2);
    const danach = await schichten();
    expect(danach.find((s) => s.id === fix.id)!.userId).toBe(fix.userId);
    expect(danach.find((s) => s.id === angeboten.id)!.userId).toBe(angeboten.userId);
  });

  test("Punkt 6: abgewaehlte Dienste ueberleben den neuen Entwurf", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();
    await planeUndWarte(page);
    const erster = await schichten();

    // Auswahl oeffnen (waehlt alles), dann zwei Pillen wieder abwaehlen.
    await page.getByTestId("planungsmodus-auswahl").click();
    const behalten = erster.slice(0, 2);
    for (const s of behalten) await desktop.getByTestId(`day-chip-${s.id}`).click();

    await page.getByTestId("planungsmodus-automatik").click();
    await expect(page.locator("[data-sonner-toast]").last()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const jetzt = await schichten();
          return behalten.every((b) => jetzt.some((s) => s.id === b.id));
        },
        { message: "Abgewaehlte Dienste darf der neue Entwurf nicht wegwerfen", timeout: 40_000 },
      )
      .toBe(true);
    const danach = await schichten();
    for (const b of behalten) {
      expect(danach.find((s) => s.id === b.id)!.userId, "unveraendert").toBe(b.userId);
    }
  });

  test("Punkt 4: Bestaetigen schliesst die Mehrfachauswahl", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();
    await planeUndWarte(page);

    await page.getByTestId("planungsmodus-auswahl").click();
    const bestaetigen = page.getByTestId("planungsmodus-bestaetigen");
    await expect(bestaetigen).toBeVisible();
    await bestaetigen.click();
    await expect(
      bestaetigen,
      "Nach dem Bestaetigen ist die Auswahl erledigt und schliesst sich",
    ).toHaveCount(0);
    await expect(page.getByTestId("planungsmodus-auswahl")).not.toContainText(/\d/);
  });

  test("Punkt 5: der Monatswechsel schliesst die Mehrfachauswahl", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();
    await planeUndWarte(page);
    const vorher = await schichten();

    await page.getByTestId("planungsmodus-auswahl").click();
    await expect(page.getByTestId("planungsmodus-bestaetigen")).toBeVisible();
    await page.getByTestId("next-month").click();
    await expect(
      page.getByTestId("planungsmodus-bestaetigen"),
      "Im neuen Monat darf keine Auswahl des Vormonats mehr offen sein",
    ).toHaveCount(0);

    // Und der Loeschen-Knopf der alten Auswahl ist ebenfalls weg — er haette
    // sonst die Dienste des Vormonats getroffen.
    await expect(page.getByTestId("planungsmodus-loeschen")).toHaveCount(0);
    expect((await schichten()).length, "Der Vormonat bleibt unangetastet").toBe(vorher.length);
  });

  test("Punkt 7: der Personenfilter erzeugt keine Platzhalter fuer besetzte Dienste", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await raeumeAb();
    // Alle drei Schichten des 8. mit DREI verschiedenen Personen besetzen.
    const datum = tag(8);
    const zeiten = [
      ["06:00:00", "14:00:00", 0],
      ["14:00:00", "22:00:00", 0],
      ["22:00:00", "06:00:00", 1],
    ] as const;
    for (const [i, [von, bis, plus]] of zeiten.entries()) {
      const ende = plus === 0 ? datum : tag(9);
      const res = await ctx.post("/api/shifts", {
        data: {
          userId: personIds[i]!,
          shiftModelId: dienstIds[i]!,
          type: "work",
          startTime: `${datum}T${von}`,
          endTime: `${ende}T${bis}`,
        },
      });
      expect(res.ok(), `Dienst ${i} anlegen (${res.status()})`).toBe(true);
    }

    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    // Ohne Filter: alle drei besetzt, kein Platz offen.
    for (const id of dienstIds) {
      await expect(desktop.getByTestId(`day-slot-${datum}-${id}`)).toHaveCount(0);
    }

    // Jetzt NUR die Person des Nachtdienstes anzeigen. Ihre Pille bleibt —
    // die beiden anderen Dienste sind ausgeblendet, aber besetzt.
    // Panel und Reihe haengen beide im DOM — das sichtbare Panel nehmen.
    const panel = page.getByTestId("stundenkonto-panel-wrapper");
    await panel.getByTestId("stundenkonto-alle").click();
    await panel.getByTestId(`stundenkonto-pill-${personIds[2]}`).click();
    await expect(desktop.getByTestId("month-grid")).toBeVisible();

    for (const id of dienstIds) {
      await expect(
        desktop.getByTestId(`day-slot-${datum}-${id}`),
        `Der Dienst ${id} ist besetzt — der Filter darf keinen offenen Platz erfinden`,
      ).toHaveCount(0);
    }
  });
});
