import { ApiError } from "@workspace/api-client-react";

function pickString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Liefert eine lesbare Fehlermeldung aus einer API-Antwort.
 *
 * Bevorzugt das vom Server gelieferte Detail (`error` / `message` / `detail` /
 * `title`); fällt nur auf den übergebenen generischen Text zurück, wenn keine
 * verwertbare Serverantwort vorliegt (z. B. Netzwerkfehler).
 */
export function readableApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data;

    if (typeof data === "string" && data.trim() !== "") {
      return data.trim();
    }

    const detail =
      pickString(data, "error") ??
      pickString(data, "message") ??
      pickString(data, "detail") ??
      pickString(data, "title");

    if (detail) return detail;
  }

  return fallback;
}

/**
 * Freundliche Upgrade-Hinweise für die serverseitig durchgesetzten Free-Limits.
 * Der Server liefert ein strukturiertes 403 mit `code: "plan_limit_reached"` und
 * einem `limit`-Feld; hier mappen wir das auf eine klare, einheitliche Meldung
 * mit Upgrade-Hinweis (statt der rohen Fehlermeldung).
 */
const PLAN_LIMIT_MESSAGES: Record<string, string> = {
  maxAssistants:
    "Free-Tarif: max. 6 Assistenten. Für unbegrenzte Assistenten auf Premium upgraden.",
  maxTeams:
    "Free-Tarif: max. 1 Team. Für mehrere Teams auf Premium upgraden.",
  maxShiftModels:
    "Free-Tarif: max. 5 Dienste. Für unbegrenzte Dienste auf Premium upgraden.",
  historyMonths:
    "Free-Tarif: Planung nur für den aktuellen und nächsten Monat. Für eine längere Vorausplanung auf Premium upgraden.",
};

/**
 * Erkennt das strukturierte 403 `plan_limit_reached` und liefert eine freundliche
 * Upgrade-Meldung. Gibt `null` zurück, wenn es kein Plan-Limit-Fehler ist (dann
 * normal mit `readableApiError` weiterbehandeln).
 */
export function planLimitMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  const data = err.data;
  if (!data || typeof data !== "object") return null;
  if ((data as Record<string, unknown>).code !== "plan_limit_reached") return null;

  const limit = (data as Record<string, unknown>).limit;
  if (typeof limit === "string" && PLAN_LIMIT_MESSAGES[limit]) {
    return PLAN_LIMIT_MESSAGES[limit];
  }

  return (
    pickString(data, "error") ??
    "Free-Tarif-Limit erreicht. Bitte auf Premium upgraden."
  );
}

/**
 * Freundliche Upgrade-Hinweise für die serverseitig durchgesetzten
 * Premium-Features. Der Server liefert ein strukturiertes 403 mit
 * `code: "plan_feature_required"` und einem `feature`-Feld.
 */
export const PLAN_FEATURE_MESSAGES: Record<string, string> = {
  bulkEdit:
    "Massenbearbeitung ist ein Premium-Feature. Für den Assistenten-Wechsel auf Premium upgraden.",
  advancedPersonnelFile:
    "Lohn- und Sozialversicherungsdaten sind ein Premium-Feature. Für die erweiterte Personalakte auf Premium upgraden.",
  advancedAnalytics:
    "Soll/Ist-Auswertungen sind ein Premium-Feature. Für Auswertungen auf Premium upgraden.",
  payrollExport:
    "Der PDF-Stundennachweis ist ein Premium-Feature. Für den Lohn-Export auf Premium upgraden.",
  strictTimeTracking:
    "Das Bestätigen/Ablehnen von Ist-Zeiten ist ein Premium-Feature. Für die strikte Arbeitszeiterfassung auf Premium upgraden.",
  calendarSync:
    "Der Kalender-Export (.ics) ist ein Premium-Feature. Für den Export in die eigene Kalender-App auf Premium upgraden.",
  caregiverLogin:
    "Einladungslinks für Assistenten sind ein Premium-Feature. Damit Assistenzkräfte einen eigenen Zugang erhalten, auf Premium upgraden.",
};

/**
 * Erkennt das strukturierte 403 `plan_feature_required` und liefert eine
 * freundliche Upgrade-Meldung. Gibt `null` zurück, wenn es kein
 * Premium-Feature-Fehler ist.
 */
export function planFeatureMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  const data = err.data;
  if (!data || typeof data !== "object") return null;
  if ((data as Record<string, unknown>).code !== "plan_feature_required") return null;

  const feature = (data as Record<string, unknown>).feature;
  if (typeof feature === "string" && PLAN_FEATURE_MESSAGES[feature]) {
    return PLAN_FEATURE_MESSAGES[feature];
  }

  return (
    pickString(data, "error") ??
    "Diese Funktion ist im Premium-Tarif enthalten. Bitte auf Premium upgraden."
  );
}
