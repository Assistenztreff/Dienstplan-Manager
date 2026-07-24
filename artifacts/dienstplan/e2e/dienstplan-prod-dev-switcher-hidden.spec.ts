import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";

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

const API_PORT = 8097;
const WEB_PORT = 5197;
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
  const u = new URL(base);
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  u.pathname = `/${current}_test`;
  return u.toString();
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
    await page.getByRole("button", { name: "Anmelden" }).click();

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
