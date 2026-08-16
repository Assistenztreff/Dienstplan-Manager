import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  enableTimeTracking,
  deleteFreeAccount,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";
import { loginViaUi } from "./helpers/auth";

/**
 * UI-E2E: Die gestufte Team-Freischaltung (Task #735) durch die Augen der
 * freigeschalteten Person selbst.
 *
 * Ergänzt `dienstplan-team-zugriffsstufen-api.spec.ts` (serverseitige
 * Durchsetzung) um den Blick durchs Frontend: ein falsch gesetztes Gate zeigt
 * entweder einen Knopf, der beim Klick am Server scheitert (Frust), oder
 * versteckt eine eigentlich erlaubte Funktion (die Freigabe wirkt "kaputt").
 *
 * Für basis/stufe1/stufe2 wird je geprüft: sichtbare Navigation,
 * Team-Umschalter, ein Dienstplan-Schreibversuch, die Team-Verwaltung
 * (Assistenzkraft anlegen/bearbeiten) und die Zeiterfassung — jeweils sowohl
 * das Erlaubte als auch das Nicht-Erlaubte.
 */

// Die Desktop-Subnavigation ("app-subnav-desktop") ist unterhalb der
// md-Breakpoint per CSS ausgeblendet; der Standard-Viewport dieses Projekts
// ist mobil (400x720). Fuer die hier geprueften Nav-Sichtbarkeiten braucht es
// die Desktop-Ansicht.
test.use({ viewport: { width: 1280, height: 800 } });

const RUN = Date.now();
const HELFER_EMAIL = `e2e.stufenui.helfer.${RUN}@dienstplan.test`;
const HELFER_PASSWORD = `Pw${RUN}!stufenui`;

type Entity = { id: number };
type Team = { id: number; name: string };
type AccessLevel = "keine" | "basis" | "stufe1" | "stufe2";

let owner: FreeAccount;
let teamA = 0;
let helferId = 0;
let kollegeId = 0;
let kollegeName = "";
let kollegeEmail = "";
let timeEntryId = 0;

async function setAccess(level: AccessLevel): Promise<void> {
  const res = await owner.ctx.patch(`/api/teams/${teamA}/members/${helferId}`, {
    data: { accessLevel: level },
  });
  expect(res.ok(), `Stufe ${level} setzen fehlgeschlagen (${res.status()})`).toBe(true);
}

/** Klickt "Nächster Monat", bis der Kalender bei November 2026 (Testdaten) landet. */
async function gotoNovember2026(page: import("@playwright/test").Page): Promise<void> {
  const label = page.getByTestId("month-label");
  for (let i = 0; i < 24; i++) {
    const text = await label.innerText();
    if (text.includes("November") && text.includes("2026")) return;
    await page.getByTestId("next-month").click();
  }
  throw new Error("November 2026 im Kalender nicht erreicht");
}

test.beforeAll(async () => {
  owner = await registerFreeAccount("dienstleister", `stufenui${RUN}`);
  await setAccountPlan(owner.email, "premium");
  await enableTimeTracking(owner.ctx);

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  const teams = (await teamsRes.json()) as Team[];
  teamA = teams[0]!.id;

  kollegeName = `E2E Kollege UI ${RUN}`;
  kollegeEmail = `e2e.stufenui.kollege.${RUN}@dienstplan.test`;
  const kollegeRes = await owner.ctx.post("/api/users", {
    data: {
      name: kollegeName,
      email: kollegeEmail,
      role: "assistant",
      teamId: teamA,
    },
  });
  expect(kollegeRes.ok(), "Kollege anlegen fehlgeschlagen").toBe(true);
  kollegeId = ((await kollegeRes.json()) as Entity).id;

  const helferRes = await owner.ctx.post("/api/users", {
    data: {
      name: `E2E Helfer UI ${RUN}`,
      email: HELFER_EMAIL,
      role: "assistant",
      teamId: teamA,
    },
  });
  expect(helferRes.ok(), "Helfer anlegen fehlgeschlagen").toBe(true);
  helferId = ((await helferRes.json()) as Entity).id;

  // Ist-Zeit-Eintrag des Kollegen — Pruefstein fuer die Zeiterfassung (Stufe 2).
  const shiftRes = await owner.ctx.post("/api/shifts", {
    data: {
      userId: kollegeId,
      teamId: teamA,
      startTime: "2026-11-20T08:00:00.000Z",
      endTime: "2026-11-20T16:00:00.000Z",
      type: "active",
    },
  });
  expect(shiftRes.ok(), "Dienst anlegen fehlgeschlagen").toBe(true);
  const shiftId = ((await shiftRes.json()) as Entity).id;
  const entryRes = await owner.ctx.post("/api/time-tracking", {
    data: {
      userId: kollegeId,
      shiftId,
      teamId: teamA,
      actualStart: "2026-11-20T08:05:00.000Z",
      actualEnd: "2026-11-20T16:10:00.000Z",
    },
  });
  expect(entryRes.ok(), `Zeiteintrag anlegen fehlgeschlagen (${entryRes.status()})`).toBe(true);
  timeEntryId = ((await entryRes.json()) as Entity).id;

  const inviteRes = await owner.ctx.post(`/api/users/${helferId}/invite`, {});
  expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };
  // WICHTIG: set-password loggt den Ziel-Nutzer auf der aufrufenden Session
  // ein (Einladungsflow) — mit owner.ctx aufgerufen würde das die
  // Inhaber-Session durch die Helfer-Identität ersetzen. Deshalb ein
  // eigener, wegwerfbarer Kontext für den Helfer.
  const helferSetupCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await helferSetupCtx.post("/api/auth/set-password", {
    data: { token, password: HELFER_PASSWORD },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
  await helferSetupCtx.dispose();
});

test.afterAll(async () => {
  await deleteFreeAccount(owner);
});

test.describe("Gestufte Team-Freischaltung im Browser", () => {
  test("basis: Dienstplan sichtbar, Team-Verwaltung/Auswerten NICHT, Planen scheitert", async ({ page }) => {
    await setAccess("basis");
    await loginViaUi(page, HELFER_EMAIL, HELFER_PASSWORD);

    // "Dienstplan" ist ein Kind der "Planen"-Gruppe und erscheint nur in der
    // zweiten Tab-Zeile, wenn die Gruppe aktiv ist — dafuer erst hierher
    // navigieren, statt es direkt nach dem Login (Route "/") zu erwarten.
    await page.goto("/dienstplan");
    const nav = page.getByTestId("app-subnav-desktop");
    await expect(nav.getByRole("link", { name: "Dienstplan" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Auswerten" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Team-Verwaltung" })).toHaveCount(0);

    // Team-Umschalter ist ab Basis sichtbar (Frontend-Scope, Memory
    // team-access-levels.md Fallstrick 3).
    await expect(page.getByRole("combobox", { name: "Team auswählen" })).toBeVisible();

    // Direktaufruf der (fuer diese Stufe verborgenen) Team-Verwaltung landet
    // auf der 404-Seite statt die Seite trotzdem zu rendern.
    await page.goto("/team-verwaltung");
    await expect(page.getByTestId("assistenzkraft-anlegen")).toHaveCount(0);

    // Planen ist ab Basis (noch) nicht erlaubt: der "Dienst hinzufügen"-Knopf
    // wird dem Frontend zufolge gar nicht erst angeboten — konsistent mit dem
    // serverseitigen 403 (dienstplan-team-zugriffsstufen-api.spec.ts), aber
    // ohne den Umweg über einen Knopf, der sowieso nur scheitern wuerde.
    await page.goto("/dienstplan");
    await gotoNovember2026(page);
    await expect(page.getByTestId(/^day-add-2026-11-/).first()).toHaveCount(0);
  });

  test("stufe1: planen erlaubt, Team-Verwaltung mit Assistenzkraft-Pflege, Zeiterfassung-Bestaetigen NICHT", async ({
    page,
  }) => {
    await setAccess("stufe1");
    await loginViaUi(page, HELFER_EMAIL, HELFER_PASSWORD);

    // "Team-Verwaltung" ist ein Kind der "Verwalten"-Gruppe und erscheint nur
    // in der zweiten Tab-Zeile, wenn diese Gruppe aktiv ist — dafuer erst
    // dorthin navigieren. "Auswerten" ist ein eigenstaendiger Punkt und daher
    // schon vorher sichtbar.
    const nav = page.getByTestId("app-subnav-desktop");
    await expect(nav.getByRole("link", { name: "Auswerten" })).toBeVisible();

    // Team-Verwaltung: Assistenzkraft anlegen ist sichtbar; ein bestehender
    // Assistent laesst sich zum Bearbeiten oeffnen (Bearbeiten-Dialog prefill).
    await page.goto("/team-verwaltung");
    await expect(nav.getByRole("link", { name: "Team-Verwaltung" })).toBeVisible();
    await expect(page.getByTestId("assistenzkraft-anlegen")).toBeVisible();
    const kollegeCard = page.getByTestId(`assistant-card-${kollegeId}`);
    await kollegeCard.getByRole("button", { name: "Bearbeiten" }).click();
    // Vorname/Nachname sind getrennte Felder (kollegeName wird beim Anlegen
    // gesplittet) — die E-Mail bleibt ein einzelnes, eindeutiges Feld und
    // eignet sich daher als Prefill-Nachweis fuer den Bearbeiten-Dialog.
    await expect(page.locator('input[type="email"]')).toHaveValue(kollegeEmail);
    await page.keyboard.press("Escape");

    // Dienstplan: derselbe Anlegeversuch wie bei Basis gelingt jetzt. Die
    // Desktop-Ansicht startet standardmaessig in der Tabellenansicht (kein
    // MonthGrid, kein "day-add"); erst auf "Monat" umschalten, dann den
    // sichtbaren "dienstplan-desktop"-Container scopen (die mobile
    // MonthGrid-Instanz bleibt parallel im DOM, aber unsichtbar).
    await page.goto("/dienstplan");
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
    await gotoNovember2026(page);
    const desktopCalendar = page.getByTestId("dienstplan-desktop");
    const addButton = desktopCalendar.getByTestId(/^day-add-2026-11-/).first();
    await addButton.click();
    await page.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: kollegeName }).click();
    await page.getByTestId("shift-dialog-save").click();
    await expect(page.getByTestId("shift-dialog-save")).toHaveCount(0, { timeout: 10_000 });

    // Zeiterfassung ist sichtbar (Nav-Punkt "Erfassen" hat keine Stufen-
    // Schranke), das Bestaetigen eines fremden Eintrags scheitert aber am
    // Server (Stufe 2 erforderlich) — das Frontend gated den Knopf nur nach
    // Plan (Premium), nicht nach Team-Stufe, daher schlaegt der Klick fehl.
    const confirmRes = await page.request.patch(`/api/time-tracking/${timeEntryId}/confirm`, {
      data: { status: "confirmed" },
    });
    expect([401, 403, 404]).toContain(confirmRes.status());
  });

  test("stufe2: Zeiterfassung bestaetigen erlaubt", async ({ page }) => {
    await setAccess("stufe2");
    await loginViaUi(page, HELFER_EMAIL, HELFER_PASSWORD);

    await page.goto("/zeiterfassung");
    await expect(page.getByTestId("time-tracking-disabled-notice")).toHaveCount(0);

    const confirmRes = await page.request.patch(`/api/time-tracking/${timeEntryId}/confirm`, {
      data: { status: "confirmed" },
    });
    expect(confirmRes.ok(), `Bestaetigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
  });
});
