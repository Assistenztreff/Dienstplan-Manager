// ---------------------------------------------------------------------------
// Monatsabschluss der Lohnauswertung (Soft-Close mit Nachberechnung).
// ---------------------------------------------------------------------------
// - Status-Karte: "Monat abgeschlossen am ..." + Abschluss-Knopf. Abschließbar
//   sind vergangene Monate UND der laufende Monat (vorzeitig); nur zukünftige
//   Monate lehnt der Server mit 400 month_not_closable ab (autoritativ,
//   der Knopf ist reine UX).
// - Bestätigungs-Dialog mit Plausibilitätswarnung bei offenen IST-Einträgen.
// - Nachberechnungs-Sektion: Differenzen des VORMONATS (gemeldet vs. aktuell),
//   sofern der Vormonat abgeschlossen wurde und sich danach etwas geändert hat.
// Premium-Gate: die Endpunkte sind wie die Lohnauswertung advancedAnalytics-
// gegated; die Sektion wird nur gerendert, wenn die Auswertung freigeschaltet ist.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMonthClosings,
  useGetMonthClosingDiff,
  useCreateMonthClosing,
  getGetMonthClosingsQueryKey,
  getGetMonthClosingDiffQueryKey,
  getGetHoursBalanceQueryKey,
} from "@workspace/api-client-react";
import type { MonthClosingStatus, MonthClosingDiff } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Lock as LockIcon, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { toast } from "sonner";

function formatClosedAt(iso: string): string {
  const d = new Date(iso);
  return format(d, "d. MMMM yyyy, HH:mm", { locale: de });
}

const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const signed = (n: number, unit: string) =>
  `${n > 0 ? "+" : ""}${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${unit}`;

/**
 * Status-Karte + Abschluss-Knopf für den aktuell angezeigten Monat.
 * Nur rendern, wenn Lohnauswertung freigeschaltet (advancedAnalytics) und Admin.
 */
export function MonthClosingCard({
  month,
  year,
  teamId,
}: {
  month: number;
  year: number;
  teamId: number | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const params = { month, year, ...(teamId != null ? { teamId } : {}) };
  const { data } = useGetMonthClosings(params, {
    query: { enabled: true },
  } as any) as { data: MonthClosingStatus | undefined };

  const createClosing = useCreateMonthClosing();

  // Abschließbar sind vergangene UND der laufende Monat (vorzeitiger Abschluss
  // für den Lohnlauf); nur Zukunftsmonate bleiben blockiert. Der Server prüft
  // das zusätzlich autoritativ.
  const now = new Date();
  const isFutureMonth =
    year > now.getFullYear() ||
    (year === now.getFullYear() && month > now.getMonth() + 1);
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1;
  const closable = !isFutureMonth;

  const closed = data?.closed ?? false;
  const latest = data?.latest;
  const pending = data?.pendingTimeEntries ?? 0;
  const reCloses = (data?.history?.length ?? 0) > 1;

  const doClose = async () => {
    try {
      await createClosing.mutateAsync({
        data: { month, year, ...(teamId != null ? { teamId } : {}) },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMonthClosingsQueryKey(params) }),
        queryClient.invalidateQueries({ queryKey: getGetMonthClosingDiffQueryKey(params) }),
        // Ohne dies bleibt die Live-Auswertung (Auswertungen-Seite) auf ihrem
        // zwischengespeicherten Stand stehen (ggf. "keine Daten", wenn die
        // Seite geladen wurde, bevor Dienste final bestätigt waren) — der
        // Abschluss selbst ändert die angezeigten Zahlen nicht automatisch.
        queryClient.invalidateQueries({ queryKey: getGetHoursBalanceQueryKey(params) }),
      ]);
      setConfirmOpen(false);
      toast.success("Monat abgeschlossen", {
        description: "Die Lohnauswertung wurde als Referenz eingefroren.",
      });
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast.error("Abschluss fehlgeschlagen", {
        description: "Der Monat konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
      });
    }
  };

  return (
    <Card className="border-border/50 shadow-sm" data-testid="month-closing-card">
      <CardContent className="p-4 md:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {closed ? (
            <CheckCircle2 className="h-5 w-5 mt-0.5 text-green-700 shrink-0" />
          ) : (
            <LockIcon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
          )}
          <div>
            <p className="font-medium text-sm" data-testid="month-closing-status">
              {closed && latest
                ? `Monat abgeschlossen am ${formatClosedAt(latest.closedAt)}${latest.closedByName ? ` von ${latest.closedByName}` : ""}`
                : "Monat noch nicht abgeschlossen"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {closed
                ? reCloses
                  ? "Erneuter Abschluss ersetzt die Referenz — frühere Abschlüsse bleiben in der Historie."
                  : "Spätere Änderungen erscheinen als Nachberechnung in der Auswertung des Folgemonats."
                : closable
                  ? isCurrentMonth
                    ? "Vorzeitiger Abschluss: friert den aktuellen Stand für die Lohnbuchhaltung ein. Änderungen danach erscheinen als Nachberechnung im Folgemonat."
                    : "Der Abschluss friert die Lohnauswertung als Referenz ein. Spätere Änderungen werden im Folgemonat als Nachberechnung ausgewiesen."
                  : "Ein zukünftiger Monat kann nicht abgeschlossen werden."}
            </p>
          </div>
        </div>
        <Button
          variant={closed ? "outline" : "default"}
          onClick={() => setConfirmOpen(true)}
          disabled={!closable || createClosing.isPending}
          className={`shrink-0 gap-1.5 ${closed ? "border-amber-400 text-amber-800 hover:bg-amber-50 hover:text-amber-900" : ""}`}
          data-testid="month-closing-button"
        >
          {closed && <AlertTriangle className="h-4 w-4" />}
          {closed ? "Erneut abschließen" : "Monat abschließen"}
        </Button>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {closed ? "Monat erneut abschließen?" : "Monat abschließen?"}
            </DialogTitle>
            <DialogDescription>
              {closed
                ? "Nutzen Sie diese Funktion nur für Korrekturen vor der Weitergabe an das Lohnbüro (Frist: 7 Tage vor Monatsende)."
                : "Die aktuelle Lohnauswertung wird als verbindliche Referenz eingefroren. Bearbeitungen bleiben weiterhin möglich — Änderungen nach dem Abschluss werden in der Auswertung des Folgemonats als Nachberechnung ausgewiesen."}
            </DialogDescription>
          </DialogHeader>
          {closed && (
            <div
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="month-closing-reclose-warning"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Wurde der Monat beim Steuerberater bereits abgerechnet? Dann schließen Sie den Monat <strong>nicht erneut</strong> ab — Änderungen in den letzten 7 Tagen des Monats führen sonst zu keiner Nachberechnung im Folgemonat.
              </span>
            </div>
          )}
          {pending > 0 && (
            <div
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="month-closing-pending-warning"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {pending === 1
                  ? "Es gibt noch 1 offenen Ist-Zeiten-Eintrag in diesem Monat."
                  : `Es gibt noch ${pending} offene Ist-Zeiten-Einträge in diesem Monat.`}{" "}
                Unbestätigte Einträge fließen nicht in die eingefrorene Auswertung ein.
              </span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={doClose}
              disabled={createClosing.isPending}
              className={closed ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
              data-testid="month-closing-confirm"
            >
              {closed ? "Jetzt erneut abschließen" : "Abschließen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Gesamtsummen der Lohnauswertung des angezeigten Monats (Grundlohn,
 * Zuschläge, Gesamt) — inkl. der Nachberechnung des Vormonats als eigene,
 * klar beschriftete Position. Nur rendern, wenn Admin & advancedAnalytics.
 */
export function PayrollTotalsCard({
  month,
  year,
  teamId,
  balances,
  assistantFilter,
}: {
  month: number;
  year: number;
  teamId: number | null;
  balances: Array<{
    userId: number;
    basePay?: number | null;
    nightSurchargePay?: number | null;
    sundaySurchargePay?: number | null;
    holidaySurchargePay?: number | null;
    totalPay?: number | null;
  }>;
  assistantFilter: number | "all";
}) {
  // Nachberechnung des Vormonats — dieselben Daten wie die Detail-Sektion
  // (React Query dedupliziert die Anfrage).
  const prev = new Date(year, month - 2, 1);
  const prevLabel = format(prev, "MMMM yyyy", { locale: de });
  const params = {
    month: prev.getMonth() + 1,
    year: prev.getFullYear(),
    ...(teamId != null ? { teamId } : {}),
  };
  const { data } = useGetMonthClosingDiff(params, {
    query: { enabled: true },
  } as any) as { data: MonthClosingDiff | undefined };

  const diffRows =
    data?.closed && data.rows.length > 0
      ? assistantFilter === "all"
        ? data.rows
        : data.rows.filter((r) => r.userId === assistantFilter)
      : [];

  const monthBase = balances.reduce((s, b) => s + (b.basePay ?? 0), 0);
  const monthSurcharge = balances.reduce(
    (s, b) =>
      s + (b.nightSurchargePay ?? 0) + (b.sundaySurchargePay ?? 0) + (b.holidaySurchargePay ?? 0),
    0,
  );
  const monthTotal = balances.reduce((s, b) => s + (b.totalPay ?? 0), 0);

  const recalcBase = diffRows.reduce((s, r) => s + (r.diffBasePay ?? 0), 0);
  const recalcSurcharge = diffRows.reduce((s, r) => s + (r.diffSurchargePay ?? 0), 0);
  const recalcTotal = diffRows.reduce((s, r) => s + (r.diffPay ?? 0), 0);
  const hasRecalc = diffRows.some((r) => r.diffPay != null && r.diffPay !== 0);

  const hasMonthPay = balances.some((b) => b.totalPay != null);
  if (!hasMonthPay && !hasRecalc) return null;

  const signedEuro = (n: number) => `${n > 0 ? "+" : ""}${euro(n)}`;

  return (
    <Card className="border-border/50 shadow-sm" data-testid="payroll-totals-card">
      <CardContent className="p-5 md:p-6">
        <h3 className="text-lg font-semibold mb-3">
          Gesamtsummen {format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: de })}
        </h3>
        <div className="space-y-1.5 max-w-md">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Grundlohn</span>
            <span className="font-medium" data-testid="totals-base">{euro(monthBase)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Zuschläge (Nacht/Sonntag/Feiertag)</span>
            <span className="font-medium" data-testid="totals-surcharge">{euro(monthSurcharge)}</span>
          </div>
          <div className="flex items-center justify-between text-sm pt-1.5 border-t">
            <span className="font-medium">Gesamtlohn (laufender Monat)</span>
            <span className="font-semibold" data-testid="totals-month">{euro(monthTotal)}</span>
          </div>
          {hasRecalc && (
            <>
              <div
                className="flex items-center justify-between text-sm text-amber-900"
                data-testid="totals-recalc"
              >
                <span>
                  Nachberechnung {prevLabel}
                  <span className="block text-xs text-muted-foreground">
                    Grundlohn {signedEuro(recalcBase)} · Zuschläge {signedEuro(recalcSurcharge)}
                  </span>
                </span>
                <span className="font-medium whitespace-nowrap">{signedEuro(recalcTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm pt-1.5 border-t">
                <span className="font-semibold">Gesamt inkl. Nachberechnung</span>
                <span className="font-bold" data-testid="totals-including-recalc">
                  {euro(monthTotal + recalcTotal)}
                </span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Nachberechnungs-Sektion: zeigt die Differenzen des VORMONATS des angezeigten
 * Monats (gemeldet laut Abschluss vs. aktueller Stand), wenn der Vormonat
 * abgeschlossen wurde und sich seitdem etwas geändert hat.
 */
export function RecalculationSection({
  month,
  year,
  teamId,
}: {
  month: number;
  year: number;
  teamId: number | null;
}) {
  const [open, setOpen] = useState(true);

  // Vormonat des angezeigten Monats.
  const prev = new Date(year, month - 2, 1);
  const prevMonth = prev.getMonth() + 1;
  const prevYear = prev.getFullYear();
  const prevLabel = format(prev, "MMMM yyyy", { locale: de });

  const params = { month: prevMonth, year: prevYear, ...(teamId != null ? { teamId } : {}) };
  const { data } = useGetMonthClosingDiff(params, {
    query: { enabled: true },
  } as any) as { data: MonthClosingDiff | undefined };

  if (!data?.closed || data.rows.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-amber-300/60 shadow-sm" data-testid="recalculation-section">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left"
            aria-expanded={open}
          >
            <div className="p-5 md:p-6 flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold">Nachberechnung {prevLabel}</h3>
                  <p className="text-sm text-muted-foreground">
                    Der Monat {prevLabel} wurde nach dem Abschluss
                    {data.closedAt ? ` (${formatClosedAt(data.closedAt)})` : ""} geändert.
                    {!open && " Aufklappen für Details."}
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-5 pb-5 md:px-6 md:pb-6 pt-0">
            <p className="text-sm text-muted-foreground mb-4">
              Differenz zwischen gemeldeter und aktueller Auswertung:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Assistenzkraft</th>
                    <th className="py-2 pr-3 font-medium text-right">Gemeldet</th>
                    <th className="py-2 pr-3 font-medium text-right">Aktuell</th>
                    <th className="py-2 pr-3 font-medium text-right">Differenz</th>
                    <th className="py-2 font-medium text-right">davon Urlaub / Krankheit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.userId} className="border-b last:border-0 align-top" data-testid={`recalc-row-${row.userId}`}>
                      <td className="py-2 pr-3 font-medium">{row.userName}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {row.reportedHours.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h
                        {row.reportedPay != null && (
                          <div className="text-xs text-muted-foreground">{euro(row.reportedPay)}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {row.currentHours.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h
                        {row.currentPay != null && (
                          <div className="text-xs text-muted-foreground">{euro(row.currentPay)}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">
                        <span className={row.diffHours !== 0 ? (row.diffHours > 0 ? "text-green-700" : "text-red-700") : ""}>
                          {signed(row.diffHours, "h")}
                        </span>
                        {row.diffPay != null && (
                          <div className={`text-xs ${row.diffPay > 0 ? "text-green-700" : row.diffPay < 0 ? "text-red-700" : "text-muted-foreground"}`}>
                            {row.diffPay > 0 ? "+" : ""}
                            {euro(row.diffPay)}
                          </div>
                        )}
                      </td>
                      {/* Abwesenheits-Ausweis: Urlaubs-/Krankheitsstunden
                          (Lohnfortzahlung) im aktuellen Stand des Vormonats. */}
                      <td className="py-2 text-right whitespace-nowrap" data-testid={`recalc-absence-${row.userId}`}>
                        {(row.vacationHours ?? 0) > 0 && (
                          <div>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                              <span className="text-muted-foreground">Urlaub</span>
                              <span className="font-medium">
                                {(row.vacationHours ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 2 })} h
                              </span>
                            </span>
                            {row.vacationPay != null && (
                              <div className="text-xs text-muted-foreground">{euro(row.vacationPay)}</div>
                            )}
                          </div>
                        )}
                        {(row.sickHours ?? 0) > 0 && (
                          <div className={(row.vacationHours ?? 0) > 0 ? "mt-1" : ""}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-gray-400 inline-block" />
                              <span className="text-muted-foreground">Krankheit</span>
                              <span className="font-medium">
                                {(row.sickHours ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 2 })} h
                              </span>
                            </span>
                            {row.sickPay != null && (
                              <div className="text-xs text-muted-foreground">{euro(row.sickPay)}</div>
                            )}
                          </div>
                        )}
                        {(row.vacationHours ?? 0) === 0 && (row.sickHours ?? 0) === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Die Nachberechnung ist bei der Abrechnung dieses Monats zu berücksichtigen.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
