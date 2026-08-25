/**
 * Unit-Test für sendSickLeaveNotification (#887): der `status`-Parameter
 * muss die Abschluss-Formulierung der E-Mail umschalten — "pending" (Antrag
 * wartet auf Bestätigung, s. POST /absence-requests) vs. das alte
 * "created"-Verhalten (Schicht wurde bereits angelegt, Legacy-Direktpfad
 * POST /shifts für privilegierte Personen). Beide Aufrufkontexte dürfen
 * nicht denselben (irreführenden) Text zeigen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSickLeaveNotification } from "./mailer";

describe("sendSickLeaveNotification", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
    vi.restoreAllMocks();
  });

  it("verwendet die 'wartet auf Bestätigung'-Formulierung bei status=pending", async () => {
    let capturedHtml = "";
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { html: string };
      capturedHtml = body.html;
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await sendSickLeaveNotification(
      "owner@example.com",
      "Test Assistenzkraft",
      [new Date("2027-05-04T00:00:00.000Z")],
      "https://example.com",
      "pending",
    );

    expect(ok).toBe(true);
    expect(capturedHtml).toContain("wartet auf Bestätigung");
    expect(capturedHtml).not.toContain("wurde automatisch eingetragen");
  });

  it("verwendet weiterhin die 'automatisch eingetragen'-Formulierung ohne status (Default 'created')", async () => {
    let capturedHtml = "";
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { html: string };
      capturedHtml = body.html;
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await sendSickLeaveNotification(
      "owner@example.com",
      "Test Assistenzkraft",
      [new Date("2027-05-04T00:00:00.000Z")],
      "https://example.com",
    );

    expect(ok).toBe(true);
    expect(capturedHtml).toContain("wurde automatisch eingetragen");
    expect(capturedHtml).not.toContain("wartet auf Bestätigung");
  });
});
