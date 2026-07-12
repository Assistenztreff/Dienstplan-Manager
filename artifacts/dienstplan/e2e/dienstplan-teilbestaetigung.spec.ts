import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { registerFreeAccount, deleteFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * Ehrliche Meldung einer MISSLUNGENEN Teil-Bestätigung (Idee #381).
 *
 * Die monatsweise Sammelbestätigung (`confirmAllDrafts` in dienstplan.tsx)
 * setzt alle Entwürfe/Vorschläge nacheinander per PATCH auf FIX und zählt
 * Teilfehler. Der Happy Path ist in dienstplan-monatsbestaetigung.spec.ts
 * abgesichert — dieser Spec erzwingt den bisher UNGETESTETEN Fehlerpfad:
 * Schlägt ein Teil der PATCH-Aufrufe fehl, darf die App die Aktion NICHT als
 * vollständig erfolgreich melden, sonst blieben Dienste unbemerkt Entwurf und
 * würden in Auswertungen und Stundennachweis fehlen.
 *
 * Geprüft wird:
 * - Per Route-Interception wird GENAU EIN PATCH /api/shifts/:id deterministisch
 *   mit 500 beantwortet (GET auf dieselbe URL läuft normal weiter); die beiden
 *   übrigen Entwürfe werden regulär bestätigt.
 * - Es erscheint die GEMISCHTE Fehlermeldung ("2 Dienste bestätigt,
 *   1 fehlgeschlagen. Bitte erneut versuchen.") — und KEIN Erfolgs-Toast.
 * - Serverseitige Gegenprobe (Round-Trip über die DB): der fehlgeschlagene
 *   Dienst steht weiterhin auf VORLAEUFIG, die beiden anderen auf FIX.
 * - Der Sammel-Button bleibt sichtbar und zeigt Zähler 1 — der verbliebene
 *   Entwurf ist weiterhin bestätigbar (kein stilles "alles erledigt").
 *
 * Setup: frisches Free-Konto über den Self-Service (eigenes Standard-Team,
 * keine Kollisionen mit parallelen Specs). Die Sammelbestätigung ist
 * plan-unabhängig (PATCH ohne startTime greift kein historyMonths-Limit).
 * Schichten liegen im aktuellen Monat, je ein eigener Tag.
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
// Drei Entwürfe (VORLAEUFIG): zwei sollen bestätigt werden, einer schlägt fehl.
let okShiftIds: number[] = [];
let failShiftId: number;

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

async function planningStatusOf(id: number): Promise<string> {
  const res = await acc.ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { planningStatus: string }).planningStatus;
}

test.beforeAll(async () => {
  // Registrierung + Datenaufbau können beim Cold-Start des Test-Stacks die
  // Standard-Hook-Zeit sprengen.
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "teilbestaetigung");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Teilbestätigung Assistent ${Date.now()}`,
      email: `e2e.teilbestaetigung.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  okShiftIds = [await createDraftShift(10), await createDraftShift(11)];
  failShiftId = await createDraftShift(12);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Teil-Bestätigung mit Fehlschlag meldet gemischte Fehlermeldung und laesst den Dienst Entwurf", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, PASSWORD);

  // Fehlerinjektion: GENAU der PATCH auf die dritte Schicht scheitert mit 500.
  // GET /api/shifts/:id (und alle anderen Methoden/Schichten) laufen normal
  // weiter — nur so bleibt der Teilfehler-Pfad (confirmed > 0 UND failed > 0)
  // deterministisch getroffen.
  let interceptedPatches = 0;
  await page.route(`**/api/shifts/${failShiftId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      interceptedPatches++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "E2E: simulierter Serverfehler" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Ausgangslage: drei bestätigbare Entwürfe.
  const confirmAllButton = page.getByTestId("confirm-all-drafts");
  await expect(
    confirmAllButton,
    "Sammel-Button muss sichtbar sein, solange es Entwürfe gibt",
  ).toBeVisible();
  await expect(confirmAllButton).toContainText("3");

  // Sammelaktion auslösen und im Dialog bestätigen.
  await confirmAllButton.click();
  const dialog = page.getByTestId("confirm-all-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("confirm-all-description")).toContainText("3 Entwürfe");
  await page.getByTestId("confirm-all-submit").click();

  // Dialog schließt, sobald alle PATCH-Aufrufe durch sind (auch bei Fehlern).
  await expect(dialog).not.toBeVisible();

  // KERN DES SPECS: Die App muss den Teilfehler EHRLICH melden — gemischte
  // Fehlermeldung, kein Erfolgs-Toast.
  await expect(
    page.getByText("2 Dienste bestätigt, 1 fehlgeschlagen. Bitte erneut versuchen."),
    "Teilfehler muss als gemischte Fehlermeldung erscheinen",
  ).toBeVisible();
  await expect(
    page.getByText(/Dienste bestätigt — zählen jetzt/),
    "Es darf KEIN vollständiger Erfolgs-Toast erscheinen",
  ).toHaveCount(0);

  // Die Injektion muss tatsächlich gegriffen haben, sonst beweist der Spec nichts.
  expect(interceptedPatches, "Der simulierte PATCH-Fehler muss ausgelöst worden sein").toBe(1);

  // Serverseitige Gegenprobe (Round-Trip über die DB): der fehlgeschlagene
  // Dienst bleibt Entwurf, die beiden anderen sind verbindlich.
  expect(
    await planningStatusOf(failShiftId),
    "Fehlgeschlagener Dienst muss Entwurf (VORLAEUFIG) bleiben",
  ).toBe("VORLAEUFIG");
  for (const id of okShiftIds) {
    expect(
      await planningStatusOf(id),
      `Schicht ${id} muss trotz Teilfehler bestätigt (FIX) sein`,
    ).toBe("FIX");
  }

  // Kein stilles "alles erledigt": Der Sammel-Button bleibt sichtbar und zeigt
  // den verbliebenen Entwurf an (Liste wurde nach der Aktion neu geladen).
  const remainingButton = page.getByTestId("confirm-all-drafts");
  await expect(
    remainingButton,
    "Sammel-Button muss nach dem Teilfehler sichtbar bleiben",
  ).toBeVisible();
  await expect(remainingButton).toContainText("1");
});
