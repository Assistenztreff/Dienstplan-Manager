import { describe, expect, it } from "vitest";
import { ApiError } from "@workspace/api-client-react";
import {
  planFeatureMessage,
  planLimitMessage,
  planUpgradeMessage,
  readableApiError,
  SERVER_UNAVAILABLE_MESSAGE,
} from "./api-error";

/**
 * Unit-Tests für `readableApiError` — die geteilte Helferfunktion, die ALLE
 * Speichern-/Aktions-Dialoge (Schicht, Assistent, Einladung, Zeiterfassung,
 * Team-Verwaltung, Schichtmodelle, Konto-Typ, Logo, Zuschläge) nutzen, um die
 * konkrete Servermeldung statt eines generischen Textes anzuzeigen (Task
 * #7/#58/#78).
 *
 * Regressionsschutz: Würde der Helfer wieder anfangen, die Servermeldung zu
 * verschlucken und stumpf den Fallback zu liefern, schlägt hier ein Test fehl.
 * Der zugehörige E2E-Test (`dienstplan-server-error-messages.spec.ts`) sichert
 * zusätzlich ab, dass die Servermeldung auch tatsächlich im UI (Toast/Dialog)
 * landet und nicht durch einen festen Text ersetzt wird.
 */

const FALLBACK = "Speichern fehlgeschlagen. Bitte erneut versuchen.";

function makeApiError(status: number, data: unknown): ApiError {
  return new ApiError(new Response(null, { status }), data, {
    method: "POST",
    url: "/api/test",
  });
}

describe("readableApiError", () => {
  it("liefert das `error`-Feld der Serverantwort statt des Fallbacks", () => {
    const err = makeApiError(409, { error: "Konkrete Servermeldung" });
    expect(readableApiError(err, FALLBACK)).toBe("Konkrete Servermeldung");
  });

  it("erkennt auch `message`, `detail` und `title` als Quelle", () => {
    expect(readableApiError(makeApiError(400, { message: "Aus message" }), FALLBACK)).toBe(
      "Aus message",
    );
    expect(readableApiError(makeApiError(400, { detail: "Aus detail" }), FALLBACK)).toBe(
      "Aus detail",
    );
    expect(readableApiError(makeApiError(400, { title: "Aus title" }), FALLBACK)).toBe(
      "Aus title",
    );
  });

  it("bevorzugt `error` vor message/detail/title", () => {
    const err = makeApiError(400, {
      error: "Bevorzugt",
      message: "Ignoriert",
      detail: "Ignoriert",
      title: "Ignoriert",
    });
    expect(readableApiError(err, FALLBACK)).toBe("Bevorzugt");
  });

  it("akzeptiert einen kurzen reinen String-Body als Servermeldung", () => {
    const err = makeApiError(500, "Roher Text vom Server");
    expect(readableApiError(err, FALLBACK)).toBe("Roher Text vom Server");
  });

  it("zeigt HTML-Bodies (Plattform-Wartungsseite) NIE roh an", () => {
    const maintenancePage =
      "<!DOCTYPE html>\n<html>\n<head><title>Replit</title></head>\n" +
      "<body>Run this app to see the results here.</body></html>";
    expect(readableApiError(makeApiError(404, maintenancePage), FALLBACK)).toBe(
      SERVER_UNAVAILABLE_MESSAGE,
    );
    expect(
      readableApiError(makeApiError(502, "<html><body>Bad Gateway</body></html>"), FALLBACK),
    ).toBe(SERVER_UNAVAILABLE_MESSAGE);
    // Auch HTML-Fragmente ohne DOCTYPE (beginnen mit "<")
    expect(readableApiError(makeApiError(503, "  <div>wartung</div>"), FALLBACK)).toBe(
      SERVER_UNAVAILABLE_MESSAGE,
    );
  });

  it("behandelt überlange Text-Bodies (ASCII-Grafik, Stacktrace) als nicht anzeigbar", () => {
    const err = makeApiError(500, "x".repeat(1000));
    expect(readableApiError(err, FALLBACK)).toBe(SERVER_UNAVAILABLE_MESSAGE);
  });

  it("liefert bei Netzwerkfehlern (fetch wirft TypeError) den Nicht-erreichbar-Hinweis", () => {
    expect(readableApiError(new TypeError("Failed to fetch"), FALLBACK)).toBe(
      SERVER_UNAVAILABLE_MESSAGE,
    );
  });

  it("trimmt umgebende Leerzeichen der Servermeldung", () => {
    const err = makeApiError(409, { error: "  getrimmt  " });
    expect(readableApiError(err, FALLBACK)).toBe("getrimmt");
  });

  it("fällt bei leerer/whitespace-Servermeldung auf den Fallback zurück", () => {
    expect(readableApiError(makeApiError(400, { error: "   " }), FALLBACK)).toBe(FALLBACK);
    expect(readableApiError(makeApiError(400, {}), FALLBACK)).toBe(FALLBACK);
    expect(readableApiError(makeApiError(400, null), FALLBACK)).toBe(FALLBACK);
  });

  it("fällt bei Nicht-ApiError-Fehlern (z. B. Netzwerk) auf den Fallback zurück", () => {
    expect(readableApiError(new Error("network down"), FALLBACK)).toBe(FALLBACK);
    expect(readableApiError("irgendwas", FALLBACK)).toBe(FALLBACK);
    expect(readableApiError(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("gibt die echten Server-Fehlermeldungen der Team-Verwaltung durch (nicht den UI-Fallback)", () => {
    // Diese beiden Strings sind die konkreten 409-Meldungen aus
    // artifacts/api-server/src/routes/teams.ts. Ändert sich der Wortlaut dort,
    // muss er hier (und im E2E-Test) mitgezogen werden.
    const deleteMsg =
      "Team kann nicht gelöscht werden, solange noch Daten oder Mitglieder zugeordnet sind.";
    const duplicateMsg = "Benutzer ist bereits Mitglied dieses Teams.";

    expect(
      readableApiError(makeApiError(409, { error: deleteMsg }), "Es sind noch Daten oder Mitglieder zugeordnet."),
    ).toBe(deleteMsg);
    expect(
      readableApiError(makeApiError(409, { error: duplicateMsg }), "Bitte erneut versuchen."),
    ).toBe(duplicateMsg);
  });
});

/**
 * `planLimitMessage` mappt die strukturierten 403-Antworten der serverseitigen
 * Free-Limits (`code: "plan_limit_reached"`) auf freundliche Upgrade-Hinweise.
 * Genutzt von Schicht-Dialog (Einzel + Mehrfach), Massenbearbeitung,
 * Abwesenheiten, Assistenten, Team-Verwaltung und Einstellungen.
 */
describe("planLimitMessage", () => {
  it("liefert die Vorausplanungs-Meldung für limit=historyMonths", () => {
    const err = makeApiError(403, {
      error: "Im Free-Tarif kann nur fuer den aktuellen und naechsten Monat geplant werden.",
      code: "plan_limit_reached",
      limit: "historyMonths",
    });
    const msg = planLimitMessage(err);
    expect(msg).toContain("aktuellen und nächsten Monat");
    expect(msg).toContain("Premium");
  });

  it("fällt bei unbekanntem limit auf die Server-Meldung bzw. den generischen Hinweis zurück", () => {
    expect(
      planLimitMessage(
        makeApiError(403, { error: "Server-Text", code: "plan_limit_reached", limit: "neu" }),
      ),
    ).toBe("Server-Text");
    expect(
      planLimitMessage(makeApiError(403, { code: "plan_limit_reached" })),
    ).toContain("Premium");
  });

  it("gibt null für Nicht-Plan-Limit-Fehler zurück", () => {
    expect(planLimitMessage(makeApiError(403, { error: "Keine Berechtigung" }))).toBeNull();
    expect(planLimitMessage(makeApiError(409, { code: "plan_limit_reached" }))).toBeNull();
    expect(planLimitMessage(new Error("network"))).toBeNull();
  });
});

/**
 * `planFeatureMessage` mappt die strukturierten 403-Antworten der serverseitig
 * durchgesetzten Premium-Features (`code: "plan_feature_required"`) auf
 * freundliche Upgrade-Hinweise.
 */
describe("planFeatureMessage", () => {
  it("liefert die passende Meldung für bekannte Features", () => {
    for (const feature of ["bulkEdit", "advancedPersonnelFile", "advancedAnalytics"]) {
      const msg = planFeatureMessage(
        makeApiError(403, { error: "Premium erforderlich", code: "plan_feature_required", feature }),
      );
      expect(msg).toContain("Premium");
    }
  });

  it("fällt bei unbekanntem feature auf die Server-Meldung bzw. den generischen Hinweis zurück", () => {
    expect(
      planFeatureMessage(
        makeApiError(403, { error: "Server-Text", code: "plan_feature_required", feature: "neu" }),
      ),
    ).toBe("Server-Text");
    expect(
      planFeatureMessage(makeApiError(403, { code: "plan_feature_required" })),
    ).toContain("Premium");
  });

  it("gibt null für Nicht-Feature-Fehler zurück", () => {
    expect(planFeatureMessage(makeApiError(403, { error: "Keine Berechtigung" }))).toBeNull();
    expect(planFeatureMessage(makeApiError(409, { code: "plan_feature_required" }))).toBeNull();
    expect(planFeatureMessage(makeApiError(403, { code: "plan_limit_reached" }))).toBeNull();
    expect(planFeatureMessage(new Error("network"))).toBeNull();
  });
});

/**
 * `planUpgradeMessage` kombiniert beide Plan-403-Codes — die Fehler-Handler
 * der Dialoge nutzen diesen Helfer, damit auch ein durchgerutschtes
 * Premium-Feature (z. B. veralteter Tab, Downgrade mitten in der Sitzung)
 * eine klare Upgrade-Meldung statt eines rohen Fehlers zeigt.
 */
describe("planUpgradeMessage", () => {
  it("erkennt plan_feature_required", () => {
    const msg = planUpgradeMessage(
      makeApiError(403, { code: "plan_feature_required", feature: "bulkEdit" }),
    );
    expect(msg).toContain("Massenbearbeitung");
    expect(msg).toContain("Premium");
  });

  it("erkennt plan_limit_reached", () => {
    const msg = planUpgradeMessage(
      makeApiError(403, { code: "plan_limit_reached", limit: "maxTeams" }),
    );
    expect(msg).toContain("Team");
    expect(msg).toContain("Premium");
  });

  it("gibt null für alle anderen Fehler zurück", () => {
    expect(planUpgradeMessage(makeApiError(403, { error: "Keine Berechtigung" }))).toBeNull();
    expect(planUpgradeMessage(makeApiError(401, {}))).toBeNull();
    expect(planUpgradeMessage(new Error("network"))).toBeNull();
  });
});
