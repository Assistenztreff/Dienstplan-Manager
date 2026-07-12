import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Ein-Klick-Bestätigung: Rollen-Grenzen + Desktop-Tabellenansicht (Task #305).
 *
 * Ergänzt `dienstplan-einklick-bestaetigung.spec.ts` (Admin-Sicht, mobile
 * Listenansicht) um die beiden ungetesteten Flanken:
 *
 * 1. ASSISTENTEN dürfen ihre eigenen Entwürfe/Vorschläge NICHT selbst
 *    verbindlich machen — die Ein-Klick-Bestätigung ist eine reine
 *    Admin-Funktion:
 *    - UI: Der eigene VORLAEUFIG-Dienst ist sichtbar, trägt aber KEINEN
 *      `shift-confirm-{id}`-Button (mobil UND Desktop — zwei Codepfade), und
 *      ein Badge-Klick öffnet keinen Dialog (kein Quick-Confirm-Banner
 *      erreichbar).
 *    - API: PATCH /api/shifts/:id mit planningStatus als Assistent → 403
 *      (requireAdmin), Status bleibt unverändert.
 * 2. DESKTOP-Tabellenansicht (Viewport ≥ md): Der Bestätigen-Button läuft dort
 *    über einen zweiten Codepfad (`onConfirm` direkt in dienstplan.tsx statt
 *    über AgendaView/MonthGrid) — er muss für Admins erscheinen UND
 *    funktionieren (Klick → Status FIX, Button verschwindet, persistiert).
 *
 * Setup: frisches Free-Konto (Self-Service, eigenes Standard-Team). Der
 * Assistenten-Login läuft über den Einladungsflow: Owner kurz auf Premium
 * heben (Einladen ist caregiverLogin-gegated), Token ziehen, zurück auf Free —
 * Bestandsschutz hält den per Token gesetzten Login gültig.
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
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

let acc: FreeAccount;
let assistantId: number;
let assistantCtx: APIRequestContext | undefined;
// Entwurf des Assistenten — darf für ihn NIE bestätigbar sein (Test 1+2).
let assistantDraftShiftId: number;
// Vorschlag — wird vom Admin in der Desktop-Tabelle bestätigt (Test 3).
let desktopOfferedShiftId: number;

test.beforeAll(async () => {
  // Registrierung + Einladungsflow (2x Plan-Flip per Skript) sprengen beim
  // Cold-Start die Standard-Hook-Zeit.
  test.setTimeout(180_000);

  acc = await registerFreeAccount("privat", "einklickrolle");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Einklick Rolle Assistent ${Date.now()}`,
      email: `e2e.einklickrolle.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  async function createShift(day: number, planningStatus: string): Promise<number> {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        ...shiftTimes(day),
        type: "active",
        planningStatus,
      },
    });
    expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }

  assistantDraftShiftId = await createShift(10, "VORLAEUFIG");
  desktopOfferedShiftId = await createShift(14, "ANGEBOTEN");

  // Assistenten-Login über den Einladungsflow (siehe Spec-Kopf).
  await setAccountPlan(acc.email, "premium");
  let token = "";
  try {
    const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
    expect(inviteRes.ok(), `Einladung sollte mit Premium klappen (${inviteRes.status()})`).toBe(true);
    token = ((await inviteRes.json()) as { token: string }).token;
    expect(token, "Einladungs-Token muss geliefert werden").toBeTruthy();
  } finally {
    await setAccountPlan(acc.email, "free");
  }

  // Passwort setzen = direkter Login des Assistenten (eigener Session-Kontext).
  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  expect(me.ok(), "Assistent muss nach set-password eingeloggt sein").toBe(true);
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id).toBe(assistantId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");
});

test.afterAll(async () => {
  await assistantCtx?.dispose();
  await deleteFreeAccount(acc);
});

test("API: Assistent kann seinen eigenen Entwurf NICHT per PATCH bestätigen (403)", async () => {
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");

  const res = await assistantCtx.patch(`/api/shifts/${assistantDraftShiftId}`, {
    data: { planningStatus: "FIX", force: true },
  });
  expect(
    res.status(),
    "PATCH planningStatus als Assistent muss abgelehnt werden (requireAdmin)",
  ).toBe(403);

  // Gegenprobe mit der ADMIN-Session: Der Status ist unverändert VORLAEUFIG.
  const check = await acc.ctx.get(`/api/shifts/${assistantDraftShiftId}`);
  expect(check.ok(), "GET /api/shifts/:id (Admin) fehlgeschlagen").toBe(true);
  expect(
    ((await check.json()) as { planningStatus: string }).planningStatus,
    "Der Entwurf darf durch den Assistenten-PATCH nicht bestätigt worden sein",
  ).toBe("VORLAEUFIG");
});

test("UI: Assistent sieht seinen Entwurf OHNE Bestätigen-Button (mobil + Desktop, kein Dialog)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");

  // Session-Cookie des Assistenten übernehmen → kein Login-Formular nötig
  // (und der Dev-Auto-Login feuert nicht, weil /api/auth/me 200 liefert).
  const storageState = await assistantCtx.storageState();

  // --- Mobile Listenansicht (Standard-Viewport 400px) ---
  const mobileContext = await browser.newContext({ storageState });
  const mobilePage = await mobileContext.newPage();
  try {
    await mobilePage.goto("/dienstplan");
    await expect(
      mobilePage.getByRole("heading", { name: "Dienstplan", exact: true }),
    ).toBeVisible();
    const mobile = mobilePage.getByTestId("dienstplan-mobile");
    // Ansicht-Umschalter lebt im sticky Header AUSSERHALB des Containers.
    await mobilePage.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();

    const draftBadge = mobile.getByTestId(`shift-badge-${assistantDraftShiftId}`);
    await expect(draftBadge, "Der eigene Entwurf muss für den Assistenten sichtbar sein").toBeVisible();
    await expect(draftBadge).toHaveAttribute("data-planning-status", "VORLAEUFIG");
    await expect(
      mobile.getByTestId(`shift-confirm-${assistantDraftShiftId}`),
      "Assistenten dürfen KEINEN Ein-Klick-Bestätigen-Button sehen (mobil)",
    ).toHaveCount(0);

    // Badge-Klick darf für Assistenten KEINEN Bearbeiten-Dialog öffnen —
    // damit ist auch das Quick-Confirm-Banner unerreichbar.
    await draftBadge.click();
    await expect(
      mobilePage.getByTestId("shift-dialog"),
      "Badge-Klick darf für Assistenten keinen Dialog öffnen",
    ).toHaveCount(0);
  } finally {
    await mobileContext.close();
  }

  // --- Desktop-Tabellenansicht (zweiter Codepfad in dienstplan.tsx) ---
  const desktopContext = await browser.newContext({
    storageState,
    viewport: DESKTOP_VIEWPORT,
  });
  const desktopPage = await desktopContext.newPage();
  try {
    await desktopPage.goto("/dienstplan");
    await expect(
      desktopPage.getByRole("heading", { name: "Dienstplan", exact: true }),
    ).toBeVisible();
    const desktop = desktopPage.getByTestId("dienstplan-desktop");
    // Standard-Desktop-Ansicht ist die Tabelle; sicherheitshalber umschalten.
    // Ansicht-Umschalter lebt im sticky Header AUSSERHALB des Containers.
    await desktopPage.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table").click();

    const draftBadge = desktop.getByTestId(`shift-badge-${assistantDraftShiftId}`);
    await expect(draftBadge, "Der eigene Entwurf muss in der Tabelle sichtbar sein").toBeVisible();
    await expect(draftBadge).toHaveAttribute("data-planning-status", "VORLAEUFIG");
    await expect(
      desktop.getByTestId(`shift-confirm-${assistantDraftShiftId}`),
      "Assistenten dürfen KEINEN Ein-Klick-Bestätigen-Button sehen (Desktop-Tabelle)",
    ).toHaveCount(0);

    await draftBadge.click();
    await expect(
      desktopPage.getByTestId("shift-dialog"),
      "Badge-Klick darf für Assistenten auch in der Tabelle keinen Dialog öffnen",
    ).toHaveCount(0);
  } finally {
    await desktopContext.close();
  }
});

test("Desktop-Tabelle: Admin bestätigt einen Vorschlag per Badge-Button → Status FIX", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
  const page = await context.newPage();
  try {
    await loginViaUi(page, acc.email, PASSWORD);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    // WICHTIG: auf `dienstplan-desktop` scopen — dieselben Badges existieren
    // auch im per CSS versteckten Mobile-Zweig (Strict-Mode-Verletzung).
    const desktop = page.getByTestId("dienstplan-desktop");
    // Ansicht-Umschalter lebt im sticky Header AUSSERHALB des Containers.
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table").click();

    const offeredBadge = desktop.getByTestId(`shift-badge-${desktopOfferedShiftId}`);
    await expect(offeredBadge, "Vorschlag muss in der Tabelle sichtbar sein").toBeVisible();
    await expect(offeredBadge).toHaveAttribute("data-planning-status", "ANGEBOTEN");

    const confirmButton = desktop.getByTestId(`shift-confirm-${desktopOfferedShiftId}`);
    await expect(
      confirmButton,
      "Der Bestätigen-Button muss für Admins auch in der Desktop-Tabelle erscheinen",
    ).toBeVisible();
    await confirmButton.click();

    // Nach der Bestätigung: Status FIX, Button weg.
    await expect(offeredBadge).toHaveAttribute("data-planning-status", "FIX");
    await expect(
      desktop.getByTestId(`shift-confirm-${desktopOfferedShiftId}`),
      "Bestätigen-Button muss nach der Bestätigung verschwinden",
    ).toHaveCount(0);

    // Serverseitige Gegenprobe: wirklich persistiert.
    const res = await acc.ctx.get(`/api/shifts/${desktopOfferedShiftId}`);
    expect(res.ok(), "GET /api/shifts/:id nach Bestätigung fehlgeschlagen").toBe(true);
    expect(((await res.json()) as { planningStatus: string }).planningStatus).toBe("FIX");
  } finally {
    await context.close();
  }
});
