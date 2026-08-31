import { useMemo, useState } from "react";
import { isAdminRole } from "@/lib/roles";
import { planFeatureMessage } from "@/lib/api-error";
import {
  useGetDashboardSummary,
  useListContracts,
  useGetVacationBalance,
  useGetMonthClosings,
  useListShifts,
  useListShiftDeviations,
  useListShiftChanges,
  useListAbsenceRequests,
} from "@workspace/api-client-react";
import type { MonthClosingStatus } from "@workspace/api-client-react";
import { hasAccess } from "@/lib/entitlements";
import type { DashboardSummary, DashboardWarnings, Shift, VacationBalance, AbsenceRequest } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { AlertTriangle, AlertCircle, CalendarX, Clock, CheckCircle2, Plane, ChevronRight, Info } from "lucide-react";
import { useLocation } from "wouter";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth, hasTeamAccessLevel } from "@/context/auth";
import { DienstStatus, type SchichtVorlage } from "@/types/dienstplan";
import { formatDays, formatDaysWithUnit, formatHours } from "@/lib/utils";
import { useTimeTrackingEnabled } from "@/hooks/use-time-tracking-enabled";
import { MeineStundenKarte } from "@/components/meine-stunden-karte";
import { KrankmeldungDialog } from "@/components/krankmeldung-dialog";
import { HourBudgetDashboardCard } from "@/components/hour-budget-card";

// Beispielhafte Einbindung der zentralen Planungstypen (siehe @/types/dienstplan):
// belegt die Importierbarkeit aus der Dashboard-Ansicht, ohne bestehendes
// Verhalten zu ändern. Diese Konstanten dienen vorerst nur als getypte Referenz.
export const DIENST_STATUS_LABELS: Record<DienstStatus, string> = {
  [DienstStatus.ENTWURF]: "Entwurf",
  [DienstStatus.VORSCHLAG]: "Vorschlag",
  [DienstStatus.BESTAETIGT]: "Bestätigt",
  [DienstStatus.ARCHIVIERT]: "Archiviert",
  [DienstStatus.KRANKHEIT]: "Krankheit",
  [DienstStatus.ABSAGE_MAB]: "Absage Mitarbeiter",
  [DienstStatus.ABSAGE_AG]: "Absage Arbeitgeber",
};

export const STANDARD_SCHICHT_VORLAGEN: SchichtVorlage[] = [];

function WarningsSection({
  warnings,
  timeTrackingEnabled,
}: {
  warnings: DashboardWarnings;
  timeTrackingEnabled: boolean;
}) {
  const { pendingTimeEntries, timeTrackingConfirmable, lowVacationAssistants, uncoveredDays, lowVacationThreshold, horizonDays } = warnings;
  const [, navigate] = useLocation();
  // Produktentscheidung: Für Free-Konten (kein Freigabe-Workflow im Team-Scope,
  // timeTrackingConfirmable=false) ist "offen" der dauerhafte Normalzustand —
  // die Einträge zählen bereits als Ist-Stunden. Die Warnung wäre ein To-do,
  // das Free gar nicht erledigen kann (Bestätigen ist Premium), daher wird sie
  // ausgeblendet. Premium-Verhalten unverändert.
  // Bei deaktivierter Zeiterfassung entfällt die Warnung komplett — die App
  // soll sich anfühlen, als gäbe es das Feature nicht.
  const showPendingWarning =
    timeTrackingEnabled && timeTrackingConfirmable && pendingTimeEntries > 0;
  const hasWarnings =
    showPendingWarning || lowVacationAssistants.length > 0 || uncoveredDays.length > 0;

  if (!hasWarnings) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
        <CardContent className="flex items-center gap-3 py-5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-800">
            Alles in Ordnung. Keine offenen Punkte fuer die naechsten {horizonDays} Tage.
          </p>
        </CardContent>
      </Card>
    );
  }

  const previewDays = uncoveredDays.slice(0, 5);
  const restDays = uncoveredDays.length - previewDays.length;

  return (
    <Card className="border-amber-200 bg-amber-50/40 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-900">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Hinweise
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showPendingWarning && (
          <button
            type="button"
            onClick={() => navigate("/zeiterfassung?status=pending")}
            data-testid="warning-pending-time-entries"
            className="group flex w-full items-start gap-3 rounded-lg p-1.5 -m-1.5 text-left transition-colors hover:bg-amber-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {pendingTimeEntries} offene {pendingTimeEntries === 1 ? "Zeiterfassung" : "Zeiterfassungen"}
              </p>
              <p className="text-sm text-muted-foreground">Noch nicht bestaetigt und warten auf Pruefung.</p>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600/70 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}

        {lowVacationAssistants.length > 0 && (
          <div className="flex items-start gap-3">
            <Plane className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {lowVacationAssistants.length}{" "}
                {lowVacationAssistants.length === 1 ? "Assistenzkraft" : "Assistenzkräfte"} mit wenig Resturlaub
                <span className="font-normal text-muted-foreground"> (Schwelle: {lowVacationThreshold} Tage)</span>
              </p>
              <ul className="mt-1 space-y-0.5">
                {lowVacationAssistants.map((a) => (
                  <li key={a.userId}>
                    <button
                      type="button"
                      onClick={() => navigate(`/team-verwaltung?highlight=${a.userId}`)}
                      data-testid={`warning-low-vacation-${a.userId}`}
                      className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 -mx-2 text-left text-sm text-muted-foreground transition-colors hover:bg-amber-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <span>
                        {a.userName}: {formatDaysWithUnit(a.vacationDaysRemaining)} Resturlaub
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-amber-600/70 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {uncoveredDays.length > 0 && (
          <div className="flex items-start gap-3">
            <CalendarX className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {uncoveredDays.length} {uncoveredDays.length === 1 ? "Tag" : "Tage"} ohne geplante Schicht
                <span className="font-normal text-muted-foreground"> (naechste {horizonDays} Tage)</span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {previewDays.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => navigate(`/dienstplan?date=${d}`)}
                    data-testid={`warning-uncovered-day-${d}`}
                    className="rounded-full border border-amber-300 bg-amber-100/50 px-2.5 py-0.5 text-xs text-amber-900 transition-colors hover:bg-amber-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    {format(parseISO(d), "EEE, dd.MM.", { locale: de })}
                  </button>
                ))}
                {restDays > 0 && (
                  <button
                    type="button"
                    onClick={() => navigate(`/dienstplan?date=${uncoveredDays[previewDays.length]}`)}
                    data-testid="warning-uncovered-day-more"
                    className="rounded-full px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    +{restDays} weitere
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({
  title,
  to,
  testId,
  children,
}: {
  title: string;
  to: string;
  testId: string;
  children: React.ReactNode;
}) {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      data-testid={testId}
      className="group text-left rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full border-border/50 shadow-sm transition-colors group-hover:border-border group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
            {title}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
          </CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </button>
  );
}

// Hinweis nach einem Premium-Upgrade: Offene (pending) Einträge zählen im
// strikten Modus nicht mehr in die Ist-Stunden. Damit zuvor sichtbare Stunden
// nicht kommentarlos "verschwinden", wird die nicht gezählte Summe erklärt und
// (für Admins) ein geführter Weg zum Nachbestätigen angeboten.
function UncountedPendingNotice({
  hours,
  count,
  isAdmin,
}: {
  hours: number;
  count: number;
  isAdmin: boolean;
}) {
  const [, navigate] = useLocation();
  return (
    <Card className="border-blue-200 bg-blue-50/50 shadow-sm" data-testid="uncounted-pending-notice">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {hours} Stunden aus {count} offenen {count === 1 ? "Zeiteintrag" : "Zeiteinträgen"} sind
              noch nicht in den Ist-Stunden enthalten.
            </p>
            <p className="text-sm text-muted-foreground">
              Im Premium-Tarif zählen nur bestätigte Einträge.{" "}
              {isAdmin
                ? "Bestätigen Sie die offenen Einträge, damit die Stunden wieder erscheinen."
                : "Die Stunden erscheinen, sobald die Einträge bestätigt wurden."}
            </p>
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate("/zeiterfassung?status=pending")}
            data-testid="uncounted-pending-review"
            className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:self-auto"
          >
            Jetzt prüfen
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// Resturlaub-Karte für ASSISTENTEN: zeigt die eigene Bilanz (Anspruch /
// genommen / verbleibend) aus dem Premium-Endpunkt vacation-balance. Das
// Server-Gate läuft über den Plan des ARBEITGEBERS (Team-Eigentümers) —
// liefert der Endpunkt 403 plan_feature_required (Free-Arbeitgeber), zeigt
// die Karte einen dezenten Info-Hinweis statt der Bilanz (Produktentscheidung
// Task-Auswahl: Assistenten sollen wissen, dass das Feature existiert und wen
// sie ansprechen können — bewusst OHNE Upgrade-Aufforderung, da Assistenten
// selbst nichts upgraden können). Ohne Vertrag oder bei anderen Fehlern bleibt
// die Karte weiterhin still ausgeblendet.
function AssistantVacationCard() {
  const [, navigate] = useLocation();

  // GET /contracts liefert für Assistenten serverseitig nur den EIGENEN
  // Vertrag (userId wird auf die Session gezwungen).
  const { data: contracts } = useListContracts();
  const activeContract = (contracts ?? []).find(
    (c) => !c.endDate || new Date(c.endDate) > new Date(),
  );
  const contractId = activeContract?.id ?? 0;

  const { data: balance, isSuccess, error } = useGetVacationBalance(contractId, {
    query: { enabled: contractId > 0, retry: false },
  } as Parameters<typeof useGetVacationBalance>[1]) as {
    data?: VacationBalance;
    isSuccess: boolean;
    error: unknown;
  };

  // Free-Arbeitgeber: dezenter Hinweis ohne Werbedruck.
  if (planFeatureMessage(error) !== null) {
    return (
      <Card
        className="border-border/50 shadow-sm"
        data-testid="assistant-vacation-locked-notice"
      >
        <CardContent className="flex items-start gap-3 py-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Die Resturlaub-Anzeige ist hier verfügbar, sobald dein Arbeitgeber
            sie freischaltet. Sprich ihn bei Interesse gern darauf an — deine
            Urlaubstage werden unabhängig davon weiter erfasst.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isSuccess || !balance) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/dienstplan")}
      data-testid="assistant-vacation-card"
      className="group block w-full text-left rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="border-border/50 shadow-sm transition-colors group-hover:border-border group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
            <span className="flex items-center gap-2">
              <Plane className="h-4 w-4" />
              Mein Resturlaub {new Date().getFullYear()}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold" data-testid="assistant-vacation-remaining">
            {formatDays(balance.vacationDaysRemaining)}{" "}
            <span className="text-lg text-muted-foreground font-normal">
              von {formatDays(balance.vacationDays)}{" "}
              {balance.vacationDays === 1 ? "Tag" : "Tagen"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDaysWithUnit(balance.vacationDaysUsed)} bereits genommen
          </p>
          {/* Transparenz (#498): zeigt, mit wie vielen Stunden ein Urlaubstag
              aktuell bewertet wird (dailyHours/dailyHoursSource aus der Bilanz).
              Reine Info, keine Korrektur-Möglichkeit. */}
          {balance.dailyHours != null && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="assistant-vacation-daily-hours"
            >
              1 Urlaubstag = {formatHours(balance.dailyHours)} h
              {balance.dailyHoursSource === "contract"
                ? " (Vertragsdaten)"
                : ""}
            </p>
          )}
          {balance.ersatzruhetagEnabled !== false && (balance.restDaysBalance ?? 0) !== 0 && (
            <p
              className="mt-2 text-sm text-emerald-700"
              data-testid="assistant-rest-days"
            >
              Ersatzruhetage (Feiertagsarbeit):{" "}
              {formatDaysWithUnit(balance.restDaysBalance ?? 0)} verfügbar
            </p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

// Hinweis-Kachel für laufende Abwesenheiten und Krankheitstage des laufenden
// Monats — gleiches kompaktes Muster wie der Monatsabschluss-Hinweis. Die
// Shift-Listen sind serverseitig automatisch gescopt (Admin: Team-Scope,
// Assistenzkraft: eigene Einträge), daher keine zusätzliche Rollenlogik nötig.
// Erscheint nur, wenn es tatsächlich etwas zu melden gibt.
function AbsenceReminder() {
  const [, navigate] = useLocation();
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  // enabled: isTeamScopeReady — erst laden, wenn der Team-Scope settled ist
  // (sonst feuert die Liste doppelt: erst ohne, dann mit Team-Auswahl). Für
  // Nutzer ohne Team-Switcher ist isTeamScopeReady sofort true.
  const { isTeamScopeReady } = useTeam();
  const { data: vacationShifts } = useListShifts(
    { type: "vacation" },
    { query: { enabled: isTeamScopeReady } } as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };
  const { data: sickShifts } = useListShifts(
    { type: "sick" },
    { query: { enabled: isTeamScopeReady } } as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };

  // useMemo: iteriert über die komplette Abwesenheits-/Krankheitsliste — ohne
  // Memo liefe das bei jedem Render der Seite neu (z. B. durch Timer-Ticks
  // anderer Karten), obwohl sich die Listen zwischen Renders meist nicht
  // ändern.
  const { ongoing, sickDays } = useMemo(() => {
    if (!vacationShifts || !sickShifts) return { ongoing: 0, sickDays: 0 };

    // Laufende Abwesenheiten: Einträge, die den heutigen Tag einschließen,
    // gezählt je betroffener Person.
    const ongoingUserIds = new Set<number>();
    for (const s of [...vacationShifts, ...sickShifts]) {
      if (new Date(s.startTime) <= now && now <= new Date(s.endTime)) {
        ongoingUserIds.add(s.userId);
      }
    }

    // Krankheitstage im laufenden Monat: eindeutige Kalendertage aller
    // Krank-Einträge, die in diesen Monat hineinragen.
    const sickDayKeys = new Set<string>();
    for (const s of sickShifts) {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getMonth() === month && d.getFullYear() === year) {
          sickDayKeys.add(d.toISOString().split("T")[0]);
        }
      }
    }
    return { ongoing: ongoingUserIds.size, sickDays: sickDayKeys.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacationShifts, sickShifts, month, year]);

  if (!vacationShifts || !sickShifts) return null;
  if (ongoing === 0 && sickDays === 0) return null;

  const monthLabel = format(now, "MMMM", { locale: de });
  const parts: string[] = [];
  if (ongoing > 0) {
    parts.push(`${ongoing} laufende ${ongoing === 1 ? "Abwesenheit" : "Abwesenheiten"}`);
  }
  if (sickDays > 0) {
    parts.push(`${sickDays} ${sickDays === 1 ? "Krankheitstag" : "Krankheitstage"} im ${monthLabel}`);
  }

  return (
    <button
      type="button"
      onClick={() => navigate("/abwesenheiten")}
      className="w-full text-left"
      data-testid="absence-reminder"
    >
      <Card className="border-amber-200 bg-amber-50/40 shadow-sm transition-colors hover:border-amber-300">
        <CardContent className="flex items-center gap-3 py-4">
          {/* Eigenes, lokales Icon — der frühere Warndreieck-Status-Badge
              (kind="warning") ist aus dem Icon-Set gestrichen (16.08.2026). */}
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-amber-600"
            aria-label="Warnung"
            data-testid="absence-reminder-icon"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              {parts.join(" · ")}
            </p>
            <p className="text-xs text-amber-800/80 mt-0.5">
              Gemeldete Abwesenheiten und Krankmeldungen im Überblick — direkt zum Abwesenheitskalender.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-amber-700 shrink-0" />
        </CardContent>
      </Card>
    </button>
  );
}

// #887: Hinweis auf offene Urlaubs-/Krankheitsanträge — nur für Planer
// (Inhaber + Koordinatoren mit Planungsrecht, dieselbe Berechtigung wie die
// Bestätigen/Ablehnen-Aktionen auf der Abwesenheiten-Seite). Erscheint nur,
// wenn tatsächlich offene Anträge vorliegen.
function PendingAbsenceRequestsReminder() {
  const [, navigate] = useLocation();
  const { isTeamScopeReady } = useTeam();
  const { data: pending } = useListAbsenceRequests(
    { status: "PENDING" },
    { query: { enabled: isTeamScopeReady } } as Parameters<typeof useListAbsenceRequests>[1],
  ) as { data?: AbsenceRequest[] };

  if (!pending || pending.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/abwesenheiten")}
      className="w-full text-left"
      data-testid="pending-absence-requests-reminder"
    >
      <Card className="border-amber-200 bg-amber-50/40 shadow-sm transition-colors hover:border-amber-300">
        <CardContent className="flex items-center gap-3 py-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              {pending.length} {pending.length === 1 ? "offener Antrag" : "offene Anträge"} auf Urlaub/Krank
            </p>
            <p className="text-xs text-amber-800/80 mt-0.5">
              Jetzt im Abwesenheitskalender bestätigen oder ablehnen.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-amber-700 shrink-0" />
        </CardContent>
      </Card>
    </button>
  );
}

// Erinnerung an den Monatsabschluss: erscheint für Admins mit Premium
// (advancedAnalytics), solange der Vormonat noch nicht abgeschlossen ist.
// Fehler (z. B. 403 nach Downgrade) blenden die Karte einfach aus.
function MonthClosingReminder({ teamId }: { teamId: number | null }) {
  const [, navigate] = useLocation();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const { data, isError } = useGetMonthClosings(
    {
      month: prev.getMonth() + 1,
      year: prev.getFullYear(),
      ...(teamId != null ? { teamId } : {}),
    },
    { query: { retry: false } } as any,
  ) as { data: MonthClosingStatus | undefined; isError: boolean };

  if (isError || !data || data.closed) return null;

  const label = format(prev, "MMMM yyyy", { locale: de });
  return (
    <button
      type="button"
      onClick={() => navigate("/auswertungen")}
      className="w-full text-left"
      data-testid="month-closing-reminder"
    >
      <Card className="border-amber-200 bg-amber-50/40 shadow-sm transition-colors hover:border-amber-300">
        <CardContent className="flex items-center gap-3 py-4">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              Monatsabschluss {label} steht noch aus
            </p>
            <p className="text-xs text-amber-800/80 mt-0.5">
              Die Lohnauswertung für {label} kann jetzt abgeschlossen werden — spätere
              Änderungen erscheinen dann als Nachberechnung.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-amber-700 shrink-0" />
        </CardContent>
      </Card>
    </button>
  );
}

/**
 * Schnell-Krankmeldung für Assistenzkräfte: zeigt eine klickbare Karte,
 * solange kein Krank-Eintrag für heute existiert. Öffnet den KrankmeldungDialog.
 */
function KrankmeldungSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Für Assistenzkräfte ist isTeamScopeReady sofort true — das Gate wirkt nur
  // bei Konten mit Team-Switcher (verhindert den unscoped Doppel-Request).
  const { isTeamScopeReady } = useTeam();
  const { data: sickShifts } = useListShifts(
    { type: "sick" },
    { query: { enabled: isTeamScopeReady } } as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };
  // #887: eine Krankmeldung legt nicht mehr sofort eine Schicht an, sondern
  // einen PENDING-Antrag — ohne diesen Zweig bliebe der Button nach dem
  // Absenden sichtbar, bis ein Planer bestätigt (Dauer-Duplikate wären
  // möglich). Eigene Anträge sind hier bereits userId-gescopt (GET
  // /absence-requests liefert Assistenzkräften ausschließlich eigene Zeilen).
  const { data: myAbsenceRequests } = useListAbsenceRequests(
    { status: "PENDING" },
    { query: { enabled: isTeamScopeReady } } as Parameters<typeof useListAbsenceRequests>[1],
  ) as { data?: AbsenceRequest[] };
  const now = new Date();
  const isSickToday = (sickShifts ?? []).some(
    (s) => new Date(s.startTime) <= now && now <= new Date(s.endTime),
  );
  const hasPendingSickRequestToday = (myAbsenceRequests ?? []).some(
    (r) =>
      r.type === "sick" &&
      r.days.some((d) => new Date(d.startTime) <= now && now <= new Date(d.endTime)),
  );

  if (isSickToday || hasPendingSickRequestToday) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="w-full text-left"
        data-testid="krank-melden-btn"
      >
        <Card className="border-destructive/30 bg-destructive/5 shadow-sm transition-colors hover:border-destructive/50">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" aria-hidden />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Krank melden</p>
              <p className="text-xs text-destructive/70 mt-0.5">
                Heute oder mehrere Tage — der Koordinator wird informiert.
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-destructive/60 shrink-0" />
          </CardContent>
        </Card>
      </button>
      <KrankmeldungDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

// Dashboard-Warnung für offene Dienstvorschläge (Assistenzkraft-Sicht): der
// Arbeitgeber hat einen bereits fixen Dienst geändert (Zeit/Person/Pause),
// wodurch er auf ANGEBOTEN zurückfällt und erneut bestätigt werden muss. Der
// gleichwertige Hinweis existiert bereits im Dienstplan-Kalender
// (dienstplan.tsx, myAngebotenShifts) — hier zusätzlich ganz oben auf dem
// Dashboard, damit er nicht übersehen wird, unabhängig vom dort gerade
// angezeigten Monat. all:true umgeht den Monats-Default der Liste; der
// Server erzwingt für Assistenzkräfte ohnehin effectiveUserId=self.
function PendingShiftProposalsBanner() {
  const [, navigate] = useLocation();
  const { isTeamScopeReady, selectedTeamId } = useTeam();
  const { currentUser } = useAuth();
  // Wie im Kalender (dienstplan.tsx) auf das gerade gewählte Team beschränkt:
  // ohne teamId würde ein Mehrteam-Konto auch Vorschläge aus NICHT
  // ausgewählten Teams zählen/verlinken, die "Vorschlag prüfen" aber im
  // aktuell gewählten Team-Kalender landet und dort nicht auftaucht.
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};
  const { data: shifts } = useListShifts(
    { all: true, userId: currentUser?.id, ...teamParam },
    { query: { enabled: isTeamScopeReady && currentUser?.id != null } } as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };

  // GET /shifts erzwingt effectiveUserId=self nur für reine Assistenzkräfte
  // ohne Planungsrechte; Teamleiter-Assistenzkräfte erhalten sonst die
  // Dienste ihres ganzen Teams. Ohne die userId-Prüfung würde ihnen hier
  // fälschlich ein fremder Vorschlag als eigener Handlungsbedarf angezeigt
  // (wie beim Kalender-Pendant myAngebotenShifts in dienstplan.tsx: gleiche
  // Filter, inkl. Ausschluss von Aushilfe-Spiegelschichten).
  const offeredShifts = (shifts ?? []).filter(
    (s) =>
      s.planningStatus === "ANGEBOTEN" &&
      s.userId === currentUser?.id &&
      !(s.einsatzTeamId != null && s.einsatzTeamId === selectedTeamId),
  );
  if (offeredShifts.length === 0) return null;

  // Offene Vorschläge. Nachträgliche Korrekturen laufen NICHT mehr hierüber —
  // sie gelten sofort und erscheinen im eigenen Hinweis darüber
  // (CorrectedShiftsBanner). Ein vergangener, noch unbestätigter Vorschlag ist
  // kein Sonderfall mehr, sondern schlicht überfällig.
  const vorschlaege = offeredShifts;

  const earliest = (list: Shift[]) => list.map((s) => s.startTime).sort()[0]!;
  // fokus=... schaltet die Tagesleiste im Dienstplan direkt auf den passenden
  // Prüf-Filter und scrollt hin — sonst landet man im Monatsraster und muss
  // die betroffenen Tage erst suchen und einzeln anklicken (Kay-Feedback
  // 28.08.2026).
  const gotoPruefliste = (list: Shift[], fokus: "korrekturen" | "vorschlaege") =>
    navigate(
      `/dienstplan?date=${format(new Date(earliest(list)), "yyyy-MM-dd")}&fokus=${fokus}`,
    );

  return (
    <>
      {/* Vorschläge: gewöhnliche Vorausplanung, deshalb der ruhige blaue
          Standard-Hinweis statt einer Warnfarbe. */}
      {vorschlaege.length > 0 && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="dashboard-shift-proposal-banner"
        >
          <div className="flex items-start gap-2 text-sky-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
            <span className="text-sm font-medium">
              {vorschlaege.length === 1
                ? "1 Dienstvorschlag wartet auf Ihre Bestätigung."
                : `${vorschlaege.length} Dienstvorschläge warten auf Ihre Bestätigung.`}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 self-start border-sky-300 bg-white text-sky-900 hover:bg-sky-100 sm:self-auto"
            data-testid="dashboard-shift-proposal-review"
            onClick={() => gotoPruefliste(vorschlaege, "vorschlaege")}
          >
            {vorschlaege.length === 1 ? "Vorschlag prüfen" : "Vorschläge prüfen"}
          </Button>
        </div>
      )}
    </>
  );
}

// Planer-Hinweis: gemeldete Abweichungen warten auf Annehmen/Widersprechen.
// Ohne ihn musste der Planer zufaellig in den richtigen Tag klicken, um eine
// Meldung ueberhaupt zu bemerken (Kay-Feedback 28.08.2026). Gegenstueck zum
// Korrektur-Banner der Assistenzkraft — hier laeuft die Zustimmung in die
// andere Richtung.
function PendingDeviationsBanner() {
  const [, navigate] = useLocation();
  const { isTeamScopeReady, selectedTeamId } = useTeam();
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};
  const { data: reports } = useListShiftDeviations(teamParam, {
    query: { enabled: isTeamScopeReady },
  } as Parameters<typeof useListShiftDeviations>[1]) as {
    data?: { id: number; shiftId: number; status: string; reportedStartTime: string }[];
  };

  const offen = (reports ?? []).filter((r) => r.status === "PENDING");
  if (offen.length === 0) return null;

  const earliest = offen.map((r) => r.reportedStartTime).sort()[0]!;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="dashboard-deviation-banner"
    >
      <div className="flex items-start gap-2 text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <span className="text-sm font-medium">
          Achtung:{" "}
          {offen.length === 1
            ? "Eine Assistenzkraft hat eine abweichende Arbeitszeit gemeldet. Bitte annehmen oder widersprechen."
            : `${offen.length} Assistenzkräfte haben abweichende Arbeitszeiten gemeldet. Bitte annehmen oder widersprechen.`}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 self-start border-amber-400 bg-white text-amber-900 hover:bg-amber-100 sm:self-auto"
        data-testid="dashboard-deviation-review"
        onClick={() =>
          navigate(`/dienstplan?date=${format(new Date(earliest), "yyyy-MM-dd")}&fokus=meldungen`)
        }
      >
        {offen.length === 1 ? "Meldung prüfen" : "Meldungen prüfen"}
      </Button>
    </div>
  );
}


// Assistenz-Hinweis: nachtraeglich geaenderte eigene Arbeitszeiten. Seit dem
// 28.08.2026 gilt eine Korrektur des Planers sofort — das ist deshalb ein
// HINWEIS, keine Aufgabe. Er steht bewusst hier im Dashboard und nicht mehr
// ueber dem Dienstplan (Kay-Feedback 28.08.2026): Das Dashboard ist die Seite,
// die eine Assistenzkraft zuerst sieht.
function CorrectedShiftsBanner() {
  const [, navigate] = useLocation();
  const { isTeamScopeReady, selectedTeamId } = useTeam();
  const { currentUser } = useAuth();
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};

  const { data: changes } = useListShiftChanges(teamParam, {
    query: { enabled: isTeamScopeReady },
  } as Parameters<typeof useListShiftChanges>[1]) as {
    data?: { shiftId: number; changeSource: string }[];
  };
  const { data: shifts } = useListShifts(
    { all: true, userId: currentUser?.id, ...teamParam },
    { query: { enabled: isTeamScopeReady && currentUser?.id != null } } as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };

  const korrigierteIds = new Set(
    (changes ?? []).filter((c) => c.changeSource === "planner_edit").map((c) => c.shiftId),
  );
  // Der Server liefert Nicht-Planenden ohnehin nur die eigenen Zeilen; die
  // userId-Pruefung deckt Teamleiter-Assistenzkraefte ab (gleiches Muster wie
  // beim Vorschlags-Banner).
  const betroffen = (shifts ?? []).filter(
    (s) =>
      s.userId === currentUser?.id &&
      korrigierteIds.has(s.id) &&
      // Nur VERGANGENE Dienste: ein künftiger, geänderter Dienst fällt auf
      // "Vorschlag" zurück und erscheint im Vorschlags-Banner darunter.
      new Date(s.endTime).getTime() < Date.now(),
  );
  if (betroffen.length === 0) return null;

  const earliest = betroffen.map((s) => s.startTime).sort()[0]!;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[#e2c88a] bg-[#fdf7e8] px-4 py-3 text-[#7a5406] sm:flex-row sm:items-center sm:justify-between"
      data-testid="dashboard-corrected-shifts-banner"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#b5790a]" />
        <span className="text-sm font-medium">
          {betroffen.length === 1
            ? "Der Arbeitgeber hat 1 deiner Arbeitszeiten nachträglich geändert. Sie gilt bereits — du kannst eine abweichende Zeit melden."
            : `Der Arbeitgeber hat ${betroffen.length} deiner Arbeitszeiten nachträglich geändert. Sie gelten bereits — du kannst abweichende Zeiten melden.`}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 self-start border-[#e2c88a] bg-white text-[#7a5406] hover:bg-[#fdf3dc] sm:self-auto"
        data-testid="dashboard-corrected-shifts-review"
        onClick={() =>
          navigate(`/dienstplan?date=${format(new Date(earliest), "yyyy-MM-dd")}&fokus=korrekturen`)
        }
      >
        {betroffen.length === 1 ? "Korrektur anzeigen" : "Korrekturen anzeigen"}
      </Button>
    </div>
  );
}

export default function Dashboard() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  const { selectedTeamId, isTeamScopeReady } = useTeam();
  const { currentUser } = useAuth();
  const isAdmin = isAdminRole(currentUser?.role);
  // Muss mit der Zugriffsbedingung fuer die Route /team-verwaltung in App.tsx
  // uebereinstimmen, sonst fuehrt die Kachel Nutzer ohne Zugriff auf eine
  // 404-Seite.
  const canAccessTeamVerwaltung =
    isAdmin || !!currentUser?.isTeamleiter || hasTeamAccessLevel(currentUser, "stufe1");

  // enabled: isTeamScopeReady — verhindert den Doppel-Request beim ersten
  // Öffnen (erst ohne, gleich darauf mit teamId), sobald der TeamProvider das
  // erste Team automatisch ausgewählt hat. Solange der Scope nicht settled
  // ist, zeigen wir weiter die Lade-Skelette (isLoading unten).
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary(
    { month, year, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) },
    { query: { enabled: isTeamScopeReady } } as Parameters<typeof useGetDashboardSummary>[1],
  ) as { data?: DashboardSummary; isLoading: boolean };
  const isLoading = !isTeamScopeReady || summaryLoading;

  // Konto-Schalter „Zeiterfassung": bei AUS verschwinden alle Querverweise
  // (KPI-Kachel, offene-Einträge-Warnung, Nachbestätigungs-Hinweis).
  const { enabled: timeTrackingEnabled } = useTimeTrackingEnabled();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {!isAdmin && <CorrectedShiftsBanner />}
      {!isAdmin && <PendingShiftProposalsBanner />}
      {isAdmin && <PendingDeviationsBanner />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Dashboard</h2>
          <p className="text-muted-foreground mt-1">Übersicht für {format(now, 'MMMM yyyy', { locale: de })}</p>
        </div>
        <TeamSwitcher />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {canAccessTeamVerwaltung && (
              <KpiCard
                title="Aktive Assistenzkräfte"
                to="/team-verwaltung"
                testId="kpi-active-assistants"
              >
                <div className="text-3xl font-bold">{summary.totalAssistants}</div>
              </KpiCard>
            )}
            <KpiCard
              title="Schichten Heute"
              to={`/dienstplan?date=${format(now, "yyyy-MM-dd")}`}
              testId="kpi-shifts-today"
            >
              <div className="text-3xl font-bold">{summary.activeShiftsToday}</div>
            </KpiCard>
            {/* Konto-Schalter „Zeiterfassung aktivieren" (Standard AUS):
                Bei AUS entfällt die Kachel „Offene Zeiteinträge" und statt der
                Ist/Soll-Bilanz werden die geplanten FIX-Stunden gezeigt. */}
            {summary.timeTrackingEnabled ? (
              <>
                <KpiCard
                  title="Offene Zeiteintraege"
                  to="/zeiterfassung?status=pending"
                  testId="kpi-pending-time-entries"
                >
                  <div className="text-3xl font-bold">{summary.pendingTimeEntries}</div>
                </KpiCard>
                <KpiCard
                  title="Stundenbilanz Monat"
                  to="/auswertungen"
                  testId="kpi-hours-balance"
                >
                  <div className="text-3xl font-bold">
                    {summary.monthlyActualHours} <span className="text-lg text-muted-foreground font-normal">/ {summary.monthlyPlannedHours} h</span>
                  </div>
                </KpiCard>
              </>
            ) : (
              <KpiCard
                title="Geplante Stunden (Monat)"
                to="/auswertungen"
                testId="kpi-planned-hours"
              >
                <div className="text-3xl font-bold">
                  {summary.monthlyPlannedHours} <span className="text-lg text-muted-foreground font-normal">h</span>
                </div>
              </KpiCard>
            )}
          </div>

          {canAccessTeamVerwaltung && <PendingAbsenceRequestsReminder />}

          {isAdmin && hasAccess(currentUser, "advancedAnalytics") && (
            <MonthClosingReminder teamId={selectedTeamId} />
          )}

          {/* Krankmeldungs-Kachel ist Premium (Arbeitsanweisung 06.08.2026,
              Punkt 2.1) — Free-Konten sehen sie nicht. */}
          {hasAccess(currentUser, "advancedAnalytics") && <AbsenceReminder />}

          {/* Stundenbilanz-Kachel (Punkt 2.2, Premium): genehmigt/verbraucht/
              verbleibend + Jahressaldo, Warnhinweis ab >1,5 angesparten
              Monatsbudgets. Nur für Admins — die Bilanz ist Bedarfsseite. */}
          {isAdmin && hasAccess(currentUser, "advancedAnalytics") && (
            <HourBudgetDashboardCard teamId={selectedTeamId} />
          )}

          {!isAdmin && (
            <>
              {currentUser && <KrankmeldungSection />}
              <MeineStundenKarte />
              <AssistantVacationCard />
            </>
          )}

          {timeTrackingEnabled && (summary.uncountedPendingHours ?? 0) > 0 && (
            <UncountedPendingNotice
              hours={summary.uncountedPendingHours ?? 0}
              count={summary.uncountedPendingEntries ?? 0}
              isAdmin={isAdmin}
            />
          )}

          {summary.warnings && (
            <WarningsSection
              warnings={summary.warnings}
              timeTrackingEnabled={timeTrackingEnabled}
            />
          )}
        </>
      ) : (
        <div className="p-8 text-center border rounded-xl bg-card">
          <p className="text-muted-foreground">Keine Daten verfuegbar.</p>
        </div>
      )}
    </div>
  );
}
