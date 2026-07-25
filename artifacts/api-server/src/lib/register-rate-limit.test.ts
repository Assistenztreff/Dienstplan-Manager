import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkRegisterRateLimit, resetRegisterRateLimit } from "./register-rate-limit";

/**
 * Unit-Tests (Task #553) fuer die Enumerations-Bremse der oeffentlichen
 * Registrierung: Sliding Window pro IP, ENV-konfigurierbar, MAX=0 = aus.
 * DB-frei — laeuft in test:unit.
 */

const ENV_KEYS = ["REGISTER_RATE_LIMIT_MAX", "REGISTER_RATE_LIMIT_WINDOW_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  resetRegisterRateLimit();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetRegisterRateLimit();
});

describe("checkRegisterRateLimit", () => {
  it("erlaubt Versuche bis zum Limit und blockt danach mit Retry-After", () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "3";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "60000";
    const t0 = 1_000_000;

    expect(checkRegisterRateLimit("1.2.3.4", t0).allowed).toBe(true);
    expect(checkRegisterRateLimit("1.2.3.4", t0 + 1000).allowed).toBe(true);
    expect(checkRegisterRateLimit("1.2.3.4", t0 + 2000).allowed).toBe(true);

    const blocked = checkRegisterRateLimit("1.2.3.4", t0 + 3000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      // Aeltester Slot (t0) wird bei t0+60000 frei => 57s Restzeit.
      expect(blocked.retryAfterSeconds).toBe(57);
    }
  });

  it("zaehlt IPs unabhaengig voneinander", () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "1";
    const t0 = 5_000;
    expect(checkRegisterRateLimit("10.0.0.1", t0).allowed).toBe(true);
    expect(checkRegisterRateLimit("10.0.0.1", t0 + 1).allowed).toBe(false);
    expect(checkRegisterRateLimit("10.0.0.2", t0 + 2).allowed).toBe(true);
  });

  it("gibt Slots nach Ablauf des Fensters wieder frei (Sliding Window)", () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "2";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "10000";
    const t0 = 100_000;

    expect(checkRegisterRateLimit("ip", t0).allowed).toBe(true);
    expect(checkRegisterRateLimit("ip", t0 + 5000).allowed).toBe(true);
    expect(checkRegisterRateLimit("ip", t0 + 6000).allowed).toBe(false);
    // t0-Slot faellt bei t0+10000 aus dem Fenster.
    expect(checkRegisterRateLimit("ip", t0 + 10_001).allowed).toBe(true);
    // Jetzt sind t0+5000 und t0+10001 im Fenster => wieder voll.
    expect(checkRegisterRateLimit("ip", t0 + 10_002).allowed).toBe(false);
  });

  it("MAX=0 schaltet den Limiter komplett ab (E2E-Test-Stack)", () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "0";
    for (let i = 0; i < 100; i++) {
      expect(checkRegisterRateLimit("bulk", 1000 + i).allowed).toBe(true);
    }
  });

  it("faellt bei unbrauchbaren ENV-Werten auf die Defaults zurueck (20/10min)", () => {
    process.env.REGISTER_RATE_LIMIT_MAX = "quatsch";
    process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "-5";
    const t0 = 0;
    for (let i = 0; i < 20; i++) {
      expect(checkRegisterRateLimit("d", t0 + i).allowed).toBe(true);
    }
    const blocked = checkRegisterRateLimit("d", t0 + 20);
    expect(blocked.allowed).toBe(false);
  });
});
