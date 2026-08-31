/**
 * Nachträglich korrigierte Dienste (Kay-Feedback 28.08.2026).
 *
 * Ein Dienst gilt als „korrigiert", wenn eine gemeldete Abweichung vom Planer
 * ANGENOMMEN wurde. Der Dienst bleibt dabei bewusst auf FIX — beide Seiten
 * sind sich ja einig, eine erneute Bestätigung wäre sinnlos. Er soll aber
 * trotzdem als Korrektur erkennbar sein, zusätzlich zum Bestätigt-Haken
 * (gleiches Muster wie die Krank-Markierung).
 *
 * Bewusst als Context statt als Prop-Kette: die Information wird in vier
 * voneinander unabhängigen Ansichten gebraucht (Monatsraster, Tabelle,
 * Tagesleiste, Pille) und würde sonst durch fünf Ebenen durchgereicht.
 *
 * Nicht zu verwechseln mit isPastCorrection (dienstplan-helpers.tsx): das ist
 * die vom PLANER angestoßene Korrektur eines vergangenen Dienstes, die auf
 * ANGEBOTEN zurückfällt und von der Assistenzkraft noch bestätigt werden muss.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

const CorrectedShiftsContext = createContext<ReadonlySet<number>>(new Set());

export function CorrectedShiftsProvider({
  shiftIds,
  children,
}: {
  shiftIds: ReadonlySet<number>;
  children: ReactNode;
}) {
  return (
    <CorrectedShiftsContext.Provider value={shiftIds}>{children}</CorrectedShiftsContext.Provider>
  );
}

/** IDs aller Dienste mit angenommener Abweichungsmeldung. */
export function useCorrectedShiftIds(): ReadonlySet<number> {
  return useContext(CorrectedShiftsContext);
}

/** Ist dieser Dienst nachträglich einvernehmlich korrigiert worden? */
export function useIsCorrectedShift(shiftId: number): boolean {
  const ids = useCorrectedShiftIds();
  return useMemo(() => ids.has(shiftId), [ids, shiftId]);
}
