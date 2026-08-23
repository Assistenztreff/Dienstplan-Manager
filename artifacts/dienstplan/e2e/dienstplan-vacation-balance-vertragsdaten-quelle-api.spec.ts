import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task #497): Bewertungsquelle der Urlaubstage im
 * `GET /contracts/:id/vacation-balance`-Endpunkt.
 *
 * Bestandsvertraege stehen nach der Migration oft pauschal auf
 * workdaysPerWeek = 5, obwohl in der persoenlichen Assistenz 7-Tage-Modelle
 * haeufig sind. Solange kein 13-Wochen-Schnitt (bwavg) vorliegt, bewertet der
 * Fallback Urlaubstage aus den Vertragsdaten (Wochenstunden / Arbeitstage).
 * Damit die UI darauf hinweisen kann, liefert die Bilanz jetzt:
 * - dailyHoursSource: contract | default
 * - dailyHours: verwendete Stunden je Urlaubstag (Stichtag heute)
 * - contractWorkdaysPerWeek / contractWeeklyHours des aktiven Vertrags
 *
 * Geprueft:
 * 1. Frischer Vertrag ohne IST-Historie -> Quelle "contract",
 *    dailyHours = weeklyHours / workdaysPerWeek.
 * 2. PATCH workdaysPerWeek (Korrektur aus dem Hinweis heraus) aendert die
 *    gelieferten dailyHours sofort.
 */

type Balance = {
  dailyHoursSource: string;
  dailyHours: number;
  contractWorkdaysPerWeek: number | null;
  contractWeeklyHours: number | null;
};

let employer: FreeAccount;
let contractId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  employer = await registerFreeAccount("privat", "vacsrc");
  await setAccountPlan(employer.email, "premium");

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const userRes = await employer.ctx.post("/api/users", {
    data: {
      name: `E2E VacSrc ${unique}`,
      email: `e2e.vacsrc.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  const userId = ((await userRes.json()) as { id: number }).id;

  const contractRes = await employer.ctx.post("/api/contracts", {
    data: {
      userId,
      startDate: "2026-01-01",
      weeklyHours: 28,
      workdaysPerWeek: 5,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
  contractId = ((await contractRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(employer);
});

test("Ohne IST-Historie bewertet die Bilanz aus Vertragsdaten (Quelle contract)", async () => {
  const res = await employer.ctx.get(`/api/contracts/${contractId}/vacation-balance`);
  expect(res.status(), "Bilanz muss 200 liefern").toBe(200);
  const body = (await res.json()) as Balance;
  expect(body.dailyHoursSource, "Quelle muss die Vertragsdaten sein").toBe("contract");
  expect(body.dailyHours, "28h / 5 Tage = 5.6 h je Urlaubstag").toBe(5.6);
  expect(body.contractWorkdaysPerWeek, "Arbeitstage/Woche aus dem Vertrag").toBe(5);
  expect(body.contractWeeklyHours, "Wochenstunden aus dem Vertrag").toBe(28);
});

test("Korrektur der Arbeitstage/Woche aendert die Bewertung sofort", async () => {
  const patch = await employer.ctx.patch(`/api/contracts/${contractId}`, {
    data: { workdaysPerWeek: 7 },
  });
  expect(patch.status(), "PATCH workdaysPerWeek sollte 200 liefern").toBe(200);

  const res = await employer.ctx.get(`/api/contracts/${contractId}/vacation-balance`);
  expect(res.status(), "Bilanz muss 200 liefern").toBe(200);
  const body = (await res.json()) as Balance;
  expect(body.dailyHoursSource, "Quelle bleibt die Vertragsdaten").toBe("contract");
  expect(body.contractWorkdaysPerWeek, "Korrigierter Wert muss zurueckkommen").toBe(7);
  expect(body.dailyHours, "28h / 7 Tage = 4 h je Urlaubstag").toBe(4);
});
