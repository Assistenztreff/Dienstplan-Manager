import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, useMutationState } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";

/**
 * Globaler Online/Offline-Status (navigator.onLine + online/offline-Events).
 *
 * Die PWA-App-Shell lädt auch ohne Netz aus dem Cache — API-Aufrufe schlagen
 * dann aber fehl. Statt roher Fehlerzustände zeigt dieses Banner einen
 * freundlichen Hinweis. Beim Wieder-Online-Gehen werden:
 *
 * 1. Alle React-Query-Abfragen neu geladen (Retries sind global deaktiviert,
 *    ohne diesen Anstoß blieben fehlgeschlagene Abfragen dauerhaft leer).
 * 2. Pausierte Mutations automatisch wiederholt (networkMode: 'offlineFirst'
 *    queued sie statt sie sofort scheitern zu lassen).
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function OfflineBanner() {
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  // Anzahl aktuell pausierter Mutations (gestartet während offline).
  const pendingCount = useMutationState({
    filters: { status: "pending" },
    select: (mutation) => (mutation.state.isPaused ? 1 : 0) as 0 | 1,
  }).reduce((sum, v) => sum + v, 0);

  // Wieder online: Abfragen aktualisieren und pausierte Mutations absenden.
  useEffect(() => {
    if (isOnline) {
      void queryClient.invalidateQueries();
      void queryClient.resumePausedMutations();
    }
  }, [isOnline, queryClient]);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 border-b border-amber-300"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {pendingCount > 0 ? (
          <>
            Keine Verbindung —{" "}
            <span data-testid="offline-banner-pending">{pendingCount}</span>{" "}
            {pendingCount === 1 ? "Änderung wird" : "Änderungen werden"} übertragen,
            sobald Sie wieder online sind.
          </>
        ) : (
          "Keine Verbindung — Ihre Daten werden angezeigt, sobald Sie wieder online sind."
        )}
      </span>
    </div>
  );
}
