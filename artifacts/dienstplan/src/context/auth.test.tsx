// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  AuthProvider,
  useAuth,
  registerUserSwitchHandler,
  resyncAuthAfter401,
  type AuthUser,
} from "./auth";

/**
 * Task #744: Absichern, dass nach einem Kontowechsel nie kurz das falsche
 * Konto zurückkehrt.
 *
 * Deckt die drei im Task beschriebenen Szenarien ab:
 * 1. Eine verspätete /auth/me-Antwort darf einen zwischenzeitlich explizit
 *    angemeldeten (neueren) Nutzer nicht überschreiben (Epoch-Guard).
 * 2. Fokus-Frischeprüfung und 401-Resync teilen sich EINEN Lauf statt sich
 *    gegenseitig zu überholen (Single-Flight über `inflight`).
 * 3. `registerUserSwitchHandler` feuert nur bei einem ECHTEN ID-Wechsel,
 *    niemals beim initialen Bootstrap oder bei identischer ID.
 */

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    name: "Nutzer",
    email: "nutzer@example.com",
    role: "admin",
    accountType: "privat",
    plan: "free",
    ...overrides,
  };
}

function jsonResponse(body: unknown, opts?: { ok?: boolean; status?: number }): Response {
  return {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function Consumer() {
  const { currentUser, isLoading, login } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user-id">{currentUser?.id ?? "none"}</span>
      <button onClick={() => void login("wechsel@example.com", "geheim")}>login</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("AuthProvider — Kontowechsel-Absicherung (Task #744)", () => {
  it("verwirft eine verspätete Bootstrap-/auth/me-Antwort nach explizitem Login (Epoch-Guard)", async () => {
    const staleMe = deferredResponse();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/me") return staleMe.promise;
      if (url === "/api/auth/login") {
        return Promise.resolve(jsonResponse(makeUser({ id: 2, name: "Neuer Nutzer" })));
      }
      throw new Error(`unerwarteter fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    // Bootstrap-/auth/me hängt noch (staleMe unaufgelöst) — der explizite
    // Login muss trotzdem sofort durchlaufen, weil er ein eigener Request ist.
    await act(async () => {
      screen.getByRole("button", { name: "login" }).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("user-id").textContent).toBe("2");

    // Jetzt löst die VERALTETE Bootstrap-Antwort auf — mit einer ANDEREN
    // (älteren) Identität. Sie darf den bereits angewendeten Login-Nutzer
    // nicht zurückrollen.
    await act(async () => {
      staleMe.resolve(jsonResponse(makeUser({ id: 1, name: "Alter Nutzer" })));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("user-id").textContent).toBe("2");
  });

  it("Fokus-Frischeprüfung und 401-Resync teilen sich einen Lauf statt doppelt zu laden (Single-Flight)", async () => {
    let meCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/me") {
        meCallCount += 1;
        return Promise.resolve(jsonResponse(makeUser({ id: 1 })));
      }
      throw new Error(`unerwarteter fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(meCallCount).toBe(1); // initialer Bootstrap

    await act(async () => {
      // Fokus-Event UND ein durch eine parallele 401-Antwort ausgelöster
      // Resync laufen im selben Moment los.
      window.dispatchEvent(new Event("focus"));
      const resyncPromise = resyncAuthAfter401();
      expect(resyncPromise).not.toBeNull();
      await resyncPromise;
    });

    // Genau EIN zusätzlicher /auth/me-Aufruf für das überlappende Fenster —
    // die beiden Trigger dürfen sich nicht gegenseitig überholen und je einen
    // eigenen Request lostreten.
    expect(meCallCount).toBe(2);
  });

  it("registerUserSwitchHandler feuert nur bei echtem ID-Wechsel, nie beim initialen Bootstrap oder bei gleicher ID", async () => {
    const switchSpy = vi.fn();
    const unregister = registerUserSwitchHandler(switchSpy);

    let loginResponseUser = makeUser({ id: 1 });
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/me") return Promise.resolve(jsonResponse(makeUser({ id: 1 })));
      if (url === "/api/auth/login") return Promise.resolve(jsonResponse(loginResponseUser));
      throw new Error(`unerwarteter fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

      // 1. Initialer Bootstrap liefert einen Nutzer — kein "Wechsel", da es
      //    keinen vorherigen Nutzer gab.
      expect(switchSpy).not.toHaveBeenCalled();

      // 2. Login mit DERSELBEN ID (z. B. Re-Login) ist kein echter Wechsel.
      loginResponseUser = makeUser({ id: 1, name: "Gleicher Nutzer, neuer Name" });
      await act(async () => {
        screen.getByRole("button", { name: "login" }).click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(switchSpy).not.toHaveBeenCalled();

      // 3. Login mit ANDERER ID ist ein echter Kontowechsel — Handler feuert
      //    genau einmal mit dem neuen Nutzer.
      loginResponseUser = makeUser({ id: 2, name: "Anderer Nutzer" });
      await act(async () => {
        screen.getByRole("button", { name: "login" }).click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(switchSpy).toHaveBeenCalledTimes(1);
      expect(switchSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    } finally {
      unregister();
    }
  });
});
