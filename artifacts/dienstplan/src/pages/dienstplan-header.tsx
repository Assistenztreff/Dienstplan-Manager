import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  List,
  LayoutGrid,
  Table2,
  X,
  Lock,
  ChevronsDownUp,
  Send,
  Palmtree,
  MoreHorizontal,
  FileDown,
  SquareDashedMousePointer,
  Scale,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTeam } from "@/context/team";
import { userInitialsClass, nameInitials } from "@/lib/shift-model-colors";
import { useHeaderTier } from "@/lib/header-tier";
import { type Assistant } from "@/components/assistant-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageStickyHeader } from "@/components/page-sticky-header";
import { AbwesenheitsKalender } from "@/components/abwesenheits-kalender";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { usePersonColors } from "./dienstplan-helpers";

function ViewToggle({
  value,
  onChange,
  options,
  showLabels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: LucideIcon }[];
  showLabels: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`view-toggle-${opt.value}`}
            data-active={active ? "true" : "false"}
            onClick={() => onChange(opt.value)}
            title={opt.label}
            aria-label={opt.label}
            className={`flex items-center gap-1.5 rounded-md ${showLabels ? "px-3" : "px-1.5"} py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {showLabels && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function DienstplanHeader({
  isAdmin,
  canPlan,
  assistants,
  selectedAssistant,
  onSelectAssistant,
  mobileView,
  onMobileView,
  desktopView,
  onDesktopView,
  confirmableCount,
  isBulkConfirming,
  onConfirmAll,
  canBasicExport,
  isExporting,
  onExport,
  canBulkEdit,
  isSelectionMode,
  onToggleSelection,
  month,
  year,
  onMonthSelect,
  onPrevMonth,
  onNextMonth,
  pillMinimiert,
  onTogglePillMinimiert,
  canSeeStundenkonto,
  stundenkontoOpen,
  onToggleStundenkonto,
}: {
  isAdmin: boolean;
  canPlan: boolean;
  assistants: Assistant[];
  selectedAssistant: number | "all";
  onSelectAssistant: (v: number | "all") => void;
  mobileView: "list" | "grid";
  onMobileView: (v: "list" | "grid") => void;
  desktopView: "table" | "grid";
  onDesktopView: (v: "table" | "grid") => void;
  confirmableCount: number;
  isBulkConfirming: boolean;
  onConfirmAll: () => void;
  canBasicExport: boolean;
  isExporting: boolean;
  onExport: () => void;
  canBulkEdit: boolean;
  isSelectionMode: boolean;
  onToggleSelection: () => void;
  month: number;
  year: number;
  onMonthSelect: (month: number, year: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** Arbeitsanweisung 17.08.2026 Punkt 1: globaler Minimiert-Umschalter,
   *  nur auf Desktop/Tablet relevant (Smartphone hat bereits einen eigenen
   *  einzeiligen Dauerzustand). */
  pillMinimiert: boolean;
  onTogglePillMinimiert: () => void;
  /** Task #857: Stundenkonto ersetzt für berechtigte Admins den einfachen
   *  Assistenzkraft-Dropdown (assistantFilter unten) durch das Panel/die
   *  Reihe im Seitenkörper. Der Umschalter hier ist nur ≥1100px relevant
   *  (darunter ist die Reihe immer sichtbar, kein Ein-/Ausklappen nötig). */
  canSeeStundenkonto: boolean;
  stundenkontoOpen: boolean;
  onToggleStundenkonto: () => void;
}) {
  const { selectedTeamId } = useTeam();
  const personColors = usePersonColors();
  // Abwesenheitskalender als Popup (HANDOFF 05.08.2026): gleiches Layout wie
  // auf der Seite /abwesenheiten, aufrufbar direkt aus dem Dienstplan.
  const [absCalOpen, setAbsCalOpen] = useState(false);
  // Fuer den gesperrten Mehrfachauswahl-Button (Free): Klick fuehrt zur
  // Preise-/Premium-Seite statt eines toten disabled-Buttons.
  const [, navigateHeader] = useLocation();
  const contentKey = [
    isAdmin,
    canPlan,
    assistants.length,
    String(selectedAssistant),
    selectedTeamId ?? "none",
    confirmableCount,
    canBasicExport,
    canBulkEdit,
    canSeeStundenkonto,
    `${month}/${year}`,
  ].join("|");
  const { measureRef, tier } = useHeaderTier(
    contentKey,
    [isSelectionMode, isExporting].join("|"),
  );
  const showLabels = tier === "labels";
  const stacked = tier === "stack";

  const title = (
    <h1 className={`text-lg md:text-xl font-serif font-bold text-foreground ${stacked ? "min-w-0 shrink truncate" : "shrink-0"}`}>
      Dienstplan
    </h1>
  );

  // Task #857: Für canSeeStundenkonto-Admins ersetzt das Stundenkonto (Panel/
  // Reihe) den Filter nur im Desktop-Kalenderkörper (≥768px). Auf
  // Smartphone-Breite gibt es dort kein Äquivalent — der klassische
  // Einzel-Filter bleibt daher unterhalb von md sichtbar (display:contents
  // reicht die Kinder unverändert an den Kopfzeilen-Flex weiter).
  const assistantFilter = canPlan && assistants.length > 0 && (
    <div className={canSeeStundenkonto ? "contents md:hidden" : "contents"}>
    <Select
      value={String(selectedAssistant)}
      onValueChange={(v) => onSelectAssistant(v === "all" ? "all" : Number(v))}
    >
      <SelectTrigger
        className={
          stacked
            ? "h-9 w-full min-w-0 gap-1.5 truncate"
            : "h-9 w-auto min-w-[7.5rem] max-w-[190px] shrink gap-2 truncate"
        }
        data-testid="assistant-select"
        aria-label="Assistenzkraft filtern"
      >
        <SelectValue placeholder="Alle Assistenzkräfte" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" data-testid="assistant-option-all">
          Alle Assistenzkräfte
        </SelectItem>
        {assistants.map((a) => (
          <SelectItem key={a.id} value={String(a.id)} data-testid={`assistant-option-${a.id}`}>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${userInitialsClass(a.id, personColors)}`}
              >
                {nameInitials(a.name)}
              </span>
              {a.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {/* Gruppentrennlinie nach dem Assistenzkraft-Filter (Task #856),
        nur in den einzeiligen Stufen. */}
    {!stacked && (
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
    )}
    </div>
  );

  const viewToggles = (
    <>
      <div className="md:hidden" data-testid="view-toggles-mobile">
        <ViewToggle
          value={mobileView}
          onChange={(v) => onMobileView(v as "list" | "grid")}
          showLabels={showLabels}
          options={[
            { value: "list", label: "Liste", icon: List },
            { value: "grid", label: "Monat", icon: LayoutGrid },
          ]}
        />
      </div>
      <div className="hidden md:block" data-testid="view-toggles-desktop">
        <ViewToggle
          value={desktopView}
          onChange={(v) => onDesktopView(v as "table" | "grid")}
          showLabels={showLabels}
          options={[
            { value: "table", label: "Tabelle", icon: Table2 },
            { value: "grid", label: "Monat", icon: LayoutGrid },
          ]}
        />
      </div>
      {/* Arbeitsanweisung 17.08.2026 Punkt 1: globaler Minimiert-Umschalter
          für die Monatsraster-Pillen, nur relevant auf Desktop/Tablet UND nur
          in der Monatsansicht (Tabelle hat keine Pillen). */}
      {desktopView === "grid" && (
        <div className="hidden md:block" data-testid="pill-minimiert-toggle-wrapper">
          <Button
            variant={pillMinimiert ? "default" : "outline"}
            size="sm"
            className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
            onClick={onTogglePillMinimiert}
            title={pillMinimiert ? "Pillen wieder zweizeilig anzeigen" : "Pillen minimieren (einzeilig)"}
            aria-label="Dienst-Pillen minimieren"
            aria-pressed={pillMinimiert}
            data-testid="toggle-pill-minimiert"
          >
            <ChevronsDownUp className="h-4 w-4" />
            {showLabels && <span>Minimiert</span>}
          </Button>
        </div>
      )}
      {/* Task #857: Ein-/Ausklappen des Stundenkonto-Panels — nur ≥1100px
          relevant (min-[1100px] identisch zur JS-Schwelle in
          stundenkonto-leiste.tsx); darunter zeigt der Seitenkörper die
          Reihe immer, ein Umschalten wäre wirkungslos. */}
      {canSeeStundenkonto && (
        <div className="hidden min-[1100px]:block" data-testid="stundenkonto-toggle-wrapper">
          <Button
            variant={stundenkontoOpen ? "default" : "outline"}
            size="sm"
            className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
            onClick={onToggleStundenkonto}
            title={stundenkontoOpen ? "Stundenkonto ausblenden" : "Stundenkonto einblenden"}
            aria-label="Stundenkonto ein-/ausblenden"
            aria-pressed={stundenkontoOpen}
            data-testid="toggle-stundenkonto"
          >
            <Scale className="h-4 w-4" />
            {showLabels && <span>Stundenkonto</span>}
          </Button>
        </div>
      )}
    </>
  );

  const confirmAllButton = isAdmin && (
    <Button
      variant="outline"
      size="sm"
      className={showLabels ? "gap-1.5" : `relative h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
      onClick={onConfirmAll}
      disabled={isBulkConfirming || confirmableCount === 0}
      title={confirmableCount === 0 ? "Keine Entwürfe zum Versenden" : "Vorschlag senden"}
      aria-label="Vorschlag senden"
      data-testid="confirm-all-drafts"
    >
      <Send className="h-4 w-4" />
      {showLabels ? (
        <>
          <span>Senden</span>
          {confirmableCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 text-xs font-semibold text-assistenz-brand">
              {confirmableCount}
            </span>
          )}
        </>
      ) : confirmableCount > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-semibold text-assistenz-brand ring-1 ring-assistenz-brand/20 backdrop-blur-sm">
          {confirmableCount}
        </span>
      ) : null}
    </Button>
  );

  // Aktive Mehrfachauswahl bleibt als eigener Beenden-Button in der
  // Hauptleiste sichtbar (ein Klick zum Verlassen des Modus); der Einstieg
  // wandert ins Überlauf-Menü (Task #856).
  const endSelectionButton = canPlan && canBulkEdit && isSelectionMode && (
    <Button
      variant="default"
      size="icon"
      className="relative h-9 w-9 shrink-0 after:absolute after:-inset-1 after:content-['']"
      onClick={onToggleSelection}
      title="Auswahl beenden"
      aria-label="Auswahl beenden"
      data-testid="toggle-selection-mode"
    >
      <X className="h-4 w-4" />
    </Button>
  );

  // Überlauf-Menü (Task #856): seltener genutzte Aktionen — PDF-Export,
  // Mehrfachauswahl-Einstieg und Abwesenheitskalender — hinter einem
  // „Weitere Aktionen"-Trigger. Labels im Menü sind immer sichtbar,
  // unabhängig von der Header-Stufe.
  const showSelectionEntry = canPlan && !isSelectionMode;
  const overflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative h-9 w-9 shrink-0 px-0 after:absolute after:-inset-1 after:content-['']"
          title="Weitere Aktionen"
          aria-label="Weitere Aktionen"
          data-testid="header-overflow"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canBasicExport && (
          <DropdownMenuItem
            className="min-h-[44px] gap-2"
            onSelect={onExport}
            disabled={isExporting}
            title="Monatsübersicht als PDF: bestätigte Dienste und Abwesenheiten, ohne Zeiterfassung."
            data-testid="simple-month-export"
          >
            <FileDown className="h-4 w-4" />
            <span>{isExporting ? "Exportiere..." : "Monat als PDF exportieren"}</span>
          </DropdownMenuItem>
        )}
        {showSelectionEntry &&
          (canBulkEdit ? (
            <DropdownMenuItem
              className="min-h-[44px] gap-2"
              onSelect={onToggleSelection}
              title="Auswählen"
              aria-label="Auswählen"
              data-testid="toggle-selection-mode"
            >
              <SquareDashedMousePointer className="h-4 w-4" />
              <span>Auswählen</span>
            </DropdownMenuItem>
          ) : (
            // Bewusst klickbar statt `disabled`: auf Touch-Geräten gibt es
            // keinen Tooltip — der Klick führt direkt zur Preise-/Premium-Seite.
            <DropdownMenuItem
              className="min-h-[44px] gap-2"
              onSelect={() => navigateHeader("/preise")}
              title="Massenbearbeitung ist in Premium enthalten. Preise & Premium ansehen."
              aria-label="Auswählen (Premium) — Preise & Premium ansehen"
              data-testid="toggle-selection-mode-locked"
            >
              <Lock className="h-4 w-4" />
              <span>Auswählen</span>
            </DropdownMenuItem>
          ))}
        {(canBasicExport || showSelectionEntry) && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="min-h-[44px] gap-2"
          onSelect={() => setAbsCalOpen(true)}
          title="Abwesenheitskalender öffnen (Jahresübersicht)"
          aria-label="Abwesenheitskalender öffnen"
          data-testid="open-abwesenheits-kalender"
        >
          <Palmtree className="h-4 w-4" />
          <span>Abwesenheit eintragen</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Gruppentrennlinie zwischen Aktions-Gruppen (nur einzeilige Stufen).
  const groupDivider = !stacked && (
    <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
  );

  return (
    <>
    <PageStickyHeader
      stacked={stacked}
      measureRef={measureRef}
      month={month}
      year={year}
      onMonthSelect={onMonthSelect}
      onPrevMonth={onPrevMonth}
      onNextMonth={onNextMonth}
      prevMonthTestId="prev-month"
      nextMonthTestId="next-month"
      title={title}
      assistantFilter={assistantFilter}
      actions={
        <>
          {viewToggles}
          {groupDivider}
          {confirmAllButton}
          {endSelectionButton}
          {overflowMenu}
        </>
      }
    />
    <Dialog open={absCalOpen} onOpenChange={setAbsCalOpen}>
      <DialogContent
        className="w-[96vw] max-w-[1400px] max-h-[90vh] overflow-y-auto"
        data-testid="abwesenheits-kalender-popup"
      >
        <DialogHeader>
          <DialogTitle>Abwesenheitskalender</DialogTitle>
          <DialogDescription className="sr-only">
            Jahresübersicht aller Abwesenheiten mit Direktanlage per Klick.
          </DialogDescription>
        </DialogHeader>
        <AbwesenheitsKalender />
      </DialogContent>
    </Dialog>
  </>
  );
}
