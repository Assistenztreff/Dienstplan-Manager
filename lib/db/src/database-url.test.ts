import { afterEach, describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./database-url";

describe("normalizeDatabaseUrl", () => {
  afterEach(() => {
    delete process.env.DATABASE_SSL_NO_VERIFY;
  });

  it("laesst bereits gueltige URLs unveraendert", () => {
    const url = "postgresql://user:simplepass@host:5432/db";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("laesst sslmode=require OHNE Opt-in unveraendert (kein stiller Downgrade)", () => {
    const url = "postgresql://user:simplepass@host:5432/db?sslmode=require";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("ersetzt sslmode=require durch no-verify NUR bei DATABASE_SSL_NO_VERIFY=1", () => {
    process.env.DATABASE_SSL_NO_VERIFY = "1";
    const url = "postgresql://user:simplepass@host:5432/db?sslmode=require";
    expect(normalizeDatabaseUrl(url)).toBe(
      "postgresql://user:simplepass@host:5432/db?sslmode=no-verify",
    );
  });

  it("laesst sslmode=disable auch mit Opt-in unveraendert", () => {
    process.env.DATABASE_SSL_NO_VERIFY = "1";
    const url = "postgresql://user:pass@host:5432/db?sslmode=disable";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("laesst URLs mit bereits kodiertem Passwort unveraendert", () => {
    const url = "postgresql://user:a%23b%3Fc@host:5432/db";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("kodiert Sonderzeichen im Passwort nach", () => {
    const url = "postgresql://admin:u[UZ0{mM[CJ?QBl#n;Rj@host:11527/my-db?sslmode=require";
    const result = normalizeDatabaseUrl(url);
    expect(() => new URL(result)).not.toThrow();
    const parsed = new URL(result);
    expect(parsed.username).toBe("admin");
    expect(decodeURIComponent(parsed.password)).toBe("u[UZ0{mM[CJ?QBl#n;Rj");
    expect(parsed.hostname).toBe("host");
    expect(parsed.port).toBe("11527");
    expect(parsed.pathname).toBe("/my-db");
    expect(parsed.searchParams.get("sslmode")).toBe("require");
  });

  it("behandelt @ im Passwort korrekt (letztes @ trennt den Host)", () => {
    const url = "postgresql://admin:p@ss{w}ord@host:5432/db";
    const result = normalizeDatabaseUrl(url);
    const parsed = new URL(result);
    expect(decodeURIComponent(parsed.password)).toBe("p@ss{w}ord");
    expect(parsed.hostname).toBe("host");
  });

  it("gibt nicht reparierbare Werte unveraendert zurueck", () => {
    expect(normalizeDatabaseUrl("kaputt")).toBe("kaputt");
    expect(normalizeDatabaseUrl("postgresql://nurhost/db")).toBe(
      "postgresql://nurhost/db",
    );
  });
});
