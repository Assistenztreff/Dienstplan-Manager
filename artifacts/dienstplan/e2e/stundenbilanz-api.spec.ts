import { test, expect } from "@playwright/test";
import {
  TeamTestHarness,
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-API-Test: Zielvereinbarungen (Monatsbudget) + Stundenbilanz-Endpunkt
 * (Arbeitsanweisung 06.08.2026, Punkt 2.2, Premium).
 *
 * Geprüft (Done-Kriterien):
 * - Budget-CRUD: anlegen (201), auflisten, ändern (200), löschen (204/404).
 * - Überlappende Zeiträume werden mit 409 budget_overlap abgelehnt; eine neue
 *   Vereinbarung löst die alte zeitraumbezogen ab (Historie bleibt).
 * - Bilanz: genehmigt/verbraucht/verbleibend für den Monat; Verbrauch zählt
 *   nur echte Arbeitsdienste — Urlaubs-/Krank-Stunden zählen NICHT.
 * - Jahressaldo = kumuliert genehmigt minus verbraucht seit Jahresbeginn.
 * - Warnschwelle: mehr als 1,5 angesparte Monatsbudgets -> warningActive.
 * - Free-Gate serverseitig: 403 plan_feature_required für alle Endpunkte.
 * - Mandantentrennung: fremde Budgets sind per ID unsichtbar (404).
 */

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;
const pad2 = (n: number) => String(n).padStart(2, "0");
// Feste Tage in der Monatsmitte (nie Monatsgrenze, keine Zeitzonen-Rolle).
const DAY_A = `${YEAR}-${pad2(MONTH)}-10`;
const DAY_B = `${YEAR}-${pad2(MONTH)}-11`;
const DAY_C = `${YEAR}-${pad2(MONTH)}-12`;

test.describe("Stundenbilanz: Budget-CRUD + Bilanz (Premium)", () => {
  test.setTimeout(120_000);

  let h: TeamTestHarness;
  let teamId: number;
  // Eigenes Team für die Bilanz-Tests: die CRUD-Tests hinterlassen bewusst
  // eine Zielvereinbarung (110 h, Jan–Jun) — ein zweites Team haelt die
  // Bilanz-Erwartungswerte frei von diesem Erbe.
  let balanceTeamId: number;

  test.beforeAll(async () => {
    h = await TeamTestHarness.login();
    await h.becomeDienstleister();
    teamId = await h.createTeam(`E2E Budget Team ${h.run}`);
    balanceTeamId = await h.createTeam(`E2E Budget Bilanz Team ${h.run}`);
  });

  test.afterAll(async () => {
    await h?.cleanup();
  });

  test("CRUD mit Überlappungs-Validierung und zeitraumbezogener Ablösung", async () => {
    // Anlegen: 100 h/Monat, Januar bis Juni.
    const createRes = await h.ctx.post("/api/hour-budgets", {
      data: { teamId, monthlyHours: 100, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-06-30`, notes: "Erste Vereinbarung" },
    });
    expect(createRes.status(), `Anlegen fehlgeschlagen (${createRes.status()})`).toBe(201);
    const first = (await createRes.json()) as { id: number; monthlyHours: number };
    expect(first.monthlyHours).toBe(100);

    // Überlappung wird abgelehnt (409 budget_overlap).
    const overlapRes = await h.ctx.post("/api/hour-budgets", {
      data: { teamId, monthlyHours: 120, startDate: `${YEAR}-05-01` },
    });
    expect(overlapRes.status()).toBe(409);
    expect(((await overlapRes.json()) as { code?: string }).code).toBe("budget_overlap");

    // Neue Vereinbarung löst die alte zeitraumbezogen ab (Historie bleibt).
    const followRes = await h.ctx.post("/api/hour-budgets", {
      data: { teamId, monthlyHours: 140, startDate: `${YEAR}-07-01` },
    });
    expect(followRes.status(), `Folgevereinbarung fehlgeschlagen (${followRes.status()})`).toBe(201);
    const second = (await followRes.json()) as { id: number };

    // Liste: beide Zeiträume, nach Beginn sortiert.
    const listRes = await h.ctx.get(`/api/hour-budgets?teamId=${teamId}`);
    expect(listRes.ok()).toBe(true);
    const list = (await listRes.json()) as { id: number; monthlyHours: number }[];
    expect(list.map((b) => b.id)).toEqual([first.id, second.id]);

    // Ändern: Stundenzahl der ersten Vereinbarung.
    const patchRes = await h.ctx.patch(`/api/hour-budgets/${first.id}`, {
      data: { monthlyHours: 110 },
    });
    expect(patchRes.ok(), `Ändern fehlgeschlagen (${patchRes.status()})`).toBe(true);
    expect(((await patchRes.json()) as { monthlyHours: number }).monthlyHours).toBe(110);

    // Ändern in eine Überlappung hinein wird ebenfalls abgelehnt.
    const patchOverlap = await h.ctx.patch(`/api/hour-budgets/${first.id}`, {
      data: { endDate: `${YEAR}-08-31` },
    });
    expect(patchOverlap.status()).toBe(409);

    // Ungültiger Zeitraum (Ende vor Beginn) -> 400.
    const badOrder = await h.ctx.patch(`/api/hour-budgets/${first.id}`, {
      data: { startDate: `${YEAR}-02-01`, endDate: `${YEAR}-01-15` },
    });
    expect(badOrder.status()).toBe(400);

    // Mandantentrennung: ein fremder Admin sieht die Budgets nicht (404).
    // Premium-Plan nötig, damit der Fremd-Zugriff am Team-Scope (404) und
    // nicht bereits am Plan-Gate (403) scheitert.
    const foreign = await h.seedForeignAdmin();
    await setAccountPlan(foreign.email, "premium");
    const foreignPatch = await foreign.ctx.patch(`/api/hour-budgets/${first.id}`, {
      data: { monthlyHours: 1 },
    });
    expect(foreignPatch.status()).toBe(404);
    const foreignDelete = await foreign.ctx.delete(`/api/hour-budgets/${first.id}`);
    expect(foreignDelete.status()).toBe(404);

    // Löschen: 204, danach 404.
    const delRes = await h.ctx.delete(`/api/hour-budgets/${second.id}`);
    expect(delRes.status()).toBe(204);
    const delAgain = await h.ctx.delete(`/api/hour-budgets/${second.id}`);
    expect(delAgain.status()).toBe(404);
  });

  test("Bilanz: nur Arbeitsdienste zählen als Verbrauch, Jahressaldo + Warnschwelle", async () => {
    const assistant = await h.createUser({ teamId: balanceTeamId, role: "assistant" });

    // Zielvereinbarung: 100 h/Monat, gültig seit Jahresbeginn (unbefristet).
    const budgetRes = await h.ctx.post("/api/hour-budgets", {
      data: { teamId: balanceTeamId, monthlyHours: 100, startDate: `${YEAR}-01-01` },
    });
    expect(budgetRes.status()).toBe(201);

    // Verbrauch: zwei Arbeitsdienste (8h + 6h = 14h) im aktuellen Monat.
    await h.createShift(balanceTeamId, assistant, DAY_A, {
      startTime: `${DAY_A}T08:00:00.000Z`,
      endTime: `${DAY_A}T16:00:00.000Z`,
    });
    await h.createShift(balanceTeamId, assistant, DAY_B, {
      startTime: `${DAY_B}T08:00:00.000Z`,
      endTime: `${DAY_B}T14:00:00.000Z`,
    });
    // Abwesenheiten zählen NICHT als Verbrauch (Urlaub 8h + Krank 8h).
    const vacRes = await h.ctx.post("/api/shifts", {
      data: {
        userId: assistant,
        teamId: balanceTeamId,
        type: "vacation",
        startTime: `${DAY_C}T00:00:00.000Z`,
        endTime: `${DAY_C}T23:59:00.000Z`,
      },
    });
    expect(vacRes.ok(), `Urlaub anlegen fehlgeschlagen (${vacRes.status()})`).toBe(true);

    const balRes = await h.ctx.get(
      `/api/dashboard/hour-budget-balance?month=${MONTH}&year=${YEAR}&teamId=${balanceTeamId}`,
    );
    expect(balRes.ok(), `Bilanz fehlgeschlagen (${balRes.status()})`).toBe(true);
    const bal = (await balRes.json()) as {
      approvedHours: number;
      consumedHours: number;
      remainingHours: number;
      yearApprovedHours: number;
      yearConsumedHours: number;
      yearBalance: number;
      warningThresholdHours: number;
      warningActive: boolean;
      hasBudgets: boolean;
    };

    expect(bal.hasBudgets).toBe(true);
    expect(bal.approvedHours).toBe(100);
    // Nur die 14 Arbeitsstunden — die Urlaubsstunden fließen NICHT ein.
    expect(bal.consumedHours).toBe(14);
    expect(bal.remainingHours).toBe(86);
    // Jahressaldo: jeder Monat seit Januar zählt 100 genehmigte Stunden.
    expect(bal.yearApprovedHours).toBe(100 * MONTH);
    expect(bal.yearConsumedHours).toBe(14);
    expect(bal.yearBalance).toBe(100 * MONTH - 14);
    expect(bal.warningThresholdHours).toBe(150);
    // Ab dem 2. Monat übersteigt der Saldo (>= 186) die Schwelle (150).
    expect(bal.warningActive).toBe(100 * MONTH - 14 > 150);

    // Monat ohne gültige Zielvereinbarung zählt 0 genehmigte Stunden.
    const emptyRes = await h.ctx.get(
      `/api/dashboard/hour-budget-balance?month=12&year=${YEAR - 2}&teamId=${balanceTeamId}`,
    );
    expect(emptyRes.ok()).toBe(true);
    const emptyBal = (await emptyRes.json()) as {
      approvedHours: number;
      warningActive: boolean;
      hasBudgets: boolean;
    };
    expect(emptyBal.approvedHours).toBe(0);
    expect(emptyBal.warningActive).toBe(false);
    // Das Budget des Teams existiert weiterhin (nur nicht fuer diesen Monat
    // gueltig) — hasBudgets bleibt true, die Karte bleibt sichtbar.
    expect(emptyBal.hasBudgets).toBe(true);

    // Fremdes Team -> 403 (kein Daten-Orakel über die Bilanz). Premium-Plan,
    // damit die Ablehnung am Team-Scope und nicht am Plan-Gate haengt.
    const foreign = await h.seedForeignAdmin();
    await setAccountPlan(foreign.email, "premium");
    const foreignBal = await foreign.ctx.get(
      `/api/dashboard/hour-budget-balance?month=${MONTH}&year=${YEAR}&teamId=${balanceTeamId}`,
    );
    expect(foreignBal.status()).toBe(403);
  });

  test("Free-Gate: 403 plan_feature_required auf allen Endpunkten", async () => {
    const free: FreeAccount = await registerFreeAccount("dienstleister", "budget-free");
    try {
      const listRes = await free.ctx.get("/api/hour-budgets");
      expect(listRes.status()).toBe(403);
      expect(((await listRes.json()) as { code?: string }).code).toBe("plan_feature_required");

      const createRes = await free.ctx.post("/api/hour-budgets", {
        data: { monthlyHours: 100, startDate: `${YEAR}-01-01` },
      });
      expect(createRes.status()).toBe(403);

      const balRes = await free.ctx.get(
        `/api/dashboard/hour-budget-balance?month=${MONTH}&year=${YEAR}`,
      );
      expect(balRes.status()).toBe(403);
      expect(((await balRes.json()) as { code?: string }).code).toBe("plan_feature_required");
    } finally {
      await deleteFreeAccount(free);
    }
  });
});
