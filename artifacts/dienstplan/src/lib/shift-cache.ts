import type { QueryClient } from "@tanstack/react-query";

/**
 * API-Limit je Sammel-Löschauftrag (openapi.yaml, BulkDeleteShiftsInput
 * maxItems). Größere Auswahlen laufen in Blöcken — jeder Block serverseitig
 * transaktional (ganz oder gar nicht).
 */
export const BULK_DELETE_CHUNK_SIZE = 200;

/** Zerlegt eine ID-Liste in API-konforme Blöcke (max. 200 je Request). */
export function chunkIds(ids: number[], size = BULK_DELETE_CHUNK_SIZE): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * Entfernt gelöschte Einträge sofort aus allen geladenen Shift-Listen im
 * React-Query-Cache (exakter Key "/api/shifts", alle Parameter-Varianten —
 * Unterpfade wie "/api/shifts/hours-balance" haben eigene Keys und bleiben
 * unberührt).
 *
 * Zweck (Task #751): Die Oberfläche reagiert direkt nach der Server-
 * Bestätigung, statt auf den vollständigen Monats-Reload zu warten. Der Patch
 * läuft NUR nach erfolgreichem Löschen (kein Rollback nötig); die
 * anschließende Hintergrund-Invalidierung gleicht abgeleitete Daten
 * (Stunden-Salden, Urlaubszähler) ab.
 */
export function removeShiftsFromCache(queryClient: QueryClient, ids: Iterable<number>): void {
  const idSet = new Set(ids);
  if (idSet.size === 0) return;
  queryClient.setQueriesData<Array<{ id: number }> | undefined>(
    { predicate: (q) => q.queryKey[0] === "/api/shifts" },
    (old) => (Array.isArray(old) ? old.filter((s) => !idSet.has(s.id)) : old)
  );
}

/**
 * Key-Präfixe aller Queries, deren Daten von Schichten/Abwesenheiten
 * abgeleitet sind: Listen selbst, Verträge (Urlaubszähler inkl.
 * /api/contracts/{id}/vacation-balance), Zeiterfassung (Abwesenheiten buchen
 * Ist-Zeiten) und alle Dashboard-Salden (/api/dashboard/*).
 */
const SHIFT_DERIVED_KEY_PREFIXES = [
  "/api/shifts",
  "/api/contracts",
  "/api/time-tracking",
  "/api/dashboard",
] as const;

/**
 * Stößt nach Anlegen/Ändern/Löschen von Einträgen die Hintergrund-
 * Invalidierung ALLER abgeleiteten Daten an (Stunden-Salden, Urlaubszähler,
 * Zeiterfassung, Dashboard-Karten). Aktive Ansichten laden neu, alles andere
 * wird als veraltet markiert und beim nächsten Öffnen frisch geholt.
 */
export function invalidateShiftDerivedQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey[0];
      return (
        typeof key === "string" &&
        SHIFT_DERIVED_KEY_PREFIXES.some((p) => key === p || key.startsWith(`${p}/`))
      );
    },
  });
}
