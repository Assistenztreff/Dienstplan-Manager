/**
 * #595 / #664 – Freundliche Offline-Anzeige statt Fehlermeldungen ohne Internet.
 *
 * Verifiziert:
 * 1. Das Offline-Banner erscheint, wenn der Browser in den Offline-Modus wechselt.
 * 2. Das Banner verschwindet wieder, wenn die Verbindung wiederhergestellt wird.
 * 3. Nach dem Offline-Bootstrap bleibt der angemeldete Nutzer erhalten (kein
 *    Redirect auf die Login-Seite, kein "Nicht angemeldet"-Zustand).
 * 4. (#664) Kein Fehler-Toast erscheint, wenn Queries/Mutations offline scheitern.
 *    App.tsx unterdrückt Toasts via QueryCache.onError + MutationCache.onError
 *    (Guard: isNetworkError && !navigator.onLine → return).
 *
 * Technik:
 *   Playwright context.setOffline(true/false) simuliert den Offline-Modus auf
 *   dem Netzwerk-Level. Der Banner reagiert auf window.navigator.onLine + die
 *   browser-eigenen "online"/"offline"-Events, die Playwright beim Setzen von
 *   setOffline() auslöst.
 *
 * Hinweis: Der Bootstrap-Fix (auth.tsx) lässt sich hier nicht direkt testen,
 * weil ein vollständig offline gestarteter Browser keine Session liefert.
 * Stattdessen prüft Test 3, dass eine bestehende Session NICHT gelöscht wird,
 * wenn die Verbindung NACH dem Login getrennt wird.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";

async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Login fehlgeschlagen (${res.status()})`).toBe(true);
}

test("Offline-Banner erscheint bei fehlender Verbindung (#595)", async ({
  page,
  context,
}) => {
  test.setTimeout(40_000);
  await loginAsAdmin(page);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible({ timeout: 10_000 });

  // Sicherstellen, dass das Banner initial NICHT sichtbar ist.
  await expect(page.getByTestId("offline-banner")).not.toBeVisible();

  // Netzwerk trennen.
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 5_000 });

  // Netzwerk wiederherstellen.
  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).not.toBeVisible({ timeout: 5_000 });
});

test("Offline-Banner erscheint auch auf anderen Seiten (#595)", async ({
  page,
  context,
}) => {
  test.setTimeout(40_000);
  await loginAsAdmin(page);
  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen" })).toBeVisible({ timeout: 10_000 });

  // Sicherstellen, dass das Banner initial NICHT sichtbar ist.
  await expect(page.getByTestId("offline-banner")).not.toBeVisible();

  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 5_000 });

  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).not.toBeVisible({ timeout: 5_000 });
});

test("Nach Offline-Phase bleibt angemeldeter Nutzer erhalten (kein Logout) (#595)", async ({
  page,
  context,
}) => {
  test.setTimeout(50_000);
  await loginAsAdmin(page);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible({ timeout: 10_000 });

  // Verbindung trennen.
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 5_000 });

  // In-App-Navigation (kein Reload) — React-App bleibt montiert, Auth-State
  // wird NICHT zurückgesetzt. Ein page.goto() würde die Seite neu laden und
  // beim Bootstrap mit TypeError scheitern (kein localStorage in Prod-Mode).
  await page.evaluate(() => {
    window.history.pushState({}, "", "/dienstplan");
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  });
  // Kurze Wartezeit damit Router-Redirect ggf. ausgelöst würde.
  await page.waitForTimeout(2000);

  // Prüfen: Die URL ist NICHT /login.
  const url = page.url();
  expect(url, "Offline → kein Logout-Redirect").not.toContain("/login");

  // Verbindung wiederherstellen.
  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).not.toBeVisible({ timeout: 5_000 });
});

test("Kein Fehler-Toast bei Query-/Netzwerkfehler offline (#664)", async ({
  page,
  context,
}) => {
  /**
   * App.tsx unterdrückt Toasts, wenn navigator.onLine === false:
   *   QueryCache.onError:   isNetworkError && navigator.onLine  → toast (online only)
   *   MutationCache.onError: isNetworkError && !navigator.onLine → return (kein toast)
   *
   * Dieser Test verifiziert das im Browser: Seite lädt online, dann Netzwerk
   * trennen, In-App-Navigation erzwingt neue Query-Starts (fresh mount), nach
   * 2 s darf kein Sonner-Toast sichtbar sein.
   */
  test.setTimeout(50_000);
  await loginAsAdmin(page);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible({ timeout: 10_000 });

  // Sicherstellen, dass kein Toast initial da ist.
  await expect(page.locator("[data-sonner-toast]")).not.toBeVisible();

  // Auswertungen-Modul vorab via client-side Navigation laden: dynamische
  // Imports (React.lazy) bleiben im Browser-Modul-Register gecacht. Ohne diesen
  // Schritt schlägt der import() offline mit "Failed to fetch dynamically
  // imported module" fehl und zerstört den React-Baum.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/auswertungen");
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  });
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    window.history.pushState({}, "", "/dienstplan");
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  });
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible({ timeout: 10_000 });

  // Netzwerk trennen → Banner erscheint, navigator.onLine = false.
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 5_000 });

  // In-App-Navigation auf eine andere Seite: React Router remountet die
  // Auswertungen-Komponenten, deren useQuery-Hooks feuern sofort (retry:false)
  // und scheitern mit TypeError — QueryCache.onError sieht navigator.onLine===false
  // und unterdrückt den Toast.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/auswertungen");
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  });

  // Warten, bis etwaige Toasts erscheinen würden (2 s Puffer).
  await page.waitForTimeout(2_000);

  // Kein Sonner-Toast darf erscheinen.
  const toastLocator = page.locator("[data-sonner-toast]");
  const toastCount = await toastLocator.count();
  expect(toastCount, "Es darf kein Fehler-Toast erscheinen wenn offline").toBe(0);

  // Offline-Banner weiterhin sichtbar.
  await expect(page.getByTestId("offline-banner")).toBeVisible();

  // Verbindung wiederherstellen — Banner verschwindet.
  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).not.toBeVisible({ timeout: 5_000 });
});
