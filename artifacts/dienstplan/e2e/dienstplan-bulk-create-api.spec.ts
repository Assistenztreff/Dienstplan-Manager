import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Tests fuer den Sammel-Endpunkt POST /api/shifts/bulk: Mehrere
 * Arbeitsdienste/Team-Eintraege werden in EINEM Request transaktional angelegt
 * statt Tag fuer Tag (die Mehrfachauswahl im Dienstplan schickte bisher pro Tag
 * einen sequenziellen Einzel-POST; Netzwerkfehler hinterliessen Teil-Anlagen).
 *
 * Abgesichert wird:
 *  1. Atomaritaet: Ueberschneidungen werden fuer ALLE Tage VOR dem Anlegen
 *     geprueft — bei Konflikt ohne force wird NICHTS angelegt (409 mit
 *     conflictDates); force legt danach alle Tage an.
 *  2. Paritaet zum Einzel-POST: identische Zeiten liefern identische Metriken
 *     (valuedHours/night/sunday/holiday) — Kern-Invariante des Umbaus.
 *  3. Kalendertag-Dedupe innerhalb des Auftrags (ein Eintrag pro Tag).
 *  4. Validierung: Tageseintraege ueber 24 h, Ende vor Beginn und
 *     Abwesenheits-Typen (gehoeren zu /shifts/bulk-absence) sind 400.
 *  5. Team-Eintraege: Konto-Schalter beachtet; pro Tag und Team nur EIN
 *     Eintrag, auch force umgeht das Duplikat-409 nicht.
 *  6. Authz: reine Assistenzkraefte 403 (auch fuer eigene Dienste);
 *     team-fremde Zielpersonen 403 (Scope-Check vor Inhalt).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const YEAR = new Date().getFullYear();

test.describe.configure({ mode: "serial" });

type Shift = {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
  notes?: string | null;
  pauseMinutes?: number;
  valuedHours?: number;
  nightHours?: number;
  sundayHours?: number;
  holidayHours?: number;
};
type BulkResult = {
  teamId: number;
  createdCount: number;
  shifts: Shift[];
  error?: string;
  code?: string;
  conflictDates?: string[];
};

let adminCtx: APIRequestContext;
let assistantId: number;
// Fremdes Konto: liefert die team-fremde Zielperson UND eine echte
// Assistenz-Session (Einladungsflow) fuer die Authz-Tests.
let acc: FreeAccount;
let foreignAssistantId: number;
let assistantCtx: APIRequestContext | undefined;

/** Feste UTC-Zeiten (deterministische conflictDates unabhaengig von der TZ). */
function utcTimes(day: string, fromHour: number, toHour: number) {
  const pad = (h: number) => String(h).padStart(2, "0");
  return {
    startTime: `${day}T${pad(fromHour)}:00:00.000Z`,
    endTime: `${day}T${pad(toHour)}:00:00.000Z`,
  };
}

async function bulkCreate(
  ctx: APIRequestContext,
  data: Record<string, unknown>,
): Promise<{ status: number; body: BulkResult }> {
  const res = await ctx.post("/api/shifts/bulk", { data });
  return { status: res.status(), body: (await res.json()) as BulkResult };
}

/** Alle Schichten der Test-Assistenzkraft im Monat (1-basiert). */
async function monthShifts(month: number): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?month=${month}&year=${YEAR}`);
  expect(res.ok(), `GET /api/shifts fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fuer Setup fehlgeschlagen").toBe(true);

  const unique = Date.now();
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Bulk Create ${unique}`,
      email: `e2e.bulk.create.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen der Assistenzkraft fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Fremdes Konto mit eigener Assistenzkraft; Einladen ist Premium-gegated.
  acc = await registerFreeAccount("privat", "bulkcreate");
  await setAccountPlan(acc.email, "premium");
  const foreignRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E BulkCreate Fremd ${unique}`,
      email: `e2e.bulk.create.fremd.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(foreignRes.status(), "Fremde Assistenzkraft sollte 201 liefern").toBe(201);
  foreignAssistantId = ((await foreignRes.json()) as { id: number }).id;

  const inviteRes = await acc.ctx.post(`/api/users/${foreignAssistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const token = ((await inviteRes.json()) as { token: string }).token;
  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  // Alle angelegten Eintraege der Test-Assistenzkraft entfernen.
  if (adminCtx && assistantId) {
    for (const month of [6, 7]) {
      const res = await adminCtx.get(`/api/shifts?month=${month}&year=${YEAR}`);
      if (res.ok()) {
        const mine = ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
        if (mine.length > 0) {
          await adminCtx.post("/api/shifts/bulk-delete", {
            data: { ids: mine.map((s) => s.id) },
          });
        }
      }
    }
    await adminCtx.delete(`/api/users/${assistantId}`);
  }
  if (acc) await deleteFreeAccount(acc);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
  await adminCtx?.dispose();
});

test("409 bei Ueberschneidung legt NICHTS an; force legt alle Tage an — Metriken wie Einzel-POST", async () => {
  const days = [`${YEAR}-06-15`, `${YEAR}-06-16`, `${YEAR}-06-17`];

  // Referenz-Dienst per Einzel-POST auf dem ersten Tag (dient zugleich als
  // Kollisionsquelle und als Paritaets-Referenz fuer die Metriken).
  const singleRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      pauseMinutes: 30,
      ...utcTimes(days[0], 8, 14),
    },
  });
  expect(singleRes.status(), "Einzel-POST sollte 201 liefern").toBe(201);
  const reference = (await singleRes.json()) as Shift;

  // Ohne force: Tag 1 kollidiert -> 409 mit genau diesem Tag, NICHTS angelegt.
  const conflict = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "active",
    planningStatus: "ANGEBOTEN",
    notes: "Sammel-Anlage",
    pauseMinutes: 30,
    days: days.map((d) => utcTimes(d, 8, 14)),
  });
  expect(conflict.status, "Kollision muss 409 liefern").toBe(409);
  expect(conflict.body.code).toBe("shift_overlap");
  expect(conflict.body.conflictDates).toEqual([days[0]]);
  expect((await monthShifts(6)).length, "409 darf keinen einzigen Tag anlegen").toBe(1);

  // Mit force: alle drei Tage werden angelegt (kompletter Auftrag).
  const forced = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "active",
    planningStatus: "ANGEBOTEN",
    notes: "Sammel-Anlage",
    pauseMinutes: 30,
    force: true,
    days: days.map((d) => utcTimes(d, 8, 14)),
  });
  expect(forced.status, "force sollte 201 liefern").toBe(201);
  expect(forced.body.createdCount).toBe(3);
  expect(forced.body.shifts).toHaveLength(3);
  expect(typeof forced.body.teamId, "teamId fuer die Client-Cache-Zuordnung").toBe("number");
  expect((await monthShifts(6)).length).toBe(4);

  // Paritaet: gleicher Tag + gleiche Zeiten => identische Metriken und Felder
  // wie beim Einzel-POST (storeShiftMetrics laeuft pro Tag in der Transaktion).
  const bulkOnRefDay = forced.body.shifts.find((s) => s.startTime === reference.startTime);
  expect(bulkOnRefDay, "Sammel-Eintrag auf dem Referenztag fehlt").toBeTruthy();
  expect(bulkOnRefDay!.endTime).toBe(reference.endTime);
  expect(bulkOnRefDay!.valuedHours).toBeCloseTo(reference.valuedHours!, 2);
  expect(bulkOnRefDay!.nightHours).toBeCloseTo(reference.nightHours!, 2);
  expect(bulkOnRefDay!.sundayHours).toBeCloseTo(reference.sundayHours!, 2);
  expect(bulkOnRefDay!.holidayHours).toBeCloseTo(reference.holidayHours!, 2);
  expect(bulkOnRefDay!.pauseMinutes).toBe(30);
  expect(bulkOnRefDay!.notes).toBe("Sammel-Anlage");
  for (const s of forced.body.shifts) {
    expect(s.planningStatus, "Planungsstatus muss uebernommen werden").toBe("ANGEBOTEN");
  }
});

test("fasst doppelte Kalendertage im Auftrag zusammen (ein Eintrag pro Tag)", async () => {
  const day = `${YEAR}-06-22`;
  const { status, body } = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "active",
    days: [utcTimes(day, 9, 12), utcTimes(day, 9, 12)],
  });
  expect(status).toBe(201);
  expect(body.createdCount, "Doppelter Kalendertag darf nur einmal angelegt werden").toBe(1);
});

test("weist ungueltige Tageseintraege und Abwesenheits-Typen mit 400 ab", async () => {
  // Tageseintrag ueber 24 Stunden (wuerde das 92-Tage-Limit aushebeln).
  const tooLong = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "active",
    days: [{ startTime: `${YEAR}-06-23T08:00:00.000Z`, endTime: `${YEAR}-06-24T09:00:00.000Z` }],
  });
  expect(tooLong.status, "Ueber 24 h muss 400 liefern").toBe(400);

  // Ende vor dem Beginn.
  const backwards = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "active",
    days: [{ startTime: `${YEAR}-06-25T14:00:00.000Z`, endTime: `${YEAR}-06-25T08:00:00.000Z` }],
  });
  expect(backwards.status, "Ende vor Beginn muss 400 liefern").toBe(400);

  // Abwesenheiten gehoeren zu /shifts/bulk-absence (eigene Ersetzungs- und
  // Urlaubskonto-Logik) — hier lehnt bereits das Schema ab.
  const absence = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "vacation",
    days: [utcTimes(`${YEAR}-06-26`, 0, 23)],
  });
  expect(absence.status, "Abwesenheits-Typ muss 400 liefern").toBe(400);

  expect(
    (await monthShifts(6)).filter((s) => s.startTime.startsWith(`${YEAR}-06-2`)).length,
    "Fehlversuche duerfen nichts anlegen (ausser dem Dedupe-Eintrag vom 22.)",
  ).toBe(1);
});

test("lehnt Team-Eintrag ab der zwei UTC-Tage ueberspannt und akzeptiert UTC-Konvention", async () => {
  // Team-Eintraege nutzen UTC-Konvention (T00:00:00Z–T23:59:59Z): Start und Ende
  // auf demselben UTC-Kalendertag. Ein 25h-Interval (Berliner Lokalzeit-Mitternacht
  // am Winterzeit-Umstellungstag) ueberspannt zwei UTC-Tage und wird abgelehnt —
  // unabhaengig davon ob die Teamsitzung im Konto aktiv ist.
  const crossDay = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "team",
    days: [
      {
        startTime: `${YEAR}-10-24T22:00:00.000Z`, // 00:00 CEST (UTC+2)
        endTime: `${YEAR}-10-25T23:00:00.000Z`, // 00:00 CET (UTC+1, naechster UTC-Tag)
      },
    ],
  });
  expect(crossDay.status, "25h UTC-tagesuebergreifender Team-Eintrag muss 400 liefern").toBe(400);

  // UTC-Konvention am DST-Tag: selber UTC-Tag, darf nicht von der Datumsvalidierung
  // abgelehnt werden (zulaessig: 201, 400 team_meeting_disabled, 409 Duplikat).
  const utcConvention = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "team",
    days: [{ startTime: `${YEAR}-10-25T00:00:00.000Z`, endTime: `${YEAR}-10-25T23:59:59.000Z` }],
  });
  if (utcConvention.status === 400) {
    expect(
      utcConvention.body.code,
      "Datumsvalidierung darf UTC-Konvention nicht ablehnen",
    ).toBe("team_meeting_disabled");
  }
});

test("Team-Eintraege: Schalter beachtet, Tages-Duplikat bleibt auch mit force 409", async () => {
  const day = `${YEAR}-07-20`;
  const first = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "team",
    days: [utcTimes(day, 9, 11)],
  });

  if (first.status === 400) {
    // Team-Dienst im Konto deaktiviert: sauberer Fehlercode, nichts angelegt.
    expect(first.body.code).toBe("team_meeting_disabled");
    return;
  }

  expect(first.status, "Team-Eintrag sollte 201 liefern (Schalter aktiv)").toBe(201);
  expect(first.body.createdCount).toBe(1);

  // Zweiter Eintrag am selben Tag: 409 — und force umgeht das NICHT
  // (Duplikate wuerden die Stunden-Gutschrift verdoppeln).
  const dup = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "team",
    days: [utcTimes(day, 14, 16)],
  });
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe("team_meeting_duplicate");
  expect(dup.body.conflictDates).toEqual([day]);

  const dupForced = await bulkCreate(adminCtx, {
    userId: assistantId,
    type: "team",
    force: true,
    days: [utcTimes(day, 14, 16)],
  });
  expect(dupForced.status, "force darf Team-Duplikate nicht umgehen").toBe(409);
});

test("zwei GLEICHZEITIGE identische Auftraege: genau einer legt an (Doppelklick-Schutz)", async () => {
  // Ohne Advisory-Lock in der Transaktion saehen beide Requests einen
  // konfliktfreien Bestand und legten die Tage doppelt an (TOCTOU-Race).
  const days = [`${YEAR}-07-27`, `${YEAR}-07-28`].map((d) => utcTimes(d, 8, 12));
  const payload = { userId: assistantId, type: "active", days };
  const [a, b] = await Promise.all([
    bulkCreate(adminCtx, payload),
    bulkCreate(adminCtx, payload),
  ]);
  expect([a.status, b.status].sort(), "genau ein 201 und ein 409").toEqual([201, 409]);
  const loser = a.status === 409 ? a : b;
  expect(loser.body.code).toBe("shift_overlap");

  const rows = (await monthShifts(7)).filter(
    (s) => s.startTime.startsWith(`${YEAR}-07-27`) || s.startTime.startsWith(`${YEAR}-07-28`),
  );
  expect(rows.length, "jeder Tag darf nur EINMAL angelegt sein").toBe(2);
});

test("reine Assistenzkraft bleibt 403 — auch fuer eigene Dienste", async () => {
  const res = await assistantCtx!.post("/api/shifts/bulk", {
    data: {
      userId: foreignAssistantId,
      type: "active",
      days: [utcTimes(`${YEAR}-07-21`, 8, 12)],
    },
  });
  expect(res.status(), "Arbeitsdienste sind nie Selbstservice").toBe(403);
});

test("team-fremde Zielperson bleibt 403 (Scope-Check vor Inhalt)", async () => {
  const { status } = await bulkCreate(adminCtx, {
    userId: foreignAssistantId,
    type: "active",
    days: [utcTimes(`${YEAR}-07-22`, 8, 12)],
  });
  expect(status, "Fremdes Team-Mitglied muss 403 bleiben").toBe(403);
});
