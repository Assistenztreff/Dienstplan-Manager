import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  setVertretungEnabled,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Kays Fehlermeldung vom 03.09.2026, Punkte 1–3, am echten Stack.
 *
 * Nachgestellt ist genau seine Lage: ein 24-Stunden-Dienst taeglich, acht
 * Assistenzkraeften mit SEHR unterschiedlichen Vertragsstunden — darunter zwei
 * Aushilfen, deren Monat schon durch Absagen erfuellt ist.
 *
 * Geprueft:
 *  1. Kein Tag bleibt grundlos leer.
 *  2. Wer sein Monats-Soll erfuellt hat, bekommt nichts mehr; niemand landet
 *     mehr als eine Schicht ueber seinem Soll.
 *  3. Ein Abwesenheitstag bleibt frei — auch fuer den 24-Stunden-Dienst des
 *     VORTAGS, der bis in ihn hineinreicht.
 */

const NAECHSTER = (() => {
  const heute = new Date();
  return new Date(heute.getFullYear(), heute.getMonth() + 1, 1, 12);
})();
const MONAT = NAECHSTER.getMonth() + 1;
const JAHR = NAECHSTER.getFullYear();
const TAGE_IM_MONAT = new Date(JAHR, MONAT, 0).getDate();
const tag = (n: number) => `${JAHR}-${String(MONAT).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
const ZIEL_ISO = tag(5);

/** Vertragsstunden je Woche → Monats-Soll ≈ weeklyHours * 4,348. */
const PERSONAL = [
  { kurz: "Neubert", weeklyHours: 44 },
  { kurz: "Kahraman", weeklyHours: 38.5 },
  { kurz: "Thierer", weeklyHours: 27.5 },
  { kurz: "Reller", weeklyHours: 27.5 },
  { kurz: "Appler", weeklyHours: 27.5 },
  { kurz: "Emmendinger", weeklyHours: 27.5 },
  // Die beiden Aushilfen: winziger Vertrag, springen nur im Notfall ein.
  { kurz: "Kennedy", weeklyHours: 5.5 },
  { kurz: "Timo", weeklyHours: 5.5 },
];

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let dienstId = 0;
const ids = new Map<string, number>();

type ShiftRow = {
  id: number;
  userId: number;
  type: string;
  shiftModelId: number | null;
  startTime: string;
  endTime: string;
};

async function schichten(): Promise<ShiftRow[]> {
  const res = await ctx.get(`/api/shifts?month=${MONAT}&year=${JAHR}`);
  expect(res.ok(), `Schichten lesen fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as ShiftRow[];
}

async function raeumeArbeitsdiensteAb(): Promise<void> {
  const weg = (await schichten()).filter((s) => s.type === "work").map((s) => s.id);
  if (weg.length > 0) {
    const res = await ctx.post("/api/shifts/bulk-delete", { data: { ids: weg } });
    expect(res.ok(), `Aufraeumen fehlgeschlagen (${res.status()})`).toBe(true);
  }
}

/**
 * Soll aus der Bilanz, verplante Stunden aus den Schichten selbst. Bewusst
 * NICHT plannedHours der Bilanz: Die zaehlt nur bestaetigte Dienste, die
 * Automatik legt aber Entwuerfe an — mit plannedHours stand hier fuer jede
 * Person 0 h, und „niemand ueber Soll" war immer wahr.
 */
async function monatsSoll(): Promise<Map<number, { soll: number; verplant: number }>> {
  const res = await ctx.get(`/api/dashboard/hours-balance?month=${MONAT}&year=${JAHR}`);
  expect(res.ok(), `Stundenkonto lesen fehlgeschlagen (${res.status()})`).toBe(true);
  const zeilen = (await res.json()) as { userId: number; contractMonthlyTargetHours: number }[];
  const verplant = new Map<number, number>();
  for (const s of await schichten()) {
    if (s.type !== "work") continue;
    const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
    verplant.set(s.userId, (verplant.get(s.userId) ?? 0) + h);
  }
  return new Map(
    zeilen.map((z) => [
      z.userId,
      { soll: z.contractMonthlyTargetHours, verplant: verplant.get(z.userId) ?? 0 },
    ]),
  );
}

async function planeDurch(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.getByTestId("month-grid")).toBeVisible();
  await page.getByTestId("toggle-planungsmodus").click();
  await page.getByTestId("planungsmodus-automatik").click();
  const hinweis = page.locator("[data-sonner-toast]").first();
  await expect(hinweis).toBeVisible({ timeout: 30_000 });
  return (await hinweis.innerText()).replace(/\s+/g, " ");
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "verteilung");
  ctx = acc.ctx;
  await setAccountPlan(acc.email, "premium");

  // Der Vertretungsplatz haengt seit dem 03.09.2026 an der
  // Team-Einstellung, nicht mehr am einzelnen Dienst.
  await setVertretungEnabled(ctx, true);

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  const patch = await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "24-Stunden-Assistenz",
      defaultStartTime: "09:00",
      defaultEndTime: "09:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      standbySlot: true,
      isActive: true,
    },
  });
  expect(patch.ok(), `Dienst vorbereiten fehlgeschlagen (${patch.status()})`).toBe(true);

  const stamp = Date.now();
  for (const p of PERSONAL) {
    const res = await ctx.post("/api/users", {
      data: {
        name: `${p.kurz} Test`,
        email: `e2e.vert.${p.kurz.toLowerCase()}.${stamp}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.ok(), `${p.kurz} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as { id: number }).id;
    ids.set(p.kurz, id);
    const vertrag = await ctx.post("/api/contracts", {
      data: {
        userId: id,
        startDate: `${JAHR - 1}-01-01`,
        weeklyHours: p.weeklyHours,
        vacationDays: 30,
      },
    });
    expect(vertrag.ok(), `Vertrag ${p.kurz} fehlgeschlagen (${vertrag.status()})`).toBe(true);
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test.describe("Automatische Planung — Verteilung nach Monats-Soll", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  });

  test("Punkt 1: der Monat wird lueckenlos besetzt", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeArbeitsdiensteAb();
    const hinweis = await planeDurch(page);
    expect(hinweis, hinweis).toContain("als Entwurf eingeplant");

    const angelegt = (await schichten()).filter((s) => s.shiftModelId === dienstId);
    const besetzteTage = new Set(angelegt.map((s) => s.startTime.slice(0, 10)));
    expect(
      besetzteTage.size,
      `Nur ${besetzteTage.size} von ${TAGE_IM_MONAT} Tagen besetzt — Hinweis: ${hinweis}`,
    ).toBe(TAGE_IM_MONAT);
  });

  test("Punkt 2: niemand liegt mehr als eine Schicht ueber seinem Monats-Soll", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await raeumeArbeitsdiensteAb();
    await planeDurch(page);

    const konto = await monatsSoll();
    const abweichungen: string[] = [];
    for (const [kurz, id] of ids) {
      const zeile = konto.get(id);
      if (!zeile) continue;
      // Eine Schicht Toleranz nach oben (Kays Vorgabe), 24 h je Dienst.
      if (zeile.verplant > zeile.soll + 24.01) {
        abweichungen.push(
          `${kurz}: ${zeile.verplant.toFixed(1)} h verplant bei ${zeile.soll.toFixed(1)} h Soll`,
        );
      }
    }
    expect(abweichungen, abweichungen.join(" · ")).toEqual([]);

    // Und die Gegenprobe: die beiden Aushilfen bekommen hoechstens einen
    // Dienst — ihr Vertrag traegt nicht mehr.
    const angelegt = (await schichten()).filter((s) => s.shiftModelId === dienstId);
    for (const kurz of ["Kennedy", "Timo"]) {
      const anzahl = angelegt.filter((s) => s.userId === ids.get(kurz)).length;
      expect(anzahl, `${kurz} ist eine Aushilfe und darf nicht durchgeplant werden`).toBeLessThanOrEqual(1);
    }
  });

  test("Punkt 2b: wessen Monat schon voll ist, bekommt gar nichts mehr", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeArbeitsdiensteAb();
    // Kennedys Vertrag traegt rund 24 Stunden im Monat. Ein einziger
    // 24-Stunden-Dienst fuellt ihn also komplett — genau Kays Lage mit den
    // Aushilfen, deren Monat schon erfuellt ist.
    const kennedyId = ids.get("Kennedy")!;
    const voll = await ctx.post("/api/shifts", {
      data: {
        userId: kennedyId,
        shiftModelId: dienstId,
        type: "work",
        startTime: `${tag(2)}T09:00:00`,
        endTime: `${tag(3)}T09:00:00`,
      },
    });
    expect(voll.ok(), `Dienst anlegen fehlgeschlagen (${voll.status()})`).toBe(true);
    const vollId = ((await voll.json()) as { id: number }).id;

    const konto = await monatsSoll();
    const kennedy = konto.get(kennedyId)!;
    expect(
      kennedy.verplant,
      "Voraussetzung: Kennedys Monat ist mit diesem einen Dienst erfuellt",
    ).toBeGreaterThanOrEqual(kennedy.soll);

    await planeDurch(page);
    const angelegt = (await schichten()).filter(
      (s) => s.shiftModelId === dienstId && s.id !== vollId,
    );
    expect(
      angelegt.filter((s) => s.userId === kennedyId),
      "Kennedys Monat ist erfuellt — die Automatik darf nichts mehr draufpacken",
    ).toEqual([]);
  });

  test("Punkt 4: auch der ZWEITE Entwurf verteilt nach dem Monats-Soll", async ({ page }) => {
    test.setTimeout(180_000);
    // Kays Fehlermeldung 05.09.2026: „Nach jedem zweiten Entwurf bekommt
    // Camillo Neubert keine Stunden und Timo/Oliver Dienste weit ueber ihrem
    // Soll." Der zweite Lauf raeumt erst die Entwuerfe des ersten ab und plant
    // dann neu — beides in EINEM Durchlauf, React rendert dazwischen nicht.
    // Wer die freien Stunden aus dem Stand von vor dem Abraeumen liest, haelt
    // alle Konten fuer voll: Der Lauf faellt auf den Ersatzweg zurueck und
    // verteilt reihum, statt nach Bedarf. Deshalb wird hier zweimal in
    // derselben Sitzung geplant — ohne Neuladen dazwischen.
    await raeumeArbeitsdiensteAb();
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
    await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
    await page.getByTestId("toggle-planungsmodus").click();

    const knopf = page.getByTestId("planungsmodus-automatik");
    await knopf.click();
    await expect(page.getByText(/als Entwurf eingeplant/).last()).toBeVisible({ timeout: 30_000 });
    const ersterLauf = (await schichten()).filter((s) => s.shiftModelId === dienstId);
    expect(ersterLauf.length, "Voraussetzung: der erste Lauf hat besetzt").toBeGreaterThan(3);

    await expect(knopf).toContainText("Neuer Entwurf");
    await knopf.click();
    // Der zweite Lauf loescht erst und legt dann neu an — abwarten, bis
    // wirklich nur noch neue Eintraege im Monat stehen.
    await expect
      .poll(
        async () => {
          const jetzt = (await schichten()).filter((s) => s.shiftModelId === dienstId);
          return jetzt.length > 3 && jetzt.every((s) => !ersterLauf.some((a) => a.id === s.id));
        },
        { message: "Der zweite Lauf muss den Monat neu besetzen", timeout: 60_000 },
      )
      .toBe(true);

    // Und jetzt dasselbe Mass wie bei Punkt 2 — der zweite Entwurf darf nicht
    // schlechter verteilen als der erste.
    const konto = await monatsSoll();
    const abweichungen: string[] = [];
    for (const [kurz, id] of ids) {
      const zeile = konto.get(id);
      if (!zeile) continue;
      if (zeile.verplant > zeile.soll + 24.01) {
        abweichungen.push(
          `${kurz}: ${zeile.verplant.toFixed(1)} h verplant bei ${zeile.soll.toFixed(1)} h Soll`,
        );
      }
    }
    expect(abweichungen, abweichungen.join(" · ")).toEqual([]);

    // Neubert hat den groessten Vertrag — genau die Person, die bei Kay im
    // zweiten Entwurf mit 0 Stunden dastand.
    const neubert = konto.get(ids.get("Neubert")!)!;
    expect(
      neubert.verplant,
      `Die Vollzeitkraft darf im zweiten Entwurf nicht leer ausgehen (${neubert.verplant} h von ${neubert.soll} h)`,
    ).toBeGreaterThan(neubert.soll / 2);
  });

  test("ein abgewiesener Sammelauftrag kostet nicht den ganzen Monat", async ({ page }) => {
    test.setTimeout(180_000);
    await raeumeArbeitsdiensteAb();

    // Der Server legt einen Sammelauftrag GANZ oder GAR NICHT an und prueft
    // die vorgemerkten Vertretungen monatsweit. Ist eine davon kein
    // Teammitglied mehr oder inzwischen Koordinatorin, weist er den kompletten
    // Monat dieser Person ab — genau so ging Kahraman am 03.09.2026 leer aus.
    // Hier nachgestellt, indem jeder Auftrag MIT Vormerkung abgelehnt wird.
    let abgelehnt = 0;
    await page.route("**/api/shifts/bulk", async (route) => {
      // Der erzeugte Client schickt den Inhalt direkt als Rumpf, ohne die
      // `data`-Huelle des Hooks.
      const body = route.request().postDataJSON() as
        | { days?: { standbyUserId?: number | null }[] }
        | null;
      if (body?.days?.some((d) => d.standbyUserId != null)) {
        abgelehnt += 1;
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "Vertretung gehört nicht zu diesem Team" }),
        });
        return;
      }
      await route.continue();
    });

    const hinweis = await planeDurch(page);
    expect(abgelehnt, "Voraussetzung: mindestens ein Auftrag wurde abgewiesen").toBeGreaterThan(0);
    expect(hinweis, hinweis).toContain("als Entwurf eingeplant");
    expect(hinweis, hinweis).toContain("ohne vorgemerkte Vertretung");

    const angelegt = (await schichten()).filter((s) => s.shiftModelId === dienstId);
    const besetzteTage = new Set(angelegt.map((s) => s.startTime.slice(0, 10)));
    expect(
      besetzteTage.size,
      `Trotz abgewiesener Vormerkungen muss der Monat stehen — Hinweis: ${hinweis}`,
    ).toBe(TAGE_IM_MONAT);
  });

  test("Punkt 3: ein Abwesenheitstag sperrt auch den Dienst des Vortags", async ({ page }) => {
    test.setTimeout(180_000);
    // Deterministisch aufgebaut: Erst planen und schauen, WER den 3. bekommt.
    // Dann alles abraeumen, genau dieser Person am 4. einen Wunschfrei-Tag
    // geben und erneut planen. Wunschfrei ist mit Absicht gewaehlt: Es
    // verbraucht keine Vertragszeit, die Ausgangslage der Verteilung bleibt
    // also exakt dieselbe. Bekommt die Person den 3. trotzdem wieder, laeuft
    // ihr 24-Stunden-Dienst bis 09:00 in den freien Tag hinein — genau der
    // Fehler aus Kays Punkt 3.
    await raeumeArbeitsdiensteAb();
    await planeDurch(page);
    const ersterLauf = (await schichten()).filter((s) => s.shiftModelId === dienstId);
    const amDritten = ersterLauf.find((s) => s.startTime.slice(0, 10) === tag(3));
    expect(amDritten, `Voraussetzung: der ${tag(3)} ist besetzt`).toBeTruthy();
    const betroffen = amDritten!.userId;

    await raeumeArbeitsdiensteAb();
    const frei = await ctx.post("/api/shifts", {
      data: {
        userId: betroffen,
        type: "wunschfrei",
        startTime: `${tag(4)}T00:00:00`,
        endTime: `${tag(4)}T23:59:00`,
      },
    });
    expect(frei.ok(), `Wunschfrei anlegen fehlgeschlagen (${frei.status()})`).toBe(true);
    const freiId = ((await frei.json()) as { id: number }).id;

    await planeDurch(page);
    const zweiterLauf = (await schichten()).filter((s) => s.shiftModelId === dienstId);
    expect(
      zweiterLauf.some((s) => s.userId === betroffen && s.startTime.slice(0, 10) === tag(4)),
      "Am freien Tag selbst darf niemand eingeteilt sein",
    ).toBe(false);
    expect(
      zweiterLauf.some((s) => s.userId === betroffen && s.startTime.slice(0, 10) === tag(3)),
      "Der 24-Stunden-Dienst des Vortags reicht bis 09:00 in den freien Tag hinein",
    ).toBe(false);

    await ctx.delete(`/api/shifts/${freiId}`);
  });
});
