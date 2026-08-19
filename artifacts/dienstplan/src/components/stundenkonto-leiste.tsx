import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { buildPersonColorAssignment, userInitialsClass, nameInitials } from "@/lib/shift-model-colors";
import { StatusBadge, STATUS_BADGE_COLORS, type StatusBadgeKind } from "@/components/status-badge";
import type { HoursBalance } from "@workspace/api-client-react";
import { Check } from "lucide-react";

export type StundenkontoUserShift = {
  userId: number;
  type: string;
  planningStatus?: string | null;
  isVertretung?: boolean | null;
};

export type StundenkontoProps = {
  balances?: HoursBalance[];
  assistants: { id: number; name: string }[];
  shifts?: StundenkontoUserShift[];
  selectedUserIds: number[] | "all";
  onToggleUser: (userId: number) => void;
  onSelectAll: () => void;
  isLoading?: boolean;
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

function lastNameInitial(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const ln = parts.length > 0 ? parts[parts.length - 1]! : name.trim();
  return ln.length > 0 ? ln[0]!.toUpperCase() : "?";
}

function getFirstName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[0]! : name.trim();
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
  isLoading
}: StundenkontoProps) {
  const personColors = useMemo(
    () => buildPersonColorAssignment(assistants.map((a) => a.id)),
    [assistants]
  );
  const balanceMap = useMemo(() => new Map(balances.map(b => [b.userId, b])), [balances]);

  return (
    <aside className="w-[284px] shrink-0 flex flex-col border-r bg-card h-full">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Stundenkonto</h2>
      </div>
      
      <div 
        className="flex-1 overflow-y-auto p-3 space-y-2" 
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
            <Skeleton className="h-[76px] w-full rounded-lg" />
            <Skeleton className="h-[76px] w-full rounded-lg" />
            <Skeleton className="h-[76px] w-full rounded-lg" />
          </>
        ) : assistants.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            Keine Assistenzkräfte.
          </div>
        ) : (
          assistants.map((a) => {
            const b = balanceMap.get(a.id);
            const planned = b?.plannedHours ?? 0;
            const actual = b?.actualHours ?? 0;
            const bal = b?.balance ?? 0;
            const percentage = planned > 0 ? Math.min(100, Math.max(0, (actual / planned) * 100)) : 0;
            
            const isSelected = selectedUserIds === "all" || selectedUserIds.includes(a.id);
            const status = getUserStatus(a.id, shifts);

            return (
              <button
                key={a.id}
                type="button"
                data-testid={`stundenkonto-pill-${a.id}`}
                aria-pressed={isSelected}
                onClick={() => onToggleUser(a.id)}
                className={`relative w-full flex flex-col text-left px-3 py-2 rounded-lg border transition-colors overflow-hidden ${
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
                
                <div className="flex items-center justify-between mb-1.5 pr-2">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none ${userInitialsClass(a.id, personColors)}`}
                    >
                      {nameInitials(a.name)}
                    </span>
                    <span className="font-medium text-sm truncate max-w-[120px]">{a.name}</span>
                  </div>
                  {status.hasShifts && (
                    <div className="flex items-center gap-1">
                      <StatusBadge kind={status.kind} compact />
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{status.label}</span>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center justify-between text-xs pr-2">
                  <span className="text-muted-foreground">
                    {actual} / {planned} h
                  </span>
                  <span className={`flex items-center gap-1 font-medium ${bal > 0 ? "text-green-600" : bal < 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                    {formatBalance(bal)}
                    <BalanceIcon balance={bal} className="w-3 h-3" />
                  </span>
                </div>
                
                <div className="mt-2 pr-2">
                  <Progress value={percentage} className="h-1.5" />
                </div>
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
  isLoading
}: StundenkontoProps) {
  const personColors = useMemo(
    () => buildPersonColorAssignment(assistants.map((a) => a.id)),
    [assistants]
  );
  const balanceMap = useMemo(() => new Map(balances.map(b => [b.userId, b])), [balances]);

  return (
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
        className={`shrink-0 flex items-center justify-center min-h-[44px] px-5 rounded-full border text-sm font-medium transition-colors ${
          selectedUserIds === "all"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card text-foreground border-border hover:bg-muted"
        }`}
      >
        Alle
      </button>

      {isLoading ? (
        <>
          <Skeleton className="h-[44px] w-[140px] rounded-full shrink-0" />
          <Skeleton className="h-[44px] w-[140px] rounded-full shrink-0" />
        </>
      ) : (
        assistants.map((a) => {
          const b = balanceMap.get(a.id);
          const planned = b?.plannedHours ?? 0;
          const actual = b?.actualHours ?? 0;
          const bal = b?.balance ?? 0;
          
          const isSelected = selectedUserIds === "all" || selectedUserIds.includes(a.id);
          const status = getUserStatus(a.id, shifts);
          
          return (
            <button
              key={a.id}
              type="button"
              data-testid={`stundenkonto-pill-${a.id}`}
              aria-pressed={isSelected}
              onClick={() => onToggleUser(a.id)}
              className={`relative shrink-0 flex items-center min-h-[44px] py-1 pl-1.5 pr-4 rounded-full border transition-colors overflow-hidden ${
                isSelected
                  ? "bg-primary/10 border-primary/30"
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
              
              <div className="flex items-center gap-2 pr-2">
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold leading-none ${userInitialsClass(a.id, personColors)}`}
                >
                  {nameInitials(a.name)}
                </span>
                
                <div className="flex flex-col items-start justify-center">
                  <div className="flex items-center gap-1.5">
                    <span className="hidden md:inline text-sm font-medium leading-none truncate max-w-[120px]">
                      {a.name}
                    </span>
                    <span className="md:hidden text-sm font-medium leading-none truncate max-w-[90px]">
                      {getFirstName(a.name)} {lastNameInitial(a.name)}.
                    </span>
                    {status.hasShifts && (
                      <span className="inline-flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
                        <StatusBadge kind={status.kind} compact />
                        {status.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] mt-1 leading-none text-muted-foreground">
                    <span>{actual}/{planned} h</span>
                    <span className={`flex items-center gap-0.5 font-medium ${bal > 0 ? "text-green-600" : bal < 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {formatBalance(bal)}
                      <BalanceIcon balance={bal} className="w-2.5 h-2.5" />
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
