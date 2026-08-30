// ---------------------------------------------------------------------------
// Vertretung einsetzen — EIN Weg fuer beide Ausloeser (Kay 30.08.2026).
// ---------------------------------------------------------------------------
// Faellt eine Assistenzkraft aus und war jemand als Vertretung vorgemerkt,
// fragt die App direkt nach: "Toni Reller als Vertretung eintragen?" Ein Klick
// legt den Dienst mit den ORIGINAL-Zeiten und der Original-Dienstart des
// verdraengten Dienstes an — sofort verbindlich (FIX), ohne den Umweg ueber
// einen Vorschlag: Wer Bereitschaft zugesagt hat, muss nicht noch einmal
// zustimmen.
//
// WARUM HIER UND NICHT ZWEIMAL: Es gibt zwei Ausloeser fuer denselben Vorgang —
// der Planer traegt die Abwesenheit direkt am Dienst ein (Dienst-Dialog), oder
// er bestaetigt eine aus der App gemeldete Krankheit (Abwesenheitsseite).
// Beide muessen sich identisch verhalten; eine zweite Umsetzung waere genau
// das Muster, das in diesem Projekt schon mehrfach auseinandergelaufen ist
// (s. Gedaechtnis "bwavg dropped from single-shift path").
// ---------------------------------------------------------------------------

import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateShift, type ShiftInputType } from "@workspace/api-client-react";
import { invalidateShiftDerivedQueries, upsertShiftsInCache } from "@/lib/shift-cache";
import { useTeam } from "@/context/team";

/** Vorschlag, wie ihn Server-Antworten mitliefern (Dienst-PATCH/POST und
 *  Antrags-Bestaetigung liefern dieselbe Form). */
export type VertretungsVorschlag = {
  userId: number;
  userName: string;
  teamId: number;
  startTime: string;
  endTime: string;
  type: string;
  shiftModelId?: number | null;
};

export function useVertretungAktivieren(): {
  /** Fragt per Toast nach; ein Klick auf "Eintragen" legt den Dienst an. */
  frageVertretung: (vorschlag: VertretungsVorschlag) => void;
  /** Mehrere Vorschlaege (Sammel-Abwesenheit ueber mehrere Tage). */
  frageVertretungen: (vorschlaege: VertretungsVorschlag[]) => void;
} {
  const queryClient = useQueryClient();
  const createShift = useCreateShift();
  const { selectedTeamId } = useTeam();

  async function eintragen(vorschlag: VertretungsVorschlag) {
    try {
      const created = await createShift.mutateAsync({
        data: {
          userId: vorschlag.userId,
          teamId: vorschlag.teamId,
          startTime: vorschlag.startTime,
          endTime: vorschlag.endTime,
          type: vorschlag.type as ShiftInputType,
          shiftModelId: vorschlag.shiftModelId ?? undefined,
          isVertretung: true,
          planningStatus: "FIX",
        },
      });
      upsertShiftsInCache(queryClient, [created], selectedTeamId);
      void invalidateShiftDerivedQueries(queryClient);
      toast.success(`Vertretung für ${vorschlag.userName} eingetragen.`);
    } catch {
      toast.error(
        "Vertretung konnte nicht eingetragen werden. Bitte im Dienstplan manuell anlegen.",
      );
    }
  }

  function frageVertretung(vorschlag: VertretungsVorschlag) {
    toast(`Vertretung: ${vorschlag.userName} für diesen Dienst eintragen?`, {
      action: {
        label: "Eintragen",
        onClick: () => void eintragen(vorschlag),
      },
      duration: 15000,
    });
  }

  function frageVertretungen(vorschlaege: VertretungsVorschlag[]) {
    // Ein Toast je Tag: Der Planer soll jeden Tag einzeln entscheiden koennen
    // — bei einer Krankmeldung ueber mehrere Tage kann an einem Tag jemand
    // anders einspringen oder gar niemand.
    for (const v of vorschlaege) frageVertretung(v);
  }

  return { frageVertretung, frageVertretungen };
}
