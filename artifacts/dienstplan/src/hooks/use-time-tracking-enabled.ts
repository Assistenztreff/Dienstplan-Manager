import {
  useGetTimeTrackingStatus,
  getGetTimeTrackingStatusQueryKey,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Effektiver Zeiterfassungs-Zustand des ANGEMELDETEN Nutzers.
//
// Quelle: GET /api/time-tracking-status (Server-Wahrheit) —
// Admin-artige Rollen = eigene Konto-Einstellung (allowance_settings,
// Konto-Zeile), Assistenzkräfte = Zustand des ARBEITGEBERS (aktiv, sobald
// der Eigentümer EINES ihrer Teams die Zeiterfassung eingeschaltet hat).
//
// Standard ist AUS: solange der Zustand lädt oder ein Fehler auftritt, gilt
// die Zeiterfassung als deaktiviert (Menüpunkt/Verweise bleiben verborgen,
// statt kurz aufzublitzen und wieder zu verschwinden).
// ---------------------------------------------------------------------------

export function useTimeTrackingEnabled(): {
  enabled: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useGetTimeTrackingStatus();
  return { enabled: data?.enabled === true, isLoading };
}

/** Query-Key für gezielte Invalidierung nach dem Umschalten in den Einstellungen. */
export const timeTrackingStatusQueryKey = getGetTimeTrackingStatusQueryKey;
