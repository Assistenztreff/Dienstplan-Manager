import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Zeitumstellung: Ein 24-Stunden-Dienst ueber die Umstellung hinweg.
 *
 * Kay-Fehlermeldung 03.09.2026. Die automatische Planung besetzte den Oktober;
 * der Sammelauftrag EINER Person wurde mit 400 abgewiesen („Ende muss nach dem
 * Beginn liegen und innerhalb eines Kalendertags enden"). Da ein Sammelauftrag
 * ganz oder gar nicht angelegt wird, verlor diese Person ihren kompletten
 * Monat — sieben Tage blieben leer.
 *
 * Ursache: Am Ende der Sommerzeit dauert ein 09:00–09:00-Dienst real 25
 * Stunden, im Fruehjahr nur 23. Die Pruefung rechnete in Millisekunden und
 * hielt den 25-Stunden-Dienst fuer einen Mehrtages-Dienst.
 *
 * Der Test sucht die NAECHSTE echte Umstellung ab heute — kein festes Datum,
 * das in einem Jahr verrottet.
 */

const ZEITZONE = "Europe/Berlin";

/** Abstand der Berliner Ortszeit zur Weltzeit, in Minuten. */
function versatzMinuten(zeitpunkt: Date): number {
  const alsUtc = new Date(zeitpunkt.toLocaleString("en-US", { timeZone: "UTC" }));
  const alsOrt = new Date(zeitpunkt.toLocaleString("en-US", { timeZone: ZEITZONE }));
  return Math.round((alsOrt.getTime() - alsUtc.getTime()) / 60000);
}

/** Berliner Kalenderdatum ("YYYY-MM-DD") eines Zeitpunkts. */
function berlinerDatum(zeitpunkt: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: ZEITZONE }).format(zeitpunkt);
}

function alsOffset(minuten: number): string {
  const zeichen = minuten < 0 ? "-" : "+";
  const abs = Math.abs(minuten);
  return `${zeichen}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Der naechste Tag ab heute, an dessen FOLGETAG die Uhr umgestellt wird —
 * also genau der Dienst, der ueber die Umstellung laeuft. Gesucht wird bis zu
 * 400 Tage voraus; zwei Umstellungen im Jahr heissen hoechstens ein halbes
 * Jahr Vorlauf.
 */
function naechsterUmstellungsDienst(): { start: string; ende: string; real: number } {
  const heute = new Date();
  for (let i = 1; i < 400; i++) {
    const tag = new Date(heute.getTime() + i * 86_400_000);
    const folgetag = new Date(heute.getTime() + (i + 1) * 86_400_000);
    const v1 = versatzMinuten(tag);
    const v2 = versatzMinuten(folgetag);
    if (v1 === v2) continue;
    const start = `${berlinerDatum(tag)}T09:00:00${alsOffset(v1)}`;
    const ende = `${berlinerDatum(folgetag)}T09:00:00${alsOffset(v2)}`;
    return {
      start,
      ende,
      real: (new Date(ende).getTime() - new Date(start).getTime()) / 3_600_000,
    };
  }
  throw new Error("Keine Zeitumstellung in den naechsten 400 Tagen gefunden");
}

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let userId = 0;
let dienstId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "zeitumstellung");
  ctx = acc.ctx;
  // Premium: Die naechste Umstellung kann bis zu einem halben Jahr voraus
  // liegen, und Free darf nur einen Monat vorausplanen.
  await setAccountPlan(acc.email, "premium");

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  const res = await ctx.post("/api/users", {
    data: {
      name: "Dora Umstellung",
      email: `e2e.dst.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Assistenzkraft anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  userId = ((await res.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Sammel-Anlage nimmt den 24-Stunden-Dienst ueber die Zeitumstellung an", async () => {
  const { start, ende, real } = naechsterUmstellungsDienst();
  // Voraussetzung des Tests: Es geht wirklich um eine Umstellung.
  expect([23, 25], `Real vergehen ${real} Stunden (${start} → ${ende})`).toContain(real);

  const res = await ctx.post("/api/shifts/bulk", {
    data: {
      userId,
      type: "work",
      shiftModelId: dienstId,
      planningStatus: "VORLAEUFIG",
      days: [{ startTime: start, endTime: ende }],
    },
  });
  expect(
    res.ok(),
    `Der Dienst ${start} → ${ende} dauert real ${real} h, auf der Uhr aber 24 — er muss angenommen werden. Antwort ${res.status()}: ${await res.text()}`,
  ).toBe(true);

  const angelegt = (await res.json()) as { shifts: { id: number }[] };
  expect(angelegt.shifts).toHaveLength(1);
  await ctx.post("/api/shifts/bulk-delete", {
    data: { ids: angelegt.shifts.map((s) => s.id) },
  });
});

test("Sammel-Anlage weist einen echten Mehrtages-Dienst weiterhin ab", async () => {
  const { start } = naechsterUmstellungsDienst();
  const zweiTageSpaeter = new Date(new Date(start).getTime() + 2 * 86_400_000);
  const ende = `${berlinerDatum(zweiTageSpaeter)}T09:00:00${alsOffset(versatzMinuten(zweiTageSpaeter))}`;

  const res = await ctx.post("/api/shifts/bulk", {
    data: {
      userId,
      type: "work",
      shiftModelId: dienstId,
      planningStatus: "VORLAEUFIG",
      days: [{ startTime: start, endTime: ende }],
    },
  });
  expect(res.status(), "Zwei Tage sind kein Tagesdienst").toBe(400);
  expect(await res.text()).toContain("innerhalb eines Kalendertags");
});
