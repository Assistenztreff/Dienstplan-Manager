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
  ObjectCorrectionDialog,
  ReportDeviationDialog,
  type DeviationReportValues,
} from "./deviation-dialog";
import {
  dienstStatusColor,
  isAbsenceShift,
  isConfirmableShift,
  isMirrorShift,
  isPastCorrection,
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
  correctionObjection,
  onObjectCorrection,
  onWithdrawCorrection,
  testId,
  hasAusfall = false,
  deviationReport,
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
  /** Offener Widerspruch gegen die Korrektur dieses Dienstes, falls vorhanden. */
  correctionObjection?: { id: number; reason: string; status: string } | null;
  /** Assistenzkraft widerspricht der Korrektur (mit Begründung). */
  onObjectCorrection?: (shift: Shift, reason: string) => void;
  /** Planer nimmt die bestrittene Korrektur zurück. */
  onWithdrawCorrection?: (shift: Shift) => void;
  /** data-testid der Zeile — die Wochen-Liste vergibt `shift-badge-<id>`,
   *  damit die bestehenden E2E-Selektoren greifen. */
  testId: string;
  /** Task #792: Person ist am selben Tag krank/kind-krank — rotes Warn-Icon anzeigen. */
  hasAusfall?: boolean;
  /** Abweichungsmodell: vorhandene Meldung zu dieser Schicht (falls eine
   *  existiert — pro Schicht höchstens eine, s. shift_deviation_reports). */
  deviationReport?: ShiftDeviationReport | null;
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
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
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
  const pastCorrection = isPastCorrection(shift);
  // Einvernehmlich korrigiert (gemeldete Abweichung wurde angenommen):
  // Dienst bleibt FIX, bekommt aber zusaetzlich das Korrektur-Symbol.
  const korrigiert = useIsCorrectedShift(shift.id);
  const statusText =
    status === "FIX"
      ? korrigiert
        ? "bestätigt · korrigiert"
        : "bestätigt"
      : pastCorrection
        ? "Korrektur"
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
  const statusBarColor = dienstStatusColor(status, hasAusfall, shift.isVertretung, pastCorrection);

  // Basis-Status-Icon (ohne Vertretung/Krank-Overlay).
  const baseIconKind: StatusBadgeKind =
    status === "FIX"
      ? "confirmed"
      : pastCorrection
        ? "correction"
        : status === "ANGEBOTEN"
          ? "sent"
          : "draft";

  // Vier-Augen-Prinzip bei Korrekturen (Kay-Feedback 28.08.2026): Eine offene
  // Korrektur an einem bereits gearbeiteten Dienst darf NUR die betroffene
  // Assistenzkraft bestätigen — sonst könnte der Planer seine eigene Änderung
  // selbst abnicken und der Rückfall auf ANGEBOTEN wäre eine Formalie. Der
  // Server weist das ohnehin ab (403 correction_needs_assistant); hier wird
  // der Knopf gar nicht erst angeboten. Ist die Assistenzkraft selbst die
  // planende Person (Einzelkonto), bleibt er sichtbar.
  const korrekturFremd = pastCorrection && currentUser?.id !== shift.userId;
  const strittig = correctionObjection?.status === "OPEN";
  // Widersprechen darf nur die betroffene Person, nur bei offener Korrektur und
  // nur solange noch kein Widerspruch steht (einer je Dienst, s. Schema).
  const canObjectCorrection =
    !!onObjectCorrection &&
    !mirror &&
    pastCorrection &&
    !strittig &&
    currentUser?.id === shift.userId;
  // Zurücknehmen ist Planer-Sache — der Aufrufer übergibt den Callback nur dann.
  const canWithdrawCorrection = !!onWithdrawCorrection && !mirror && strittig;
  const confirmable = onConfirm && !mirror && !korrekturFremd && isConfirmableShift(shift);
  // Eigenbestätigung: nur der eigene, vorgeschlagene Dienst und nur, wenn
  // nicht ohnehin schon der Planer-Knopf steht (sonst zwei Knöpfe).
  const selfConfirmable =
    !confirmable &&
    !!onConfirmOwn &&
    !mirror &&
    // Solange der Widerspruch offen ist, wird nicht bestätigt — sonst hebt
    // ein Fehlklick den eigenen Einspruch stillschweigend auf.
    !strittig &&
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
  const canReportDeviation =
    !!onReportDeviation &&
    isPastFixWorkShift &&
    !deviationReport &&
    currentUser?.id === shift.userId;
  // Annehmen/Widersprechen nur für den Planer (Aufrufer übergibt die
  // Callbacks nur dann, analog zu onConfirm) und nur solange offen.
  const canRespondToDeviation =
    !!onAcceptDeviation && !!onDisputeDeviation && deviationReport?.status === "PENDING";

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
          title={
            pastCorrection
              ? "Geänderte Zeit dieses vergangenen Dienstes bestätigen"
              : "Diesen Dienstvorschlag verbindlich annehmen"
          }
          onClick={(e) => {
            e.stopPropagation();
            onConfirmOwn(shift);
          }}
          className={`relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border bg-white px-2 py-0.5 text-[11px] font-semibold transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] ${
            pastCorrection
              ? "border-[#b5790a] text-[#966408] hover:border-[#966408]"
              : "border-[#d8d8d4] text-[#092948] hover:border-[#092948]"
          }`}
        >
          <Check className="h-3 w-3" />
          {pastCorrection ? "Korrektur bestätigen" : "Annehmen"}
        </button>
      )}

      {/* Korrektur ablehnen — Gegenstück zum Widerspruch des Planers. */}
      {canObjectCorrection && (
        <button
          type="button"
          data-testid={`correction-object-${shift.id}`}
          title="Dieser nachträglichen Änderung widersprechen"
          onClick={(e) => {
            e.stopPropagation();
            setObjectDialogOpen(true);
          }}
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border border-[#b23b3b] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#b23b3b] transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:bg-[#fdf2f2]"
        >
          Ablehnen
        </button>
      )}

      {/* Strittig — beide Seiten sehen die Begründung per Tooltip. */}
      {strittig && (
        <span
          data-testid={`correction-objection-badge-${shift.id}`}
          title={`Widerspruch: ${correctionObjection?.reason ?? ""}`}
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md bg-[#b23b3b]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8f2f2f]"
        >
          Strittig
        </span>
      )}

      {/* Planer: bestrittene Korrektur zurücknehmen. Nachbearbeiten geht über
          den normalen Bearbeiten-Dialog (Klick auf die Zeile). */}
      {canWithdrawCorrection && (
        <button
          type="button"
          data-testid={`correction-withdraw-${shift.id}`}
          title="Korrektur zurücknehmen — der Stand vor der Änderung gilt wieder"
          onClick={(e) => {
            e.stopPropagation();
            onWithdrawCorrection(shift);
          }}
          className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border border-[#d8d8d4] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#092948] transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] hover:border-[#092948]"
        >
          Zurücknehmen
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
      {deviationReport?.status === "PENDING" && !canRespondToDeviation && (
        <span
          data-testid={`deviation-status-${shift.id}`}
          className="relative z-10 shrink-0 whitespace-nowrap rounded-md border border-[#b5790a] bg-white px-2.5 py-1 text-[14px] font-semibold text-[#b5790a]"
        >
          Gemeldet
        </span>
      )}

      {/* Strittig — beide Seiten sehen den Grund per Tooltip; Planwert gilt. */}
      {deviationReport?.status === "DISPUTED" && (
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
              status === "FIX"
                ? "Bestätigt"
                : pastCorrection
                  ? "Korrektur"
                  : status === "ANGEBOTEN"
                    ? "Vorschlag"
                    : "Entwurf"
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
      {objectDialogOpen && onObjectCorrection && (
        <ObjectCorrectionDialog
          open={objectDialogOpen}
          onOpenChange={setObjectDialogOpen}
          submitting={deviationActionPending}
          zeitraum={timeLabel}
          onSubmit={(reason) => {
            onObjectCorrection(shift, reason);
            setObjectDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
