/**
 * MeineStundenKarte — kompakte Stunden-Übersicht für Assistenten im Dashboard.
 *
 * Zeigt: geleistete Stunden (IST) vs. Soll, Urlaubstage, Krankheitsstunden.
 * Falls der Arbeitgeber Premium hat und ein Stundenlohn hinterlegt ist, werden
 * zusätzlich Grundlohn und Gesamtlohn angezeigt.
 *
 * Über Prev/Next-Pfeile kann der Assistent auch abgeschlossene Vormonate
 * einsehen (#676).  Der Vorwärts-Pfeil ist auf den aktuellen Monat begrenzt.
 */

import { useState } from "react";
import { useGetMyHoursBalance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Clock, ChevronRight, ChevronLeft, Info } from "lucide-react";
import { format, subMonths, addMonths, isSameMonth } from "date-fns";
import { de } from "date-fns/locale";
import { useLocation } from "wouter";
import { formatDays, formatHours } from "@/lib/utils";

function StatRow({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className="text-sm font-semibold text-foreground tabular-nums"
        data-testid={testId}
      >
        {value}
        {sub && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span>
        )}
      </span>
    </div>
  );
}

export function MeineStundenKarte() {
  const [, navigate] = useLocation();
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(now);

  const month = selectedDate.getMonth() + 1;
  const year = selectedDate.getFullYear();
  const monthLabel = format(selectedDate, "MMMM yyyy", { locale: de });
  const isCurrentMonth = isSameMonth(selectedDate, now);

  const { data, isLoading, isError } = useGetMyHoursBalance({ month, year });

  const handlePrevMonth = () => setSelectedDate((d) => subMonths(d, 1));
  const handleNextMonth = () => {
    if (!isCurrentMonth) setSelectedDate((d) => addMonths(d, 1));
  };

  if (isLoading) {
    return (
      <Card className="border-border/50 shadow-sm" data-testid="meine-stunden-loading">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card
        className="border-border/50 shadow-sm"
        data-testid="meine-stunden-error"
      >
        <CardContent className="flex items-start gap-3 py-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Stunden-Übersicht konnte momentan nicht geladen werden.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Kein Vertrag / keine Mitgliedschaft — Karte still ausblenden.
  if (!data) return null;

  const hasWage = data.hourlyWage != null;

  return (
    <Card
      className="border-border/50 shadow-sm"
      data-testid="meine-stunden-karte"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base font-semibold text-foreground">
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Meine Stunden
          </span>
          {/* Monatswechsel-Navigation */}
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Vormonat"
              data-testid="meine-stunden-prev-month"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span
              className="min-w-[9rem] text-center text-sm font-normal text-muted-foreground"
              data-testid="meine-stunden-monat-label"
            >
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              disabled={isCurrentMonth}
              aria-label="Nächster Monat"
              data-testid="meine-stunden-next-month"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-0 pb-4">
        {/* ---- Stunden ---- */}
        <StatRow
          label="Geleistete Stunden (IST)"
          value={`${formatHours(data.valuedHours)} h`}
          sub={`/ ${formatHours(data.plannedHours)} h Soll`}
          testId="meine-stunden-ist"
        />
        <StatRow
          label="Krankheitsstunden"
          value={`${formatHours(data.sickHours)} h`}
          testId="meine-stunden-krank"
        />
        <StatRow
          label="Urlaubstage (diesen Monat)"
          value={formatDays(data.vacationDaysTaken)}
          sub={
            data.vacationDaysRemaining != null
              ? `/ ${formatDays(data.vacationDaysRemaining)} verbleibend`
              : undefined
          }
          testId="meine-stunden-urlaub"
        />

        {/* ---- Kind-krank-Tage (immer sichtbar wenn > 0) ---- */}
        {(data.kindKrankTage ?? 0) > 0 && (
          <StatRow
            label="Kind-krank-Tage"
            value={formatDays(data.kindKrankTage ?? 0)}
            testId="meine-stunden-kindkrank"
          />
        )}

        {/* ---- Lohn (nur wenn Arbeitgeber Premium + Stundenlohn hinterlegt) ---- */}
        {hasWage && (
          <>
            <StatRow
              label="Grundlohn"
              value={(data.basePay ?? 0).toLocaleString("de-DE", {
                style: "currency",
                currency: "EUR",
              })}
              testId="meine-stunden-grundlohn"
            />
            {/* Zuschläge auf tatsächlich geleistete Arbeit (§ 3b EStG steuerfrei) */}
            {(data.nightSurchargePay ?? 0) > 0 && (
              <StatRow
                label="Nachtzuschlag"
                value={(data.nightSurchargePay ?? 0).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}
                testId="meine-stunden-nachtzuschlag"
              />
            )}
            {(data.sundaySurchargePay ?? 0) > 0 && (
              <StatRow
                label="Sonntagszuschlag"
                value={(data.sundaySurchargePay ?? 0).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}
                testId="meine-stunden-sonntagszuschlag"
              />
            )}
            {(data.holidaySurchargePay ?? 0) > 0 && (
              <StatRow
                label="Feiertagszuschlag"
                value={(data.holidaySurchargePay ?? 0).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}
                testId="meine-stunden-feiertagszuschlag"
              />
            )}
            {/* SV-pflichtige Zuschläge auf Urlaubs-/Kranktage (§ 11 BUrlG / § 2 EFZG) */}
            {((data.absenceNightSurchargePay ?? 0) +
              (data.absenceSundaySurchargePay ?? 0) +
              (data.absenceHolidaySurchargePay ?? 0)) > 0 && (
              <StatRow
                label="SV-pflichtig (Urlaub/Krank)"
                value={(
                  (data.absenceNightSurchargePay ?? 0) +
                  (data.absenceSundaySurchargePay ?? 0) +
                  (data.absenceHolidaySurchargePay ?? 0)
                ).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}
                testId="meine-stunden-sv-pflichtig"
              />
            )}
            <StatRow
              label="Gesamtlohn (brutto)"
              value={(data.totalPay ?? 0).toLocaleString("de-DE", {
                style: "currency",
                currency: "EUR",
              })}
              testId="meine-stunden-gesamt"
            />
          </>
        )}

        {/* ---- Navigation ---- */}
        <div className="pt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between text-sm"
            onClick={() => navigate("/auswertungen")}
            data-testid="meine-stunden-details-btn"
          >
            Details anzeigen
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
