import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";
import { pickDateField } from "./helpers/date-picker";

/**
 * UI-Smoke-Test (Aufgabe #828): Schnell-Krankmeldung aus der App.
 *
 * Prüft den kompletten Weg über die echte Oberfläche statt nur die API:
 * - Der auffällige "Krank melden"-Button erscheint auf dem Dashboard einer
 *   Assistenzkraft (KrankmeldungSection, ausgeblendet für Admins).
 * - Der Dialog zeigt die 4 Dauer-Karten, Standardauswahl "Heute".
 * - Nach "Weiter" erscheint der Bestätigungsschritt mit den betroffenen
 *   Tagen; "Krankmeldung absenden" trägt den Tag ein.
 * - Der Button verschwindet danach vom Dashboard (bereits heute krank,
 *   KrankmeldungSection liefert null) — das eigentliche Verhaltens-Kriterium
 *   der Aufgabe ("Button ausgeblendet, wenn bereits krank gemeldet").
 * - Der gleichwertige Kurzweg unter /abwesenheiten ist ebenfalls sichtbar.
 *
 * Aufbau wie die übrigen Assistenten-UI-Specs: Premium-Arbeitgeber, Assistent
 * per Einladungsflow eingeloggt, Session-Cookies in den Browser-Kontext
 * übernommen (verhindert das Dev-Auto-Login, Memory e2e-dev-auto-login).
 */

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "krankui");
  await setAccountPlan(admin.email, "premium"); // Einladen ist Premium-gegated.

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const userRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KrankUI Assistent ${unique}`,
      email: `e2e.krankui.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  const inviteRes = await admin.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const inviteToken = ((await inviteRes.json()) as { token: string }).token;

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  await deleteFreeAccount(admin);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

async function adoptAssistant(page: Page): Promise<void> {
  const state = await assistantCtx!.storageState();
  await page.context().addCookies(state.cookies);
}

test("Assistent kann sich über das Dashboard krank melden; Button verschwindet danach", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await adoptAssistant(page);
  await page.goto("/");

  const krankButton = page.getByTestId("krank-melden-btn");
  await expect(krankButton).toBeVisible({ timeout: 20_000 });
  await krankButton.click();

  // Schritt 1: Dauer-Auswahl — 4 Karten, Standard "Heute" bereits markiert.
  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Heute/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Morgen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mehrere Tage/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Bis Datum/ })).toBeVisible();

  await page.getByRole("button", { name: "Weiter" }).click();

  // Schritt 2: Bestätigung.
  await expect(page.getByText("1 Krankheitstag wird eingetragen.")).toBeVisible();
  await page.getByTestId("krankmeldung-absenden").click();

  // Erfolg: Dialog schließt, Toast erscheint (Antrag, #887 — noch keine Schicht).
  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeHidden({
    timeout: 10_000,
  });
  await expect(
    page.getByText("Krankmeldung für heute beantragt. Ein Planer muss sie noch bestätigen."),
  ).toBeVisible({
    timeout: 10_000,
  });

  // Kern-Kriterium: bereits ein offener Antrag für heute -> Button
  // verschwindet vom Dashboard (auch ohne Bestätigung durch einen Planer).
  await page.reload();
  await expect(page.getByTestId("krank-melden-btn")).toHaveCount(0, { timeout: 20_000 });
});

test("Kurzweg unter /abwesenheiten ist für Assistenzkräfte ebenfalls vorhanden", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await adoptAssistant(page);
  await page.goto("/abwesenheiten");

  // Assistent war im vorigen Test bereits heute krank gemeldet — der Button
  // ist hier bewusst NICHT ausgeblendet (anders als das Dashboard: die Seite
  // erlaubt weitere/andere Zeiträume), er muss also sichtbar bleiben.
  await expect(page.getByTestId("abwesenheiten-krank-melden-btn")).toBeVisible({
    timeout: 20_000,
  });
});

// ---------------------------------------------------------------------------
// Die drei verbleibenden Dauer-Modi (Morgen / Mehrere Tage / Bis Datum)
// ---------------------------------------------------------------------------

/**
 * Hilfsfunktion: Öffnet den Krank-melden-Dialog über die /abwesenheiten-Seite.
 * Der Button dort bleibt sichtbar, auch wenn heute bereits ein Krankheitstag
 * eingetragen ist (anders als der Dashboard-Button).
 */
async function openDialogViaAbwesenheiten(page: Page): Promise<void> {
  await adoptAssistant(page);
  await page.goto("/abwesenheiten");
  const btn = page.getByTestId("abwesenheiten-krank-melden-btn");
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await btn.click();
  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeVisible();
}

test("Morgen-Modus: Bestätigung zeigt einen Krankheitstag, Absenden klappt", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openDialogViaAbwesenheiten(page);

  // "Morgen"-Karte auswählen (Standard ist "Heute").
  await page.getByRole("button", { name: /^Morgen/ }).click();

  // Weiter zum Bestätigungs-Schritt.
  await page.getByRole("button", { name: "Weiter" }).click();

  // Bestätigung: genau 1 Krankheitstag (Morgen ist noch nicht eingetragen).
  await expect(page.getByText("1 Krankheitstag wird eingetragen.")).toBeVisible();

  // Absenden.
  await page.getByTestId("krankmeldung-absenden").click();

  // Dialog schließt sich; Toast erscheint.
  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeHidden({
    timeout: 10_000,
  });
  // Morgen-Modus liefert einen eigenen Toast (nicht "für heute").
  await expect(
    page.getByText("Krankmeldung für morgen beantragt. Ein Planer muss sie noch bestätigen."),
  ).toBeVisible({
    timeout: 10_000,
  });
});

test("Mehrere-Tage-Modus: Stepper (2–14) ändert Anzahl; Bestätigung und Absenden klappt", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openDialogViaAbwesenheiten(page);

  // "Mehrere Tage"-Karte auswählen.
  await page.getByRole("button", { name: /^Mehrere Tage/ }).click();

  // Stepper erscheint; Standardwert ist 3.
  const stepperValue = page.locator(".text-2xl.font-bold.tabular-nums");
  await expect(stepperValue).toBeVisible();
  await expect(stepperValue).toHaveText("3");

  // Untergrenze prüfen: zweimal auf "Weniger" → 2 (nicht unter 2).
  await page.getByRole("button", { name: "Weniger Tage" }).click();
  await page.getByRole("button", { name: "Weniger Tage" }).click();
  await expect(stepperValue).toHaveText("2");
  await page.getByRole("button", { name: "Weniger Tage" }).click(); // bleibt bei 2
  await expect(stepperValue).toHaveText("2");

  // Hochzählen auf 5.
  await page.getByRole("button", { name: "Mehr Tage" }).click();
  await page.getByRole("button", { name: "Mehr Tage" }).click();
  await page.getByRole("button", { name: "Mehr Tage" }).click();
  await expect(stepperValue).toHaveText("5");

  // Obergrenze prüfen: ab 14 stoppt der Stepper.
  for (let i = 0; i < 20; i++) {
    await page.getByRole("button", { name: "Mehr Tage" }).click();
  }
  await expect(stepperValue).toHaveText("14");

  // Zurück auf 5 für den eigentlichen Submit-Pfad.
  for (let i = 0; i < 9; i++) {
    await page.getByRole("button", { name: "Weniger Tage" }).click();
  }
  await expect(stepperValue).toHaveText("5");

  // Weiter zum Bestätigungs-Schritt.
  await page.getByRole("button", { name: "Weiter" }).click();

  // Bestätigung: 5 Krankheitstage (Plural-Variante).
  await expect(page.getByText("5 Krankheitstage werden eingetragen.")).toBeVisible();

  // Absenden — #887: erzeugt einen Antrag (immer 201, keine 409-Duplikatprüfung
  // bei der Antragstellung selbst; die Übersprung-Toleranz greift erst bei
  // der späteren Bestätigung).
  await page.getByTestId("krankmeldung-absenden").click();

  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeHidden({
    timeout: 10_000,
  });
  await expect(page.getByText(/Krankmeldung.*beantragt/)).toBeVisible({ timeout: 10_000 });
});

test("Bis-Datum-Modus: Datum-Picker ändert Enddatum; Bestätigung und Absenden klappt", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openDialogViaAbwesenheiten(page);

  // "Bis Datum"-Karte auswählen.
  await page.getByRole("button", { name: /^Bis Datum/ }).click();

  // DatePickerField erscheint (Standardwert: heute + 6 = 7 Krankheitstage).
  const pickerTrigger = page.getByTestId("krankmeldung-until-date");
  await expect(pickerTrigger).toBeVisible();

  // Standard-Enddatum ist vorbelegt — kein Platzhalter, sondern ein echter Datumswert.
  const todayUtc = new Date(new Date().toISOString().split("T")[0]! + "T00:00:00Z");
  const defaultEnd = new Date(todayUtc);
  defaultEnd.setUTCDate(todayUtc.getUTCDate() + 6);
  const defaultEndIso = defaultEnd.toISOString().split("T")[0]!;
  await expect(pickerTrigger).toHaveAttribute("data-value", defaultEndIso);

  // Ziel-Datum: heute + 8 Tage (immer verschieden vom Standard heute+6).
  // pickDateField navigiert via Monat-/Jahr-Dropdown deterministisch — kein
  // manuelles Blättern nötig, auch wenn das Datum im nächsten Monat liegt.
  const target = new Date(todayUtc);
  target.setUTCDate(todayUtc.getUTCDate() + 8);
  const targetIso = target.toISOString().split("T")[0]!;

  await pickDateField(page, "krankmeldung-until-date", targetIso);

  // Weiter zum Bestätigungs-Schritt (heute bis heute+8 = 9 Krankheitstage).
  await page.getByRole("button", { name: "Weiter" }).click();

  await expect(page.getByText("9 Krankheitstage werden eingetragen.")).toBeVisible();

  // Absenden — erzeugt einen Antrag (#887).
  await page.getByTestId("krankmeldung-absenden").click();

  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeHidden({
    timeout: 10_000,
  });
  await expect(page.getByText(/Krankmeldung.*beantragt/)).toBeVisible({
    timeout: 10_000,
  });
});
