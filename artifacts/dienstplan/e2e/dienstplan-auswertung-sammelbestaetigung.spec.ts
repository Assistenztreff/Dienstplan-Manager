import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * #380 — Beweisen, dass sammelbestätigte Dienste WIRKLICH in den Auswertungen
 * mitzählen (nicht nur ihren Status auf FIX setzen).
 *
 * Der Schwester-Spec `dienstplan-monatsbestaetigung.spec.ts` prüft nach der
 * Monats-Sammelbestätigung nur den planning_status (FIX) der einzelnen
 * Schichten. Das eigentliche Produktversprechen — „nur FIX-Schichten zählen in
 * Auswertungen und Stundennachweis" — bliebe damit unbewiesen: Ein
 * Regressionsfehler, der zwar den Status setzt, die abgeleiteten Kennzahlen aber
 * nicht (neu) berücksichtigt, würde unbemerkt bleiben.
 *
 * Dieser Spec schließt die Lücke über einen Vorher/Nachher-Vergleich der
 * Auswertung (`GET /api/dashboard/summary`, `monthlyPlannedHours` — frei
 * zugänglich, zählt live ausschließlich FIX-Schichten des Monats):
 * - VORHER: drei Entwürfe (VORLAEUFIG) im laufenden Monat → Soll-Stunden = 0
 *   (Entwürfe zählen NICHT).
 * - Sammelbestätigung über die echte UI-Aktion („Alle Entwürfe bestätigen").
 * - NACHHER: die drei bestätigten Dienste (FIX) erscheinen exakt mit ihren
 *   Stunden in den Soll-Stunden.
 *
 * Setup: frisches Free-Konto über den Self-Service (eigenes Standard-Team, keine
 * Kollisionen mit parallelen Specs). Die Sammelbestätigung ist plan-unabhängig
 * (PATCH ohne startTime greift kein historyMonths-Limit), Schichten liegen im
 * aktuellen Monat, je ein eigener Tag.
 */

const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = String(now.getUTCMonth() + 1).padStart(2, "0");
const MONTH_NUM = now.getUTCMonth() + 1;

const SHIFT_HOURS = 8; // 08:00–16:00 UTC je Dienst
const DRAFT_DAYS = [10, 11, 12];
const EXPECTED_CONFIRMED_HOURS = DRAFT_DAYS.length * SHIFT_HOURS; // 24

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
let draftShiftIds: number[] = [];

async function createDraftShift(day: number): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      ...shiftTimes(day),
      type: "active",
      planningStatus: "VORLAEUFIG",
    },
  });
  expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** Soll-Stunden des laufenden Monats aus der Auswertung (nur FIX-Schichten). */
async function plannedHoursThisMonth(): Promise<number> {
  const res = await acc.ctx.get(`/api/dashboard/summary?month=${MONTH_NUM}&year=${YEAR}`);
  expect(
    res.ok(),
    `GET /api/dashboard/summary fehlgeschlagen (${res.status()})`,
  ).toBe(true);
  return ((await res.json()) as { monthlyPlannedHours: number }).monthlyPlannedHours;
}

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "auswertung-sammelbestaetigung");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Auswertung Assistent ${Date.now()}`,
      email: `e2e.auswertung.sammelbestaetigung.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Ausgangszustand: ausschließlich drei Entwürfe (VORLAEUFIG) im laufenden
  // Monat — noch KEINE verbindliche (FIX) Schicht, damit die Soll-Stunden vorher
  // garantiert 0 sind und der Zuwachs eindeutig den bestätigten Diensten gehört.
  draftShiftIds = [];
  for (const day of DRAFT_DAYS) {
    draftShiftIds.push(await createDraftShift(day));
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Sammelbestätigte Entwürfe zählen erst nach der Bestätigung in die Auswertung", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // VORHER: Entwürfe (VORLAEUFIG) dürfen die Soll-Stunden nicht verfälschen.
  const before = await plannedHoursThisMonth();
  expect(
    before,
    "Entwürfe (VORLAEUFIG) dürfen vor der Bestätigung nicht in den Soll-Stunden zählen",
  ).toBe(0);

  // Sammelbestätigung über die echte Produkt-Aktion in der UI.
  await loginViaUi(page, acc.email, PASSWORD);
  await page.goto("/dienstplan");
  await expect(
    page.getByRole("heading", { name: "Dienstplan", exact: true }),
  ).toBeVisible();

  const confirmAllButton = page.getByTestId("confirm-all-drafts");
  await expect(
    confirmAllButton,
    "Sammel-Button muss sichtbar sein, solange es Entwürfe gibt",
  ).toBeVisible();
  await expect(confirmAllButton).toContainText(String(DRAFT_DAYS.length));

  await confirmAllButton.click();
  const dialog = page.getByTestId("confirm-all-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("confirm-all-submit").click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByTestId("confirm-all-drafts"),
    "Sammel-Button muss nach der Bestätigung verschwinden",
  ).toHaveCount(0);

  // NACHHER: die bestätigten (FIX) Dienste erscheinen exakt mit ihren Stunden.
  // Der Zuwachs gegenüber „vorher" ist der eigentliche Beweis, dass die
  // Auswertung die frisch bestätigten Dienste berücksichtigt.
  const after = await plannedHoursThisMonth();
  expect(
    after - before,
    "Bestätigte Dienste müssen mit ihren Stunden in den Soll-Stunden auftauchen",
  ).toBe(EXPECTED_CONFIRMED_HOURS);
  expect(after).toBe(EXPECTED_CONFIRMED_HOURS);
});
