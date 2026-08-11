import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Mess- und Paritaets-Spec fuer den Sammel-Endpunkt POST /api/shifts/bulk-absence
 * (Task #757: Sammelauftraege deutlich beschleunigen).
 *
 * Hintergrund: Der Zeitraum kam bereits in EINEM Request an, wurde serverseitig
 * aber Tag fuer Tag mit einer Kette teurer Einzelabfragen verarbeitet
 * (Duplikat-Suche, geplante Dienste, Vertrag, Urlaubseinstellungen,
 * 13-Wochen-Schnitt — je Kalendertag erneut). Diese Spec haelt fest, dass
 *
 *  1. die Laufzeit mit der Zahl der Tage nicht mehr linear mitwaechst
 *     (Messwerte fuer 1, 7, 14 und 30 Tage werden protokolliert), und
 *  2. das fachliche Ergebnis (Urlaubskonto, gewertete Stunden, Zeiterfassung)
 *     exakt dem der Einzel-Anlage entspricht.
 *
 * Bewusst KEINE absoluten Zeitschranken: absolute Millisekunden haengen an
 * Maschine und DB-Latenz und waeren dauerhaft flaky. Geprueft wird die
 * Skalierung (Zeit pro Tag sinkt deutlich mit der Zeitraumlaenge), die
 * belastbar ist, weil sie das behobene Problem selbst beschreibt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR}-01-01`;

type CreatedUser = { id: number };
type Contract = { id: number; vacationHoursUsed: number };
type Shift = {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
  valuedHours?: number | null;
};

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

function fullDay(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

// Fortlaufende Kalendertage ab einem Startdatum (UTC-Rechnung, damit die
// Tagesschluessel exakt der Server-Konvention entsprechen).
function daysFrom(start: string, count: number): string[] {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from(
    { length: count },
    (_, i) => new Date(base + i * 86_400_000).toISOString().split("T")[0]!,
  );
}

async function vacationHoursUsed(): Promise<number> {
  const res = await adminCtx.get(`/api/contracts?userId=${assistantId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationHoursUsed;
}

async function listAbsences(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

async function clearAbsences(type: string): Promise<void> {
  for (const shift of await listAbsences(type)) {
    const res = await adminCtx.delete(`/api/shifts/${shift.id}`);
    expect(res.ok(), `DELETE /api/shifts/${shift.id} fehlgeschlagen`).toBe(true);
  }
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fuer Setup fehlgeschlagen").toBe(true);

  const unique = Date.now();
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Bulk Perf ${unique}`,
      email: `e2e.bulk.perf.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen der Assistenzkraft fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(true);
  contractId = ((await contractRes.json()) as Contract).id;
});

test.afterAll(async () => {
  for (const type of ["vacation", "sick"]) {
    const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
    if (res.ok()) {
      const shifts = (await res.json()) as Shift[];
      for (const s of shifts.filter((s) => s.userId === assistantId)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("Sammelauftrag skaliert nicht mehr linear mit der Zahl der Tage", async () => {
  test.setTimeout(240_000);

  // Disjunkte Monate je Messung, damit sich die Laeufe nicht gegenseitig als
  // Duplikate ueberspringen.
  const cases: { days: number; start: string }[] = [
    { days: 1, start: `${YEAR}-02-03` },
    { days: 7, start: `${YEAR}-03-03` },
    { days: 14, start: `${YEAR}-04-07` },
    { days: 30, start: `${YEAR}-06-02` },
  ];

  const measurements: { days: number; totalMs: number; perDayMs: number }[] = [];

  for (const { days, start } of cases) {
    const range = daysFrom(start, days);
    const started = Date.now();
    const res = await adminCtx.post("/api/shifts/bulk-absence", {
      data: { userId: assistantId, type: "sick", days: range.map(fullDay) },
    });
    const totalMs = Date.now() - started;
    expect(res.status(), `Sammelauftrag ueber ${days} Tage sollte 201 liefern`).toBe(201);
    const body = (await res.json()) as { createdCount: number };
    expect(body.createdCount, `alle ${days} Tage muessen angelegt werden`).toBe(days);

    measurements.push({ days, totalMs, perDayMs: totalMs / days });
    await clearAbsences("sick");
  }

  // Messwerte protokollieren (erscheinen in der Testausgabe und dokumentieren
  // den Vorher-/Nachher-Vergleich).
  for (const m of measurements) {
    console.log(
      `[bulk-absence] ${String(m.days).padStart(2)} Tage: ${m.totalMs} ms gesamt, ` +
        `${m.perDayMs.toFixed(1)} ms/Tag`,
    );
  }

  // Kern-Aussage: Die Kosten pro Tag fallen deutlich, wenn der Zeitraum
  // waechst. Bei der frueheren Abfragekette pro Kalendertag war die Zeit pro
  // Tag naeherungsweise konstant.
  const oneDay = measurements.find((m) => m.days === 1)!;
  const longest = measurements[measurements.length - 1]!;
  expect(
    longest.perDayMs,
    `Zeit pro Tag muss beim langen Zeitraum deutlich unter der eines Einzeltags liegen ` +
      `(1 Tag: ${oneDay.perDayMs.toFixed(1)} ms, ${longest.days} Tage: ${longest.perDayMs.toFixed(1)} ms/Tag)`,
  ).toBeLessThan(oneDay.perDayMs * 0.5);

  // Ein 30-Tage-Auftrag darf nicht annaehernd 30x so lange dauern wie ein
  // Ein-Tages-Auftrag (das war das gemeldete Problem).
  expect(
    longest.totalMs,
    `Gesamtzeit fuer ${longest.days} Tage darf nicht linear mitwachsen`,
  ).toBeLessThan(oneDay.totalMs * longest.days * 0.5);
});

test("Zeitumstellungs-Wochenende: Sammelauftrag ergibt dasselbe wie Einzel-Anlage", async () => {
  test.setTimeout(120_000);
  // Zeitumstellung Maerz (letzter Sonntag). Bewusst nur PARITAET geprueft:
  // welche Stundenzahl an einem 23-/25-Stunden-Tag fachlich richtig ist,
  // entscheidet die separate Zeitumstellungs-Aufgabe — hier wird nur
  // festgehalten, dass der Sammelweg exakt dasselbe Ergebnis liefert wie
  // die bisherige Einzel-Anlage.
  const march = new Date(`${YEAR}-03-31T00:00:00Z`);
  while (march.getUTCDay() !== 0) march.setUTCDate(march.getUTCDate() - 1);
  const sunday = march.toISOString().split("T")[0]!;
  const range = daysFrom(
    new Date(march.getTime() - 86_400_000).toISOString().split("T")[0]!,
    3,
  );

  const bulkBase = await vacationHoursUsed();
  const bulkRes = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "vacation", days: range.map(fullDay) },
  });
  expect(bulkRes.status(), `Sammelauftrag ueber ${sunday} sollte 201 liefern`).toBe(201);
  const bulkDelta = (await vacationHoursUsed()) - bulkBase;
  const bulkShifts = (await listAbsences("vacation")).sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  await clearAbsences("vacation");

  const singleBase = await vacationHoursUsed();
  for (const day of range) {
    const res = await adminCtx.post("/api/shifts", {
      data: { userId: assistantId, type: "vacation", ...fullDay(day) },
    });
    expect(res.status(), `Einzel-Urlaub ${day} sollte 201 liefern`).toBe(201);
  }
  const singleDelta = (await vacationHoursUsed()) - singleBase;
  const singleShifts = (await listAbsences("vacation")).sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  expect(bulkShifts).toHaveLength(singleShifts.length);
  expect(bulkDelta, "Urlaubskonto am Zeitumstellungs-Wochenende muss identisch sein").toBeCloseTo(
    singleDelta,
    2,
  );
  for (let i = 0; i < singleShifts.length; i++) {
    expect(bulkShifts[i]!.startTime).toBe(singleShifts[i]!.startTime);
    expect(bulkShifts[i]!.endTime).toBe(singleShifts[i]!.endTime);
    expect(bulkShifts[i]!.valuedHours ?? 0).toBeCloseTo(singleShifts[i]!.valuedHours ?? 0, 2);
  }

  await clearAbsences("vacation");
});

test("Sammelauftrag bleibt fachlich identisch zur Einzel-Anlage (14 Tage)", async () => {
  test.setTimeout(300_000);
  const range = daysFrom(`${YEAR}-09-01`, 14);

  // A) Sammelauftrag
  const baselineBulk = await vacationHoursUsed();
  const bulkStarted = Date.now();
  const bulkRes = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "vacation", days: range.map(fullDay) },
  });
  const bulkMs = Date.now() - bulkStarted;
  expect(bulkRes.status()).toBe(201);
  expect(((await bulkRes.json()) as { createdCount: number }).createdCount).toBe(14);
  const bulkDelta = (await vacationHoursUsed()) - baselineBulk;
  const bulkShifts = (await listAbsences("vacation")).sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  expect(bulkShifts).toHaveLength(14);

  await clearAbsences("vacation");

  // B) Dieselben Tage als Einzel-Anlagen (Referenzverhalten)
  const baselineSingle = await vacationHoursUsed();
  const singleStarted = Date.now();
  for (const day of range) {
    const res = await adminCtx.post("/api/shifts", {
      data: { userId: assistantId, type: "vacation", ...fullDay(day) },
    });
    expect(res.status(), `Einzel-Urlaub ${day} sollte 201 liefern`).toBe(201);
  }
  const singleMs = Date.now() - singleStarted;
  const singleDelta = (await vacationHoursUsed()) - baselineSingle;
  const singleShifts = (await listAbsences("vacation")).sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  console.log(
    `[bulk-absence] 14 Urlaubstage — Sammelauftrag ${bulkMs} ms, ` +
      `Einzel-Anlage ${singleMs} ms (${(singleMs / Math.max(bulkMs, 1)).toFixed(1)}x)`,
  );

  // Urlaubskonto identisch ...
  expect(bulkDelta, "Urlaubskonto muss exakt wie bei Einzel-Anlagen gebucht werden").toBeCloseTo(
    singleDelta,
    2,
  );
  // ... und die angelegten Eintraege ebenfalls (Zeiten und gewertete Stunden).
  expect(singleShifts).toHaveLength(14);
  for (let i = 0; i < 14; i++) {
    expect(bulkShifts[i]!.startTime).toBe(singleShifts[i]!.startTime);
    expect(bulkShifts[i]!.endTime).toBe(singleShifts[i]!.endTime);
    expect(bulkShifts[i]!.valuedHours ?? 0).toBeCloseTo(singleShifts[i]!.valuedHours ?? 0, 2);
  }

  await clearAbsences("vacation");
});
