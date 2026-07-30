import { test, expect, request as playwrightRequest } from "@playwright/test";

/**
 * #596 – Absichern, dass Manifest und Service Worker nach Änderungen
 * weiterhin ausgeliefert werden.
 *
 * Prüft, dass die PWA-Dateien (manifest.webmanifest und sw.js) nach Build
 * und Deployment erreichbar sind und korrekte Inhalte liefern. Schlägt einer
 * dieser Tests fehl, ist die PWA-Installierbarkeit oder die Offline-Funktion
 * unterbrochen — ein direktes Live-Gang-Blocker-Kriterium.
 *
 * Beide Dateien liegen unter public/ und werden von Vite statisch nach
 * dist/public kopiert. Sie dürfen nie als leere Datei oder 404 ausgeliefert
 * werden; regelmäßige Checks verhindern stille Regressionen durch Build-
 * Konfigurationsänderungen.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

test("manifest.webmanifest wird mit korrektem Content-Type ausgeliefert (#596)", async () => {
  test.setTimeout(20_000);
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.get("/manifest.webmanifest");
  expect(res.status(), "manifest.webmanifest gibt kein 200 zurück").toBe(200);

  const ct = res.headers()["content-type"] ?? "";
  expect(
    ct.includes("json") || ct.includes("manifest"),
    `Content-Type unpassend: ${ct}`,
  ).toBe(true);

  const body = (await res.json()) as Record<string, unknown>;
  expect(body["name"] ?? body["short_name"], "manifest.name fehlt").toBeTruthy();
  expect(body["start_url"], "manifest.start_url fehlt").toBeTruthy();
  expect(Array.isArray(body["icons"]), "manifest.icons ist kein Array").toBe(true);
  expect((body["icons"] as unknown[]).length, "manifest.icons ist leer").toBeGreaterThan(0);

  await ctx.dispose();
});

test("sw.js wird als JavaScript ausgeliefert und enthält Cache-Logik (#596)", async () => {
  test.setTimeout(20_000);
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.get("/sw.js");
  expect(res.status(), "sw.js gibt kein 200 zurück").toBe(200);

  const ct = res.headers()["content-type"] ?? "";
  expect(ct.includes("javascript"), `Content-Type kein JavaScript: ${ct}`).toBe(true);

  const body = await res.text();
  expect(body.length, "sw.js ist leer").toBeGreaterThan(0);
  // Service Worker muss einen Cache-Namen und Caching-Logik enthalten.
  expect(body.includes("cache") || body.includes("Cache"), "sw.js enthält keine Cache-Logik").toBe(true);

  await ctx.dispose();
});
