// ---------------------------------------------------------------------------
// Unit-Tests fuer die Warn-Mail-Drosselung (AlertThrottle).
// ---------------------------------------------------------------------------
// Die Drosselung verhindert, dass derselbe Fehler (Kontext + Meldung) im
// Minutentakt neue Warn-E-Mails an den Betreiber ausloest. Reine Logik,
// deshalb hier ohne DB/Netz testbar.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { AlertThrottle, ALERT_THROTTLE_MS } from "./platform-errors";

describe("AlertThrottle", () => {
  it("erlaubt die erste Mail fuer einen Fehler", () => {
    const throttle = new AlertThrottle();
    expect(throttle.shouldSend("GET /api/x|boom", 1_000)).toBe(true);
  });

  it("blockt denselben Fehler innerhalb des Drossel-Fensters", () => {
    const throttle = new AlertThrottle();
    const t0 = 1_000;
    expect(throttle.shouldSend("GET /api/x|boom", t0)).toBe(true);
    expect(throttle.shouldSend("GET /api/x|boom", t0 + 1_000)).toBe(false);
    expect(throttle.shouldSend("GET /api/x|boom", t0 + ALERT_THROTTLE_MS - 1)).toBe(false);
  });

  it("erlaubt denselben Fehler nach Ablauf des Fensters wieder", () => {
    const throttle = new AlertThrottle();
    const t0 = 1_000;
    expect(throttle.shouldSend("GET /api/x|boom", t0)).toBe(true);
    expect(throttle.shouldSend("GET /api/x|boom", t0 + ALERT_THROTTLE_MS)).toBe(true);
    // ... und danach greift die Drossel erneut.
    expect(throttle.shouldSend("GET /api/x|boom", t0 + ALERT_THROTTLE_MS + 1)).toBe(false);
  });

  it("drosselt unterschiedliche Fehler unabhaengig voneinander", () => {
    const throttle = new AlertThrottle();
    expect(throttle.shouldSend("GET /api/x|boom", 1_000)).toBe(true);
    expect(throttle.shouldSend("GET /api/y|anders", 1_001)).toBe(true);
    expect(throttle.shouldSend("GET /api/x|boom", 1_002)).toBe(false);
    expect(throttle.shouldSend("GET /api/y|anders", 1_003)).toBe(false);
  });

  it("begrenzt die Anzahl gemerkter Schluessel (kein unbegrenztes Wachstum)", () => {
    const throttle = new AlertThrottle(ALERT_THROTTLE_MS, 3);
    expect(throttle.shouldSend("a", 1)).toBe(true);
    expect(throttle.shouldSend("b", 2)).toBe(true);
    expect(throttle.shouldSend("c", 3)).toBe(true);
    // Vierter Schluessel verdraengt den aeltesten ("a") ...
    expect(throttle.shouldSend("d", 4)).toBe(true);
    // ... "a" gilt daher wieder als neu (Drossel-Info verworfen), waehrend
    // "b"–"d" weiterhin gedrosselt sind.
    expect(throttle.shouldSend("b", 5)).toBe(false);
    expect(throttle.shouldSend("d", 6)).toBe(false);
    expect(throttle.shouldSend("a", 7)).toBe(true);
  });
});
