import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";
import {
  dbDeleteAccountByEmail,
  dbGetEmailVerificationToken,
  dbMarkEmailVerified,
  dbSetEmailVerification,
  dbSetPasswordResetToken,
} from "./helpers/db";

/**
 * Browser-UI-Tests fuer die E-Mail-Flows (Verifizierung + Passwort-Reset).
 *
 * Da die Test-Umgebung keinen echten RESEND_API_KEY hat, werden Tokens direkt
 * per DB-Helfer gesetzt — der Browser navigiert dann zu den echten URLs wie
 * nach einem E-Mail-Klick.
 *
 * Dev-Auto-Login-Falle: Auf oeffentlichen Auth-Seiten (/registrierung,
 * /email-bestaetigen, /login, /passwort-*) wird der /api/auth/dev-login
 * Request abgefangen und mit 401 beantwortet, damit die Seite unauthentifiziert
 * bleibt.
 */

/** Blockiert den Vite-Dev-Auto-Login, damit oeffentliche Seiten sichtbar bleiben. */
async function blockDevAutoLogin(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Dev-Auto-Login im Test deaktiviert" }),
    }),
  );
}

let verifyAcc: FreeAccount;
let loginUnverifiedAcc: FreeAccount;
let resetAcc: FreeAccount;
/** E-Mail des innerhalb des Registrierungs-Tests angelegten Kontos — fuer Cleanup in afterAll. */
let registrationTestEmail = "";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  [verifyAcc, loginUnverifiedAcc, resetAcc] = await Promise.all([
    registerFreeAccount("privat", "ui-verify"),
    registerFreeAccount("privat", "ui-login-unverified"),
    registerFreeAccount("privat", "ui-pwreset"),
  ]);
  // Wenn RESEND_API_KEY gesetzt ist, startet jedes neue Konto mit
  // emailVerified=false. Die Specs setzen den Status wo noetig selbst —
  // als Ausgangszustand brauchen wir verifizierte Konten.
  await Promise.all([
    dbMarkEmailVerified(verifyAcc.email),
    dbMarkEmailVerified(loginUnverifiedAcc.email),
    dbMarkEmailVerified(resetAcc.email),
  ]);
});

test.afterAll(async () => {
  await Promise.all([
    deleteFreeAccount(verifyAcc),
    deleteFreeAccount(loginUnverifiedAcc),
    deleteFreeAccount(resetAcc),
    registrationTestEmail ? dbDeleteAccountByEmail(registrationTestEmail) : Promise.resolve(),
  ]);
});

// ---------------------------------------------------------------------------
// /email-bestaetigen — Verifizierungsseite
// ---------------------------------------------------------------------------

test("email-bestaetigen ohne Token zeigt sofort Fehlermeldung", async ({ page }) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);
  await page.goto("/email-bestaetigen");

  // Fehlermeldung muss sichtbar sein
  await expect(
    page.getByText(/Ungültiger Bestätigungslink/i),
    "Fehlermeldung bei fehlendem Token muss erscheinen",
  ).toBeVisible();

  // Link zum Login muss vorhanden sein
  await expect(
    page.getByRole("link", { name: /Login/i }).or(page.getByText(/Zum Login/i)),
    "Link zum Login muss angeboten werden",
  ).toBeVisible();
});

test("email-bestaetigen mit unbekanntem Token zeigt Fehlermeldung", async ({ page }) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);
  await page.goto("/email-bestaetigen?token=unbekannter-token-12345");

  // Seite darf nicht abstuerzen und zeigt Fehlermeldung
  await expect(
    page.getByText(/Ungültig|Bestätigung fehlgeschlagen|bereits verwendet/i),
    "Fehlermeldung bei unbekanntem Token muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });

  await expect(
    page.getByText(/Zum Login/i),
    "Link zum Login muss bei Fehler angeboten werden",
  ).toBeVisible();
});

test("email-bestaetigen mit gueltigem Token zeigt Erfolg und leitet weiter", async ({ page }) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  const token = "ui-valid-verify-token-e2e";
  await dbSetEmailVerification(verifyAcc.email, token);

  await page.goto(`/email-bestaetigen?token=${token}`);

  // Erfolgsmeldung muss erscheinen
  await expect(
    page.getByText(/erfolgreich bestätigt/i),
    "Erfolgsmeldung nach Verifizierung muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });

  // Weiterleitung auf / nach 2.5 Sekunden (laut Implementierung)
  await expect(page, "Nach Verifizierung muss auf / weitergeleitet werden").toHaveURL(/\/$/, {
    timeout: 8_000,
  });
});

// ---------------------------------------------------------------------------
// /login — unverifizierte E-Mail + Resend-Button
// ---------------------------------------------------------------------------

test("Login mit unverifizierter E-Mail zeigt Fehler und Resend-Button", async ({ page }) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  await dbSetEmailVerification(loginUnverifiedAcc.email, "resend-test-token");

  await page.goto("/login");

  await expect(
    page.getByRole("button", { name: /Login/i, exact: true }),
    "Login-Seite muss sichtbar sein",
  ).toBeVisible();

  await page.locator("#email").fill(loginUnverifiedAcc.email);
  await page.locator("#password").fill(FREE_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: /Login/i, exact: true }).click();

  // Fehlermeldung
  await expect(
    page.getByText(/E-Mail-Adresse/i),
    "Fehlermeldung wegen unverifizierter E-Mail muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });

  // Resend-Button
  await expect(
    page.getByRole("button", { name: /Erneut senden/i }),
    "Schaltflaeche zum erneuten Senden muss erscheinen",
  ).toBeVisible();
});

test("Resend-Button auf Login-Seite zeigt Bestaetigungshinweis nach Klick", async ({ page }) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  await dbSetEmailVerification(loginUnverifiedAcc.email, "resend-test-token-2");

  await page.goto("/login");
  await page.locator("#email").fill(loginUnverifiedAcc.email);
  await page.locator("#password").fill(FREE_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: /Login/i, exact: true }).click();

  // Warten bis der Resend-Button erscheint
  const resendBtn = page.getByRole("button", { name: /Erneut senden/i });
  await expect(resendBtn).toBeVisible({ timeout: 10_000 });

  await resendBtn.click();

  // Bestaetigung muss erscheinen
  await expect(
    page.getByText(/erneut gesendet|Postfach/i),
    "Bestaetigung nach erneutem Versand muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// /passwort-vergessen
// ---------------------------------------------------------------------------

test("passwort-vergessen zeigt generischen Erfolg nach Absenden (Anti-Enumeration)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  await page.goto("/passwort-vergessen");

  await expect(
    page.getByRole("button", { name: /Reset-Link anfordern/i }),
    "Reset-Formular muss sichtbar sein",
  ).toBeVisible();

  await page.locator("#email").fill("unbekannt@dienstplan.test");
  await page.getByRole("button", { name: /Reset-Link anfordern/i }).click();

  // Generische Erfolgsmeldung, kein Hinweis ob die E-Mail existiert
  await expect(
    page.getByText(/falls diese E-Mail/i).or(page.getByText(/Reset-Link gesendet/i)),
    "Generische Erfolgsmeldung muss erscheinen (kein Existenz-Orakel)",
  ).toBeVisible({ timeout: 10_000 });
});

test("passwort-vergessen zeigt Erfolgsmeldung auch fuer bekannte E-Mail (Anti-Enumeration)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  await page.goto("/passwort-vergessen");
  await page.locator("#email").fill(resetAcc.email);
  await page.getByRole("button", { name: /Reset-Link anfordern/i }).click();

  await expect(
    page.getByText(/falls diese E-Mail/i).or(page.getByText(/Reset-Link gesendet/i)),
    "Generische Erfolgsmeldung muss auch fuer registrierte E-Mail erscheinen",
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// /passwort-zuruecksetzen
// ---------------------------------------------------------------------------

test("passwort-zuruecksetzen ohne Token zeigt Fehler mit Link zu passwort-vergessen", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  await page.goto("/passwort-zuruecksetzen");

  await expect(
    page.getByText(/Ungültiger Reset-Link/i),
    "Fehlermeldung bei fehlendem Token muss sofort erscheinen",
  ).toBeVisible();

  await expect(
    page.getByText(/Neuen Link anfordern/i),
    "Link zu passwort-vergessen muss angeboten werden",
  ).toBeVisible();
});

test("passwort-zuruecksetzen mit ungueltigem Token zeigt Fehlermeldung nach Absenden", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  await page.goto("/passwort-zuruecksetzen?token=ungueltiger-token-xyz");

  // Formular muss sichtbar sein
  await expect(
    page.getByRole("button", { name: /Passwort speichern/i }),
    "Reset-Formular muss mit Token sichtbar sein",
  ).toBeVisible();

  await page.locator("#password").fill("NeuesPasswort123!");
  await page.locator("#confirm").fill("NeuesPasswort123!");
  await page.getByRole("button", { name: /Passwort speichern/i }).click();

  // API antwortet mit 400 → Fehlermeldung
  await expect(
    page.getByText(/Ungültig|abgelaufen/i),
    "Fehlermeldung bei unbekanntem Token muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });
});

test("passwort-zuruecksetzen mit abgelaufenem Token zeigt Fehlermeldung", async ({ page }) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  const expiredToken = "ui-expired-reset-token-e2e";
  const pastDate = new Date(Date.now() - 60_000);
  await dbSetPasswordResetToken(resetAcc.email, expiredToken, pastDate);

  await page.goto(`/passwort-zuruecksetzen?token=${expiredToken}`);
  await page.locator("#password").fill("NeuesPasswort123!");
  await page.locator("#confirm").fill("NeuesPasswort123!");
  await page.getByRole("button", { name: /Passwort speichern/i }).click();

  await expect(
    page.getByText(/abgelaufen/i),
    "Fehlermeldung 'abgelaufen' muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });
});

test("passwort-zuruecksetzen mit gueltigem Token: neues Passwort setzen → Weiterleitung zu Login", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await blockDevAutoLogin(page);

  const resetToken = "ui-valid-reset-token-e2e-complete";
  const newPassword = "NeuesPasswort456!";
  await dbSetPasswordResetToken(resetAcc.email, resetToken, new Date(Date.now() + 3_600_000));

  await page.goto(`/passwort-zuruecksetzen?token=${resetToken}`);

  await expect(
    page.getByRole("button", { name: /Passwort speichern/i }),
    "Reset-Formular muss sichtbar sein",
  ).toBeVisible();

  await page.locator("#password").fill(newPassword);
  await page.locator("#confirm").fill(newPassword);
  await page.getByRole("button", { name: /Passwort speichern/i }).click();

  // Erfolgsmeldung
  await expect(
    page.getByText(/erfolgreich geändert/i),
    "Erfolgsmeldung nach Passwort-Reset muss erscheinen",
  ).toBeVisible({ timeout: 10_000 });

  // Weiterleitung zu /login
  await expect(page, "Nach Reset muss auf /login weitergeleitet werden").toHaveURL(/\/login/, {
    timeout: 8_000,
  });

  // Mit neuem Passwort einloggen
  await page.locator("#email").fill(resetAcc.email);
  await page.locator("#password").fill(newPassword);
  await page.getByRole("button", { name: /Login/i, exact: true }).click();

  await expect(
    page,
    "Login mit neuem Passwort muss auf / weiterleiten",
  ).toHaveURL(/\/$/, { timeout: 10_000 });
});

test("passwort-zuruecksetzen: Passwoerter stimmen nicht ueberein → Client-Fehler", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await blockDevAutoLogin(page);

  const token = "ui-pw-mismatch-token";
  await dbSetPasswordResetToken(resetAcc.email, token, new Date(Date.now() + 3_600_000));

  await page.goto(`/passwort-zuruecksetzen?token=${token}`);
  await page.locator("#password").fill("EinPasswort123!");
  await page.locator("#confirm").fill("AndereresPasswort456!");
  await page.getByRole("button", { name: /Passwort speichern/i }).click();

  await expect(
    page.getByText(/stimmen nicht überein/i),
    "Client-seitige Fehlermeldung bei unterschiedlichen Passwoertern",
  ).toBeVisible({ timeout: 5_000 });

  // URL darf nicht gewechselt haben
  await expect(page).toHaveURL(/\/passwort-zuruecksetzen/);
});

// ---------------------------------------------------------------------------
// Registrierungsseite — echter Flow (kein API-Mock)
// ---------------------------------------------------------------------------

test("Registrierungsformular laeuft echten Flow durch: Bestaetigung oder direkter Login", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await blockDevAutoLogin(page);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `e2e.reg-flow.${stamp}@dienstplan.test`;
  registrationTestEmail = email;

  await page.goto("/registrierung");

  await expect(
    page.getByRole("button", { name: /Jetzt registrieren/i }),
    "Registrierungsformular muss sichtbar sein",
  ).toBeVisible();

  await page.locator("#name").fill(`E2E Reg Flow ${stamp}`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("TestPasswort123!");
  await page.locator("#password-repeat").fill("TestPasswort123!");
  await page.getByRole("button", { name: /Jetzt registrieren/i }).click();

  // Je nach Umgebung zeigt die App nach erfolgreicher Registrierung entweder
  // den Bestaetigungsscreen (RESEND_API_KEY gesetzt → E-Mail-Verifizierung
  // erforderlich) oder leitet direkt auf / weiter (kein RESEND → sofort
  // eingeloggt). Beide Pfade werden geprueft.
  const confirmationText = page.getByText(/Bestätigungsmail verschickt/i);
  const which = await Promise.race([
    confirmationText
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => "confirmation" as const),
    page
      .waitForURL(/\/$/, { timeout: 20_000 })
      .then(() => "redirect" as const),
  ]).catch(() => "timeout" as const);

  if (which === "confirmation") {
    // Pfad A: E-Mail-Verifizierung erforderlich
    await expect(
      page.getByText(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")),
      "Eingegebene E-Mail muss im Bestaetigungsscreen erscheinen",
    ).toBeVisible();

    // Token aus DB lesen und echten Verifikations-Klick simulieren
    const token = await dbGetEmailVerificationToken(email);
    expect(token, "Verifikationstoken muss in der DB hinterlegt sein").not.toBeNull();

    await page.goto(`/email-bestaetigen?token=${token}`);
    await expect(
      page.getByText(/erfolgreich bestätigt/i),
      "Verifikationsseite muss Erfolgsmeldung zeigen",
    ).toBeVisible({ timeout: 10_000 });

    await expect(page, "Nach Verifizierung muss auf / weitergeleitet werden").toHaveURL(/\/$/, {
      timeout: 8_000,
    });
  } else if (which === "redirect") {
    // Pfad B: kein RESEND_API_KEY → direkter Login nach Registrierung
    await expect(page).toHaveURL(/\/$/);
  } else {
    throw new Error(
      `Registrierung hat weder Bestaetigungsscreen noch / innerhalb von 20s erreicht. URL: ${page.url()}`,
    );
  }
});
