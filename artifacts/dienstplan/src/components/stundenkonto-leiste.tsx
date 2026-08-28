import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { buildPersonColorAssignment, userInitialsClass, nameInitials } from "@/lib/shift-model-colors";
import { formatHours } from "@/lib/utils";
import { StatusBadge, STATUS_BADGE_COLORS, type StatusBadgeKind } from "@/components/status-badge";
import type { HoursBalance, HourBudgetBalance } from "@workspace/api-client-react";
import { Check, FileSignature, CalendarClock, PencilLine, ArrowDownWideNarrow } from "lucide-react";

export type StundenkontoUserShift = {
  userId: number;
  type: string;
  planningStatus?: string | null;
  isVertretung?: boolean | null;
  /** Rohdauer der Arbeitsdienste. */
  startTime?: string;
  endTime?: string;
  /** Serverseitig gewertete Stunden — Quelle der Abwesenheits-Stunden. */
  valuedHours?: number | null;
};

export type StundenkontoProps = {
  balances?: HoursBalance[];
  assistants: { id: number; name: string }[];
  shifts?: StundenkontoUserShift[];
  selectedUserIds: number[] | "all";
  onToggleUser: (userId: number) => void;
  onSelectAll: () => void;
  isLoading?: boolean;
  /** Kostenträger-Budget des Monats; ohne Zielvereinbarung/Premium undefined. */
  budget?: HourBudgetBalance;
  sortMode?: StundenkontoSortMode;
  onToggleSort?: () => void;
  /** Schmalstmögliche Smartphone-Variante der Reihe: nur Avatar, Nachname
   *  und ein einzelnes Ausgleichs-Symbol (Haken bei ausgeglichenem Konto,
   *  sonst die Plus-/Minusstunden) — Status-Badge sowie Vertrags-/Geplant-
   *  Stunden entfallen, da auf dem Smartphone kein Platz für Details ist. */
  minimal?: boolean;
};

function formatBalance(b: number) {
  if (Math.abs(b) < 0.05) return "0,0";
  const sign = b > 0 ? "+" : "-";
  const num = Math.abs(b).toFixed(1).replace(".", ",");
  return `${sign}${num}`;
}

function BalanceIcon({ balance, className }: { balance: number; className?: string }) {
  if (Math.abs(balance) < 0.05) {
    return <Check className={className} />;
  }
  if (balance > 0) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M12 4l8 16H4z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 20L4 4h16z" />
    </svg>
  );
}

// Für die Pillen (Reihe oben & Sidebar-Panel) wird nur der Nachname gezeigt —
// bei vollem Vor-/Nachnamen sprengen lange Kombinationen die schmalen Pillen.
function getLastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : name.trim();
}

// ---------------------------------------------------------------------------
// Planungs-Stunden (Abstimmung 27.08.2026)
// ---------------------------------------------------------------------------
// Das Stundenkonto im Dienstplan ist eine reine PLANUNGSHILFE und rechnet
// bewusst anders als die Lohnauswertung:
//   * Es zaehlen ALLE Planungsstatus (Entwurf, Vorschlag, Bestaetigt) — der
//     Dienstplaner sieht sofort, wie viel Zeit verplant ist, ohne dass etwas
//     bestaetigt sein muss.
//   * Bezahlte Abwesenheiten (Urlaub, Krank, Freizeitausgleich, Freistellung,
//     vom Arbeitgeber abgesagt) verbrauchen Vertragszeit und zaehlen mit —
//     auch ganztaegige Eintraege, die in der Lohnauswertung bewusst NICHT ins
//     Soll fliessen (Lohnausfallprinzip, siehe dashboard-hours-balance.ts).
//   * Unbezahlte Kategorien (Kind krank, von der Assistenzkraft abgesagt) und
//     die reine Geldposition Urlaubsabgeltung zaehlen NICHT: Die Stunden sind
//     weder geleistet noch bezahlt, die Luecke bleibt offen und kann
//     nachbesetzt werden.
// Auswertung, PDF, Monatsabschluss und Lohn bleiben unberuehrt — sie zaehlen
// weiterhin ausschliesslich bestaetigte (FIX) Dienste.
// ---------------------------------------------------------------------------

/** Bezahlte Abwesenheiten: verbrauchen Vertragszeit (Lohnfortzahlung). */
const PAID_ABSENCE_TYPES = new Set([
  "vacation",
  "sick",
  "freizeitausgleich",
  "freistellung",
  "abgesagt_ag",
]);

/** Unbezahlt bzw. reine Info-/Geldposition: verbrauchen KEINE Vertragszeit. */
const UNPAID_SHIFT_TYPES = new Set(["kind_krank", "abgesagt_an", "urlaubsabgeltung"]);

function shiftDurationHours(s: StundenkontoUserShift): number {
  if (!s.startTime || !s.endTime) return 0;
  const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / 3_600_000;
}

/**
 * Stunden, die dieser Eintrag vom Monatskonto verbraucht. Arbeitsdienste mit
 * ihrer Rohdauer (gleiche Basis wie plannedHours der Auswertung), bezahlte
 * Abwesenheiten mit den serverseitig gewerteten Stunden — nur so zaehlt ein
 * ganztaegiger Urlaubstag als Tages-Soll statt als 24 h.
 * Teamsitzungen bleiben aussen vor: Ein Team-Eintrag gilt fuer ALLE
 * Mitglieder, die Gutschrift kommt daher aus teamsitzungStunden der Bilanz.
 */
function planungsStunden(s: StundenkontoUserShift): number {
  if (s.type === "team") return 0;
  if (UNPAID_SHIFT_TYPES.has(s.type)) return 0;
  if (PAID_ABSENCE_TYPES.has(s.type)) return s.valuedHours ?? 0;
  return shiftDurationHours(s);
}

/** Nicht bestaetigt = Entwurf (VORLAEUFIG) oder Vorschlag (ANGEBOTEN). */
const isUnbestaetigt = (s: StundenkontoUserShift): boolean =>
  (s.planningStatus ?? "FIX") !== "FIX";

export type StundenkontoEintrag = {
  id: number;
  name: string;
  /** Vertragliches Monats-Soll; 0 = keine Vertragsstunden hinterlegt. */
  contractTarget: number;
  /** Verplante Stunden inkl. Entwuerfen und bezahlten Abwesenheiten. */
  verplant: number;
  /** Davon noch nicht bestaetigt. */
  entwurf: number;
  /** verplant minus contractTarget (positiv = mehr verplant als vereinbart). */
  balance: number;
  /** Noch freie Vertragsstunden (negativ = ueberplant). */
  frei: number;
  hasContract: boolean;
  status: UserStatus;
};

export type StundenkontoSortMode = "name" | "kapazitaet";

const SORT_MODE_KEY = "dienstplan.stundenkontoSort";

function readStoredSortMode(): StundenkontoSortMode {
  try {
    const stored = localStorage.getItem(SORT_MODE_KEY);
    if (stored === "kapazitaet" || stored === "name") return stored;
  } catch {
    // localStorage nicht verfuegbar — Standardsortierung nutzen.
  }
  return "name";
}

/**
 * Sortierung des Stundenkontos. Liegt bewusst beim Aufrufer (wie
 * useSelectedUserIds), damit Panel und Reihe — die gleichzeitig im DOM
 * haengen — dieselbe Einstellung teilen statt je eigenen State zu halten.
 */
export function useStundenkontoSort(): {
  sortMode: StundenkontoSortMode;
  toggleSort: () => void;
} {
  const [sortMode, setSortMode] = useState<StundenkontoSortMode>(readStoredSortMode);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_MODE_KEY, sortMode);
    } catch {
      // Schreiben fehlgeschlagen — Sortierung gilt nur fuer diese Sitzung.
    }
  }, [sortMode]);

  return {
    sortMode,
    toggleSort: () => setSortMode((prev) => (prev === "name" ? "kapazitaet" : "name")),
  };
}

/**
 * Baut die Bilanz-Zeilen je Assistenzkraft und sortiert sie. "kapazitaet"
 * stellt die Person mit den meisten freien Vertragsstunden nach oben — beim
 * Fuellen einer Luecke steht die passende Person damit vorn. Personen ohne
 * hinterlegte Vertragsstunden landen ans Ende (keine Kapazitaet berechenbar).
 */
function useStundenkontoEintraege(
  assistants: { id: number; name: string }[],
  shifts: StundenkontoUserShift[],
  balances: HoursBalance[],
  sortMode: StundenkontoSortMode,
): StundenkontoEintrag[] {
  const balanceMap = useMemo(() => new Map(balances.map((b) => [b.userId, b])), [balances]);

  const eintraege = useMemo(() => {
    const summen = new Map<number, { verplant: number; entwurf: number }>();
    for (const s of shifts) {
      const stunden = planungsStunden(s);
      if (stunden === 0) continue;
      const eintrag = summen.get(s.userId) ?? { verplant: 0, entwurf: 0 };
      eintrag.verplant += stunden;
      if (isUnbestaetigt(s)) eintrag.entwurf += stunden;
      summen.set(s.userId, eintrag);
    }

    return assistants.map((a) => {
      const b = balanceMap.get(a.id);
      const contractTarget = b?.contractMonthlyTargetHours ?? 0;
      const summe = summen.get(a.id) ?? { verplant: 0, entwurf: 0 };
      // Teamsitzungs-Gutschrift kommt aus der Bilanz (ein Team-Eintrag gilt
      // fuer alle Mitglieder, nicht nur den zugewiesenen Nutzer).
      const verplant = summe.verplant + (b?.teamsitzungStunden ?? 0);
      return {
        id: a.id,
        name: a.name,
        contractTarget,
        verplant,
        entwurf: summe.entwurf,
        balance: verplant - contractTarget,
        frei: contractTarget - verplant,
        hasContract: contractTarget > 0,
        status: getUserStatus(a.id, shifts),
      };
    });
  }, [assistants, shifts, balanceMap]);

  return useMemo(() => {
    if (sortMode !== "kapazitaet") return eintraege;
    return [...eintraege].sort((a, b) => {
      if (a.hasContract !== b.hasContract) return a.hasContract ? -1 : 1;
      if (Math.abs(b.frei - a.frei) > 0.001) return b.frei - a.frei;
      return a.name.localeCompare(b.name, "de");
    });
  }, [eintraege, sortMode]);
}

/** Fuellstand des Monatskontos in Prozent (0-100, gedeckelt fuer die Breite). */
function fortschrittProzent(e: StundenkontoEintrag): number {
  if (!e.hasContract) return 0;
  return Math.max(0, Math.min(100, (e.verplant / e.contractTarget) * 100));
}

/**
 * Vorgelesener Text der Pille. Ersetzt fuer Screenreader den rein visuellen
 * Mix aus Farbe, Dreieck-Symbol und Icon-Kuerzeln (Design-Guidelines Abschnitt 3:
 * nie Information nur ueber Farbe transportieren).
 */
function pillAriaLabel(e: StundenkontoEintrag): string {
  const teile: string[] = [e.name];
  if (e.hasContract) {
    teile.push(
      `${formatHours(e.verplant)} von ${formatHours(e.contractTarget)} Vertragsstunden verplant`,
    );
    if (Math.abs(e.balance) < 0.05) {
      teile.push("Konto ausgeglichen");
    } else if (e.balance < 0) {
      teile.push(`${formatHours(Math.abs(e.balance))} Stunden noch frei`);
    } else {
      teile.push(`${formatHours(e.balance)} Stunden ueber Vertrag`);
    }
  } else {
    teile.push(`${formatHours(e.verplant)} Stunden verplant`);
    teile.push("keine Vertragsstunden in der Personalakte hinterlegt");
  }
  if (e.entwurf > 0) {
    teile.push(`davon ${formatHours(e.entwurf)} Stunden noch nicht bestaetigt`);
  }
  if (e.status.hasShifts) teile.push(e.status.label);
  return `${teile.join(", ")}.`;
}

/** Tooltip-Text (Maus) — gleiche Information wie das Aria-Label. */
function pillTitle(e: StundenkontoEintrag): string {
  const kopf = e.hasContract
    ? `${e.name} — Vertrag ${formatHours(e.contractTarget)} h, verplant ${formatHours(e.verplant)} h`
    : `${e.name} — verplant ${formatHours(e.verplant)} h (keine Vertragsstunden in der Personalakte hinterlegt)`;
  return e.entwurf > 0
    ? `${kopf}, davon ${formatHours(e.entwurf)} h noch nicht bestätigt`
    : kopf;
}

/** Fuellstands-Balken des Monatskontos (Corporate-Dunkelblau). */
function FortschrittsBalken({
  eintrag,
  className = "",
}: {
  eintrag: StundenkontoEintrag;
  className?: string;
}) {
  return (
    <div
      className={`h-[3px] w-full overflow-hidden rounded-full bg-muted ${className}`}
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-assistenz-brand transition-[width] duration-200"
        style={{ width: `${fortschrittProzent(eintrag)}%` }}
      />
    </div>
  );
}

/**
 * Kopfzeile ueber den Pillen: Kostentraeger-Budget des Monats (sofern in den
 * Einstellungen eine Zielvereinbarung hinterlegt ist) plus Sortier-Umschalter.
 * "Verbraucht" zaehlt serverseitig nur echte Arbeitsdienste — Abwesenheiten
 * stecken im Budget bereits drin (siehe hour-budget-balance.ts).
 */
function StundenkontoKopf({
  budget,
  sortMode,
  onToggleSort,
}: {
  budget?: HourBudgetBalance;
  sortMode?: StundenkontoSortMode;
  onToggleSort?: () => void;
}) {
  const zeigtBudget = budget != null && budget.hasBudgets;
  if (!zeigtBudget && onToggleSort == null) return null;

  const ueberzogen = zeigtBudget && budget.remainingHours < 0;

  return (
    <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
      {zeigtBudget ? (
        <p
          className="min-w-0 truncate text-[11px] leading-tight text-muted-foreground"
          data-testid="stundenkonto-budget"
        >
          <span className="font-medium text-foreground">Kostenträger:</span>{" "}
          {formatHours(budget.consumedHours)} / {formatHours(budget.approvedHours)} h{" — "}
          <span className={ueberzogen ? "font-medium text-amber-700" : "font-medium"}>
            {ueberzogen
              ? `${formatHours(Math.abs(budget.remainingHours))} h über Budget`
              : `${formatHours(budget.remainingHours)} h übrig`}
          </span>
        </p>
      ) : (
        <span className="sr-only">Stundenkonto</span>
      )}
      {onToggleSort && (
        <button
          type="button"
          data-testid="stundenkonto-sortieren"
          onClick={onToggleSort}
          aria-pressed={sortMode === "kapazitaet"}
          title={
            sortMode === "kapazitaet" ? "Nach Namen sortieren" : "Nach freier Kapazität sortieren"
          }
          aria-label={
            sortMode === "kapazitaet"
              ? "Nach Namen sortieren"
              : "Nach freier Kapazität sortieren — wer noch am meisten Stunden frei hat, steht oben"
          }
          className={`flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors ${
            sortMode === "kapazitaet"
              ? "border-primary/30 bg-primary/10 text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted"
          }`}
        >
          <ArrowDownWideNarrow className="h-3 w-3" aria-hidden="true" />
          <span>{sortMode === "kapazitaet" ? "Kapazität" : "Name"}</span>
        </button>
      )}
    </div>
  );
}

// Eigene Schwelle (1100px), da 3 Layout-Stufen (Panel/Reiter vs. Reihe)
// gebraucht werden, für die keiner der bestehenden Tailwind-Breakpoints
// passt. Dieselbe Zahl wird als Tailwind-Arbitrary-Value (min-[1100px]:...)
// an den Aufrufstellen verwendet, damit CSS- und JS-Schwelle übereinstimmen.
const WIDE_LAYOUT_QUERY = "(min-width: 1100px)";

export function useIsWideStundenkontoLayout(): boolean {
  const [isWide, setIsWide] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(WIDE_LAYOUT_QUERY).matches : true,
  );
  useEffect(() => {
    const mql = window.matchMedia(WIDE_LAYOUT_QUERY);
    const onChange = () => setIsWide(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isWide;
}

const SELECTED_USER_IDS_KEY = "dienstplan.selectedUserIds";

function readStoredUserIds(): number[] | "all" {
  try {
    const stored = localStorage.getItem(SELECTED_USER_IDS_KEY);
    if (stored == null || stored === "all") return "all";
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n))) return parsed;
  } catch {
    // localStorage/JSON nicht verfügbar — Fallback "all" nutzen.
  }
  return "all";
}

/**
 * Mehrfachauswahl-Filter fürs Stundenkonto (ersetzt für berechtigte Nutzer
 * die einfache useSelectedAssistant-Auswahl aus assistant-filter.tsx, die
 * für alle anderen Seiten/Nutzer unverändert bleibt). Persistiert unter
 * einem eigenen localStorage-Key, damit beide Filter nebeneinander bestehen
 * können. Ungültig gewordene IDs (z. B. entfernte Assistenzkräfte) werden
 * beim nächsten bereiten Laden automatisch bereinigt.
 */
export function useSelectedUserIds(
  assistants: { id: number; name: string }[],
  ready: boolean,
): {
  selectedUserIds: number[] | "all";
  toggleUser: (userId: number) => void;
  selectAll: () => void;
} {
  const [selected, setSelected] = useState<number[] | "all">(readStoredUserIds);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_USER_IDS_KEY, JSON.stringify(selected));
    } catch {
      // Schreiben fehlgeschlagen — Auswahl gilt dann nur für diese Sitzung.
    }
  }, [selected]);

  useEffect(() => {
    if (selected === "all" || !ready) return;
    const validIds = selected.filter((id) => assistants.some((a) => a.id === id));
    if (validIds.length === 0) {
      setSelected("all");
    } else if (validIds.length !== selected.length) {
      setSelected(validIds);
    }
  }, [selected, assistants, ready]);

  const toggleUser = (userId: number) => {
    setSelected((prev) => {
      if (prev === "all") return [userId];
      if (prev.includes(userId)) {
        const next = prev.filter((id) => id !== userId);
        return next.length === 0 ? "all" : next;
      }
      return [...prev, userId];
    });
  };

  const selectAll = () => setSelected("all");

  return { selectedUserIds: selected, toggleUser, selectAll };
}

type UserStatus = { kind: StatusBadgeKind; label: string; hasShifts: boolean };

// Farb-/Icon-Quelle ist ausschließlich StatusBadge (status-badge.tsx) — hier
// nur die Aggregation je Assistenzkraft über den geladenen Monat.
function getUserStatus(userId: number, shifts: StundenkontoUserShift[]): UserStatus {
  const userShifts = shifts.filter((s) => s.userId === userId);

  if (userShifts.length === 0) {
    return { kind: "draft", label: "Keine Dienste", hasShifts: false };
  }

  const hasAusfall = userShifts.some((s) => s.type === "sick" || s.type === "vacation");
  const isVertretung = userShifts.some((s) => s.isVertretung);

  let baseStatus = "FIX";
  if (userShifts.some((s) => s.planningStatus === "VORLAEUFIG")) {
    baseStatus = "VORLAEUFIG";
  } else if (userShifts.some((s) => s.planningStatus === "ANGEBOTEN")) {
    baseStatus = "ANGEBOTEN";
  }

  const kind: StatusBadgeKind = hasAusfall
    ? "krank"
    : isVertretung
    ? "vertretung"
    : baseStatus === "FIX"
    ? "confirmed"
    : baseStatus === "ANGEBOTEN"
    ? "sent"
    : "draft";

  const label = hasAusfall
    ? "Krank"
    : isVertretung
    ? "Vertretung"
    : baseStatus === "FIX"
    ? "Bestätigt"
    : baseStatus === "ANGEBOTEN"
    ? "Vorschlag"
    : "Entwurf";

  return { kind, label, hasShifts: true };
}

export function StundenkontoPanel({
  balances = [],
  assistants,
  shifts = [],
  selectedUserIds,
  onToggleUser,
  onSelectAll,
  isLoading,
  budget,
  sortMode = "name",
  onToggleSort,
}: StundenkontoProps) {
  const personColors = useMemo(
    () => buildPersonColorAssignment(assistants.map((a) => a.id)),
    [assistants]
  );
  const eintraege = useStundenkontoEintraege(assistants, shifts, balances, sortMode);

  return (
    <aside className="w-[256px] shrink-0 flex flex-col border-r bg-card h-full">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Stundenkonto</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Planung — zählt auch Entwürfe</p>
      </div>

      <StundenkontoKopf budget={budget} sortMode={sortMode} onToggleSort={onToggleSort} />

      <div
        className="flex-1 overflow-y-auto p-2.5 space-y-1.5"
        role="group"
        aria-label="Assistenzkräfte filtern"
      >
        <button
          type="button"
          data-testid="stundenkonto-alle"
          aria-pressed={selectedUserIds === "all"}
          onClick={onSelectAll}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${
            selectedUserIds === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-foreground border-border hover:bg-muted"
          }`}
        >
          <span className="font-medium text-sm">Alle anzeigen</span>
          {selectedUserIds === "all" && <Check className="w-4 h-4" />}
        </button>

        {isLoading ? (
          <>
            <Skeleton className="h-[52px] w-full rounded-lg" />
            <Skeleton className="h-[52px] w-full rounded-lg" />
            <Skeleton className="h-[52px] w-full rounded-lg" />
          </>
        ) : eintraege.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            Keine Assistenzkräfte.
          </div>
        ) : (
          eintraege.map((e) => {
            const isSelected = selectedUserIds === "all" || selectedUserIds.includes(e.id);
            const status = e.status;

            return (
              <button
                key={e.id}
                type="button"
                data-testid={`stundenkonto-pill-${e.id}`}
                aria-pressed={isSelected}
                aria-label={pillAriaLabel(e)}
                title={pillTitle(e)}
                onClick={() => onToggleUser(e.id)}
                className={`relative w-full flex flex-col text-left px-2.5 py-1 rounded-lg border transition-colors overflow-hidden ${
                  isSelected
                    ? "bg-primary/5 border-primary/30"
                    : "bg-card border-border hover:bg-muted"
                }`}
              >
                {status.hasShifts && (
                  <div
                    aria-hidden="true"
                    className="absolute right-0 top-0 bottom-0 w-1"
                    style={{ backgroundColor: STATUS_BADGE_COLORS[status.kind] }}
                  />
                )}

                {/* Zeile 1: Avatar, Name, Status */}
                <div className="flex items-center justify-between gap-1 pr-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${userInitialsClass(e.id, personColors)}`}
                    >
                      {nameInitials(e.name)}
                    </span>
                    <span className="font-semibold text-[13px] leading-none truncate">{getLastName(e.name)}</span>
                  </div>
                  {status.hasShifts && <StatusBadge kind={status.kind} label={status.label} compact />}
                </div>

                {/* Zeile 2: Vertrags-/Verplant-Stunden als Icons + Saldo. Ohne
                    hinterlegte Vertragsstunden steht statt eines Saldos ein
                    neutraler Hinweis: Die Bilanz soll nur dort eine Aussage
                    treffen, wo sie eine treffen kann. */}
                <div className="flex items-center gap-1.5 text-xs leading-none text-muted-foreground pr-2 mt-0.5">
                  <span className="flex items-center gap-0.5">
                    <FileSignature className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {e.hasContract ? `${formatHours(e.contractTarget)} h` : "—"}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <CalendarClock className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {formatHours(e.verplant)} h
                  </span>
                  {e.hasContract ? (
                    <span
                      className={`ml-auto flex items-center gap-0.5 font-semibold tabular-nums ${e.balance > 0 ? "text-green-600" : e.balance < 0 ? "text-amber-600" : "text-muted-foreground"}`}
                    >
                      {formatBalance(e.balance)}
                      <BalanceIcon balance={e.balance} className="w-3 h-3" />
                    </span>
                  ) : (
                    <span className="ml-auto font-semibold text-muted-foreground">kein Vertrag</span>
                  )}
                </div>

                {/* Zeile 3: Füllstand des Monatskontos + Hinweis auf noch
                    unbestätigte Stunden, der verschwindet, sobald der Monat
                    vollständig bestätigt ist. */}
                {e.hasContract && <FortschrittsBalken eintrag={e} className="mt-1 mr-2" />}
                {e.entwurf > 0 && (
                  <span className="mt-0.5 flex items-center gap-0.5 text-xs leading-none text-muted-foreground">
                    <PencilLine className="w-3 h-3 shrink-0" aria-hidden="true" />
                    davon {formatHours(e.entwurf)} h Entwurf
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="p-4 border-t text-xs text-center text-muted-foreground">
        Assistenzkräfte filtern
      </div>
    </aside>
  );
}

export function StundenkontoReihe({
  balances = [],
  assistants,
  shifts = [],
  selectedUserIds,
  onToggleUser,
  onSelectAll,
  isLoading,
  budget,
  sortMode = "name",
  onToggleSort,
  minimal = false
}: StundenkontoProps) {
  const personColors = useMemo(
    () => buildPersonColorAssignment(assistants.map((a) => a.id)),
    [assistants]
  );
  const eintraege = useStundenkontoEintraege(assistants, shifts, balances, sortMode);

  return (
    <div className="flex flex-col">
      <StundenkontoKopf budget={budget} sortMode={sortMode} onToggleSort={onToggleSort} />
      <div
        className="flex flex-row items-center gap-2 overflow-x-auto whitespace-nowrap py-2 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Assistenzkräfte filtern"
      >
        <button
          type="button"
          data-testid="stundenkonto-alle"
          aria-pressed={selectedUserIds === "all"}
          onClick={onSelectAll}
          className={`shrink-0 flex items-center justify-center h-9 px-4 rounded-full border text-sm font-medium transition-colors ${
            selectedUserIds === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-foreground border-border hover:bg-muted"
          }`}
        >
          Alle
        </button>

        {isLoading ? (
          <>
            <Skeleton className="h-9 w-[176px] rounded-full shrink-0" />
            <Skeleton className="h-9 w-[176px] rounded-full shrink-0" />
          </>
        ) : (
          eintraege.map((e) => {
            const isSelected = selectedUserIds === "all" || selectedUserIds.includes(e.id);
            const status = e.status;
            const balanced = Math.abs(e.balance) < 0.05;

            return (
              <button
                key={e.id}
                type="button"
                data-testid={`stundenkonto-pill-${e.id}`}
                aria-pressed={isSelected}
                aria-label={pillAriaLabel(e)}
                title={pillTitle(e)}
                onClick={() => onToggleUser(e.id)}
                className={`relative shrink-0 flex items-center gap-1.5 h-9 pl-1 pr-2.5 rounded-full border transition-colors overflow-hidden ${
                  isSelected
                    ? "bg-primary/10 border-primary/30"
                    : "bg-card border-border hover:bg-muted"
                }`}
              >
                {/* Balken unten (Corporate Dunkelblau) = Füllstand des
                    Monatskontos. Die Statusfarbe vermittelt weiterhin der
                    StatusBadge-Punkt; der früher rein dekorative Vollbalken
                    zeigt jetzt, wie voll das Konto ist. Ohne Vertragsstunden
                    bleibt die Spur leer (nichts zu messen). */}
                <div aria-hidden="true" className="absolute left-0 right-0 bottom-0 h-[3px] bg-muted">
                  <div
                    className="h-full bg-assistenz-brand transition-[width] duration-200"
                    style={{ width: `${fortschrittProzent(e)}%` }}
                  />
                </div>

                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${userInitialsClass(e.id, personColors)}`}
                >
                  {nameInitials(e.name)}
                </span>

                <span className="text-xs font-medium leading-none truncate max-w-[84px]">
                  {getLastName(e.name)}
                </span>

                {minimal ? (
                  <>
                    {/* Auf dem Smartphone bleibt nur ein Symbol Platz: Stift =
                        es stecken noch unbestätigte Stunden drin. */}
                    {e.entwurf > 0 && (
                      <PencilLine
                        className="w-3 h-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    {!e.hasContract ? (
                      <span className="text-xs leading-none text-muted-foreground">–</span>
                    ) : balanced ? (
                      <Check className="w-3.5 h-3.5 text-green-600 shrink-0" aria-hidden="true" />
                    ) : (
                      <span className="flex items-center gap-0.5 text-xs font-semibold tabular-nums leading-none text-amber-600">
                        {formatBalance(e.balance)}
                        <BalanceIcon balance={e.balance} className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {status.hasShifts && (
                      <StatusBadge kind={status.kind} label={status.label} compact />
                    )}

                    <span className="flex items-center gap-0.5 text-xs leading-none text-muted-foreground">
                      <FileSignature className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {e.hasContract ? `${formatHours(e.contractTarget)} h` : "—"}
                    </span>
                    <span className="flex items-center gap-0.5 text-xs leading-none text-muted-foreground">
                      <CalendarClock className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {formatHours(e.verplant)} h
                    </span>
                    {e.entwurf > 0 && (
                      <span className="flex items-center gap-0.5 text-xs leading-none text-muted-foreground">
                        <PencilLine className="w-3 h-3 shrink-0" aria-hidden="true" />
                        {formatHours(e.entwurf)} h
                      </span>
                    )}

                    {e.hasContract ? (
                      <span
                        className={`flex items-center gap-0.5 text-xs font-semibold tabular-nums leading-none ${e.balance > 0 ? "text-green-600" : e.balance < 0 ? "text-amber-600" : "text-muted-foreground"}`}
                      >
                        {formatBalance(e.balance)}
                        <BalanceIcon balance={e.balance} className="w-2.5 h-2.5" />
                      </span>
                    ) : (
                      <span className="text-xs font-semibold tabular-nums leading-none text-muted-foreground">
                        kein Vertrag
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
