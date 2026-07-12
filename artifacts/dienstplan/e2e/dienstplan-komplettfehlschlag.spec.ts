import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { registerFreeAccount, deleteFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * Ehrliche Meldung eines KOMPLETTEN Fehlschlags der Bestätigung (Task #425).
 *
 * Die Teilfehler-Meldung der Sammelbestätigung ist in
 * dienstplan-teilbestaetigung.spec.ts abgesichert. Dieser Spec erzwingt die
 * beiden verbleibenden, bisher UNGETESTETEN Fehlerpfade in dienstplan.tsx:
 *
 * 1. `confirmAllDrafts`, Zweig `confirmed === 0`: ALLE PATCH /api/shifts/:id
 *    der Sammelaktion schlagen fehl. Die App muss den Komplett-Fehlschlag
 *    ehrlich melden ("Bestätigen fehlgeschlagen. Bitte erneut versuchen."),
 *    darf KEINEN Erfolgs-Toast zeigen, alle Dienste bleiben Entwurf
 *    (DB-Round-Trip) und der Sammel-Button bleibt mit unverändertem Zähler
 *    sichtbar — kein stilles "alles erledigt".
 *
 * 2. `confirmShift` (Ein-Klick-Bestätigung direkt am Badge im Kalender):
 *    Der einzelne PATCH schlägt fehl → Fehler-Toast, kein Erfolgs-Toast,
 *    der Dienst bleibt Entwurf.
 *
 * Bei einer Regression könnte die App einen kompletten Fehlschlag als Erfolg
 * melden und Dienste blieben unbemerkt Entwurf — sie würden dann in
 * Auswertungen und Stundennachweis fehlen (nur FIX zählt).
 *
 * Fehlerinjektion per Route-Interception (Muster wie in
 * dienstplan-teilbestaetigung.spec.ts): NUR PATCH-Aufrufe werden mit 500
 * beantwortet, GET & Co. laufen normal weiter.
 *
 * Setup: frisches Free-Konto über den Self-Service (eigenes Standard-Team,
 * keine Kollisionen mit parallelen Specs). Die Bestätigung ist plan-unabhängig
 * (PATCH ohne startTime greift kein historyMonths-Limit). Schichten liegen im
 * aktuellen Monat, je ein eigener Tag.
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
// Drei Entwürfe (VORLAEUFIG) für die Sammelaktion; der dritte dient danach
// zusätzlich als Ziel der Einzel-Bestätigung.
let draftShiftIds: number[] = [];
let singleShiftId: number;

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

  acc = await registerFreeAccount("privat", "komplettfehlschlag");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Komplettfehlschlag Assistent ${Date.now()}`,
      email: `e2e.komplettfehlschlag.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  draftShiftIds = [
    await createDraftShift(10),
    await createDraftShift(11),
    await createDraftShift(12),
  ];
  singleShiftId = draftShiftIds[2];
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Sammelbestätigung mit Komplett-Fehlschlag meldet Fehler und laesst alle Dienste Entwurf", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, PASSWORD);

  // Fehlerinjektion: JEDER PATCH /api/shifts/:id scheitert mit 500. GET (und
  // alle anderen Methoden) laufen normal weiter — nur so wird deterministisch
  // der Zweig `confirmed === 0` von confirmAllDrafts getroffen. Das Glob
  // `**/api/shifts/*` matcht nur ID-Pfade, nicht die Listen-URL
  // `/api/shifts?month=...` (Neuladen der Liste bleibt intakt).
  let interceptedPatches = 0;
  await page.route("**/api/shifts/*", async (route) => {
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

  // KERN DES SPECS: Kompletter Fehlschlag muss EHRLICH gemeldet werden —
  // reiner Fehler-Toast, KEIN Erfolgs- und KEIN gemischter Teilfehler-Toast.
  await expect(
    page.getByText("Bestätigen fehlgeschlagen. Bitte erneut versuchen.", { exact: true }),
    "Komplett-Fehlschlag muss als Fehler-Toast erscheinen",
  ).toBeVisible();
  await expect(
    page.getByText(/bestätigt — zähl(t|en) jetzt/),
    "Es darf KEIN Erfolgs-Toast erscheinen",
  ).toHaveCount(0);
  await expect(
    page.getByText(/Dienste? bestätigt, \d+ fehlgeschlagen/),
    "Es darf KEIN gemischter Teilfehler-Toast erscheinen",
  ).toHaveCount(0);

  // Die Injektion muss ALLE drei PATCH-Aufrufe getroffen haben, sonst beweist
  // der Spec nichts.
  expect(
    interceptedPatches,
    "Alle drei simulierten PATCH-Fehler müssen ausgelöst worden sein",
  ).toBe(3);

  // Serverseitige Gegenprobe (Round-Trip über die DB): ALLE Dienste bleiben
  // Entwurf (VORLAEUFIG).
  for (const id of draftShiftIds) {
    expect(
      await planningStatusOf(id),
      `Schicht ${id} muss nach dem Komplett-Fehlschlag Entwurf (VORLAEUFIG) bleiben`,
    ).toBe("VORLAEUFIG");
  }

  // Kein stilles "alles erledigt": Der Sammel-Button bleibt sichtbar und zeigt
  // weiterhin ALLE drei Entwürfe an (Liste wurde nach der Aktion neu geladen).
  const remainingButton = page.getByTestId("confirm-all-drafts");
  await expect(
    remainingButton,
    "Sammel-Button muss nach dem Komplett-Fehlschlag sichtbar bleiben",
  ).toBeVisible();
  await expect(remainingButton).toContainText("3");
});

test("Einzel-Bestätigung mit Fehlschlag meldet Fehler und laesst den Dienst Entwurf", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, PASSWORD);

  // Fehlerinjektion: GENAU der PATCH auf die Ziel-Schicht scheitert mit 500;
  // GET auf dieselbe URL läuft normal weiter.
  let interceptedPatches = 0;
  await page.route(`**/api/shifts/${singleShiftId}`, async (route) => {
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

  // Ein-Klick-Bestätigung direkt am Badge (mobile Listenansicht ist die
  // Standardansicht des Test-Viewports; der Button trägt eine data-testid,
  // da 400px-Viewports Text-Labels teils ausblenden). Der Badge existiert
  // parallel im (per CSS versteckten) Desktop-Container — deshalb auf den
  // mobilen Container einschränken (sonst Strict-Mode-Verletzung).
  const confirmButton = page
    .getByTestId("dienstplan-mobile")
    .getByTestId(`shift-confirm-${singleShiftId}`);
  await expect(
    confirmButton,
    "Bestätigen-Button am Entwurfs-Badge muss sichtbar sein",
  ).toBeVisible();
  await confirmButton.click();

  // KERN DES SPECS: Der Fehlschlag muss EHRLICH gemeldet werden.
  await expect(
    page.getByText("Bestätigen fehlgeschlagen. Bitte erneut versuchen.", { exact: true }),
    "Fehlgeschlagene Einzel-Bestätigung muss als Fehler-Toast erscheinen",
  ).toBeVisible();
  await expect(
    page.getByText(/Dienst bestätigt — zählt jetzt/),
    "Es darf KEIN Erfolgs-Toast erscheinen",
  ).toHaveCount(0);

  // Die Injektion muss tatsächlich gegriffen haben.
  expect(interceptedPatches, "Der simulierte PATCH-Fehler muss ausgelöst worden sein").toBe(1);

  // Serverseitige Gegenprobe (Round-Trip über die DB): der Dienst bleibt
  // Entwurf (VORLAEUFIG).
  expect(
    await planningStatusOf(singleShiftId),
    "Dienst muss nach fehlgeschlagener Einzel-Bestätigung Entwurf (VORLAEUFIG) bleiben",
  ).toBe("VORLAEUFIG");

  // Der Badge bleibt bestätigbar — der Button ist weiterhin sichtbar
  // (kein stilles "erledigt").
  await expect(
    confirmButton,
    "Bestätigen-Button muss nach dem Fehlschlag sichtbar bleiben",
  ).toBeVisible();
});
