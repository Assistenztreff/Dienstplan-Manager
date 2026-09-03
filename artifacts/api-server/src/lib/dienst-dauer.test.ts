import { describe, it, expect } from "vitest";
import { wanduhrDauerMs, istTagesdienst } from "./dienst-dauer";

const STUNDE = 60 * 60 * 1000;

/** Zeitpunkt aus Berliner Ortszeit — der Versatz gehoert bewusst dazu. */
const berlin = (iso: string) => new Date(iso);

describe("wanduhrDauerMs", () => {
  it("zaehlt einen gewoehnlichen 24-Stunden-Dienst als 24 Stunden", () => {
    const start = berlin("2026-10-10T09:00:00+02:00");
    const ende = berlin("2026-10-11T09:00:00+02:00");
    expect(wanduhrDauerMs(start, ende)).toBe(24 * STUNDE);
  });

  it("zaehlt am Ende der Sommerzeit real 25 Stunden als 24", () => {
    // 25.10.2026, 03:00 → Uhr geht auf 02:00 zurueck.
    const start = berlin("2026-10-24T09:00:00+02:00");
    const ende = berlin("2026-10-25T09:00:00+01:00");
    expect(ende.getTime() - start.getTime(), "real vergehen 25 Stunden").toBe(25 * STUNDE);
    expect(wanduhrDauerMs(start, ende), "auf der Uhr sind es 24").toBe(24 * STUNDE);
    expect(istTagesdienst(start, ende)).toBe(true);
  });

  it("zaehlt am Beginn der Sommerzeit real 23 Stunden als 24", () => {
    // 29.03.2026, 02:00 → Uhr geht auf 03:00 vor.
    const start = berlin("2026-03-28T09:00:00+01:00");
    const ende = berlin("2026-03-29T09:00:00+02:00");
    expect(ende.getTime() - start.getTime(), "real vergehen 23 Stunden").toBe(23 * STUNDE);
    expect(wanduhrDauerMs(start, ende), "auf der Uhr sind es 24").toBe(24 * STUNDE);
    expect(istTagesdienst(start, ende)).toBe(true);
  });

  it("weist einen Mehrtages-Dienst weiterhin ab", () => {
    const start = berlin("2026-10-10T09:00:00+02:00");
    const ende = berlin("2026-10-12T09:00:00+02:00");
    expect(istTagesdienst(start, ende)).toBe(false);
  });

  it("weist auch am Umstellungswochenende einen Mehrtages-Dienst ab", () => {
    const start = berlin("2026-10-24T09:00:00+02:00");
    const ende = berlin("2026-10-26T09:00:00+01:00");
    expect(istTagesdienst(start, ende), "49 reale Stunden sind kein Tagesdienst").toBe(false);
  });

  it("laesst 24 Stunden zu, aber keine Minute mehr", () => {
    const start = berlin("2026-06-10T09:00:00+02:00");
    expect(istTagesdienst(start, berlin("2026-06-11T09:00:00+02:00"))).toBe(true);
    expect(istTagesdienst(start, berlin("2026-06-11T09:01:00+02:00"))).toBe(false);
  });
});
