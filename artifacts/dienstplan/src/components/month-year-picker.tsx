/**
 * MonthYearPicker — kompaktes Popover-Raster für schnelle Monatswahl.
 *
 * Trigger: ein Button mit dem aktuellen Monats-Label (ersetzt den statischen
 * <span> im Dienstplan- und Auswertungen-Header).
 *
 * Tastatur:
 *   ← / → bewegen den Fokus um einen Monat,
 *   ↑ / ↓ um eine Zeile (3 Monate),
 *   Enter / Space wählen aus,
 *   Escape schließt ohne Übernahme.
 */

import { useCallback, useRef, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Kurzbezeichnungen für das 3×4-Raster */
const SHORT_MONTH_NAMES = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

function buildLabel(month: number, year: number): string {
  return format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: de });
}

export type MonthYearPickerProps = {
  /** Aktuell ausgewählter Monat (1–12). */
  month: number;
  /** Aktuell ausgewähltes Jahr. */
  year: number;
  /** Callback, wenn eine neue Kombination ausgewählt wird. */
  onChange: (month: number, year: number) => void;
  /** Zusätzliche CSS-Klassen für den Trigger-Button. */
  triggerClassName?: string;
  /** data-testid für den Trigger (Standard: "month-label"). */
  testId?: string;
};

export function MonthYearPicker({
  month,
  year,
  onChange,
  triggerClassName,
  testId = "month-label",
}: MonthYearPickerProps) {
  const [open, setOpen] = useState(false);
  /** Jahreszahl, die gerade im Popover angezeigt wird — kann vom gewählten Jahr abweichen. */
  const [pickerYear, setPickerYear] = useState(year);
  const gridRef = useRef<HTMLDivElement>(null);

  // Wenn das Popover öffnet, Jahr synchronisieren.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) setPickerYear(year);
      setOpen(next);
    },
    [year],
  );

  const handleSelect = useCallback(
    (m: number) => {
      onChange(m, pickerYear);
      setOpen(false);
    },
    [onChange, pickerYear],
  );

  // Pfeiltasten-Navigation im 3×4-Grid.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const buttons = Array.from(
        gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-month]") ?? [],
      );
      const active = document.activeElement as HTMLButtonElement | null;
      const idx = active ? buttons.indexOf(active) : -1;
      let next = idx;

      if (e.key === "ArrowRight") next = Math.min(11, idx + 1);
      else if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
      else if (e.key === "ArrowDown") next = Math.min(11, idx + 3);
      else if (e.key === "ArrowUp") next = Math.max(0, idx - 3);
      else return;

      e.preventDefault();
      buttons[next]?.focus();
    },
    [],
  );

  const today = new Date();
  const todayMonth = today.getMonth() + 1;
  const todayYear = today.getFullYear();

  const label = buildLabel(month, year);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={`Monat wählen, aktuell ${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "rounded px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            triggerClassName,
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="center"
        data-testid="month-year-picker-popover"
      >
        {/* Jahres-Navigation */}
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPickerYear((y) => y - 1)}
            aria-label="Vorheriges Jahr"
            data-testid="picker-prev-year"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold" data-testid="picker-year">
            {pickerYear}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPickerYear((y) => y + 1)}
            aria-label="Nächstes Jahr"
            data-testid="picker-next-year"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* 3 × 4-Raster */}
        <div
          ref={gridRef}
          className="grid grid-cols-3 gap-1"
          role="grid"
          aria-label="Monatsauswahl"
          onKeyDown={handleKeyDown}
        >
          {SHORT_MONTH_NAMES.map((name, i) => {
            const m = i + 1;
            const isSelected = m === month && pickerYear === year;
            const isCurrentMonth = m === todayMonth && pickerYear === todayYear;
            return (
              <button
                key={m}
                type="button"
                data-month={m}
                aria-label={buildLabel(m, pickerYear)}
                aria-pressed={isSelected}
                onClick={() => handleSelect(m)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold"
                    : isCurrentMonth
                      ? "border border-primary/40 text-primary font-medium hover:bg-accent"
                      : "hover:bg-accent",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
