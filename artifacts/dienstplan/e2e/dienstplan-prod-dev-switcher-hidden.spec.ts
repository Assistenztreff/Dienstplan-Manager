import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { deriveTestDbTarget } from "@workspace/test-fixtures/test-db-name";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";
import { PROD_SPEC_API_PORT, PROD_SPEC_WEB_PORT } from "./helpers/prod-spec-ports";

/**
 * Task #174 — Sicherstellen, dass der Test-Nutzer-Wechsler in Produktion
 * unsichtbar bleibt.
 *
 * Der Dev-Umschalter (als anderer Test-Nutzer agieren) ist doppelt gegated:
 *   - Backend: `NODE_ENV !== "production"` um `/api/auth/dev-login` und
 *     `/api/auth/dev-users` (routes/auth.ts)
 *   - Frontend: `import.meta.env.DEV` in dev-user-switcher.tsx und im
 *     Auto-Dev-Login-Bootstrap (context/auth.tsx)
 *
 * Ein versehentliches Aktivieren in Produktion wäre eine ernste
 * Sicherheitslücke (Anmeldung als beliebiger Nutzer OHNE Passwort). Dieses
 * Spec schützt vor einer stillen Regression, indem es einen ECHTEN
 * Produktions-Stack hochfährt (gegen die isolierte `_test`-DB):
 *
 *   - API-Server-Bundle mit NODE_ENV=production auf Port 8097
 *   - Vite-Prod-Build, ausgeliefert via `vite preview` auf Port 5197
 *     (Preview-Proxy leitet /api an den Prod-API weiter, s. vite.config.ts)
 *
 * Geprüft wird:
 *   1. `GET /api/auth/dev-users` und `POST /api/auth/dev-login` (mit und ohne
 *      `userId`) liefern 404 — die Routen existieren in Produktion nicht.
 *      `POST /api/auth/login` funktioniert weiterhin (200).
 *   2. Im Production-Frontend-Build erscheint der Umschalter
 *      ("Test-Nutzer wechseln") nirgends, es rendert das reguläre
 *      Login-Formular (KEIN Auto-Dev-Login) und der Browser feuert keinerlei
 *      Requests auf /api/auth/dev-*.
 */

// Gemeinsame Quelle mit dem Waisen-Reaper in playwright.config.ts (Task #639).
const API_PORT = PROD_SPEC_API_PORT;
const WEB_PORT = PROD_SPEC_WEB_PORT;
const API_URL = `http://localhost:${API_PORT}`;
const PREVIEW_URL = `http://localhost:${WEB_PORT}`;

const specDir = path.dirname(fileURLToPath(import.meta.url));
const apiServerDir = path.resolve(specDir, "..", "..", "api-server");

/**
 * Test-DB-URL ermitteln: Im isolierten Test-Stack stellt playwright.config.ts
 * `E2E_TEST_DATABASE_URL` bereit; als Fallback wird sie (wie dort) aus
 * `DATABASE_URL` mit `_test`-Suffix abgeleitet. Der Prod-Stack dieses Specs
 * darf NIE gegen die Dev-Datenbank laufen.
 */
function resolveTestDbUrl(): string | null {
  if (process.env.E2E_TEST_DATABASE_URL) return process.env.E2E_TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) return null;
  // Zentrale Ableitung (inkl. privatem Umgebungs-Suffix) — muss dieselbe DB
  // treffen wie playwright.config/setup-test-db.
  return deriveTestDbTarget(base).url;
}

async function waitForOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      // Jede HTTP-Antwort genügt: Der Server nimmt Verbindungen an.
      if (res.status < 500) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server unter ${url} nicht erreichbar: ${String(lastError)}`);
}

/** stdout/stderr eines Kindprozesses sammeln (nur für Fehlerdiagnose). */
function captureOutput(proc: ChildProcess, sink: string[]): void {
  proc.stdout?.on("data", (d: Buffer) => sink.push(d.toString()));
  proc.stderr?.on("data", (d: Buffer) => sink.push(d.toString()));
}

function killProcessTree(proc: ChildProcess | null): void {
  if (!proc || proc.pid == null) return;
  try {
    // Negative PID = ganze Prozessgruppe (pnpm spawnt vite als Kind).
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* bereits beendet */
    }
  }
}

const testDbUrl = resolveTestDbUrl();

let apiProc: ChildProcess | null = null;
let previewProc: ChildProcess | null = null;
const apiOutput: string[] = [];
const previewOutput: string[] = [];

test.describe("Produktions-Modus: Dev-Nutzer-Wechsler unsichtbar", () => {
  // Der Umschalter ist (wenn vorhanden) nur ab md sichtbar — Desktop-Viewport,
  // damit die Abwesenheits-Assertion nicht trivial am 400px-Viewport hängt.
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    test.skip(!testDbUrl, "Keine DATABASE_URL/E2E_TEST_DATABASE_URL — Test-DB nicht ermittelbar.");

    // 1. API-Server bundeln und mit NODE_ENV=production starten.
    execSync("pnpm --filter @workspace/api-server run build", {
      stdio: "pipe",
      timeout: 180_000,
    });
    apiProc = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
      cwd: apiServerDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(API_PORT),
        DATABASE_URL: testDbUrl!,
        APP_DATABASE_URL: testDbUrl!,
        SESSION_SECRET: "e2e-prod-mode-check",
      },
    });
    captureOutput(apiProc, apiOutput);
    await waitForOk(`${API_URL}/api/healthz`, 60_000).catch((err) => {
      throw new Error(`${String(err)}\nAPI-Log:\n${apiOutput.join("")}`);
    });

    // 2. Frontend-Produktions-Build erstellen und via `vite preview` serven
    //    (Preview-Proxy -> Prod-API, siehe vite.config.ts).
    execSync("pnpm --filter @workspace/dienstplan run build", {
      stdio: "pipe",
      timeout: 300_000,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(WEB_PORT),
        BASE_PATH: "/",
      },
    });
    previewProc = spawn("pnpm", ["--filter", "@workspace/dienstplan", "run", "serve"], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(WEB_PORT),
        BASE_PATH: "/",
        E2E_API_PROXY_TARGET: API_URL,
      },
    });
    captureOutput(previewProc, previewOutput);
    await waitForOk(`${PREVIEW_URL}/`, 60_000).catch((err) => {
      throw new Error(`${String(err)}\nPreview-Log:\n${previewOutput.join("")}`);
    });
  });

  test.afterAll(() => {
    killProcessTree(previewProc);
    killProcessTree(apiProc);
  });

  test("PWA-Assets: Manifest, Icons und Service-Worker-Registrierung (#596)", async ({ page }) => {
    const api = await playwrightRequest.newContext({ baseURL: PREVIEW_URL });
    try {
      // manifest.webmanifest muss mit korrektem Content-Type ausgeliefert werden.
      const manifest = await api.get("/manifest.webmanifest");
      expect(manifest.status(), "GET /manifest.webmanifest muss 200 liefern").toBe(200);
      expect(
        manifest.headers()["content-type"],
        "manifest.webmanifest muss Content-Type application/manifest+json haben",
      ).toContain("application/manifest+json");
      const manifestBody = (await manifest.json()) as { name?: string; icons?: unknown[] };
      expect(manifestBody.name, "Manifest muss einen Namen haben").toBeTruthy();
      expect(manifestBody.icons, "Manifest muss Icons enthalten").toBeTruthy();

      // Wichtigste Icons müssen erreichbar sein.
      for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-180.png"]) {
        const r = await api.get(icon);
        expect(r.status(), `Icon ${icon} muss 200 liefern`).toBe(200);
        expect(r.headers()["content-type"], `${icon} muss image/png haben`).toContain("image/png");
      }

      // sw.js muss ausgeliefert werden (Service Worker ist nur im Prod-Build aktiv).
      const sw = await api.get("/sw.js");
      expect(sw.status(), "GET /sw.js muss 200 liefern").toBe(200);
      expect(
        sw.headers()["content-type"],
        "sw.js muss JavaScript-Content-Type haben",
      ).toMatch(/javascript|text\/plain/);
    } finally {
      await api.dispose();
    }

    // index.html muss manifest-Link und apple-touch-icon enthalten.
    await page.goto(PREVIEW_URL);
    const manifestLink = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestLink, "index.html muss einen manifest-Link enthalten").toBe(
      "/manifest.webmanifest",
    );
    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(appleIcon, "index.html muss einen apple-touch-icon-Link enthalten").toBeTruthy();

    // Im Prod-Build muss navigator.serviceWorker.register() aufgerufen worden
    // sein (nur wenn der Browser SW unterstützt — in Chromium immer der Fall).
    const swRegistered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration("/");
      return !!reg;
    });
    expect(swRegistered, "Im Prod-Build muss der Service Worker registriert sein").toBe(true);
  });

  test("SW-Update-Toast: 'Neu laden'-Hinweis erscheint nach Deploy-Update (#652)", async ({ page }) => {
    // Pfad zur gebauten sw.js im dist-Verzeichnis (nach dem build im beforeAll).
    const swDistPath = path.resolve(specDir, "..", "dist", "sw.js");
    const originalSwContent = readFileSync(swDistPath, "utf-8");

    try {
      // --- 1. App laden, SW v1 installieren lassen --------------------------------
      await page.goto(PREVIEW_URL);
      // Warten, bis der Service Worker den Tab kontrolliert (activating → activated).
      // Das kann ein paar Sekunden dauern (install → activate lifecycle).
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
        { timeout: 30_000 },
      );

      // --- 2. sw.js auf Disk leicht abändern → erzwingt Byte-Unterschied ----------
      // Der Browser lädt sw.js beim update() neu; eine einzige Kommentarzeile
      // reicht, damit der Browser einen anderen Hash erkennt und ein Update
      // einleitet.
      writeFileSync(swDistPath, originalSwContent + "\n// e2e-update-check\n", "utf-8");

      // --- 3. SW-Update anstoßen --------------------------------------------------
      // navigator.serviceWorker.getRegistration().update() triggert einen neuen
      // Byte-für-Byte-Vergleich mit der gerade geänderten sw.js auf dem Server.
      await page.evaluate(() =>
        navigator.serviceWorker.getRegistration("/").then((r) => r?.update()),
      );

      // --- 4. "Neue Version verfügbar"-Toast prüfen --------------------------------
      // main.tsx setzt den Toast, sobald der neue SW 'installed' (= wartend)
      // erreicht und ein aktiver Controller vorhanden ist. Gelegentlich reagiert
      // das Update innerhalb von Sekunden; 40 s reichen als Sicherheitspuffer.
      await expect(
        page.getByText("Neue Version verfügbar"),
        "Nach einem SW-Byte-Update muss der 'Neue Version verfügbar'-Toast erscheinen",
      ).toBeVisible({ timeout: 40_000 });

      // --- 5. "Neu laden"-Button klicken ------------------------------------------
      // Die Schaltfläche sendet SKIP_WAITING an den neuen SW, der daraufhin
      // übernimmt; controllerchange → window.location.reload().
      await page.getByRole("button", { name: "Neu laden" }).click();

      // --- 6. Seite lädt neu und SW v2 ist jetzt aktiver Controller ---------------
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
      const swUrl = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        return reg?.active?.scriptURL ?? null;
      });
      expect(swUrl, "Nach 'Neu laden' muss ein aktiver SW vorhanden sein").toBeTruthy();
    } finally {
      // SW-Datei immer wiederherstellen, damit Folge-Tests kein Artefakt sehen.
      writeFileSync(swDistPath, originalSwContent, "utf-8");
    }
  });

  test("Prod-API: dev-users/dev-login existieren nicht (404), Login funktioniert", async () => {
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    try {
      // Die Dev-Routen dürfen in Produktion gar nicht registriert sein.
      const devUsers = await api.get("/api/auth/dev-users");
      expect(devUsers.status(), "GET /api/auth/dev-users muss in Produktion 404 liefern").toBe(404);

      const devLoginWithUser = await api.post("/api/auth/dev-login", {
        data: { userId: 1 },
      });
      expect(
        devLoginWithUser.status(),
        "POST /api/auth/dev-login (mit userId) muss in Produktion 404 liefern",
      ).toBe(404);

      const devLoginDefault = await api.post("/api/auth/dev-login");
      expect(
        devLoginDefault.status(),
        "POST /api/auth/dev-login (ohne Body) muss in Produktion 404 liefern",
      ).toBe(404);

      // Gegenprobe: Der reguläre Passwort-Login bleibt voll funktionsfähig.
      const login = await api.post("/api/auth/login", {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(login.status(), "POST /api/auth/login muss in Produktion weiter 200 liefern").toBe(200);
      const body = (await login.json()) as { email?: string };
      expect(body.email).toBe(ADMIN_EMAIL);
    } finally {
      await api.dispose();
    }
  });

  test("Prod-Frontend: kein Auto-Dev-Login, kein 'Test-Nutzer wechseln'-Element", async ({ page }) => {
    // Alle Requests auf die Dev-Auth-Routen mitschneiden — es darf KEINEN geben.
    const devRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/api\/auth\/dev-(login|users)/.test(req.url())) devRequests.push(req.url());
    });

    // Im Prod-Build gibt es keinen Auto-Dev-Login: /login MUSS das Formular zeigen.
    await page.goto(`${PREVIEW_URL}/login`);
    await expect(
      page.locator("#email"),
      "Prod-Build muss das Login-Formular zeigen (kein Auto-Dev-Login)",
    ).toBeVisible({ timeout: 15_000 });

    await page.locator("#email").fill(ADMIN_EMAIL);
    await page.locator("#password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Login", exact: true }).click();

    // Eingeloggt: App-Shell mit Navigation ist da.
    await expect(page).toHaveURL(new RegExp(`^${PREVIEW_URL}/$`), { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });

    // Der Dev-Umschalter darf NIRGENDS auftauchen (weder Trigger noch Label).
    await expect(page.locator('[aria-label="Test-Nutzer wechseln"]')).toHaveCount(0);
    await expect(page.getByText("Test-Nutzer wählen")).toHaveCount(0);

    // Und der Prod-Build hat zu keinem Zeitpunkt eine Dev-Auth-Route angefragt.
    expect(devRequests, "Prod-Build darf keine /api/auth/dev-* Requests feuern").toEqual([]);
  });
});
