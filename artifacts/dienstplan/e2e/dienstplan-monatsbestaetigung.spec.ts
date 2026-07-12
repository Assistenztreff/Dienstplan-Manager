import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Monatsweise Sammelbestätigung von Dienstplan-Entwürfen (frühere Idee #304).
 *
 * WICHTIG: Dieser Test betrifft den DIENSTPLAN (planning_status), NICHT die
 * Zeiterfassung (dafür gibt es einen eigenen Test). Alle offenen Entwürfe
 * (VORLAEUFIG) und Vorschläge (ANGEBOTEN) des sichtbaren Monats werden per
 * Sammelaktion verbindlich (FIX) gemacht — technisch je Schicht ein
 * PATCH /api/shifts/:id mit `{ planningStatus: "FIX", force: true }`. Erst
 * FIX-Schichten zählen in Auswertungen und PDF, deshalb sichert dieser Spec
 * ab, dass die Sammelaktion wirklich alle betroffenen Schichten umstellt.
 *
 * Geprüft wird:
 * - Der Sammel-Button („Alle Entwürfe bestätigen") zeigt die korrekte Anzahl
 *   der bestätigbaren Dienste (nur VORLAEUFIG/ANGEBOTEN, keine Abwesenheiten).
 * - Nach der Sammelbestätigung stehen ALLE Entwürfe/Vorschläge auf FIX
 *   (Round-Trip über die DB, kein reiner UI-Effekt).
 * - Kontrollen: eine bereits verbindliche (FIX) Schicht und eine Abwesenheit
 *   (Urlaub) sind NICHT Teil der Sammelaktion und bleiben unverändert.
 * - Der Sammel-Button verschwindet danach (nichts mehr zu bestätigen).
 * - AUSWERTUNGS-BEWEIS (#380): Das Produktversprechen "nur FIX zählt" wird
 *   nicht nur am Status, sondern an den Kennzahlen selbst geprüft. VOR der
 *   Sammelbestätigung zählen weder `GET /dashboard/summary`
 *   (monthlyPlannedHours) noch `GET /dashboard/hours-balance` (plannedHours/
 *   valuedHours) die Entwürfe/Vorschläge mit; DANACH enthalten beide die
 *   bestätigten Dienste. Da hours-balance auf den per `storeShiftMetrics`
 *   gespeicherten Roh-Kennzahlen (valuedHours) basiert, fällt eine Regression
 *   auf, die den Status setzt, ohne dass die Kennzahlen (mehr) stimmen.
 *   hours-balance ist Premium-gegated (advancedAnalytics) — der Plan wird nur
 *   für die beiden Lese-Zugriffe kurz auf premium gehoben und sofort wieder
 *   auf free gesenkt, damit der Sammelbestätigungs-Flow selbst weiterhin auf
 *   dem Free-Plan bewiesen bleibt (getUserPlan liest frisch aus der DB).
 *
 * Setup: frisches Free-Konto über den Self-Service (eigenes Standard-Team,
 * keine Kollisionen mit parallelen Specs). Die Sammelbestätigung ist
 * plan-unabhängig — kein Premium-Flip nötig (PATCH ohne startTime greift kein
 * historyMonths-Limit). Schichten liegen im aktuellen Monat (Free-
 * Vorausplanungsfenster immer erfüllt), je ein eigener Tag.
 */

const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = String(now.getUTCMonth() + 1).padStart(2, "0");
function shiftTimes(day: number): { startTime: string; endTime: string } {
  const d = String(day).padStart(2, "0");
  return {
    startTime: `${YEAR}-${MONTH}-${d}T08:00:00.000Z`,
    endTime: `${YEAR}-${MONTH}-${d}T16:00:00.000Z`,
  };
}

const PASSWORD = "free12345"; // registerFreeAccount vergibt dieses Passwort.

let acc: FreeAccount;
let assistantId: number;
// Drei Entwürfe (VORLAEUFIG) — sollen alle per Sammelaktion FIX werden.
let draftShiftIds: number[] = [];
// Ein Vorschlag (ANGEBOTEN) — zählt ebenfalls als bestätigbar.
let offeredShiftId: number;
// Kontrolle: bereits verbindlich (FIX) — nicht Teil der Sammelaktion.
let fixShiftId: number;
// Kontrolle: Abwesenheit (Urlaub) — nie Teil der Sammelaktion.
let vacationShiftId: number;

async function createShift(
  day: number,
  opts: { planningStatus?: string; type?: string } = {},
): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      ...shiftTimes(day),
      type: opts.type ?? "active",
      ...(opts.planningStatus ? { planningStatus: opts.planningStatus } : {}),
    },
  });
  expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function planningStatusOf(id: number): Promise<string> {
  const res = await acc.ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { planningStatus: string }).planningStatus;
}

/** Geplante Soll-Stunden des Monats aus der Dashboard-Übersicht (nur FIX). */
async function readMonthlyPlannedHours(): Promise<number> {
  const res = await acc.ctx.get(
    `/api/dashboard/summary?month=${Number(MONTH)}&year=${YEAR}`,
  );
  expect(res.ok(), `GET /dashboard/summary fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { monthlyPlannedHours: number }).monthlyPlannedHours;
}

interface BalanceRow {
  userId: number;
  plannedHours: number;
  valuedHours: number;
}

/**
 * Liest die Soll/Ist-Zeile des Assistenten aus der Premium-Lohnauswertung.
 * hours-balance ist Premium-gegated — der Plan wird nur für diesen einen
 * Lesezugriff auf premium gehoben und im finally sofort wieder gesenkt.
 */
async function readAssistantBalanceRow(): Promise<BalanceRow> {
  await setAccountPlan(acc.email, "premium");
  try {
    const res = await acc.ctx.get(
      `/api/dashboard/hours-balance?month=${Number(MONTH)}&year=${YEAR}`,
    );
    expect(
      res.ok(),
      `GET /dashboard/hours-balance fehlgeschlagen (${res.status()})`,
    ).toBe(true);
    const rows = (await res.json()) as BalanceRow[];
    const row = rows.find((r) => r.userId === assistantId);
    expect(row, "Auswertung muss eine Zeile für den Assistenten enthalten").toBeDefined();
    return row!;
  } finally {
    await setAccountPlan(acc.email, "free");
  }
}

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "monatsbestaetigung");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Monatsbestätigung Assistent ${Date.now()}`,
      email: `e2e.monatsbestaetigung.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Ausgangszustand bewusst sicherstellen: drei Entwürfe + ein Vorschlag sind
  // bestätigbar; die FIX-Schicht und der Urlaub sind es NICHT.
  draftShiftIds = [
    await createShift(10, { planningStatus: "VORLAEUFIG" }),
    await createShift(11, { planningStatus: "VORLAEUFIG" }),
    await createShift(12, { planningStatus: "VORLAEUFIG" }),
  ];
  offeredShiftId = await createShift(13, { planningStatus: "ANGEBOTEN" });
  fixShiftId = await createShift(14); // Default FIX
  vacationShiftId = await createShift(15, { type: "vacation" });
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Monatsweise Sammelbestätigung setzt alle Entwürfe & Vorschläge auf FIX", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // --- Auswertungen VOR der Sammelbestätigung: Entwürfe zählen NICHT ---
  // Verbindlich (FIX) sind nur die Kontroll-Schicht (8 h Arbeit) und der
  // Urlaub (8 h, echte Schichtzeiten → zählt zum Soll). Die 3 Entwürfe + der
  // Vorschlag (zusammen 32 h) dürfen in KEINER Kennzahl auftauchen.
  expect(
    await readMonthlyPlannedHours(),
    "summary: vor der Bestätigung zählen nur FIX-Schicht (8h) + Urlaub (8h)",
  ).toBeCloseTo(16, 2);
  const balanceBefore = await readAssistantBalanceRow();
  expect(
    balanceBefore.plannedHours,
    "hours-balance: Soll vor der Bestätigung = FIX-Schicht (8h) + Urlaub (8h)",
  ).toBeCloseTo(16, 2);
  expect(
    balanceBefore.valuedHours,
    "hours-balance: gewertete Stunden vor der Bestätigung = nur die FIX-Arbeitsschicht (8h)",
  ).toBeCloseTo(8, 2);

  await loginViaUi(page, acc.email, PASSWORD);

  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Der Sammel-Button trägt einen Zähler = Anzahl bestätigbarer Dienste. Vier
  // sind offen (3× VORLAEUFIG + 1× ANGEBOTEN); FIX und Urlaub zählen NICHT mit.
  const confirmAllButton = page.getByTestId("confirm-all-drafts");
  await expect(
    confirmAllButton,
    "Sammel-Button muss sichtbar sein, solange es Entwürfe gibt",
  ).toBeVisible();
  await expect(confirmAllButton).toContainText("4");

  // Sammelaktion auslösen: Dialog öffnet, Anzahl wird nochmals angezeigt.
  await confirmAllButton.click();
  const dialog = page.getByTestId("confirm-all-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("confirm-all-description")).toContainText("4 Entwürfe");
  await page.getByTestId("confirm-all-submit").click();

  // Dialog schließt, sobald alle PATCH-Aufrufe durch sind.
  await expect(dialog).not.toBeVisible();

  // Der Sammel-Button verschwindet — nichts mehr zu bestätigen.
  await expect(
    page.getByTestId("confirm-all-drafts"),
    "Sammel-Button muss nach der Bestätigung verschwinden",
  ).toHaveCount(0);

  // Serverseitige Gegenprobe (Round-Trip über die DB): ALLE ehemals offenen
  // Dienste stehen jetzt auf FIX und zählen damit in Auswertungen.
  for (const id of [...draftShiftIds, offeredShiftId]) {
    expect(
      await planningStatusOf(id),
      `Schicht ${id} muss nach der Sammelbestätigung FIX sein`,
    ).toBe("FIX");
  }

  // Kontrollen: die bereits verbindliche Schicht bleibt FIX, der Urlaub bleibt
  // eine (verbindliche) Abwesenheit — die Sammelaktion fasst sie nicht an.
  expect(await planningStatusOf(fixShiftId), "FIX-Schicht bleibt FIX").toBe("FIX");
  const vacationRes = await acc.ctx.get(`/api/shifts/${vacationShiftId}`);
  expect(vacationRes.ok(), "GET Urlaubs-Schicht fehlgeschlagen").toBe(true);
  expect(
    ((await vacationRes.json()) as { type: string }).type,
    "Abwesenheit (Urlaub) darf durch die Sammelaktion nicht verändert werden",
  ).toBe("vacation");

  // --- Auswertungen NACH der Sammelbestätigung: bestätigte Dienste zählen ---
  // Die 4 bestätigten Dienste (32 h) müssen jetzt in den Kennzahlen stecken:
  // summary 16 h → 48 h; hours-balance Soll 16 h → 48 h, gewertete Stunden
  // 8 h → 40 h (5 Arbeitsschichten à 8 h aus den per storeShiftMetrics
  // gespeicherten Roh-Kennzahlen). Bliebe eine Kennzahl auf dem alten Stand,
  // wäre der Status nur kosmetisch gesetzt — genau die Regression, die dieser
  // Spec abfangen soll.
  expect(
    await readMonthlyPlannedHours(),
    "summary: nach der Bestätigung zählen alle 6 Dienste (5 Arbeit + Urlaub = 48h)",
  ).toBeCloseTo(48, 2);
  const balanceAfter = await readAssistantBalanceRow();
  expect(
    balanceAfter.plannedHours,
    "hours-balance: Soll nach der Bestätigung = 5 Arbeitsschichten (40h) + Urlaub (8h)",
  ).toBeCloseTo(48, 2);
  expect(
    balanceAfter.valuedHours,
    "hours-balance: gewertete Stunden nach der Bestätigung = 5 Arbeitsschichten (40h)",
  ).toBeCloseTo(40, 2);
});
