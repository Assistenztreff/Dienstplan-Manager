import type { QueryClient } from "@tanstack/react-query";
import { getListShiftsQueryOptions, type ListShiftsParams } from "@workspace/api-client-react";

/**
 * API-Limit je Sammel-Löschauftrag (openapi.yaml, BulkDeleteShiftsInput
 * maxItems). Größere Auswahlen laufen in Blöcken — jeder Block serverseitig
 * transaktional (ganz oder gar nicht).
 */
export const BULK_DELETE_CHUNK_SIZE = 200;

/**
 * Gültigkeitsdauer für Schicht-Listen (Task #758: Seitenstart & Monats-
 * wechsel beschleunigen). 30s "frisch" halten verhindert, dass schnelles
 * Vor-/Zurückblättern oder ein kurz danach geöffneter Dialog (gleicher
 * Query-Key) dieselben Daten sofort erneut lädt; 15 Minuten im Cache halten
 * zuletzt gesehene Monate beim Zurückblättern instant verfügbar. Mutationen
 * umgehen das ohnehin über invalidateShiftDerivedQueries — Invalidierung
 * erzwingt einen Reload unabhängig von der Gültigkeitsdauer.
 */
export const SHIFT_LIST_STALE_TIME_MS = 30_000;
export const SHIFT_LIST_GC_TIME_MS = 15 * 60_000;

/**
 * Referenzdaten (Nutzer, Teams, Schichtmodelle, Zuschlags-Einstellungen)
 * ändern sich seltener als Schichten selbst — eine großzügigere
 * Gültigkeitsdauer vermeidet unnötige Neuladungen beim Wechseln zwischen
 * Dienstplan-Unterseiten oder beim Öffnen eines Dialogs kurz nach dem
 * Seitenaufruf.
 *
 * Task #794: 5 Minuten (= globaler QueryClient-Standard) statt 1 Minute,
 * damit Nutzerlisten und Einstellungen bei normaler Navigation nicht
 * unnötig neu geladen werden. Mutationen rufen invalidateQueries auf und
 * erzwingen so sofortige Aktualisierungen nach Schreiboperationen.
 */
export const REFERENCE_DATA_STALE_TIME_MS = 5 * 60_000;

/**
 * Läd die Schichten des Vor- und Folgemonats (gleicher Team-Scope) im
 * Hintergrund vor (Task #758). Nutzt dieselben Query-Optionen wie
 * useListShifts, damit React Query den Cache-Eintrag exakt teilt — ein Klick
 * auf "Vorheriger/Nächster Monat" findet die Daten dann meist schon vor (ein
 * bereits frischer Eintrag löst dank SHIFT_LIST_STALE_TIME_MS keinen
 * weiteren Request aus, auch nicht bei wiederholtem Aufruf dieser Funktion).
 */
export function prefetchAdjacentMonthShifts(
  queryClient: QueryClient,
  month: number,
  year: number,
  teamParam: { teamId?: number },
): void {
  for (const delta of [-1, 1]) {
    const target = new Date(year, month - 1 + delta, 1);
    const params: ListShiftsParams = {
      month: target.getMonth() + 1,
      year: target.getFullYear(),
      ...teamParam,
    };
    void queryClient.prefetchQuery({
      ...getListShiftsQueryOptions(params),
      staleTime: SHIFT_LIST_STALE_TIME_MS,
      gcTime: SHIFT_LIST_GC_TIME_MS,
    });
  }
}

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

/** Minimale Strukturform eines Listen-Eintrags aus GET /shifts. */
export interface CachedShiftRow {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
}

/**
 * Prüft, ob ein Eintrag in eine gecachte /api/shifts-Liste mit diesen
 * Query-Parametern gehört. Spiegelt die Server-Filter: Monat/Jahr wirken nur
 * GEMEINSAM und beziehen sich auf den Startzeitpunkt in UTC (EXTRACT auf der
 * timestamptz-Spalte); userId/type exakt. Team-gescopte Listen werden nur
 * befüllt, wenn das Ziel-Team des Schreibvorgangs bekannt ist und passt —
 * sonst überlässt der Aufrufer die Angleichung der Hintergrund-Invalidierung.
 */
function matchesListParams(
  shift: CachedShiftRow,
  params: Record<string, unknown>,
  teamId: number | null
): boolean {
  if (params.month != null && params.year != null) {
    const d = new Date(shift.startTime);
    if (
      d.getUTCMonth() + 1 !== Number(params.month) ||
      d.getUTCFullYear() !== Number(params.year)
    ) {
      return false;
    }
  }
  if (params.userId != null && shift.userId !== Number(params.userId)) return false;
  if (params.type != null && shift.type !== params.type) return false;
  if (params.teamId != null && (teamId == null || Number(params.teamId) !== teamId)) return false;
  return true;
}

/**
 * Fügt neu angelegte bzw. geänderte Einträge sofort in alle passenden
 * geladenen Shift-Listen ein (bzw. ersetzt sie dort per ID). Gegenstück zu
 * removeShiftsFromCache: Die Oberfläche zeigt das Ergebnis direkt nach der
 * Server-Bestätigung, die anschließende Hintergrund-Invalidierung gleicht
 * abgeleitete Daten (Salden, Urlaubszähler) ab.
 *
 * `teamId` ist das aufgelöste Ziel-Team des Schreibvorgangs (aus der
 * Server-Antwort oder dem Dialog-Kontext); ohne Angabe bleiben team-gescopte
 * Listen unangetastet (kein falsches Team-Fenster).
 */
export function upsertShiftsInCache(
  queryClient: QueryClient,
  shifts: readonly CachedShiftRow[],
  teamId: number | null = null
): void {
  if (shifts.length === 0) return;
  const byId = new Map(shifts.map((s) => [s.id, s] as const));
  const queries = queryClient
    .getQueryCache()
    .findAll({ predicate: (q) => q.queryKey[0] === "/api/shifts" });
  for (const query of queries) {
    const rawParams = query.queryKey[1];
    const params =
      rawParams && typeof rawParams === "object" ? (rawParams as Record<string, unknown>) : {};
    queryClient.setQueryData<CachedShiftRow[] | undefined>(query.queryKey, (old) => {
      if (!Array.isArray(old)) return old;
      const kept = old.filter((s) => !byId.has(s.id));
      const additions = shifts.filter((s) => matchesListParams(s, params, teamId));
      if (additions.length === 0 && kept.length === old.length) return old;
      return [...kept, ...additions];
    });
  }
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
