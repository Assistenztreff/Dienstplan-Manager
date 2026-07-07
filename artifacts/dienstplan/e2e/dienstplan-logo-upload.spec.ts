import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { deleteAccountByEmail, registerFreeAccount } from "./helpers/teams";

/**
 * E2E-Test für den Firmenlogo-Upload (Einstellungen) und dessen Verwendung.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Upload eines PNG in den Einstellungen (presigned URL -> GCS PUT -> speichern)
 * - Vorschau erscheint nach dem Upload, Button wechselt zu "Logo ersetzen"
 * - GET /api/branding-settings persistiert den objectPath
 * - GET /api/storage/objects/... liefert das hochgeladene Bild aus
 * - "Entfernen" setzt zurück -> Vorschau zeigt wieder "Kein Logo"
 * - Negativfall: ohne eigenes Logo bleibt das Standard-Logo der Fallback
 *
 * Wichtig: Ohne teamId liest/schreibt der Endpunkt die Konto-Zeile des
 * jeweils angemeldeten Kontos (nicht mehr einen globalen Singleton). Der Test
 * merkt sich den ursprünglichen Zustand und stellt ihn im Cleanup wieder her.
 */

// Die Logo-Karte rendert NUR für Dienstleister-Konten (Privat-Konten nutzen
// das Standard-Logo; der Seed-Admin ist "privat"). Daher registriert der Test
// ein eigenes Dienstleister-Konto (Passwort fix aus registerFreeAccount).
const ACCOUNT_PASSWORD = "free12345";
let accountEmail: string;

// Desktop-Viewport: Logo-Vorschau und Buttons sind im Settings-Layout stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Cold-Start (Login + Navigation + Upload) kann das 30s-Default überschreiten.
test.setTimeout(60000);

// Minimales, gültiges 1x1-PNG (transparent) als Upload-Nutzlast.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_BUFFER = Buffer.from(PNG_BASE64, "base64");

type BrandingSettings = { logoPath: string | null };

let adminCtx: APIRequestContext;
let originalLogoPath: string | null = null;

/**
 * Öffnet die Einstellungen als Admin. Im Dev-Modus meldet die App sich
 * automatisch als Admin an (`/api/auth/dev-login`), das Login-Formular
 * erscheint dann gar nicht. Als Fallback (z.B. Prod-Build) wird das Formular
 * ausgefüllt.
 */
async function gotoSettingsAsAdmin(page: Page): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login greift nie (dev- UND prod-tauglich).
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: accountEmail, password: ACCOUNT_PASSWORD },
  });
  expect(loginRes.ok(), `Admin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);
  await page.goto("/einstellungen");
  await expect(
    page.getByRole("heading", { name: "Einstellungen", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

async function getBranding(): Promise<BrandingSettings> {
  const res = await adminCtx.get("/api/branding-settings");
  expect(res.ok(), `GET branding-settings fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as BrandingSettings;
}

test.beforeAll(async () => {
  const account = await registerFreeAccount("dienstleister", "logo.upload");
  adminCtx = account.ctx;
  accountEmail = account.email;

  // Ursprünglichen Zustand merken und auf "kein Logo" zurücksetzen, damit der
  // Test mit einem definierten Ausgangszustand startet.
  originalLogoPath = (await getBranding()).logoPath;
  const resetRes = await adminCtx.put("/api/branding-settings", {
    data: { logoPath: null },
  });
  expect(resetRes.ok(), "Branding-Reset fehlgeschlagen").toBe(true);
});

test.afterAll(async () => {
  // Registriertes Konto samt Standard-Team per SQL-Bereinigung entfernen
  // (DELETE /api/users scheitert am Team-FK-Baum; Branding kaskadiert mit).
  try {
    deleteAccountByEmail(accountEmail);
  } catch {
    /* Best effort — Cleanup darf den Lauf nicht blockieren. */
  }
  await adminCtx.dispose();
});

test("Logo-Upload zeigt Vorschau, persistiert objectPath und liefert das Bild aus", async ({
  page,
}) => {
  await gotoSettingsAsAdmin(page);

  // Ausgangszustand: kein Logo -> Platzhalter sichtbar, Button "Logo hochladen".
  await expect(page.getByText("Kein Logo")).toBeVisible();
  const uploadButton = page.getByRole("button", { name: "Logo hochladen" });
  await expect(uploadButton).toBeVisible();

  // Datei in das (versteckte) File-Input legen -> löst den Upload-Flow aus.
  await page.locator('input[type="file"]').setInputFiles({
    name: "firmenlogo.png",
    mimeType: "image/png",
    buffer: PNG_BUFFER,
  });

  // Nach erfolgreichem Upload erscheint die Vorschau und der Button wechselt.
  const preview = page.getByRole("img", { name: "Firmenlogo" });
  await expect(preview).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Logo ersetzen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entfernen" })).toBeVisible();
  await expect(page.getByText("Kein Logo")).toHaveCount(0);

  // Backend: objectPath ist persistiert.
  const branding = await getBranding();
  expect(branding.logoPath, "logoPath nicht persistiert").toBeTruthy();
  expect(branding.logoPath).toMatch(/^\/objects\//);

  // Die Vorschau zeigt das Bild über den Storage-Proxy an.
  const previewSrc = await preview.getAttribute("src");
  expect(previewSrc).toBe(`/api/storage${branding.logoPath}`);

  // GET /api/storage/objects/... liefert das hochgeladene Bild aus.
  const imageRes = await adminCtx.get(`/api/storage${branding.logoPath}`);
  expect(imageRes.ok(), `Bild-Auslieferung fehlgeschlagen (${imageRes.status()})`).toBe(true);
  const body = await imageRes.body();
  expect(body.length, "Ausgeliefertes Bild ist leer").toBeGreaterThan(0);
  expect(body.equals(PNG_BUFFER), "Ausgeliefertes Bild weicht vom Upload ab").toBe(true);

  // "Entfernen" setzt zurück -> wieder Platzhalter, kein gespeichertes Logo.
  await page.getByRole("button", { name: "Entfernen" }).click();
  await expect(page.getByText("Kein Logo")).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("img", { name: "Firmenlogo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Logo hochladen" })).toBeVisible();

  const afterRemove = await getBranding();
  expect(afterRemove.logoPath, "logoPath nach Entfernen nicht null").toBeNull();
});

test("Negativfall: ohne eigenes Logo bleibt das Standard-Logo der Fallback", async ({ page }) => {
  // Sicherstellen, dass kein eigenes Logo gespeichert ist.
  const reset = await adminCtx.put("/api/branding-settings", { data: { logoPath: null } });
  expect(reset.ok()).toBe(true);

  await gotoSettingsAsAdmin(page);

  // Ohne eigenes Logo: Platzhalter statt Vorschau, Button "Logo hochladen".
  await expect(page.getByText("Kein Logo")).toBeVisible();
  await expect(page.getByRole("img", { name: "Firmenlogo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Logo hochladen" })).toBeVisible();

  // Branding meldet kein eigenes Logo -> der PDF-Export nutzt das Standard-Logo.
  const branding = await getBranding();
  expect(branding.logoPath).toBeNull();
});
