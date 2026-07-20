// ---------------------------------------------------------------------------
// Soft-Close-Warnung: Hinweis beim Bearbeiten eines bereits abgeschlossenen
// Monats. Die Aktion wird NIE blockiert — der Server erlaubt Änderungen
// weiterhin, sie erscheinen im Folgemonat als Nachberechnung.
// ---------------------------------------------------------------------------
// Fire-and-forget nach erfolgreichem Speichern/Löschen: der Status-Endpunkt
// ist admin- & premium-gegated (advancedAnalytics); 401/403 (Assistent oder
// Free-Konto) werden bewusst still ignoriert.
// ---------------------------------------------------------------------------

import { getMonthClosings } from "@workspace/api-client-react";
import { toast } from "sonner";

// Kleiner Cache je (Monat, Jahr, Team), damit Massenaktionen nicht pro Schicht
// eine Statusabfrage feuern und der Toast nicht mehrfach erscheint.
const closedCache = new Map<string, boolean>();
const warnedThisSession = new Set<string>();
// Laufende Statusabfragen je Schlüssel: Massen-Anlegen feuert warnIfMonthClosed
// für alle Tage im SELBEN Tick — ohne In-Flight-Dedupe würde jeder Aufruf eine
// eigene GET-Anfrage starten, bevor die erste den Boolean-Cache füllen kann.
const inflight = new Map<string, Promise<boolean>>();

export function clearMonthClosingWarningCache(): void {
  closedCache.clear();
  warnedThisSession.clear();
  inflight.clear();
}

/**
 * Prüft nach einer Schreibaktion, ob der betroffene Monat bereits
 * abgeschlossen ist, und zeigt dann einmalig einen Warn-Toast.
 */
export async function warnIfMonthClosed(date: Date, teamId: number | null): Promise<void> {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const key = `${year}-${month}-${teamId ?? "auto"}`;
  try {
    let closed = closedCache.get(key);
    if (closed === undefined) {
      let pending = inflight.get(key);
      if (!pending) {
        pending = getMonthClosings({
          month,
          year,
          ...(teamId != null ? { teamId } : {}),
        }).then((status) => status.closed);
        inflight.set(key, pending);
      }
      try {
        closed = await pending;
        closedCache.set(key, closed);
      } finally {
        inflight.delete(key);
      }
    }
    if (!closed || warnedThisSession.has(key)) return;
    warnedThisSession.add(key);
    toast.warning("Monat bereits abgeschlossen", {
      description:
        "Dieser Monat wurde bereits abgeschlossen. Die Änderung wird in der Auswertung des Folgemonats als Nachberechnung ausgewiesen.",
      duration: 8000,
    });
  } catch {
    // Kein Zugriff (Assistent/Free) oder Netzwerkfehler — Warnung entfällt still.
  }
}
