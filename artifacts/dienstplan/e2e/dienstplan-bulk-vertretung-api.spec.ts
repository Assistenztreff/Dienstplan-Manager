import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Test: Vertretung je Tag im Sammel-Endpunkt (Etappe 2, 02.09.2026).
 *
 * Die automatische Planung merkt an jedem Tag eine ANDERE Person vor. Ein
 * einzelnes standbyUserId für den ganzen Sammelauftrag wäre dafür unbrauchbar,
 * deshalb steht das Feld an `days[]`. Ohne diese Erweiterung bräuchte jede
 * Vormerkung einen eigenen PATCH — bei einem Monatslauf dreißig Stück.
 *
 * Geprüft werden die vier Wachposten, die auch beim Einzel-Anlegen gelten. Sie
 * sind der Grund, warum dieses Spec existiert: Ein Sammel-Endpunkt, der eine
 * Prüfung des Einzelwegs vergisst, ist ein Loch in der Team-Trennung.
 *   1. Der gute Fall: verschiedene Vertretungen je Tag kommen an.
 *   2. Vertretung aus einem FREMDEN Team → 403, nichts wird angelegt.
 *   3. Vertretung = zugewiesene Person → 400.
 *   4. Vertretung an einem Team-Eintrag → 400 (Teamsitzungen vertritt niemand).
 */

type Entity = { id: number };
type Shift = { id: number; startTime: string; standbyUserId: number | null };

let h: TeamTestHarness;
let teamA = 0;
let teamB = 0;
let anna = 0;
let ben = 0;
let fremd = 0;
const angelegt: number[] = [];

/** Anker: heute + 3 Tage, damit kein Vorausplanungs-Limit greift. */
function isoTag(offsetTage: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3 + offsetTage);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamA = await h.createTeam(`E2E Bulk-Vertretung A ${h.run}`);
  teamB = await h.createTeam(`E2E Bulk-Vertretung B ${h.run}`);
  anna = await h.createUser({
    name: `E2E Anna ${h.run}`,
    email: `e2e.bulkv.anna.${h.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
  ben = await h.createUser({
    name: `E2E Ben ${h.run}`,
    email: `e2e.bulkv.ben.${h.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
  fremd = await h.createUser({
    name: `E2E Fremd ${h.run}`,
    email: `e2e.bulkv.fremd.${h.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamB,
  });
});

test.afterAll(async () => {
  for (const id of angelegt) {
    try {
      await h.ctx.delete(`/api/shifts/${id}`);
    } catch {
      /* Aufraeumen darf den Lauf nicht kippen */
    }
  }
  await h.cleanup();
});

function tag(offset: number, standbyUserId?: number | null) {
  return {
    startTime: `${isoTag(offset)}T08:00:00.000Z`,
    endTime: `${isoTag(offset)}T16:00:00.000Z`,
    ...(standbyUserId !== undefined ? { standbyUserId } : {}),
  };
}

test("verschiedene Vertretungen je Tag kommen an", async () => {
  const res = await h.ctx.post("/api/shifts/bulk", {
    data: {
      userId: anna,
      teamId: teamA,
      type: "work",
      planningStatus: "VORLAEUFIG",
      days: [tag(0, ben), tag(1, null), tag(2, ben)],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { shifts } = (await res.json()) as { shifts: Shift[] };
  for (const s of shifts) angelegt.push(s.id);

  const nachTag = new Map(shifts.map((s) => [s.startTime.slice(0, 10), s.standbyUserId]));
  expect(nachTag.get(isoTag(0)), "Tag 1: Ben vorgemerkt").toBe(ben);
  expect(nachTag.get(isoTag(1)), "Tag 2: bewusst ohne Vertretung").toBeNull();
  expect(nachTag.get(isoTag(2)), "Tag 3: Ben vorgemerkt").toBe(ben);
});

test("Vertretung aus einem fremden Team wird abgewiesen — und legt nichts an", async () => {
  const vorher = (await (
    await h.ctx.get(`/api/shifts?month=${Number(isoTag(10).slice(5, 7))}&year=${Number(isoTag(10).slice(0, 4))}&teamId=${teamA}`)
  ).json()) as Entity[];

  const res = await h.ctx.post("/api/shifts/bulk", {
    data: {
      userId: anna,
      teamId: teamA,
      type: "work",
      days: [tag(10), tag(11, fremd)],
    },
  });
  expect(res.status(), await res.text()).toBe(403);

  // Gegenprobe: Der Endpunkt ist transaktional — auch der unverdaechtige
  // erste Tag darf NICHT angelegt worden sein. Ohne diese Zeile wuerde der
  // Test auch dann gruen, wenn der Server Tag 1 schreibt und erst bei Tag 2
  // abbricht.
  const nachher = (await (
    await h.ctx.get(`/api/shifts?month=${Number(isoTag(10).slice(5, 7))}&year=${Number(isoTag(10).slice(0, 4))}&teamId=${teamA}`)
  ).json()) as Entity[];
  expect(nachher.length, "Ein abgewiesener Sammelauftrag darf nichts hinterlassen").toBe(
    vorher.length,
  );
});

test("die Vertretung darf nicht die zugewiesene Person sein", async () => {
  const res = await h.ctx.post("/api/shifts/bulk", {
    data: { userId: anna, teamId: teamA, type: "work", days: [tag(20, anna)] },
  });
  expect(res.status(), await res.text()).toBe(400);
});

test("ein Team-Eintrag nimmt keine Vertretung an", async () => {
  const res = await h.ctx.post("/api/shifts/bulk", {
    data: { userId: anna, teamId: teamA, type: "team", days: [tag(25, ben)] },
  });
  expect(res.status(), await res.text()).toBe(400);
});
