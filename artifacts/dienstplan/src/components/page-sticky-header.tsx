/**
 * PageStickyHeader — gemeinsamer Sticky-Header-Rahmen für Dienstplan und
 * Auswertungen (#573).
 *
 * Kapselt:
 *  - Outer-Container (sticky, backdrop-blur, negative Margins)
 *  - Stacked vs. Einzeilen-Layout (zwei Zeilen auf Mobilgeräten,
 *    eine Zeile auf Desktop — gesteuerter durch die `stacked`-Prop)
 *  - TeamSwitcher an der festen Position
 *  - MonthYearPicker inkl. Prev/Next-Buttons
 *
 * Die Seite selbst ist verantwortlich für:
 *  - Aufruf von `useHeaderTier` und Weitergabe von `stacked` + `measureRef`
 *  - Aufbau von Titel-Element, AssistantFilter und Aktionsbuttons
 *
 * Änderungen am Layout (Container-Klasse, Zeilenstruktur, Month-Switcher)
 * müssen nur noch an dieser einen Stelle gepflegt werden.
 */

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthYearPicker } from "@/components/month-year-picker";
import { TeamSwitcher } from "@/components/team-switcher";

export interface PageStickyHeaderProps {
  /** Tier-Zustand aus `useHeaderTier` — steuert Einzeilen- vs. Stapel-Layout. */
  stacked: boolean;
  /** Ref auf das innere Flex-Element (geliefert von `useHeaderTier`). */
  measureRef: React.RefObject<HTMLDivElement>;

  // ---- MonthSwitcher --------------------------------------------------
  month: number;
  year: number;
  onMonthSelect: (month: number, year: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** data-testid des "Vorheriger Monat"-Buttons (Default: "prev-month"). */
  prevMonthTestId?: string;
  /** data-testid des "Nächster Monat"-Buttons (Default: "next-month"). */
  nextMonthTestId?: string;

  // ---- Seiten-spezifische Slots ----------------------------------------
  /** Seitentitel als vorbereitetes ReactElement (h2 o. ä.). */
  title: React.ReactNode;
  /**
   * Assistent-Filter-Select oder `undefined` wenn nicht sichtbar.
   * Im Stapel-Layout wird es in einen max-w-[190px]-Wrapper eingeschlossen.
   */
  assistantFilter?: React.ReactNode;
  /**
   * Aktionsbuttons rechtsbündig vor dem Monatsschalter.
   * Stacked/Einzeilen-Layout wird durch den Wrapper geregelt.
   */
  actions: React.ReactNode;
}

export function PageStickyHeader({
  stacked,
  measureRef,
  month,
  year,
  onMonthSelect,
  onPrevMonth,
  onNextMonth,
  prevMonthTestId = "prev-month",
  nextMonthTestId = "next-month",
  title,
  assistantFilter,
  actions,
}: PageStickyHeaderProps) {
  const monthSwitcher = (
    <div className={`flex items-center gap-0.5 ${stacked ? "min-w-0" : "shrink-0"}`}>
      <Button
        variant="ghost"
        size="icon"
        className={stacked ? "h-8 w-6 shrink-0" : "h-8 w-8"}
        onClick={onPrevMonth}
        aria-label="Vorheriger Monat"
        data-testid={prevMonthTestId}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <MonthYearPicker
        month={month}
        year={year}
        onChange={onMonthSelect}
        triggerClassName={
          stacked
            ? "min-w-0 truncate whitespace-nowrap text-center text-lg font-normal tracking-tight text-foreground"
            : "whitespace-nowrap text-center text-sm font-medium md:text-base"
        }
      />
      <Button
        variant="ghost"
        size="icon"
        className={stacked ? "h-8 w-6 shrink-0" : "h-8 w-8"}
        onClick={onNextMonth}
        aria-label="Nächster Monat"
        data-testid={nextMonthTestId}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div data-dienstplan-header className="sticky top-0 z-40 -mx-4 -mt-4 mb-1 border-b border-border/40 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mt-6 md:px-6">
      {stacked ? (
        <div ref={measureRef} className="flex w-full flex-col gap-2.5">
          {/* Zeile 1: Titel · TeamSwitcher · AssistantFilter */}
          <div className="flex w-full flex-nowrap items-center gap-2">
            {title}
            <div className="shrink">
              <TeamSwitcher />
            </div>
            {assistantFilter && (
              <div className="ml-auto w-full min-w-0 max-w-[190px] shrink">
                {assistantFilter}
              </div>
            )}
          </div>
          {/* Zeile 2: Aktionen · Monatsschalter */}
          <div className="flex w-full flex-nowrap items-center gap-1">
            {actions}
            <div className="ml-auto flex min-w-0 items-center">{monthSwitcher}</div>
          </div>
        </div>
      ) : (
        <div ref={measureRef} className="flex w-full flex-nowrap items-center gap-2">
          {title}
          <TeamSwitcher />
          {assistantFilter}
          <div className="ml-auto flex flex-nowrap items-center gap-1.5">
            {actions}
            {monthSwitcher}
          </div>
        </div>
      )}
    </div>
  );
}
