import { test, expect } from "@playwright/test";
import { deleteFreeAccount, registerFreeAccount, setAccountPlan, type FreeAccount } from "./helpers/teams";

/**
 * Die Aenderungshistorie eines Monats — Datenquelle des Vormonats-Blocks im
 * Stundenlisten-Export (Stufe 4).
 *
 * Warum der Export sie braucht: ein Export zeigt nur, was im Moment des
 * Klickens in der Datenbank steht. Ein ueberschriebener Dienst waere ohne
 * diese Tabelle unwiederbringlich weg — das Excel ist die ANZEIGE, nicht der
 * SPEICHERORT. Getestet wird deshalb genau das, was ein Nachweis leisten muss:
 *   1. jede einzelne Aenderung, nicht nur die juengste je Dienst
 *   2. alter UND neuer Wert in derselben Zeile
 *   3. Zuordnung ueber das DIENST-Datum, nicht ueber den Aenderungszeitpunkt
 *   4. ein ueber die Monatsgrenze verschobener Dienst taucht in beiden Monaten auf
 *   5. die Historie ueberlebt das Loeschen des Dienstes
 *
 * Datumsfest: alle Dienste liegen auf dem 15. eines fest berechneten Monats,
 * und abgefragt wird immer der Monat DIESES Dienstes — nie "der aktuelle
 * Monat". Die Abwesenheitskalender-Spec ist genau daran jahrelang nur in den
 * ersten Monatstagen gruen gewesen.
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantId: number;

type Snapshot = { startTime: string; endTime: string; pauseMinutes: number; userId: number };
type HistorieEintrag = {
  id: number;
  shiftId: number | null;
  changeSource: string;
  changedByName: string | null;
  shiftType: string | null;
  createdAt: string;
  before: Snapshot;
  after: Snapshot;
};

/**
 * Ein fester Tag des Monats, der `monateZurueck` Monate vor dem laufenden
 * liegt. Jeder Test bekommt seinen EIGENEN Tag: alle Dienste gehoeren
 * derselben Assistenzkraft, und die Ueberschneidungspruefung des Servers
 * lehnt einen zweiten Dienst am selben Tag mit 409 ab. Nur Tage 10–20
 * verwenden — die gibt es in jedem Monat.
 */
function monatsTag(monateZurueck: number, tagImMonat: number): Date {
  const heute = new Date();
  return new Date(heute.getFullYear(), heute.getMonth() - monateZurueck, tagImMonat);
}

function dienstAn(tag: Date, vonStunde: number, bisStunde: number) {
  const iso = (stunde: number) =>
    new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), stunde, 0, 0).toISOString();
  return { startTime: iso(vonStunde), endTime: iso(bisStunde) };
}

async function fixDienstAnlegen(tag: Date, vonStunde = 8, bisStunde = 16): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      shiftModelId: null,
      ...dienstAn(tag, vonStunde, bisStunde),
    },
  });
  expect(res.status(), `Dienst-Anlage sollte 201 liefern (${await res.text()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** Historie genau des Monats, in dem `tag` liegt. */
async function historie(tag: Date): Promise<HistorieEintrag[]> {
  const res = await acc.ctx.get(
    `/api/shifts/changes/history?month=${tag.getMonth() + 1}&year=${tag.getFullYear()}`,
  );
  expect(res.status(), `Historie sollte 200 liefern (${await res.text()})`).toBe(200);
  return (await res.json()) as HistorieEintrag[];
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "histapi");
  // Premium: vergangene Monate liegen ausserhalb des Free-Planungsfensters.
  await setAccountPlan(acc.email, "premium");

  const createRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Historie ${Date.now()}`,
      email: `e2e.historie.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.status(), `Assistenzkraft sollte 201 liefern (${await createRes.text()})`).toBe(201);
  assistantId = ((await createRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("jede Aenderung steht einzeln in der Historie, mit altem und neuem Wert", async () => {
  test.setTimeout(120_000);
  const tag = monatsTag(1, 15);
  const shiftId = await fixDienstAnlegen(tag, 8, 16);

  // Zweimal korrigieren: 8–16 → 8–17 → 9–17.
  const patch1 = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: dienstAn(tag, 8, 17) });
  expect(patch1.status(), await patch1.text()).toBe(200);
  const patch2 = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: dienstAn(tag, 9, 17) });
  expect(patch2.status(), await patch2.text()).toBe(200);

  const eintraege = (await historie(tag)).filter((e) => e.shiftId === shiftId);
  expect(
    eintraege.length,
    "Zwei Korrekturen muessen zwei Zeilen ergeben — nicht eine zusammengefasste",
  ).toBe(2);

  // Die Kette ist lueckenlos nachvollziehbar: das "nachher" der ersten Zeile
  // ist das "vorher" der zweiten.
  const [erste, zweite] = eintraege;
  expect(new Date(erste.before.endTime).getHours()).toBe(16);
  expect(new Date(erste.after.endTime).getHours()).toBe(17);
  expect(new Date(zweite.before.startTime).getHours()).toBe(8);
  expect(new Date(zweite.after.startTime).getHours()).toBe(9);
  expect(erste.changeSource).toBe("planner_edit");
  expect(erste.changedByName, "Wer geaendert hat, muss im Export stehen").toBeTruthy();
  expect(erste.shiftType).toBe("work");
});

test("zugeordnet wird ueber das Dienst-Datum, nicht ueber den Aenderungszeitpunkt", async () => {
  test.setTimeout(120_000);
  const vormonat = monatsTag(1, 12);
  const vorvormonat = monatsTag(2, 12);
  const shiftId = await fixDienstAnlegen(vorvormonat, 8, 16);
  const patch = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: dienstAn(vorvormonat, 8, 18) });
  expect(patch.status(), await patch.text()).toBe(200);

  // Geaendert wurde HEUTE, der Dienst liegt im Vorvormonat — dort gehoert er hin.
  expect(
    (await historie(vorvormonat)).some((e) => e.shiftId === shiftId),
    "Die Aenderung gehoert in den Monat des Dienstes",
  ).toBe(true);
  expect(
    (await historie(vormonat)).some((e) => e.shiftId === shiftId),
    "Die Aenderung darf NICHT im Monat des Aenderungszeitpunkts auftauchen",
  ).toBe(false);
});

test("ein ueber die Monatsgrenze verschobener Dienst steht in beiden Monaten", async () => {
  test.setTimeout(120_000);
  const vonMonat = monatsTag(2, 18);
  const nachMonat = monatsTag(1, 18);
  const shiftId = await fixDienstAnlegen(vonMonat, 8, 16);
  const patch = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: dienstAn(nachMonat, 8, 16) });
  expect(patch.status(), await patch.text()).toBe(200);

  expect(
    (await historie(vonMonat)).some((e) => e.shiftId === shiftId),
    "Im Herkunftsmonat fehlt sonst der Hinweis, dass der Dienst weg ist",
  ).toBe(true);
  expect(
    (await historie(nachMonat)).some((e) => e.shiftId === shiftId),
    "Im Zielmonat fehlt sonst der Hinweis, woher der Dienst kommt",
  ).toBe(true);
});

test("die Historie ueberlebt das Loeschen des Dienstes", async () => {
  test.setTimeout(120_000);
  const tag = monatsTag(1, 20);
  const shiftId = await fixDienstAnlegen(tag, 10, 14);
  const patch = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: dienstAn(tag, 10, 15) });
  expect(patch.status(), await patch.text()).toBe(200);

  const vorherigeZeile = (await historie(tag)).find((e) => e.shiftId === shiftId);
  expect(vorherigeZeile, "Vorbedingung: die Aenderung ist protokolliert").toBeTruthy();
  const zeilenId = vorherigeZeile!.id;

  const del = await acc.ctx.delete(`/api/shifts/${shiftId}`);
  expect(del.ok(), `Loeschen sollte klappen (${del.status()} ${await del.text()})`).toBe(true);

  // Kern des Loeschschutzes: frueher haette ON DELETE CASCADE diese Zeile mit
  // in den Abgrund gerissen — genau den Nachweis, den § 16 ArbZG verlangt.
  const nachher = (await historie(tag)).find((e) => e.id === zeilenId);
  expect(nachher, "Die Aenderungszeile darf beim Loeschen des Dienstes nicht verschwinden").toBeTruthy();
  expect(nachher!.shiftId, "Der Bezug zum geloeschten Dienst wird geleert, die Zeile bleibt").toBeNull();
  expect(new Date(nachher!.before.endTime).getHours()).toBe(14);
  expect(new Date(nachher!.after.endTime).getHours()).toBe(15);
});

test("ohne Monat/Jahr antwortet die Route mit 400", async () => {
  const res = await acc.ctx.get("/api/shifts/changes/history");
  expect(res.status(), "Pflichtparameter fehlen — das darf nicht stillschweigend alles liefern").toBe(400);
});
