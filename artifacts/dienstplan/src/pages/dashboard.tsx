import { isAdminRole } from "@/lib/roles";
import { planFeatureMessage } from "@/lib/api-error";
import {
  useGetDashboardSummary,
  useListContracts,
  useGetVacationBalance,
  useGetMonthClosings,
} from "@workspace/api-client-react";
import type { MonthClosingStatus } from "@workspace/api-client-react";
import { hasAccess } from "@/lib/entitlements";
import type { DashboardWarnings, VacationBalance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { AlertTriangle, CalendarX, Clock, CheckCircle2, Plane, ChevronRight, Info } from "lucide-react";
import { useLocation } from "wouter";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { DienstStatus, type SchichtVorlage } from "@/types/dienstplan";
import { formatDays, formatDaysWithUnit, formatHours } from "@/lib/utils";
import { useTimeTrackingEnabled } from "@/hooks/use-time-tracking-enabled";
import { MeineStundenKarte } from "@/components/meine-stunden-karte";

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
                      onClick={() => navigate(`/assistenten?highlight=${a.userId}`)}
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
              {balance.dailyHoursSource === "bwavg"
                ? " (13-Wochen-Schnitt)"
                : balance.dailyHoursSource === "contract"
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

export default function Dashboard() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  const { selectedTeamId } = useTeam();
  const { currentUser } = useAuth();
  const isAdmin = isAdminRole(currentUser?.role);

  const { data: summary, isLoading } = useGetDashboardSummary(
    { month, year, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) }
  );

  // Konto-Schalter „Zeiterfassung": bei AUS verschwinden alle Querverweise
  // (KPI-Kachel, offene-Einträge-Warnung, Nachbestätigungs-Hinweis).
  const { enabled: timeTrackingEnabled } = useTimeTrackingEnabled();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
            <KpiCard
              title="Aktive Assistenzkräfte"
              to="/assistenten"
              testId="kpi-active-assistants"
            >
              <div className="text-3xl font-bold">{summary.totalAssistants}</div>
            </KpiCard>
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

          {isAdmin && hasAccess(currentUser, "advancedAnalytics") && (
            <MonthClosingReminder teamId={selectedTeamId} />
          )}

          {!isAdmin && (
            <>
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
