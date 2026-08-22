import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { enableTimeTracking } from "./helpers/teams";

/**
 * E2E-/API-Test für die Funktion "Geplante Zeiten per Klick übernehmen".
 *
 * Die Übernahme befüllt den Ist-Zeit-Dialog mit den Soll-Zeiten der geplanten
 * Schicht; der Assistent kann sie anpassen und als pending-Eintrag speichern.
 * Die Funktion ist mehrfach heikel und wird hier dauerhaft abgesichert:
 *
 * Deckt ab (Done-Kriterien der Aufgabe):
 * - Web-Übernahme-Flow als Assistent: offene Schicht übernehmen, Prefill der
 *   Soll-Zeiten prüfen, neuer pending-Eintrag erscheint in der Tabelle, die
 *   übernommene Schicht verschwindet aus der Liste der offenen Schichten.
 * - Nachtschicht über Mitternacht: das Enddatum im Prefill rollt korrekt auf den
 *   Folgetag, und der gespeicherte Eintrag hat actualEnd > actualStart.
 * - Serverseitiger 409-Doppelbuchungs-Schutz in POST /api/time-tracking: eine
 *   zweite Buchung derselben shiftId wird mit code "shift_already_booked"
 *   abgelehnt — unabhängig von der UI-Filterung.
 *
 * Ein Test-Assistent mit bekanntem Passwort wird im Setup über den echten
 * Einladungs-Flow bereitgestellt (kein manuelles Setzen in der DB).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Zeiterfassungs-Tabelle wird im Desktop-Layout gerendert.
test.use({ viewport: { width: 1280, height: 800 } });

type CreatedUser = { id: number; name: string; email: string };
type Entity = { id: number };
type TimeEntry = {
  id: number;
  shiftId: number | null;
  actualStart: string;
  actualEnd: string;
};

/** Test-Assistent (Subjekt) mit gesetztem Passwort. */
let assistant: CreatedUser & { password: string };
/** Admin-Kontext für Setup, Verifikation und Cleanup. */
let adminCtx: APIRequestContext;

let regularShiftId: number;
let nightShiftId: number;

/** Schichten liegen im aktuellen Monat auf festen Tagen (existieren immer). */
const now = new Date();
const month = now.getMonth() + 1;
const year = now.getFullYear();
const REG_DAY = 5; // reguläre Schicht 08:00–16:00 (Übernahme-Flow)
const NIGHT_DAY = 8; // Nachtschicht 22:00 → 06:00 Folgetag
const DOUBLE_DAY = 12; // dedizierte Schicht für den 409-Test

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Entspricht dem datetime-local-Prefill der App (lokale Zeitzone). */
function localInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Übernahme ${suffix}`,
      email: `e2e.uebernahme.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

/**
 * Generiert über den Admin-Kontext einen Einladungstoken und setzt darüber das
 * Passwort des Assistenten (eigener Kontext, damit die Admin-Session bleibt).
 */
async function setAssistantPassword(
  ctx: APIRequestContext,
  userId: number,
  password: string,
): Promise<void> {
  const inviteRes = await ctx.post(`/api/users/${userId}/invite`, {});
  expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  const pwCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await pwCtx.post("/api/auth/set-password", { data: { token, password } });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
  await pwCtx.dispose();
}

/** Legt eine reguläre Schicht (type "active") für den Assistenten an. */
async function createShift(userId: number, start: Date, end: Date): Promise<number> {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      type: "active",
    },
  });
  expect(res.ok(), `Anlegen der Schicht fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login (der sonst als Seed-Admin anmeldet) greift nie —
  // der Test agiert garantiert als der gewünschte Nutzer (dev- UND prod-tauglich).
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `Login als ${email} fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

async function gotoZeiterfassung(page: Page): Promise<void> {
  await page.goto("/zeiterfassung");
  await expect(page.getByRole("heading", { name: "Zeiterfassung" })).toBeVisible();
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  // Konto-Schalter „Zeiterfassung aktivieren" (Standard AUS) einschalten,
  // sonst blocken alle Zeiterfassungs-Schreibrouten mit 403.
  await enableTimeTracking(adminCtx);

  // POST /users ordnet den neuen Nutzer dem Standard-Team des Admins zu, daher
  // ist der Assistent Mitglied desselben Teams wie die unten erzeugten Schichten.
  const me = await createAssistant(adminCtx, `${unique}`);

  regularShiftId = await createShift(
    me.id,
    new Date(year, month - 1, REG_DAY, 8, 0, 0),
    new Date(year, month - 1, REG_DAY, 16, 0, 0),
  );
  nightShiftId = await createShift(
    me.id,
    new Date(year, month - 1, NIGHT_DAY, 22, 0, 0),
    new Date(year, month - 1, NIGHT_DAY + 1, 6, 0, 0),
  );

  const password = `Pw${unique}!secure`;
  await setAssistantPassword(adminCtx, me.id, password);
  assistant = { ...me, password };
});

test.afterAll(async () => {
  // Best-effort-Cleanup in FK-sicherer Reihenfolge: erst Ist-Zeiten, dann
  // Schichten, dann der Nutzer. Einzelne Fehlschläge blockieren den Rest nicht.
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };
  try {
    // all=true: Aufräumen muss ALLE Monate treffen, nicht nur den
    // serverseitigen Default-Zeitraum (aktueller Kalendermonat).
    const teRes = await adminCtx.get(`/api/time-tracking?userId=${assistant.id}&all=true`);
    if (teRes.ok()) {
      for (const e of (await teRes.json()) as Entity[]) await tryDelete(`/api/time-tracking/${e.id}`);
    }
    const shRes = await adminCtx.get(`/api/shifts?userId=${assistant.id}&all=true`);
    if (shRes.ok()) {
      for (const s of (await shRes.json()) as Entity[]) await tryDelete(`/api/shifts/${s.id}`);
    }
  } catch {
    /* ignore */
  }
  await tryDelete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test.describe("Zeit-Übernahme: Web-Flow als Assistent", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, assistant.email, assistant.password);
    await gotoZeiterfassung(page);
  });

  test("übernimmt eine offene Schicht: Prefill, pending-Eintrag, Schicht verschwindet", async ({
    page,
  }) => {
    const openShifts = page.getByTestId("open-shifts");
    await expect(openShifts).toBeVisible();

    // Die offene reguläre Schicht (08:00–16:00) ist als übernehmbar gelistet.
    const regularRow = openShifts.locator(":scope > div").filter({ hasText: "08:00" });
    await expect(regularRow).toHaveCount(1);

    await regularRow.getByTestId("adopt-shift").click();
    await expect(page.getByTestId("adopt-dialog")).toBeVisible();

    // Prefill: Soll-Zeiten der Schicht sind übernommen (gleicher Tag, 08:00/16:00).
    const expectedStart = localInput(new Date(year, month - 1, REG_DAY, 8, 0, 0));
    const expectedEnd = localInput(new Date(year, month - 1, REG_DAY, 16, 0, 0));
    await expect(page.getByTestId("adopt-start")).toHaveValue(expectedStart);
    await expect(page.getByTestId("adopt-end")).toHaveValue(expectedEnd);

    await page.getByTestId("adopt-save").click();

    // Dialog schließt, ein neuer pending-Eintrag erscheint in der Tabelle.
    await expect(page.getByTestId("adopt-dialog")).toBeHidden();
    await expect(page.getByText("08:00 - 16:00")).toBeVisible();
    // Status-Badge in der Eintrags-Tabelle (nicht der "Offen"-Filter-Button
    // oberhalb der Tabelle → auf die Tabelle scopen).
    await expect(page.locator("table").getByText("Offen").first()).toBeVisible();

    // Die übernommene Schicht verschwindet aus der Liste der offenen Schichten.
    await expect(
      openShifts.locator(":scope > div").filter({ hasText: "08:00" }),
    ).toHaveCount(0);
  });

  test("Nachtschicht: Enddatum rollt auf den Folgetag (actualEnd > actualStart)", async ({
    page,
  }) => {
    const openShifts = page.getByTestId("open-shifts");
    await expect(openShifts).toBeVisible();

    const nightRow = openShifts.locator(":scope > div").filter({ hasText: "22:00" });
    await expect(nightRow).toHaveCount(1);

    await nightRow.getByTestId("adopt-shift").click();
    await expect(page.getByTestId("adopt-dialog")).toBeVisible();

    // Prefill: Start am NIGHT_DAY 22:00, Ende am Folgetag 06:00.
    const startVal = await page.getByTestId("adopt-start").inputValue();
    const endVal = await page.getByTestId("adopt-end").inputValue();
    expect(startVal).toBe(localInput(new Date(year, month - 1, NIGHT_DAY, 22, 0, 0)));
    expect(endVal).toBe(localInput(new Date(year, month - 1, NIGHT_DAY + 1, 6, 0, 0)));
    // Das Enddatum liegt auf einem späteren Kalendertag als der Start.
    expect(endVal.slice(0, 10)).not.toBe(startVal.slice(0, 10));
    expect(new Date(endVal).getTime()).toBeGreaterThan(new Date(startVal).getTime());

    await page.getByTestId("adopt-save").click();
    await expect(page.getByTestId("adopt-dialog")).toBeHidden();

    // Serverseitig gespeicherter Eintrag: Ende echt nach dem Start (Folgetag).
    const res = await adminCtx.get(`/api/time-tracking?userId=${assistant.id}`);
    expect(res.ok()).toBe(true);
    const entries = (await res.json()) as TimeEntry[];
    const entry = entries.find((e) => e.shiftId === nightShiftId);
    expect(entry, "Nachtschicht-Eintrag wurde nicht gespeichert").toBeTruthy();
    expect(new Date(entry!.actualEnd).getTime()).toBeGreaterThan(
      new Date(entry!.actualStart).getTime(),
    );
  });
});

test.describe("Zeit-Übernahme: serverseitiger Doppelbuchungs-Schutz", () => {
  test("zweite Buchung derselben shiftId -> 409 shift_already_booked", async () => {
    const start = new Date(year, month - 1, DOUBLE_DAY, 9, 0, 0);
    const end = new Date(year, month - 1, DOUBLE_DAY, 17, 0, 0);
    const shiftId = await createShift(assistant.id, start, end);

    const payload = {
      data: {
        userId: assistant.id,
        shiftId,
        actualStart: start.toISOString(),
        actualEnd: end.toISOString(),
      },
    };

    const first = await adminCtx.post("/api/time-tracking", payload);
    expect(first.status(), "erste Buchung muss 201 sein").toBe(201);

    const second = await adminCtx.post("/api/time-tracking", payload);
    expect(second.status(), "zweite Buchung muss 409 sein").toBe(409);
    const body = (await second.json()) as { code?: string };
    expect(body.code).toBe("shift_already_booked");
  });
});
