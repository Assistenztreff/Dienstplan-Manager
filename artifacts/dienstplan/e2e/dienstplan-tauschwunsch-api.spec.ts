import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { BASE_URL, deleteFreeAccount, registerFreeAccount, setAccountPlan, type FreeAccount } from "./helpers/teams";

/**
 * TAUSCHWUNSCH: "Kann dieser Dienst getauscht werden?"
 *
 * Die Regel in Worten:
 *   1. Nur der EIGENE, KÜNFTIGE Arbeitsdienst lässt sich zum Tausch anbieten.
 *      Fremde Dienste liefern 404 (nicht 403), damit sie nicht ausspähbar sind.
 *   2. Abwesenheiten und Teamsitzungen sind keine tauschbaren Dienste.
 *   3. Ein vergangener Dienst ist kein Tausch-, sondern ein Abweichungsfall.
 *   4. Ein Entwurf wurde der Assistenzkraft noch gar nicht zugesagt.
 *   5. Nur EIN offener Wunsch je Dienst; ist er erledigt, geht ein neuer.
 *   6. Der Planer schließt ihn ab (umbesetzt oder abgelehnt) — die Route
 *      rührt die Schicht dabei NICHT an, das Umbesetzen bleibt bei
 *      PATCH /shifts/:id.
 *   7. Eine Assistenzkraft sieht nur ihre eigenen Wünsche: der Grund ist oft
 *      privat ("Arzttermin") und geht Kolleginnen nichts an.
 *
 * Warum dieser Test existiert: Der Tauschwunsch kam mit eigener Tabelle und
 * drei Routen ins Repo, hatte aber weder Unit- noch E2E-Abdeckung. Die
 * Arbeitsregel seit dem 29.08.2026 lautet: keine Funktionsänderung ohne
 * E2E-Lauf — das gilt auch für Code, der schon gepusht ist.
 *
 * Datumsfest: die Dienste liegen relativ zu heute, nie auf festen Kalendertagen.
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantCtx: APIRequestContext;
let assistantId: number;
// Zweite Assistenzkraft: OHNE sie waere die Sichtbarkeits-Zusicherung nicht
// pruefbar — bei nur einer Person ist "alle Wuensche des Teams" zufaellig
// dasselbe wie "meine Wuensche", und der Test bliebe auch dann gruen, wenn
// die Regel ausgebaut waere (genau so gemessen).
let kolleginCtx: APIRequestContext;
let kolleginId: number;

/** Zeitfenster an einem Tag, der `tageVersatz` Tage von heute entfernt liegt. */
function dienstZeit(tageVersatz: number, vonStunde = 8, bisStunde = 16) {
  const tag = new Date();
  tag.setDate(tag.getDate() + tageVersatz);
  const iso = (stunde: number) =>
    new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), stunde, 0, 0).toISOString();
  return { startTime: iso(vonStunde), endTime: iso(bisStunde) };
}

async function dienstAnlegen(
  tageVersatz: number,
  extra: Record<string, unknown> = {},
  vonStunde = 8,
  bisStunde = 16,
): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      shiftModelId: null,
      ...dienstZeit(tageVersatz, vonStunde, bisStunde),
      ...extra,
    },
  });
  expect(res.status(), `Dienst-Anlage sollte 201 liefern (${await res.text()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

function tauschWunsch(shiftId: number, grund = "Arzttermin an dem Tag") {
  return assistantCtx.post(`/api/shifts/${shiftId}/swap-request`, {
    data: { reason: grund },
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "tauschwunsch");
  // Premium: der Einladungsflow (echter Login der Assistenzkraft) ist gegated.
  await setAccountPlan(acc.email, "premium");

  const angemeldeteKraft = async (kennung: string) => {
    const createRes = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Tausch ${kennung} ${Date.now()}`,
        email: `e2e.tausch.${kennung}.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(createRes.status(), `Assistenzkraft sollte 201 liefern (${await createRes.text()})`).toBe(201);
    const id = ((await createRes.json()) as { id: number }).id;

    const inviteRes = await acc.ctx.post(`/api/users/${id}/invite`);
    expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
    const token = ((await inviteRes.json()) as { token: string }).token;
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const setPwRes = await ctx.post("/api/auth/set-password", {
      data: { token, password: "assistent1234" },
    });
    expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
    return { id, ctx };
  };

  const erste = await angemeldeteKraft("a");
  assistantId = erste.id;
  assistantCtx = erste.ctx;
  const zweite = await angemeldeteKraft("b");
  kolleginId = zweite.id;
  kolleginCtx = zweite.ctx;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
  for (const ctx of [assistantCtx, kolleginCtx]) {
    try {
      await ctx?.dispose();
    } catch {
      /* ignore */
    }
  }
});

test("der volle Kreislauf: wuenschen → zweiter Wunsch blockiert → erledigt → neuer Wunsch moeglich", async () => {
  test.setTimeout(120_000);
  const shiftId = await dienstAnlegen(7);

  const erster = await tauschWunsch(shiftId);
  expect(erster.status(), `Erster Wunsch sollte 201 liefern (${await erster.text()})`).toBe(201);
  const angelegt = (await erster.json()) as { status: string; reason: string; userName: string | null };
  expect(angelegt.status).toBe("OPEN");
  expect(angelegt.reason, "Der Grund gehoert in den Datensatz").toBe("Arzttermin an dem Tag");

  // Nur EIN offener Wunsch je Dienst.
  const zweiter = await tauschWunsch(shiftId, "Nochmal");
  expect(zweiter.status(), "Zweiter offener Wunsch muss 409 sein").toBe(409);

  // Der Planer lehnt ab — die Schicht bleibt dabei unangetastet.
  const vorher = (await (await acc.ctx.get(`/api/shifts/${shiftId}`)).json()) as {
    planningStatus: string;
    userId: number;
  };
  const abgelehnt = await acc.ctx.post(`/api/shifts/${shiftId}/swap-request/resolve`, {
    data: { resolution: "DECLINED", note: "Niemand frei an dem Tag" },
  });
  expect(abgelehnt.status(), `Abschliessen sollte 200 liefern (${await abgelehnt.text()})`).toBe(200);
  const erledigt = (await abgelehnt.json()) as { status: string; resolution: string; resolutionNote: string | null };
  expect(erledigt.status).toBe("RESOLVED");
  expect(erledigt.resolution).toBe("DECLINED");
  expect(erledigt.resolutionNote).toBe("Niemand frei an dem Tag");

  const nachher = (await (await acc.ctx.get(`/api/shifts/${shiftId}`)).json()) as {
    planningStatus: string;
    userId: number;
  };
  expect(
    nachher.planningStatus,
    "Der Tauschwunsch darf den Dienst-Status NICHT anfassen",
  ).toBe(vorher.planningStatus);
  expect(nachher.userId, "Und die zugewiesene Person auch nicht").toBe(vorher.userId);

  // Zweimal abschliessen geht nicht — sonst uebschriebe ein zweiter Klick
  // eine bereits getroffene Entscheidung.
  const nochmal = await acc.ctx.post(`/api/shifts/${shiftId}/swap-request/resolve`, {
    data: { resolution: "REASSIGNED" },
  });
  expect(nochmal.status(), "Ein erledigter Wunsch laesst sich nicht erneut abschliessen").toBe(409);

  // Aber ein NEUER Wunsch zum selben Dienst ist wieder moeglich: die Lage
  // kann sich geaendert haben.
  const dritter = await tauschWunsch(shiftId, "Doch noch ein Termin dazwischen");
  expect(
    dritter.status(),
    `Nach Erledigung muss ein neuer Wunsch gehen (${await dritter.text()})`,
  ).toBe(201);
});

test("abgewiesen wird, was kein eigener, kuenftiger Arbeitsdienst ist", async () => {
  test.setTimeout(120_000);

  // Vergangener Dienst -> dafuer gibt es die Abweichungsmeldung.
  const vergangen = await dienstAnlegen(-3);
  const resVergangen = await tauschWunsch(vergangen);
  expect(resVergangen.status(), "Vergangener Dienst ist kein Tauschfall").toBe(400);
  expect(((await resVergangen.json()) as { code?: string }).code).toBe("swap_shift_past");

  // Entwurf -> wurde der Assistenzkraft noch gar nicht zugesagt.
  const entwurf = await dienstAnlegen(8, { planningStatus: "VORLAEUFIG" });
  const resEntwurf = await tauschWunsch(entwurf);
  expect(resEntwurf.status(), "Ein Entwurf ist noch nichts, was man tauschen koennte").toBe(400);
  expect(((await resEntwurf.json()) as { code?: string }).code).toBe("swap_shift_draft");

  // Abwesenheit -> kein Arbeitsdienst.
  const urlaub = await dienstAnlegen(9, { type: "vacation" }, 0, 23);
  const resUrlaub = await tauschWunsch(urlaub);
  expect(resUrlaub.status(), "Urlaub ist kein tauschbarer Dienst").toBe(400);
  expect(((await resUrlaub.json()) as { code?: string }).code).toBe("swap_invalid_shift");

  // Fremde/unbekannte Dienst-ID -> 404, nicht 403 (nicht ausspaehbar).
  const fremd = await assistantCtx.post("/api/shifts/99999999/swap-request", {
    data: { reason: "Test" },
  });
  expect(fremd.status(), "Fremde Dienst-IDs duerfen nicht ausspaehbar sein").toBe(404);

  // Ohne Grund geht es nicht: ohne ihn kann der Planer nicht abwaegen.
  const kuenftig = await dienstAnlegen(10);
  const ohneGrund = await assistantCtx.post(`/api/shifts/${kuenftig}/swap-request`, {
    data: { reason: "" },
  });
  expect(ohneGrund.status(), "Ein Tauschwunsch ohne Begruendung ist keiner").toBe(400);
});

test("die Assistenzkraft sieht nur ihre eigenen Wuensche, der Planer alle", async () => {
  test.setTimeout(120_000);

  // Beide Kraefte aeussern je einen Wunsch — erst dadurch ist ueberhaupt
  // messbar, ob die Trennung greift.
  const meiner = await dienstAnlegen(11);
  expect((await tauschWunsch(meiner, "Familienfeier")).status()).toBe(201);

  const ihrer = await dienstAnlegen(11, { userId: kolleginId }, 17, 22);
  const ihrWunsch = await kolleginCtx.post(`/api/shifts/${ihrer}/swap-request`, {
    data: { reason: "Arzttermin" },
  });
  expect(ihrWunsch.status(), `Wunsch der Kollegin sollte 201 liefern (${await ihrWunsch.text()})`).toBe(201);

  const eigene = (await (await assistantCtx.get("/api/shifts/swap-requests")).json()) as Array<{
    shiftId: number;
    userId: number;
    reason: string;
  }>;
  expect(eigene.some((w) => w.shiftId === meiner), "Der eigene Wunsch muss dabei sein").toBe(true);
  expect(
    eigene.some((w) => w.shiftId === ihrer),
    "Der Grund ist privat — der Wunsch der Kollegin darf hier NICHT auftauchen",
  ).toBe(false);
  expect(
    eigene.every((w) => w.userId === assistantId),
    "Keine einzige fremde Zeile in der Assistenz-Sicht",
  ).toBe(true);

  // Der Planer sieht beide — er soll ja reagieren.
  const alsPlaner = (await (await acc.ctx.get("/api/shifts/swap-requests")).json()) as Array<{
    shiftId: number;
    reason: string;
  }>;
  const meinTreffer = alsPlaner.find((w) => w.shiftId === meiner);
  const ihrTreffer = alsPlaner.find((w) => w.shiftId === ihrer);
  expect(meinTreffer, "Der Planer muss den ersten Wunsch sehen").toBeTruthy();
  expect(ihrTreffer, "Und den zweiten auch").toBeTruthy();
  expect(meinTreffer!.reason, "Mit Grund").toBe("Familienfeier");
  expect(ihrTreffer!.reason).toBe("Arzttermin");
});

test("nur Planende duerfen einen Tauschwunsch abschliessen", async () => {
  test.setTimeout(120_000);
  const shiftId = await dienstAnlegen(12);
  expect((await tauschWunsch(shiftId)).status()).toBe(201);

  const alsAssistenz = await assistantCtx.post(`/api/shifts/${shiftId}/swap-request/resolve`, {
    data: { resolution: "REASSIGNED" },
  });
  expect(
    alsAssistenz.status(),
    "Eine Assistenzkraft darf ihren eigenen Wunsch nicht selbst als erledigt abhaken",
  ).toBe(403);
});
