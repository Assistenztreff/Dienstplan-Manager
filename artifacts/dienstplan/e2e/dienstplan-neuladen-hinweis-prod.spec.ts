/**
 * #652 – Bestätigen, dass der "Neu laden"-Hinweis nach einem Deploy wirklich erscheint.
 *
 * Der Service-Worker-Update-Toast ist ausschließlich im Produktions-Build aktiv
 * (import.meta.env.PROD). Dieser Spec fährt einen echten Prod-Stack hoch:
 *   - API: NODE_ENV=production, Port 8098, isolierte _test-DB
 *   - Frontend: vite build + vite preview, Port 5198
 *
 * Dann wird die Service-Worker-API per addInitScript gemockt:
 *   - navigator.serviceWorker.controller = vorhanden (Seite läuft unter SW)
 *   - registration.waiting = vorhanden (neuer SW wartet)
 * → Fall 1 aus main.tsx: promptForUpdate wird sofort gerufen.
 * → Toast "Neue Version verfügbar" + Schaltfläche "Neu laden" muss erscheinen.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { deriveTestDbTarget } from "@workspace/test-fixtures/test-db-name";

const API_PORT = 8098;
const WEB_PORT = 5198;
const API_URL = `http://localhost:${API_PORT}`;
const PREVIEW_URL = `http://localhost:${WEB_PORT}`;

const specDir = path.dirname(fileURLToPath(import.meta.url));
const apiServerDir = path.resolve(specDir, "..", "..", "api-server");
const dienstplanDir = path.resolve(specDir, "..");

function resolveTestDbUrl(): string | null {
  if (process.env.E2E_TEST_DATABASE_URL) return process.env.E2E_TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) return null;
  return deriveTestDbTarget(base).url;
}

async function waitForOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${url} nicht erreichbar: ${String(lastErr)}`);
}

let apiProc: ChildProcess | null = null;
let webProc: ChildProcess | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);

  const dbUrl = resolveTestDbUrl();
  if (!dbUrl) {
    throw new Error("Keine Test-DB-URL vorhanden (DATABASE_URL fehlt)");
  }

  // API-Server-Build (dist/ wird nur neu gebaut, wenn kein dist/index.mjs vorhanden).
  try {
    execSync("test -f dist/index.mjs", { cwd: apiServerDir, stdio: "ignore" });
  } catch {
    execSync("pnpm run build", { cwd: apiServerDir, stdio: "pipe" });
  }

  // API-Server starten.
  apiProc = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: apiServerDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(API_PORT),
      DATABASE_URL: dbUrl,
      APP_DATABASE_URL: dbUrl,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret-prod-sw",
      TRUST_PROXY: "1",
    },
    detached: true,
    stdio: "pipe",
  });
  apiProc.unref();

  // Vite-Prod-Build.
  execSync("pnpm run build", {
    cwd: dienstplanDir,
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(WEB_PORT),
      VITE_API_BASE: "",
    },
  });

  // vite preview starten.
  webProc = spawn("pnpm", ["run", "serve"], {
    cwd: dienstplanDir,
    env: {
      ...process.env,
      PORT: String(WEB_PORT),
      E2E_API_PROXY_TARGET: API_URL,
      // X-Forwarded-Proto: https → Secure-Cookie-Pflicht von express-session.
      VITE_FORWARDED_PROTO_HTTPS: "1",
    },
    detached: true,
    stdio: "pipe",
  });
  webProc.unref();

  await Promise.all([
    waitForOk(`${API_URL}/`, 60_000),
    waitForOk(`${PREVIEW_URL}/`, 60_000),
  ]);
});

test.afterAll(() => {
  if (apiProc?.pid) {
    try { process.kill(-apiProc.pid); } catch { /* ignore */ }
  }
  if (webProc?.pid) {
    try { process.kill(-webProc.pid); } catch { /* ignore */ }
  }
});

test(
  "Neu-laden-Toast erscheint wenn ein neuer Service Worker wartet (#652)",
  async ({ page }) => {
    test.setTimeout(60_000);

    // Service-Worker-API mocken: waiting-Worker simulieren, bevor die Seite
    // lädt. Fall 1 aus main.tsx greift beim initialen Registration-Check.
    await page.addInitScript(() => {
      const mockWaiting = {
        state: "installed",
        postMessage(_msg: unknown) {
          // SKIP_WAITING → sofort controllerchange feuern.
          const evt = new Event("controllerchange");
          (navigator.serviceWorker as EventTarget).dispatchEvent(evt);
        },
        addEventListener(_: string, _cb: unknown) {},
      };

      const mockRegistration = {
        waiting: mockWaiting,
        installing: null,
        active: { state: "activated" },
        addEventListener(_: string, _cb: unknown) {},
      };

      // controller simulieren (zeigt: eine frühere Version ist installiert).
      const mockController = { state: "activated" };

      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          controller: mockController,
          register: () => Promise.resolve(mockRegistration),
          addEventListener(_: string, _cb: unknown) {},
          dispatchEvent(evt: Event) {
            return EventTarget.prototype.dispatchEvent.call(this, evt);
          },
        },
      });
    });

    await page.goto(PREVIEW_URL);

    // Toast muss erscheinen (bis zu 10 s nach dem "load"-Event).
    await expect(page.getByText("Neue Version verfügbar")).toBeVisible({
      timeout: 12_000,
    });
    await expect(
      page.getByRole("button", { name: /Neu laden/i }),
    ).toBeVisible();
  },
);
