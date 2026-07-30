import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Test #551: Der Einzel-Assistent-Export ("Nachweis" auf /assistenten)
 * muss sauber abbrechen und einen Fehler-Toast zeigen, wenn die gewählte
 * Assistenzkraft im Monat KEINE verbindlichen (FIX) Dienste oder Abwesenheiten
 * hat — statt ein leeres oder kaputtes PDF zu liefern.
 *
 * Kontext:
 * - Der "einfache" Monats-Export (Free-Plan) wird in
 *   dienstplan-monats-export-leer-abbruch.spec.ts abgesichert.
 * - Dieser Test prüft den "Einzel-Assistent-Nachweis" (Premium, via
 *   StatementExportDialog) für genau EINE ausgewählte Assistenzkraft.
 *
 * Aufbau:
 * - Frisches Premium-Dienstleister-Konto.
 * - Eine Assistenzkraft mit NUR einem VORLAEUFIG-Entwurf im aktuellen Monat
 *   (kein einziger FIX-Eintrag — härterer Testfall als "gar nichts").
 *
 * Geprüft:
 * 1. Klick auf den Nachweis-Button der Assistenzkraft → kein `download`-Event
 *    innerhalb einer kurzen Frist.
 * 2. Toast "Keine bestätigten Dienste" erscheint.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MM = String(NOW.getMonth() + 1).padStart(2, "0");

function pickDraftDay(): number {
  const today = NOW.getDate();
  let day = 10;
  if (today === day) day += 5;
  return day;
}
const DRAFT_DAY = `${YEAR}-${MM}-${String(pickDraftDay()).padStart(2, "0")}`;

let acc: FreeAccount;
let teamId: number;
let assistantId: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("dienstleister", "einzel-export-leer");
  await setAccountPlan(acc.email, "premium");

  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as Array<{ id: number }>;
  teamId = teams[0]!.id;

  // Assistenzkraft anlegen.
  const suffix = Date.now();
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `Kein FIX ${suffix}`,
      email: `kein-fix-${suffix}@e2e.test`,
      password: "keinfixtest123",
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistenzkraft anlegen").toBe(201);
  assistantId = (await userRes.json()).id as number;

  // Vertrag anlegen.
  await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });

  // Nur ein VORLAEUFIG-Entwurf — kein FIX-Eintrag.
  const draftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      teamId,
      type: "work",
      startTime: `${DRAFT_DAY}T08:00:00.000Z`,
      endTime: `${DRAFT_DAY}T16:00:00.000Z`,
      planningStatus: "VORLAEUFIG",
    },
  });
  expect(draftRes.status(), "Entwurf-Dienst anlegen").toBe(201);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Einzel-Assistent-Nachweis bricht sauber ab, wenn keine FIX-Dienste vorhanden (#551)", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);

  // Zur Assistenten-Seite navigieren.
  await page.goto("/assistenten");
  // Auf die Assistenten-Karte warten (data-testid="assistant-card-{id}").
  const assistantCard = page.getByTestId(`assistant-card-${assistantId}`);
  await expect(assistantCard, "Assistenten-Karte muss nach Login erscheinen").toBeVisible({
    timeout: 20_000,
  });

  // Den Nachweis-Button (payrollExport) innerhalb der Karte finden.
  const btn = assistantCard.getByRole("button", { name: /nachweis/i });
  await expect(btn, "Nachweis-Button muss sichtbar sein").toBeVisible({ timeout: 10_000 });

  // Auf kein Download-Event lauschen — keines darf kommen.
  const downloadPromise = page.waitForEvent("download", { timeout: 8_000 }).catch(() => null);

  await btn.click();

  // Falls ein Dialog aufgeht (StatementExportDialog), muss ein weiterer Klick
  // auf "Export starten"/"PDF herunterladen" erfolgen.
  const exportBtn = page.getByRole("button", { name: /pdf|herunterladen|export starten/i });
  if (await exportBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await exportBtn.click();
  }

  // Kein Download darf stattfinden.
  const download = await downloadPromise;
  expect(
    download,
    "Bei fehlenden FIX-Diensten darf kein Download gestartet werden",
  ).toBeNull();

  // Fehler-Toast muss erscheinen.
  await expect(
    page.getByText(/keine bestätigten dienste/i),
    "Fehler-Toast 'Keine bestätigten Dienste' muss erscheinen",
  ).toBeVisible({ timeout: 15_000 });
});
