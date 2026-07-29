import { pickDateField } from "./helpers/date-picker";
import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { enableTimeTracking } from "./helpers/teams";

/**
 * E2E-Test für den manuellen Zeiteintrag ohne Schichtbezug in der Web-App,
 * insbesondere den "Endet am Folgetag"-Schalter (Pendant zur Mobile-App).
 *
 * Deckt ab (Done-Kriterien der Aufgabe):
 * - Im Web-Zeiteintrags-Dialog gibt es den "Endet am Folgetag"-Schalter.
 * - Ohne Schalter bleibt die strenge Validierung bestehen: eine Endzeit <=
 *   Startzeit (z.B. 22:00 → 06:00) wird abgewiesen, statt still einen falschen
 *   Eintrag zu erzeugen.
 * - Mit Schalter rollt das Ende auf den Folgetag; der gespeicherte Eintrag hat
 *   actualEnd > actualStart und überspannt einen Kalendertag.
 *
 * Ein Test-Assistent mit bekanntem Passwort wird im Setup über den echten
 * Einladungs-Flow bereitgestellt (kein manuelles Setzen in der DB).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: konsistent mit den übrigen Zeiterfassungs-Tests.
test.use({ viewport: { width: 1280, height: 800 } });

type CreatedUser = { id: number; name: string; email: string };
type Entity = { id: number };
type TimeEntry = {
  id: number;
  shiftId: number | null;
  actualStart: string;
  actualEnd: string;
  notes?: string | null;
};

/** Test-Assistent (Subjekt) mit gesetztem Passwort. */
let assistant: CreatedUser & { password: string };
/** Admin-Kontext für Setup, Verifikation und Cleanup. */
let adminCtx: APIRequestContext;

/** Eindeutige Notiz, um den manuellen Eintrag zuverlässig wiederzufinden. */
const NOTE_TAG = `e2e-folgetag-${Date.now()}`;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Folgetag ${suffix}`,
      email: `e2e.folgetag.${suffix}@dienstplan.test`,
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

  const me = await createAssistant(adminCtx, `${unique}`);
  const password = `Pw${unique}!secure`;
  await setAssistantPassword(adminCtx, me.id, password);
  assistant = { ...me, password };
});

test.afterAll(async () => {
  // Best-effort-Cleanup in FK-sicherer Reihenfolge: erst Ist-Zeiten, dann Nutzer.
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };
  try {
    const teRes = await adminCtx.get(`/api/time-tracking?userId=${assistant.id}`);
    if (teRes.ok()) {
      for (const e of (await teRes.json()) as Entity[]) await tryDelete(`/api/time-tracking/${e.id}`);
    }
  } catch {
    /* ignore */
  }
  await tryDelete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test.describe("Zeiterfassung: manueller Folgetag-Eintrag (Web)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, assistant.email, assistant.password);
    await gotoZeiterfassung(page);
  });

  test("ohne Schalter: Endzeit <= Startzeit wird abgewiesen", async ({ page }) => {
    await page.getByTestId("manual-entry").click();
    await expect(page.getByTestId("manual-dialog")).toBeVisible();

    // Nacht-Eingabe 22:00 → 06:00 ohne aktivierten Folgetag-Schalter.
    await page.getByTestId("manual-start").fill("22:00");
    await page.getByTestId("manual-end").fill("06:00");
    await page.getByTestId("manual-save").click();

    // Strenge Validierung greift: Fehlermeldung, Dialog bleibt offen.
    await expect(page.getByTestId("manual-error")).toContainText(
      "Endzeit muss nach der Startzeit liegen",
    );
    await expect(page.getByTestId("manual-dialog")).toBeVisible();
  });

  test("mit Schalter: Ende rollt auf den Folgetag (actualEnd > actualStart)", async ({
    page,
  }) => {
    await page.getByTestId("manual-entry").click();
    await expect(page.getByTestId("manual-dialog")).toBeVisible();

    // Festes Datum, damit der Folgetag-Wechsel eindeutig prüfbar ist.
    await pickDateField(page, "manual-date", "2026-03-10");
    await page.getByTestId("manual-start").fill("22:00");
    await page.getByTestId("manual-end").fill("06:00");

    // Folgetag-Schalter aktivieren und eindeutige Notiz setzen.
    await page.getByTestId("manual-ends-next-day").click();
    await page.locator("#manual-ends-next-day").waitFor();
    await page.getByPlaceholder("Kurze Anmerkung...").fill(NOTE_TAG);

    await page.getByTestId("manual-save").click();

    // Dialog schließt nach erfolgreichem Speichern.
    await expect(page.getByTestId("manual-dialog")).toBeHidden();

    // Serverseitig gespeicherter Eintrag: Ende echt nach dem Start, anderer Tag.
    const res = await adminCtx.get(`/api/time-tracking?userId=${assistant.id}`);
    expect(res.ok()).toBe(true);
    const entries = (await res.json()) as TimeEntry[];
    const entry = entries.find((e) => e.notes === NOTE_TAG);
    expect(entry, "Manueller Folgetag-Eintrag wurde nicht gespeichert").toBeTruthy();
    expect(entry!.shiftId, "Manueller Eintrag hat keinen Schichtbezug").toBeNull();
    expect(new Date(entry!.actualEnd).getTime()).toBeGreaterThan(
      new Date(entry!.actualStart).getTime(),
    );
    expect(
      new Date(entry!.actualEnd).toISOString().slice(0, 10),
      "Enddatum liegt auf einem späteren Kalendertag",
    ).not.toBe(new Date(entry!.actualStart).toISOString().slice(0, 10));
  });
});
