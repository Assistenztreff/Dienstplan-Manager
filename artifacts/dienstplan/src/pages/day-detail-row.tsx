import { formatAbsenceTimeSpan } from "@/lib/absence-time";
import { format } from "date-fns";
import { useState } from "react";
import { Check, MessageSquare } from "lucide-react";
import { StatusBadge, type StatusBadgeKind } from "@/components/status-badge";
import { useIsCorrectedShift } from "./corrected-shifts";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShiftDeviationReport } from "@workspace/api-client-react";
import {
  DisputeDeviationDialog,
  ReportDeviationDialog,
  type DeviationReportValues,
} from "./deviation-dialog";
import {
  dienstStatusColor,
  isAbsenceShift,
  isConfirmableShift,
  isMirrorShift,
  lastNameInitial,
  PLANNING_STATUS_LABELS,
  planningStatusBadgeOutline,
  type Shift,
  shiftLabel,
  type ShiftModelInfo,
  usePersonSlotLookup,
} from "./dienstplan-helpers";

/** Einzeilige Tagesleisten-Zeile — Pillen-Design (18.08.2026, Task #850):
 *  Links Avatar (Personenfarbe) + Name + Uhrzeit; rechts Statustext
 *  („Dienst · bestätigt", Zustandswort eingefärbt) + Icon-Stack + 4-px-
 *  Statusfarbbalken. Gleiche Farb-/Icon-Quellen wie die Kalender-Pille
 *  (dienstStatusColor / StatusBadge). Zeilenhöhe unverändert.
 *  Abwesenheiten und Teamdienste folgen dem selben Layout. */
export function DayDetailRow({
  shift,
  modelMap,
  onClick,
  onConfirm,
  onConfirmOwn,
  testId,
  hasAusfall = false,
  deviationReport,
  meldungWiederMoeglich = false,
  onReportDeviation,
  onAcceptDeviation,
  onDisputeDeviation,
  deviationActionPending = false,
}: {
  shift: Shift;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: () => void;
  onConfirm?: (shift: Shift) => void;
  /** Bestätigung durch die Assistenzkraft SELBST (eigener Dienst,
   *  Vorschlag oder Korrektur). Eigener Callback statt onConfirm, weil
   *  dahinter eine andere Route steckt: onConfirm ist planerpflichtig
   *  (PATCH /shifts/:id), dies nutzt POST /shifts/:id/confirm-own.
   *  Kay-Feedback 28.08.2026 — vorher gab es für Assistenzkräfte nur
   *  "Alle bestätigen". */
  onConfirmOwn?: (shift: Shift) => void;
  /** data-testid der Zeile — die Wochen-Liste vergibt `shift-badge-<id>`,
   *  damit die bestehenden E2E-Selektoren greifen. */
  testId: string;
  /** Task #792: Person ist am selben Tag krank/kind-krank — rotes Warn-Icon anzeigen. */
  hasAusfall?: boolean;
  /** Abweichungsmodell: vorhandene Meldung zu dieser Schicht (falls eine
   *  existiert — pro Schicht höchstens eine, s. shift_deviation_reports). */
  deviationReport?: ShiftDeviationReport | null;
  /** Der Planer hat nach der letzten (erledigten) Meldung erneut korrigiert —
   *  dann darf erneut gemeldet werden und die alte Meldung ist überholt. */
  meldungWiederMoeglich?: boolean;
  /** Nur gesetzt, wenn die Assistenzkraft für diese Schicht melden darf —
   *  Ownership/Vergangenheits-Check übernimmt der Aufrufer NICHT, die Zeile
   *  prüft selbst (eigener Dienst, bestätigt, vorbei, kein Report). */
  onReportDeviation?: (shift: Shift, values: DeviationReportValues) => void;
  /** Nur vom Planer übergeben (analog zu onConfirm) — Annehmen/Widersprechen
   *  erscheinen nur, wenn beide gesetzt sind UND die Meldung offen ist. */
  onAcceptDeviation?: (shift: Shift) => void;
  onDisputeDeviation?: (shift: Shift, reason: string) => void;
  deviationActionPending?: boolean;
}) {
  const { selectedTeamId } = useTeam();
  const { currentUser } = useAuth();
  const getPersonSlot = usePersonSlotLookup();
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [disputeDialogOpen, setDisputeDialogOpen] = useState(false);
  const mirror = isMirrorShift(shift, selectedTeamId);
  const isAbsence = isAbsenceShift(shift);
  const isTeam = shift.type === "team";
  const status = shift.planningStatus ?? "FIX";
  const label = shiftLabel(shift, modelMap);
  const einsatzLabel =
    shift.einsatzTeamId != null
      ? mirror
        ? `Aushilfe aus ${shift.homeTeamName ?? "anderem Team"}`
        : `Aushilfe für ${shift.einsatzTeamName ?? "anderes Team"}`
      : null;
  // Einvernehmlich korrigiert (gemeldete Abweichung wurde angenommen):
  // Dienst bleibt FIX, bekommt aber zusaetzlich das Korrektur-Symbol.
  const korrigiert = useIsCorrectedShift(shift.id);
  const statusText =
    status === "FIX"
      ? korrigiert
        ? "bestätigt · korrigiert"
        : "bestätigt"
      : (PLANNING_STATUS_LABELS[status] ?? status);
  // Halbtägiger Urlaub (#862): eigene Zeitspanne statt "ganztägig" zeigen,
  // damit die Tagesleiste den echten Zeitraum erkennbar macht.
  const timeLabel = isAbsence
    ? !shift.isPartialAbsence
      ? "ganztägig"
      : formatAbsenceTimeSpan(shift.startTime, shift.endTime)
    : isTeam
      ? ""
      : `${format(new Date(shift.startTime), "HH:mm")}–${format(new Date(shift.endTime), "HH:mm")}`;
  const clickable = !!onClick && !mirror;

  // Avatar-Farbe: Personenslot für Arbeits-/Abwesenheitsschichten,
  // Himmelblau (#0284c7) für Teamdienste (wie in der Kalender-Pille).
  const slot = getPersonSlot(shift.userId);
  const avatarColor = isTeam ? "#0284c7" : slot.bg;
  const avatarLabel = isTeam ? "T" : shift.user?.name ? lastNameInitial(shift.user.name) : "?";

  // Rechter Statusfarbbalken: exakt dieselbe Prioritätslogik wie in der Pille.
  const statusBarColor = dienstStatusColor(status, hasAusfall, shift.isVertretung);

  // Basis-Status-Icon (ohne Vertretung/Krank-Overlay).
  const baseIconKind: StatusBadgeKind =
    status === "FIX"
      ? "confirmed"
        : status === "ANGEBOTEN"
          ? "sent"
          : "draft";

  const confirmable = onConfirm && !mirror && isConfirmableShift(shift);
  // Eigenbestätigung: nur der eigene, vorgeschlagene Dienst und nur, wenn
  // nicht ohnehin schon der Planer-Knopf steht (sonst zwei Knöpfe).
  const selfConfirmable =
    !confirmable &&
    !!onConfirmOwn &&
    !mirror &&
    shift.planningStatus === "ANGEBOTEN" &&
    isConfirmableShift(shift) &&
    currentUser?.id === shift.userId;

  // Abweichungsmodell: "Zeit korrigieren" nur für die eigene, bereits vergangene
  // FIX-Schicht (Arbeitsdienst, keine Abwesenheit/Teamdienst), solange noch
  // keine Meldung existiert (Abbruchregel — genau eine Meldung pro Dienst).
  const isPastFixWorkShift =
    !mirror &&
    !isAbsence &&
    !isTeam &&
    status === "FIX" &&
    new Date(shift.endTime).getTime() < Date.now();
  // Eine ueberholte Meldung (der Planer hat seither erneut korrigiert) zaehlt
  // nicht mehr — sonst bliebe der Knopf fuer immer weg und die Assistenzkraft
  // haette zum neuen Stand keine Stimme (Kay-Test 28.08.2026, Punkt 4).
  const meldungUeberholt = meldungWiederMoeglich;
  const canReportDeviation =
    !!onReportDeviation &&
    isPastFixWorkShift &&
    (!deviationReport || meldungUeberholt) &&
    currentUser?.id === shift.userId;
  // Annehmen/Widersprechen nur für den Planer (Aufrufer übergibt die
  // Callbacks nur dann, analog zu onConfirm) und nur solange offen.
  const canRespondToDeviation =
    !!onAcceptDeviation &&
    !!onDisputeDeviation &&
    !meldungUeberholt &&
    deviationReport?.status === "PENDING";

  return (
    <div
      data-testid={testId}
      data-planning-status={status}
      title={
        mirror && einsatzLabel
          ? `${label} · ${einsatzLabel} (wird im Stammteam bearbeitet)`
          : `${shift.user?.name ? `${shift.user.name} · ` : ""}${label}`
      }
      // Wie die Kalenderzellen (3.4): div mit role=button + Enter/Space; die
      // verschachtelten Bestätigen-/Notiz-Buttons stoppen das Bubbling.
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick?.();
              }
            }
          : undefined
      }
      // Kompakte Zeile (Abnahme 27.08.2026): optisch 36 px statt 44 px —
      // die Tippfläche bleibt über das unsichtbare ::after volle 44 px
      // (DESIGN-GUIDELINES: Touch-Ziele mind. 44×44). overflow-x-clip statt
      // overflow-hidden, damit die vertikal überstehende Tippzone nicht
      // weggeschnitten wird; horizontal bleibt alles geclippt (truncate).
      className={`relative flex min-h-[36px] items-center gap-2 overflow-x-clip border-b border-[#f1f1ee] py-1 pl-3 pr-[8px] text-[12.5px] last:border-b-0 ${planningStatusBadgeOutline(shift)} ${
        clickable
          ? "cursor-pointer transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          : ""
      }`}
    >
      {/* Avatar: runder Initialen-Kreis in der Personenfarbe (wie in der
          Kalender-Pille); 2 px größer als die Schriftgröße des Namens. */}
      <span
        aria-hidden="true"
        className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[7.5px] font-bold leading-none text-white"
        style={{ backgroundColor: avatarColor }}
      >
        {avatarLabel}
      </span>

      {/* Linke Gruppe: Name + Uhrzeit — nimmt den verfügbaren Platz auf;
          der Rest der Zeile bleibt rechts-ausgerichtet (shrink-0). Name
          IMMER zeigen, auch ohne Bearbeitungsrecht (Assistenzkraft sieht
          serverseitig nur eigene Schichten — kein Leck; festgepinnt in
          dienstplan-zweiklick-desktop.spec.ts). */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {shift.user && (
          <span className="shrink truncate font-semibold text-[#151515]">
            {shift.user.name}
          </span>
        )}
        {timeLabel && (
          <span className="shrink-0 whitespace-nowrap tabular-nums text-[11.5px] text-[#555555]">
            {timeLabel}
          </span>
        )}
      </span>

      {/* Bestätigen-Button (Entwurf/Vorschlag): stoppt das Bubbling,
          damit der Zeilenklick (Bearbeiten) nicht feuert. */}
      {confirmable && (
        <button
          type="button"
          data-testid={`shift-confirm-${shift.id}`}
          title="Als verbindlich bestätigen"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(shift);
          }}
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border border-[#d8d8d4] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#092948] transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:border-[#092948]"
        >
          <Check className="h-3 w-3" />
          Bestätigen
        </button>
      )}

      {/* Eigenbestätigung der Assistenzkraft — Beschriftung macht den
          Unterschied sichtbar: eine Korrektur betrifft einen bereits
          gearbeiteten Dienst, ein Vorschlag die reine Planung. */}
      {selfConfirmable && (
        <button
          type="button"
          data-testid={`shift-confirm-own-${shift.id}`}
          title="Diesen Dienstvorschlag verbindlich annehmen"
          onClick={(e) => {
            e.stopPropagation();
            onConfirmOwn(shift);
          }}
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border border-[#d8d8d4] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#092948] transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:border-[#092948]"
        >
          <Check className="h-3 w-3" />
          Annehmen
        </button>
      )}

      {/* "Zeit korrigieren" — Abweichungsmodell (Assistenzkraft). Bewusst
          dasselbe Wort wie beim Planer-Weg: es ist derselbe Vorgang aus der
          anderen Richtung, und zwei Begriffe für eine Sache haben beim
          Testen zuverlässig verwirrt (Kay-Feedback 28.08.2026). */}
      {canReportDeviation && (
        <button
          type="button"
          data-testid={`deviation-report-${shift.id}`}
          title="Tatsächlich geleistete Zeit melden — der Arbeitgeber bestätigt sie"
          onClick={(e) => {
            e.stopPropagation();
            setReportDialogOpen(true);
          }}
          // Eigene, größere Auszeichnung (Kay-Feedback 28.08.): Abweichungs-
          // Farbe (#b5790a, dieselbe wie VORLAEUFIG/Abweichung im Mockup)
          // statt der neutralen Bestätigen-Optik — der Melde-Button soll
          // auffallen, nicht wie eine Routine-Aktion wirken.
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border border-[#b5790a] bg-white px-2.5 py-1 text-[14px] font-semibold text-[#b5790a] transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:bg-[#b5790a]/10"
        >
          Zeit korrigieren
        </button>
      )}

      {/* Meldung offen und der Betrachter ist NICHT der Planer (der bekommt
          stattdessen die Annehmen/Widersprechen-Buttons unten) — kurzer
          Warte-Hinweis für die meldende Assistenzkraft. */}
      {deviationReport?.status === "PENDING" && !meldungUeberholt && !canRespondToDeviation && (
        <span
          data-testid={`deviation-status-${shift.id}`}
          className="relative z-10 shrink-0 whitespace-nowrap rounded-md border border-[#b5790a] bg-white px-2.5 py-1 text-[14px] font-semibold text-[#b5790a]"
        >
          Gemeldet
        </span>
      )}

      {/* Strittig — beide Seiten sehen den Grund per Tooltip; Planwert gilt. */}
      {deviationReport?.status === "DISPUTED" && !meldungUeberholt && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid={`deviation-status-${shift.id}`}
                className="relative z-10 shrink-0 cursor-default whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-semibold text-red-800"
                onClick={(e) => e.stopPropagation()}
              >
                Strittig
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] break-words text-xs">
              {deviationReport.disputeReason}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Annehmen/Widersprechen — nur Planer, nur solange offen. */}
      {canRespondToDeviation && (
        <span className="relative z-10 flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid={`deviation-accept-${shift.id}`}
            title="Gemeldete Abweichung annehmen"
            onClick={(e) => {
              e.stopPropagation();
              onAcceptDeviation!(shift);
            }}
            className="inline-flex items-center whitespace-nowrap rounded-md border border-[#1e8f4e] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1e8f4e] transition-colors hover:bg-[#1e8f4e]/10"
          >
            Annehmen
          </button>
          <button
            type="button"
            data-testid={`deviation-dispute-open-${shift.id}`}
            title="Gemeldeter Abweichung widersprechen"
            onClick={(e) => {
              e.stopPropagation();
              setDisputeDialogOpen(true);
            }}
            className="inline-flex items-center whitespace-nowrap rounded-md border border-[#d8d8d4] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#092948] transition-colors hover:border-[#092948]"
          >
            Widersprechen
          </button>
        </span>
      )}

      {/* Notiz-Icon */}
      {shift.notes && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid={`shift-note-icon-${shift.id}`}
                className="relative z-10 inline-flex shrink-0 cursor-default items-center text-[#555555]/70"
                onClick={(e) => e.stopPropagation()}
              >
                <MessageSquare className="h-3 w-3 shrink-0" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] break-words text-xs">
              {shift.notes}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Rechte Statusgruppe: Statustext (Zustandswort eingefärbt) +
          Icon-Stack + 4-px-Farbbalken (absolute).
          4-px-Abstand zum Balken durch pr-[8px] auf dem Elternelement. */}
      <span className="flex max-w-[160px] shrink-0 items-center gap-1 text-[11.5px] text-[#555555]">
        {/* Statustext */}
        <span className="truncate">
          {isAbsence ? (
            <>Abwesenheit · {label}</>
          ) : (
            <>
              {isTeam ? "Teamdienst" : "Dienst"}
              {einsatzLabel ? ` · ${einsatzLabel}` : ""}
              {shift.isVertretung ? " · Vertretung" : ""}
              {" · "}
              <span style={{ color: statusBarColor }}>{statusText}</span>
            </>
          )}
        </span>
        {/* Icon-Stack: aufsteigend wichtig — Basis-Status links, Ausfall ganz
            rechts (wie in der Kalender-Pille). */}
        <span className="flex shrink-0 items-center -space-x-[5px]">
          <StatusBadge
            kind={baseIconKind}
            compact
            label={
              status === "FIX" ? "Bestätigt" : status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"
            }
          />
          {korrigiert && (
            <StatusBadge
              kind="correction"
              compact
              label="Nachträglich korrigiert (gemeldete Abweichung angenommen)"
            />
          )}
          {shift.isVertretung && (
            <StatusBadge kind="vertretung" compact label="Vertretung" />
          )}
          {hasAusfall && (
            <StatusBadge kind="krank" compact label="Ausfall: Assistenzkraft abwesend" />
          )}
        </span>
      </span>

      {/* Rechter 4-px-Statusfarbbalken — gleiche Farbe wie in der Kalender-
          Pille; overflow:hidden auf dem Elternelement clippt ihn bündig. */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 right-0 top-0 w-[4px]"
        style={{ backgroundColor: statusBarColor }}
      />

      {reportDialogOpen && onReportDeviation && (
        <ReportDeviationDialog
          shift={shift}
          open={reportDialogOpen}
          onOpenChange={setReportDialogOpen}
          submitting={deviationActionPending}
          onSubmit={(values) => {
            onReportDeviation(shift, values);
            setReportDialogOpen(false);
          }}
        />
      )}
      {disputeDialogOpen && onDisputeDeviation && (
        <DisputeDeviationDialog
          open={disputeDialogOpen}
          onOpenChange={setDisputeDialogOpen}
          submitting={deviationActionPending}
          onSubmit={(reason) => {
            onDisputeDeviation(shift, reason);
            setDisputeDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
