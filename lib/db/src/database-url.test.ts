import { afterEach, describe, expect, it } from "vitest";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "./database-url";

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

describe("resolveDatabaseUrl", () => {
  const ORIGINAL = {
    APP_DATABASE_URL: process.env.APP_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    SCALEWAY_DB_PASSWORD: process.env.SCALEWAY_DB_PASSWORD,
    PROD_DATABASE_URL: process.env.PROD_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  } as const;

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.DATABASE_SSL_NO_VERIFY;
  });

  it("liefert undefined, wenn keine der Variablen gesetzt ist", () => {
    delete process.env.APP_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.SCALEWAY_DB_PASSWORD;
    expect(resolveDatabaseUrl()).toBeUndefined();
  });

  it("APP_DATABASE_URL hat Vorrang vor DATABASE_URL", () => {
    process.env.APP_DATABASE_URL = "postgresql://u:p@app-host:5432/app-db";
    process.env.DATABASE_URL = "postgresql://u:p@replit-host:5432/replit-db";
    delete process.env.SCALEWAY_DB_PASSWORD;
    expect(resolveDatabaseUrl()).toBe("postgresql://u:p@app-host:5432/app-db");
  });

  it("faellt ohne APP_DATABASE_URL auf DATABASE_URL zurueck", () => {
    delete process.env.APP_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://u:p@replit-host:5432/replit-db";
    delete process.env.SCALEWAY_DB_PASSWORD;
    expect(resolveDatabaseUrl()).toBe(
      "postgresql://u:p@replit-host:5432/replit-db",
    );
  });

  it("SCALEWAY_DB_PASSWORD ueberschreibt das Passwort in APP_DATABASE_URL", () => {
    process.env.APP_DATABASE_URL = "postgresql://u:altespw@app-host:5432/app-db";
    process.env.SCALEWAY_DB_PASSWORD = "neu{es}pw#1";
    const parsed = new URL(resolveDatabaseUrl()!);
    expect(decodeURIComponent(parsed.password)).toBe("neu{es}pw#1");
    expect(parsed.hostname).toBe("app-host");
    expect(parsed.pathname).toBe("/app-db");
  });

  it("SCALEWAY_DB_PASSWORD wirkt NICHT auf die verwaltete DATABASE_URL", () => {
    delete process.env.APP_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://u:managedpw@replit-host:5432/replit-db";
    process.env.SCALEWAY_DB_PASSWORD = "rotiert";
    const parsed = new URL(resolveDatabaseUrl()!);
    expect(decodeURIComponent(parsed.password)).toBe("managedpw");
  });

  it("normalisiert unkodierte Passwoerter auch im APP_DATABASE_URL-Pfad", () => {
    process.env.APP_DATABASE_URL =
      "postgresql://admin:u[UZ0{mM[CJ?QBl#n;Rj@app-host:11527/app-db?sslmode=require";
    delete process.env.SCALEWAY_DB_PASSWORD;
    const result = resolveDatabaseUrl()!;
    expect(() => new URL(result)).not.toThrow();
    expect(new URL(result).hostname).toBe("app-host");
  });

  it("PROD_DATABASE_URL hat in Produktion Vorrang vor APP_DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    process.env.PROD_DATABASE_URL = "postgresql://u:p@prod-host:5432/prod-db";
    process.env.APP_DATABASE_URL = "postgresql://u:p@staging-host:5432/staging-db";
    delete process.env.SCALEWAY_DB_PASSWORD;
    expect(resolveDatabaseUrl()).toBe("postgresql://u:p@prod-host:5432/prod-db");
  });

  it("PROD_DATABASE_URL wird ausserhalb der Produktion ignoriert", () => {
    process.env.NODE_ENV = "development";
    process.env.PROD_DATABASE_URL = "postgresql://u:p@prod-host:5432/prod-db";
    process.env.APP_DATABASE_URL = "postgresql://u:p@staging-host:5432/staging-db";
    delete process.env.SCALEWAY_DB_PASSWORD;
    expect(resolveDatabaseUrl()).toBe("postgresql://u:p@staging-host:5432/staging-db");
  });

  it("SCALEWAY_DB_PASSWORD ueberschreibt auch das Passwort in PROD_DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    process.env.PROD_DATABASE_URL = "postgresql://u:altespw@prod-host:5432/prod-db";
    delete process.env.APP_DATABASE_URL;
    process.env.SCALEWAY_DB_PASSWORD = "neues{pw}#prod";
    const parsed = new URL(resolveDatabaseUrl()!);
    expect(decodeURIComponent(parsed.password)).toBe("neues{pw}#prod");
    expect(parsed.hostname).toBe("prod-host");
  });
});
