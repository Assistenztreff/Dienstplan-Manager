/**
 * Unit-Tests für GET /api/dashboard/my-hours-balance
 *
 * Prüft den serverseitigen Zugriffs-Guard durch Mocking aller schweren
 * Abhängigkeiten (DB, computeHoursBalances, requireAuth).
 *
 * Geprüfte Invarianten:
 * - Admins/Superadmins erhalten 403
 * - Nicht angemeldete Nutzer erhalten 401
 * - Assistenten mit gültiger Session erhalten 200 (null ohne Mitgliedschaft)
 * - Ungültiger month-Parameter liefert 400
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import http from "node:http";
import express from "express";
import session from "express-session";

// Mock requireAuth so DB is never touched.
vi.mock("../middleware/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/auth")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      // Simulate requireAuth: pass if userId present, else 401
      if (!req.session?.userId) {
        _res.status(401).json({ error: "Nicht angemeldet" });
        return;
      }
      next();
    },
  };
});

// Mock computeHoursBalances so no DB queries run.
vi.mock("../lib/hours-balance-service", () => ({
  computeHoursBalances: vi.fn().mockResolvedValue([]),
}));

// Mock userHasFeatureViaTeamOwner so plan queries are skipped.
vi.mock("../lib/plan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/plan")>();
  return {
    ...original,
    userHasFeatureViaTeamOwner: vi.fn().mockResolvedValue(false),
    requirePlanFeature: () => (_req: any, _res: any, next: any) => next(),
    getLenientTimeTrackingTeamIds: vi.fn().mockResolvedValue([]),
  };
});

// --- Minimale Express-App ------------------------------------------------

function makeTestApp(role?: string, userId?: number) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
    }),
  );
  // Inject session data before route handling.
  if (userId != null) {
    app.use((req, _res, next) => {
      req.session.userId = userId;
      (req.session as any).role = role ?? "assistant";
      next();
    });
  }
  // Mount dashboard router dynamically so mocks are applied at import time.
  app.use((req, res, next) => {
    // Dynamic require to get the mocked version
    import("./dashboard").then((mod) => {
      mod.default(req, res, next);
    }).catch(next);
  });
  return app;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
    }),
  );

  // Use a single server, inject role via header for flexibility.
  app.use((req, _res, next) => {
    const testRole = req.headers["x-test-role"] as string | undefined;
    const testUserId = req.headers["x-test-userid"] as string | undefined;
    if (testUserId) {
      req.session.userId = Number(testUserId);
      (req.session as any).role = testRole ?? "assistant";
    }
    next();
  });

  const dashboardMod = await import("./dashboard");
  app.use(dashboardMod.default);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

describe("GET /dashboard/my-hours-balance — Zugriffs-Guard", () => {
  it("liefert 401, wenn keine Session vorhanden ist", async () => {
    const res = await fetch(`${baseUrl}/dashboard/my-hours-balance`);
    expect(res.status).toBe(401);
  });

  it("liefert 403, wenn ein Admin anfrägt", async () => {
    const res = await fetch(`${baseUrl}/dashboard/my-hours-balance`, {
      headers: { "x-test-userid": "1", "x-test-role": "admin" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("Admins") });
  });

  it("liefert 403, wenn ein Superadmin anfrägt", async () => {
    const res = await fetch(`${baseUrl}/dashboard/my-hours-balance`, {
      headers: { "x-test-userid": "1", "x-test-role": "superadmin" },
    });
    expect(res.status).toBe(403);
  });

  it("liefert 400 bei ungültigem month-Parameter (0 ist außerhalb 1–12)", async () => {
    const res = await fetch(
      `${baseUrl}/dashboard/my-hours-balance?month=0&year=2026`,
      { headers: { "x-test-userid": "99", "x-test-role": "assistant" } },
    );
    expect(res.status).toBe(400);
  });

  it("liefert 200 + null, wenn der Assistent keine Team-Mitgliedschaft hat", async () => {
    // computeHoursBalances mock returns [] → find() returns undefined → null
    const res = await fetch(`${baseUrl}/dashboard/my-hours-balance?month=7&year=2026`, {
      headers: { "x-test-userid": "99", "x-test-role": "assistant" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});
