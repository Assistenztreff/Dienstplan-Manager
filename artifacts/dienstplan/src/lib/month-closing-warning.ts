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

export function clearMonthClosingWarningCache(): void {
  closedCache.clear();
  warnedThisSession.clear();
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
      const status = await getMonthClosings({
        month,
        year,
        ...(teamId != null ? { teamId } : {}),
      });
      closed = status.closed;
      closedCache.set(key, closed);
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
