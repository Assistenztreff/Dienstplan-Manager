import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
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
});
