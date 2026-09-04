import { useState, useEffect, useRef } from "react";
import {
  useGetAllowanceSettings,
  useUpdateAllowanceSettings,
  useDeleteAllowanceSettingsOverride,
  getGetAllowanceSettingsQueryKey,
  getGetTimeTrackingStatusQueryKey,
  type AllowanceSettings,
  type AllowanceSettingsInputState,
  type AllowanceSettingsInputBillingMethod,
  type AllowanceSettingsInputVacationMethod,
  type AllowanceSettingsInputVertretungCompensationMode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { readableApiError } from "@/lib/api-error";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { hasAccess } from "@/lib/entitlements";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { Lock } from "lucide-react";

type FormState = {
  nightPercent: string;
  nightStart: string;
  nightEnd: string;
  sundayPercent: string;
  holidayPercent: string;
  state: string;
  billingMethod: string;
  autoApproveTimesheets: boolean;
  timeTrackingEnabled: boolean;
  vacationMethod: string;
  vacationFactor: string;
  fulltimeWorkdaysPerWeek: string;
  fulltimeWeeklyHours: string;
  defaultVacationDays: string;
  vacationForecastEnabled: boolean;
  ersatzruhetagEnabled: boolean;
  teamMeetingEnabled: boolean;
  teamMeetingHours: string;
  pauseAutoEnabled: boolean;
  pauseThreshold1Hours: string;
  pauseMinutes1: string;
  pauseThreshold2Hours: string;
  pauseMinutes2: string;
  deductPausesEnabled: boolean;
  vertretungEnabled: boolean;
  vertretungCompensationMode: string;
  vertretungCompensationValue: string;
};

// Sonderwert für "erbt" (Abrechnungsart nicht auf dieser Ebene gesetzt).
const INHERIT_BILLING = "inherit";

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// "" steht für "kein Bundesland" (nur bundesweite Feiertage).
const NO_STATE = "none";

// Sonderwert des Bereichs-Wählers: Konto-weite Einstellungen (kein Team-Override).
const ACCOUNT_SCOPE = "account";

// Premium-Hinweis unter gesperrten Schaltern (Free-Tarif): nach dem Muster der
// bestehenden Free-Limits — sichtbar, aber gesperrt, mit direktem Upgrade-Weg.
// Bereits aktive Einstellungen bleiben wirksam (Bestandsschutz), gesperrt ist
// nur das Ändern; der Server lehnt Wert-Änderungen im Free-Tarif zusätzlich ab.
function PremiumSwitchHint() {
  return (
    <p
      className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="premium-switch-hint"
    >
      <span>Nur mit Premium änderbar — die aktuelle Einstellung bleibt wirksam.</span>
      <PlanUpgradeLink className="text-xs" />
    </p>
  );
}

const GERMAN_STATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "BW", label: "Baden-Württemberg" },
  { value: "BY", label: "Bayern" },
  { value: "BE", label: "Berlin" },
  { value: "BB", label: "Brandenburg" },
  { value: "HB", label: "Bremen" },
  { value: "HH", label: "Hamburg" },
  { value: "HE", label: "Hessen" },
  { value: "MV", label: "Mecklenburg-Vorpommern" },
  { value: "NI", label: "Niedersachsen" },
  { value: "NW", label: "Nordrhein-Westfalen" },
  { value: "RP", label: "Rheinland-Pfalz" },
  { value: "SL", label: "Saarland" },
  { value: "SN", label: "Sachsen" },
  { value: "ST", label: "Sachsen-Anhalt" },
  { value: "SH", label: "Schleswig-Holstein" },
  { value: "TH", label: "Thüringen" },
];

function PercentField({
  id,
  label,
  value,
  error,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={error ? "border-destructive pr-8" : "pr-8"}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          %
        </span>
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function AllowanceSettingsForm() {
  const queryClient = useQueryClient();
  const { teams, isDienstleister, isTeamScopeReady } = useTeam();
  const { currentUser } = useAuth();
  // Free-Tarif: Die drei Schalter Zeiterfassung/Pausen sind sichtbar, aber
  // gesperrt (Premium-Feature "timeTrackingSettings"). Der Server lehnt
  // Wert-Aenderungen zusaetzlich ab — das hier ist reine UX.
  const switchesLocked = !hasAccess(currentUser, "timeTrackingSettings");

  // Bereich: Konto-Standard oder ein bestimmtes Team (nur Dienstleister mit Teams).
  const [scope, setScope] = useState<string>(ACCOUNT_SCOPE);
  const showTeamPicker = isDienstleister && teams.length > 0;
  const scopeTeamId = scope === ACCOUNT_SCOPE ? undefined : Number(scope);

  const queryParams = scopeTeamId !== undefined ? { teamId: scopeTeamId } : undefined;
  // Erst laden/anzeigen, wenn der Team-Scope settled ist: Vorher ist unklar,
  // ob der "Gilt für"-Bereichswähler überhaupt existiert — ein Speichern in
  // diesem Fenster schriebe in einen Bereich, den der Nutzer so nie gesehen
  // hat (gleiches Muster wie die Logo-Karte, Task #618).
  // Dual-Cast (Optionen + Ergebnis), sonst inferiert `data` zu `{}` (Orval).
  const {
    data: settings,
    isLoading: settingsLoading,
    isFetching: settingsFetching,
  } = useGetAllowanceSettings(queryParams, {
    query: {
      enabled: isTeamScopeReady,
      staleTime: 0,
      refetchOnMount: "always",
    },
  } as Parameters<typeof useGetAllowanceSettings>[1]) as {
    data?: AllowanceSettings;
    isLoading: boolean;
    isFetching: boolean;
  };
  const isLoading = !isTeamScopeReady || settingsLoading;
  const updateSettings = useUpdateAllowanceSettings();
  const deleteOverride = useDeleteAllowanceSettingsOverride();

  const [form, setForm] = useState<FormState>({
    nightPercent: "25",
    nightStart: "23:00",
    nightEnd: "06:00",
    sundayPercent: "50",
    holidayPercent: "100",
    state: NO_STATE,
    billingMethod: INHERIT_BILLING,
    autoApproveTimesheets: false,
    timeTrackingEnabled: false,
    vacationMethod: "bwavg",
    vacationFactor: "0.0941",
    fulltimeWorkdaysPerWeek: "5",
    fulltimeWeeklyHours: "39",
    defaultVacationDays: "30",
    vacationForecastEnabled: true,
    ersatzruhetagEnabled: true,
    teamMeetingEnabled: false,
    teamMeetingHours: "1",
    pauseAutoEnabled: false,
    pauseThreshold1Hours: "6",
    pauseMinutes1: "30",
    pauseThreshold2Hours: "9",
    pauseMinutes2: "45",
    deductPausesEnabled: false,
    vertretungEnabled: false,
    vertretungCompensationMode: "none",
    vertretungCompensationValue: "0",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Bestätigungs-Dialog vor dem AKTIVIEREN der Zeiterfassung (Ausschalten ohne Dialog).
  const [confirmTimeTracking, setConfirmTimeTracking] = useState(false);
  // Pro Bereich nur einmal mit den geladenen Werten befüllen, damit ein Refetch
  // (z.B. bei Fensterfokus) keine ungespeicherten Eingaben überschreibt. Ein
  // Bereichswechsel lädt bewusst neu.
  const hydratedScopeRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (
      settings &&
      !settingsFetching &&
      (hydratedScopeRef.current !== scope || !isDirtyRef.current)
    ) {
      hydratedScopeRef.current = scope;
      setForm({
        nightPercent: String(settings.nightPercent),
        nightStart: settings.nightStart,
        nightEnd: settings.nightEnd,
        sundayPercent: String(settings.sundayPercent),
        holidayPercent: String(settings.holidayPercent),
        state: settings.state ?? NO_STATE,
        billingMethod: settings.billingMethod ?? INHERIT_BILLING,
        autoApproveTimesheets: settings.autoApproveTimesheets ?? false,
        timeTrackingEnabled: settings.timeTrackingEnabled ?? false,
        vacationMethod: settings.vacationMethod ?? "bwavg",
        vacationFactor: String(settings.vacationFactor ?? 0.0941),
        fulltimeWorkdaysPerWeek: String(settings.fulltimeWorkdaysPerWeek ?? 5),
        fulltimeWeeklyHours: String(settings.fulltimeWeeklyHours ?? 39),
        defaultVacationDays: String(settings.defaultVacationDays ?? 30),
        vacationForecastEnabled: settings.vacationForecastEnabled ?? true,
        ersatzruhetagEnabled: settings.ersatzruhetagEnabled ?? true,
        teamMeetingEnabled: settings.teamMeetingEnabled ?? false,
        teamMeetingHours: String(settings.teamMeetingHours ?? 1),
        pauseAutoEnabled: settings.pauseAutoEnabled ?? false,
        pauseThreshold1Hours: String(settings.pauseThreshold1Hours ?? 6),
        pauseMinutes1: String(settings.pauseMinutes1 ?? 30),
        pauseThreshold2Hours: String(settings.pauseThreshold2Hours ?? 9),
        pauseMinutes2: String(settings.pauseMinutes2 ?? 45),
        deductPausesEnabled: settings.deductPausesEnabled ?? false,
        vertretungEnabled: settings.vertretungEnabled ?? false,
        vertretungCompensationMode: settings.vertretungCompensationMode ?? "none",
        vertretungCompensationValue: String(settings.vertretungCompensationValue ?? 0),
      });
      setErrors({});
      setSaved(false);
    }
  }, [settings, settingsFetching, scope]);

  function changeScope(next: string) {
    setScope(next);
    hydratedScopeRef.current = null;
    isDirtyRef.current = false;
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    isDirtyRef.current = true;
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setSaved(false);
  }

  function validatePercent(value: string): string | undefined {
    const n = Number(value);
    if (value === "" || Number.isNaN(n)) return "Bitte Zahl eingeben";
    if (n < 0 || n > 100) return "Wert zwischen 0 und 100";
    return undefined;
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    errs.nightPercent = validatePercent(form.nightPercent);
    errs.sundayPercent = validatePercent(form.sundayPercent);
    errs.holidayPercent = validatePercent(form.holidayPercent);
    if (!TIME_PATTERN.test(form.nightStart)) errs.nightStart = "Ungültige Uhrzeit";
    if (!TIME_PATTERN.test(form.nightEnd)) errs.nightEnd = "Ungültige Uhrzeit";
    // Nur pruefen, was auch sichtbar ist: bei ausgeschalteten Vertretungen
    // ist das Feld ausgeblendet, ein Fehler daran waere nicht behebbar.
    if (form.vertretungEnabled && form.vertretungCompensationMode !== "none") {
      const vcv = Number(form.vertretungCompensationValue);
      if (form.vertretungCompensationValue === "" || Number.isNaN(vcv) || vcv < 0) {
        errs.vertretungCompensationValue = "Mindestens 0";
      }
    }
    if (scopeTeamId === undefined) {
      if (form.vacationMethod === "factor") {
        const vf = Number(form.vacationFactor);
        if (form.vacationFactor === "" || Number.isNaN(vf) || vf < 0)
          errs.vacationFactor = "Mindestens 0";
      }
      const fwd = Number(form.fulltimeWorkdaysPerWeek);
      if (form.fulltimeWorkdaysPerWeek === "" || Number.isNaN(fwd) || fwd < 1 || fwd > 7)
        errs.fulltimeWorkdaysPerWeek = "Zahl zwischen 1 und 7";
      const fwh = Number(form.fulltimeWeeklyHours);
      if (form.fulltimeWeeklyHours === "" || Number.isNaN(fwh) || fwh < 1 || fwh > 60)
        errs.fulltimeWeeklyHours = "Zahl zwischen 1 und 60";
      const dvd = Number(form.defaultVacationDays);
      if (form.defaultVacationDays === "" || Number.isNaN(dvd) || dvd < 0 || dvd > 365)
        errs.defaultVacationDays = "Zahl zwischen 0 und 365";
      const tmh = Number(form.teamMeetingHours);
      if (form.teamMeetingHours === "" || Number.isNaN(tmh) || tmh < 0.1)
        errs.teamMeetingHours = "Mindestens 0,1";
      if (form.pauseAutoEnabled) {
        const validateThreshold = (v: string): string | undefined => {
          const n = Number(v);
          if (v === "" || Number.isNaN(n) || n < 0.1) return "Mindestens 0,1";
          return undefined;
        };
        const validateMinutes = (v: string): string | undefined => {
          const n = Number(v);
          if (v === "" || Number.isNaN(n) || n < 0 || n > 1440) return "0 bis 1440";
          return undefined;
        };
        errs.pauseThreshold1Hours = validateThreshold(form.pauseThreshold1Hours);
        errs.pauseThreshold2Hours = validateThreshold(form.pauseThreshold2Hours);
        errs.pauseMinutes1 = validateMinutes(form.pauseMinutes1);
        errs.pauseMinutes2 = validateMinutes(form.pauseMinutes2);
      }
    }
    const cleaned = Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
    setErrors(cleaned);
    return Object.keys(cleaned).length === 0;
  }

  async function invalidateAll() {
    // Prefix-Match: trifft die Konto-Abfrage UND alle Team-Abfragen.
    await queryClient.invalidateQueries({ queryKey: getGetAllowanceSettingsQueryKey() });
    // Urlaubsbilanz und Sammelbilanz hängen u. a. am Prognose-Schalter und an
    // den Vollzeit-/Urlaubswerten. Beide generierten Query-Keys enthalten
    // "vacation-balance" (Singular oder Plural).
    await queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === "string" && queryKey[0].includes("vacation-balance"),
    });
    // Zeiterfassungs-Schalter wirkt sofort auf Menüpunkt/Seite/Dashboard
    // (ohne Neuladen): effektiven Status neu laden.
    await queryClient.invalidateQueries({ queryKey: getGetTimeTrackingStatusQueryKey() });
  }

  async function handleSave(overrides: Partial<FormState> = {}) {
    if (!validate()) return;
    const f = { ...form, ...overrides };
    setSaving(true);
    try {
      await updateSettings.mutateAsync({
        data: {
          nightPercent: Number(f.nightPercent),
          nightStart: f.nightStart,
          nightEnd: f.nightEnd,
          sundayPercent: Number(f.sundayPercent),
          holidayPercent: Number(f.holidayPercent),
          state: (f.state === NO_STATE ? null : f.state) as AllowanceSettingsInputState,
          billingMethod: (f.billingMethod === INHERIT_BILLING
            ? null
            : f.billingMethod) as AllowanceSettingsInputBillingMethod,
          vertretungEnabled: f.vertretungEnabled,
          vertretungCompensationMode:
            f.vertretungCompensationMode as AllowanceSettingsInputVertretungCompensationMode,
          vertretungCompensationValue: Number(f.vertretungCompensationValue),
          // Konto-weite Regeln (Auto-Genehmigung, Zeiterfassung, Urlaubsberechnung)
          // gelten global und werden nur im Konto-Bereich mitgesendet, nicht bei
          // Team-Overrides.
          ...(scopeTeamId === undefined
            ? {
                autoApproveTimesheets: f.autoApproveTimesheets,
                timeTrackingEnabled: f.timeTrackingEnabled,
                vacationMethod: f.vacationMethod as AllowanceSettingsInputVacationMethod,
                vacationFactor: Number(f.vacationFactor),
                fulltimeWorkdaysPerWeek: Number(f.fulltimeWorkdaysPerWeek),
                fulltimeWeeklyHours: Number(f.fulltimeWeeklyHours),
                defaultVacationDays: Number(f.defaultVacationDays),
                vacationForecastEnabled: f.vacationForecastEnabled,
                ersatzruhetagEnabled: f.ersatzruhetagEnabled,
                teamMeetingEnabled: f.teamMeetingEnabled,
                teamMeetingHours: Number(f.teamMeetingHours),
                pauseAutoEnabled: f.pauseAutoEnabled,
                pauseThreshold1Hours: Number(f.pauseThreshold1Hours),
                pauseMinutes1: Number(f.pauseMinutes1),
                pauseThreshold2Hours: Number(f.pauseThreshold2Hours),
                pauseMinutes2: Number(f.pauseMinutes2),
                deductPausesEnabled: f.deductPausesEnabled,
              }
            : {}),
        },
        params: queryParams,
      });
      isDirtyRef.current = false;
      await invalidateAll();
      setSaved(true);
    } catch (err) {
      setErrors({ holidayPercent: readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen.") });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Zeiterfassungs-Schalter: Einschalten nur nach Bestätigungs-Dialog,
   * Ausschalten sofort. Gespeichert wird direkt (nicht erst über „Speichern"),
   * damit der Konto-Schalter nie in einem ungespeicherten Zwischenzustand hängt.
   */
  function onTimeTrackingToggle(next: boolean) {
    if (next) {
      setConfirmTimeTracking(true);
      return;
    }
    set("timeTrackingEnabled", false);
    void handleSave({ timeTrackingEnabled: false });
  }

  function confirmEnableTimeTracking() {
    setConfirmTimeTracking(false);
    set("timeTrackingEnabled", true);
    void handleSave({ timeTrackingEnabled: true });
  }

  async function handleRemoveOverride() {
    if (scopeTeamId === undefined) return;
    setSaving(true);
    try {
      await deleteOverride.mutateAsync({ params: { teamId: scopeTeamId } });
      hydratedScopeRef.current = null;
      await invalidateAll();
      setSaved(false);
    } catch (err) {
      setErrors({ holidayPercent: readableApiError(err, "Entfernen fehlgeschlagen. Bitte erneut versuchen.") });
    } finally {
      setSaving(false);
    }
  }

  const isTeamScope = scopeTeamId !== undefined;
  const hasOverride = isTeamScope && settings?.isOverride === true;

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader>
        {/* Kay-Rueckmeldung 03.09.2026: Der Vertretungs-Schalter war unter dem
            Titel „Zuschlaege" nicht zu finden — niemand sucht Vertretungen
            unter Zuschlaegen. Der Titel nennt jetzt beides. */}
        <CardTitle className="font-serif text-xl">Vertretungen und Zuschläge</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {showTeamPicker && (
            <div className="space-y-1.5">
              <Label htmlFor="allowance-scope">Gilt für</Label>
              <Select value={scope} onValueChange={changeScope}>
                <SelectTrigger id="allowance-scope" data-testid="allowance-scope-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ACCOUNT_SCOPE}>Konto-Standard (alle Teams)</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      Team: {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isTeamScope && (
                <p className="text-xs text-muted-foreground" data-testid="allowance-scope-hint">
                  {hasOverride
                    ? "Für dieses Team gilt eine eigene Regelung. Sie überschreibt den Konto-Standard."
                    : "Dieses Team nutzt aktuell den Konto-Standard. Speichern legt eine eigene Regelung für dieses Team an."}
                </p>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              {/* Kay-Rueckmeldung 03.09.2026: „Ich kann die Funktion in den
                  Einstellungen nicht finden." Sie stand ganz unten in einer
                  langen Karte namens „Zuschlaege" — hinter Nacht-, Sonntags-
                  und Feiertagszuschlag, Bundesland und Abrechnungsart. Wer
                  nach „Vertretung" sucht, scrollt so weit nicht.
                  Jetzt steht der Block GANZ OBEN mit eigener Ueberschrift und
                  eigenem Sprungziel (#vertretungen). */}
              <div id="vertretungen" className="scroll-mt-4">
                <h3 className="text-sm font-semibold mb-3">Vertretungen</h3>
                <div className="space-y-4">
              {/* Kay-Entscheidung 30.08.2026: Ob ueberhaupt mit Vertretungen
                  geplant wird, ist eine Grundsatzentscheidung des Teams — sie
                  gehoert einmal hierher, nicht in jeden einzelnen
                  Schicht-Dialog. Im Drei-Schicht-Modell hat das Feld dort nur
                  den Dialog aufgeblaeht und wurde uebersehen. */}
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="vertretungEnabled" className="text-sm font-semibold">
                      Mit Vertretungen planen
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Zu jedem Dienst lässt sich eine Person hinterlegen, die bei Ausfall
                      einspringt. Eingeschaltet erscheint das Feld „Vertretung vormerken" im
                      Schicht-Dialog, im Monatsraster kommt unter jedem besetzten Dienst eine
                      flache Vertretungszeile dazu, und die automatische Planung merkt die
                      Vertretungen gleich mit vor. Ausgeschaltet bleibt alles schlank. Bereits
                      vorgemerkte Vertretungen bleiben in jedem Fall erhalten und lassen sich
                      weiter ändern.
                    </p>
                  </div>
                  <Switch
                    id="vertretungEnabled"
                    data-testid="allowance-vertretung-enabled-switch"
                    checked={form.vertretungEnabled}
                    onCheckedChange={(v) => set("vertretungEnabled", v)}
                  />
                </div>
              </div>

              {/* Die Verguetung ist eine Folgefrage — ohne Vertretungen gibt es
                  nichts zu verguetenden. Der gespeicherte Wert bleibt im
                  Formularzustand und wird beim Speichern unveraendert
                  mitgeschickt; Ausblenden verliert also nichts. */}
              {form.vertretungEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="vertretungCompensationMode">Vertretungsvergütung</Label>
                <Select
                  value={form.vertretungCompensationMode}
                  onValueChange={(v) => set("vertretungCompensationMode", v)}
                >
                  <SelectTrigger id="vertretungCompensationMode" data-testid="allowance-vertretung-compensation-mode-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine Sonderregel</SelectItem>
                    <SelectItem value="percent">Zuschlag (% des Dienst-Lohns)</SelectItem>
                    <SelectItem value="flat">Pauschale (€ pro Dienst)</SelectItem>
                  </SelectContent>
                </Select>
                {form.vertretungCompensationMode !== "none" && (
                  <div className="relative max-w-[160px]">
                    <Input
                      id="vertretungCompensationValue"
                      type="number"
                      min="0"
                      step={form.vertretungCompensationMode === "percent" ? "1" : "0.01"}
                      value={form.vertretungCompensationValue}
                      onChange={(e) => set("vertretungCompensationValue", e.target.value)}
                      className={errors.vertretungCompensationValue ? "border-destructive pr-8" : "pr-8"}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                      {form.vertretungCompensationMode === "percent" ? "%" : "€"}
                    </span>
                  </div>
                )}
                {errors.vertretungCompensationValue && (
                  <p className="text-xs text-destructive">{errors.vertretungCompensationValue}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Gilt für Dienste, die als Vertretung eingesetzt wurden. Die Vergütung kommt
                  ZUSÄTZLICH zum normalen Lohn — wer kurzfristig einspringt, verdient nicht
                  weniger, sondern bekommt einen Aufschlag. "Zuschlag" rechnet einen Prozentsatz
                  des für diesen Dienst verdienten Lohns obendrauf, "Pauschale" einen festen
                  Betrag. "Keine Sonderregel" = regulärer Lohn wie jeder andere Dienst.
                </p>
              </div>
              )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Nachtzuschlag</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <PercentField
                    id="nightPercent"
                    label="Zuschlag"
                    value={form.nightPercent}
                    error={errors.nightPercent}
                    onChange={(v) => set("nightPercent", v)}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="nightStart">Von</Label>
                    <Input
                      id="nightStart"
                      type="time"
                      value={form.nightStart}
                      onChange={(e) => set("nightStart", e.target.value)}
                      className={errors.nightStart ? "border-destructive" : ""}
                    />
                    {errors.nightStart && <p className="text-xs text-destructive">{errors.nightStart}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nightEnd">Bis</Label>
                    <Input
                      id="nightEnd"
                      type="time"
                      value={form.nightEnd}
                      onChange={(e) => set("nightEnd", e.target.value)}
                      className={errors.nightEnd ? "border-destructive" : ""}
                    />
                    {errors.nightEnd && <p className="text-xs text-destructive">{errors.nightEnd}</p>}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Zeitfenster, in dem der Nachtzuschlag gilt (über Mitternacht hinweg möglich).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PercentField
                  id="sundayPercent"
                  label="Sonntagszuschlag"
                  value={form.sundayPercent}
                  error={errors.sundayPercent}
                  onChange={(v) => set("sundayPercent", v)}
                />
                <PercentField
                  id="holidayPercent"
                  label="Feiertagszuschlag"
                  value={form.holidayPercent}
                  error={errors.holidayPercent}
                  onChange={(v) => set("holidayPercent", v)}
                />
              </div>

              {/* Hinweis SV-Pflicht bei Abwesenheits-Zuschlägen */}
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
                <p className="font-medium mb-1">Zuschläge auf Urlaubs- und Kranktage</p>
                <p className="text-blue-800 dark:text-blue-300">
                  Fällt ein ganztägiger Urlaubs- oder Kranktag auf einen Sonntag oder Feiertag,
                  werden die oben konfigurierten Zuschlagssätze auf die vertraglichen Tagesstunden
                  angerechnet (§&nbsp;11 BUrlG, §&nbsp;2 EFZG). Diese Zuschläge sind{" "}
                  <strong>sozialversicherungs- und lohnsteuerpflichtig</strong> – im Gegensatz zu
                  Zuschlägen auf geleistete Arbeit, die nach §&nbsp;3b&nbsp;EStG steuerfrei sein
                  können.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="state">Bundesland</Label>
                <Select value={form.state} onValueChange={(v) => set("state", v)}>
                  <SelectTrigger id="state">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STATE}>Kein Bundesland (nur bundesweit)</SelectItem>
                    {GERMAN_STATE_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Bestimmt, welche regionalen gesetzlichen Feiertage (z.B. Fronleichnam) für den
                  Feiertagszuschlag berücksichtigt werden. Ohne Auswahl gelten nur die bundesweiten
                  Feiertage. Die Änderung wirkt sich auf neu gespeicherte Schichten aus.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="billingMethod">Abrechnungsart</Label>
                <Select value={form.billingMethod} onValueChange={(v) => set("billingMethod", v)}>
                  <SelectTrigger id="billingMethod" data-testid="allowance-billing-method-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_BILLING}>
                      {isTeamScope
                        ? "Konto-Standard übernehmen"
                        : "Standard (Soll-Stunden)"}
                    </SelectItem>
                    <SelectItem value="SOLL">Soll – nach geplanten Schichten</SelectItem>
                    <SelectItem value="IST">Ist – nach erfassten Zeiten</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Bestimmt, ob Stunden und Zuschläge in Auswertungen und Stundennachweis aus den
                  geplanten Schichten (Soll) oder aus den tatsächlich erfassten Zeiten (Ist)
                  berechnet werden. Eine Einstellung pro Assistenzkraft (Personalakte) hat Vorrang
                  vor dieser {isTeamScope ? "Team-" : "Konto-"}Regelung.
                </p>
              </div>

              {!isTeamScope && (
                <>
                  <div className="border-t border-border/60 pt-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label htmlFor="autoApproveTimesheets" className="text-sm font-semibold">
                          Stundenzettel automatisch genehmigen
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Eingereichte Zeiteinträge werden ohne manuelle Prüfung sofort bestätigt und
                          in die Auswertung übernommen.
                        </p>
                      </div>
                      <Switch
                        id="autoApproveTimesheets"
                        data-testid="allowance-auto-approve-switch"
                        checked={form.autoApproveTimesheets}
                        onCheckedChange={(v) => set("autoApproveTimesheets", v)}
                      />
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="timeTrackingEnabled"
                          className="text-sm font-semibold flex items-center gap-1.5"
                        >
                          Zeiterfassung aktivieren
                          {switchesLocked && (
                            <Lock
                              className="h-3.5 w-3.5 text-muted-foreground"
                              data-testid="lock-time-tracking"
                              aria-label="Premium-Feature"
                            />
                          )}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Erlaubt das Erfassen und Bearbeiten von Ist-Zeiten (Stundenzettel) für
                          alle Teams dieses Kontos. Solange ausgeschaltet, können keine neuen
                          Zeiteinträge angelegt oder bestätigt werden; bestehende Einträge bleiben
                          sichtbar. Die Änderung wird sofort gespeichert.
                        </p>
                        {switchesLocked && <PremiumSwitchHint />}
                      </div>
                      <Switch
                        id="timeTrackingEnabled"
                        data-testid="allowance-time-tracking-switch"
                        checked={form.timeTrackingEnabled}
                        disabled={saving || switchesLocked}
                        onCheckedChange={onTimeTrackingToggle}
                      />
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label htmlFor="ersatzruhetagEnabled" className="text-sm font-semibold">
                          Ersatzruhetag-Konto für Feiertage
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Wer an einem gesetzlichen Feiertag arbeitet, erhält nach § 11 Abs. 3 ArbZG
                          einen Ausgleichs-Ruhetag gutgeschrieben. Nur Feiertage an Werktagen (Mo–Sa)
                          zählen — fällt ein Feiertag auf einen Sonntag, entstehen nur Zuschläge, aber
                          kein zusätzlicher Ausgleichstag. Ausschalten, wenn kein Ausgleichskonto
                          geführt werden soll.
                        </p>
                      </div>
                      <Switch
                        id="ersatzruhetagEnabled"
                        data-testid="allowance-ersatzruhetag-switch"
                        checked={form.ersatzruhetagEnabled}
                        onCheckedChange={(v) => set("ersatzruhetagEnabled", v)}
                      />
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label htmlFor="teamMeetingEnabled" className="text-sm font-semibold">
                          Team-Dienst (Teamsitzung)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Erlaubt das Anlegen von Team-Einträgen im Dienstplan. Ein Team-Eintrag
                          pro Tag schreibt allen Assistenzkräften des Teams die eingestellte
                          Stundenzahl als Arbeitszeit gut (gilt für alle Teams dieses Kontos).
                        </p>
                      </div>
                      <Switch
                        id="teamMeetingEnabled"
                        data-testid="allowance-team-meeting-switch"
                        checked={form.teamMeetingEnabled}
                        onCheckedChange={(v) => set("teamMeetingEnabled", v)}
                      />
                    </div>
                    {form.teamMeetingEnabled && (
                      <div className="space-y-1.5">
                        <Label htmlFor="teamMeetingHours">Stunden-Gutschrift pro Teamsitzung</Label>
                        <Input
                          id="teamMeetingHours"
                          data-testid="allowance-team-meeting-hours"
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={form.teamMeetingHours}
                          onChange={(e) => set("teamMeetingHours", e.target.value)}
                          className={errors.teamMeetingHours ? "border-destructive" : ""}
                        />
                        {errors.teamMeetingHours && (
                          <p className="text-xs text-destructive">{errors.teamMeetingHours}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Diese Stundenzahl wird jeder Assistenzkraft des Teams je Team-Eintrag
                          gutgeschrieben und mit dem Stundenlohn vergütet.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border/60 pt-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="pauseAutoEnabled"
                          className="text-sm font-semibold flex items-center gap-1.5"
                        >
                          Pausen automatisch vorbefüllen
                          {switchesLocked && (
                            <Lock
                              className="h-3.5 w-3.5 text-muted-foreground"
                              data-testid="lock-pause-auto"
                              aria-label="Premium-Feature"
                            />
                          )}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Befüllt beim Anlegen neuer Dienste die unbezahlte Pause automatisch
                          anhand der Dienstdauer (Staffel unten). Der Wert bleibt pro Dienst
                          überschreibbar; bestehende Dienste werden nicht verändert.
                        </p>
                        {switchesLocked && <PremiumSwitchHint />}
                      </div>
                      <Switch
                        id="pauseAutoEnabled"
                        data-testid="allowance-pause-auto-switch"
                        checked={form.pauseAutoEnabled}
                        disabled={switchesLocked}
                        onCheckedChange={(v) => set("pauseAutoEnabled", v)}
                      />
                    </div>
                    {form.pauseAutoEnabled && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="pauseThreshold1Hours">Ab Dienstdauer (Std.)</Label>
                            <Input
                              id="pauseThreshold1Hours"
                              type="number"
                              min="0.1"
                              step="0.5"
                              data-testid="allowance-pause-threshold1"
                              value={form.pauseThreshold1Hours}
                              onChange={(e) => set("pauseThreshold1Hours", e.target.value)}
                              className={errors.pauseThreshold1Hours ? "border-destructive" : ""}
                            />
                            {errors.pauseThreshold1Hours && (
                              <p className="text-xs text-destructive">{errors.pauseThreshold1Hours}</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="pauseMinutes1">Pause (Min.)</Label>
                            <Input
                              id="pauseMinutes1"
                              type="number"
                              min="0"
                              max="1440"
                              step="5"
                              data-testid="allowance-pause-minutes1"
                              value={form.pauseMinutes1}
                              onChange={(e) => set("pauseMinutes1", e.target.value)}
                              className={errors.pauseMinutes1 ? "border-destructive" : ""}
                            />
                            {errors.pauseMinutes1 && (
                              <p className="text-xs text-destructive">{errors.pauseMinutes1}</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="pauseThreshold2Hours">Ab Dienstdauer (Std.)</Label>
                            <Input
                              id="pauseThreshold2Hours"
                              type="number"
                              min="0.1"
                              step="0.5"
                              data-testid="allowance-pause-threshold2"
                              value={form.pauseThreshold2Hours}
                              onChange={(e) => set("pauseThreshold2Hours", e.target.value)}
                              className={errors.pauseThreshold2Hours ? "border-destructive" : ""}
                            />
                            {errors.pauseThreshold2Hours && (
                              <p className="text-xs text-destructive">{errors.pauseThreshold2Hours}</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="pauseMinutes2">Pause (Min.)</Label>
                            <Input
                              id="pauseMinutes2"
                              type="number"
                              min="0"
                              max="1440"
                              step="5"
                              data-testid="allowance-pause-minutes2"
                              value={form.pauseMinutes2}
                              onChange={(e) => set("pauseMinutes2", e.target.value)}
                              className={errors.pauseMinutes2 ? "border-destructive" : ""}
                            />
                            {errors.pauseMinutes2 && (
                              <p className="text-xs text-destructive">{errors.pauseMinutes2}</p>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Zweistufige Staffel: Erreicht die Dienstdauer eine Schwelle, wird die
                          zugehörige Pause vorbefüllt — die höhere erreichte Stufe gewinnt.
                          Voreinstellung = gesetzliche Staffel (§ 4 ArbZG): ab 6 Std. → 30 Min.,
                          ab 9 Std. → 45 Min. Gilt konto-weit für alle Teams.
                        </p>
                      </>
                    )}
                  </div>

                  <div className="border-t border-border/60 pt-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="deductPausesEnabled"
                          className="text-sm font-semibold flex items-center gap-1.5"
                        >
                          Pausen von bezahlten Stunden abziehen
                          {switchesLocked && (
                            <Lock
                              className="h-3.5 w-3.5 text-muted-foreground"
                              data-testid="lock-deduct-pauses"
                              aria-label="Premium-Feature"
                            />
                          )}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Zieht die eingetragenen unbezahlten Pausenminuten von den gewerteten
                          Stunden und dem Grundlohn der Arbeitsdienste ab — in beiden
                          Abrechnungsarten (Soll und Ist), rückwirkend schaltbar. Zuschläge
                          bleiben unverändert. Solange ausgeschaltet, sind Pausen eine reine
                          Info-Kennzahl (bisheriges Verhalten). Gilt konto-weit für alle Teams.
                        </p>
                        {switchesLocked && <PremiumSwitchHint />}
                      </div>
                      <Switch
                        id="deductPausesEnabled"
                        data-testid="allowance-deduct-pauses-switch"
                        checked={form.deductPausesEnabled}
                        disabled={switchesLocked}
                        onCheckedChange={(v) => set("deductPausesEnabled", v)}
                      />
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-5 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold">Vollzeit entspricht</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <div className="relative">
                            <Input
                              id="fulltimeWorkdaysPerWeek"
                              data-testid="allowance-fulltime-workdays"
                              type="number"
                              min="1"
                              max="7"
                              step="0.1"
                              value={form.fulltimeWorkdaysPerWeek}
                              onChange={(e) => set("fulltimeWorkdaysPerWeek", e.target.value)}
                              className={errors.fulltimeWorkdaysPerWeek ? "border-destructive pr-32" : "pr-32"}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                              Arbeitstage/Woche
                            </span>
                          </div>
                          {errors.fulltimeWorkdaysPerWeek && (
                            <p className="text-xs text-destructive">{errors.fulltimeWorkdaysPerWeek}</p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <div className="relative">
                            <Input
                              id="fulltimeWeeklyHours"
                              data-testid="allowance-fulltime-weekly-hours"
                              type="number"
                              min="1"
                              max="60"
                              step="0.5"
                              value={form.fulltimeWeeklyHours}
                              onChange={(e) => set("fulltimeWeeklyHours", e.target.value)}
                              className={errors.fulltimeWeeklyHours ? "border-destructive pr-28" : "pr-28"}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                              Wochenstunden
                            </span>
                          </div>
                          {errors.fulltimeWeeklyHours && (
                            <p className="text-xs text-destructive">{errors.fulltimeWeeklyHours}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="defaultVacationDays">Urlaub bei Vollzeit</Label>
                      <div className="relative">
                        <Input
                          id="defaultVacationDays"
                          data-testid="allowance-default-vacation-days"
                          type="number"
                          min="0"
                          max="365"
                          value={form.defaultVacationDays}
                          onChange={(e) => set("defaultVacationDays", e.target.value)}
                          className={errors.defaultVacationDays ? "border-destructive pr-14" : "pr-14"}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                          Tage
                        </span>
                      </div>
                      {errors.defaultVacationDays && (
                        <p className="text-xs text-destructive">{errors.defaultVacationDays}</p>
                      )}
                      {(() => {
                        const fwd = Number(form.fulltimeWorkdaysPerWeek);
                        const dvd = Number(form.defaultVacationDays);
                        if (!(fwd > 0) || Number.isNaN(dvd)) return null;
                        const weeks = dvd / fwd;
                        const factor = weeks / 51.96;
                        return (
                          <p className="text-xs text-muted-foreground">
                            = {weeks.toFixed(1)} Wochen · Faktor {factor.toFixed(4)} je bezahlter Stunde
                          </p>
                        );
                      })()}
                      <p className="text-xs text-muted-foreground">
                        Vorbelegung für neue Verträge, je Person änderbar.
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
                      <div className="space-y-1">
                        <Label
                          htmlFor="vacationForecastEnabled"
                          className="text-sm font-semibold"
                        >
                          13-Wochen-Prognose anzeigen
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Schätzt den Stand zum Jahresende aus den bestätigten Arbeitszeiten der
                          letzten 13 Wochen. Die Prognose verändert den verfügbaren Urlaub nicht.
                        </p>
                      </div>
                      <Switch
                        id="vacationForecastEnabled"
                        data-testid="allowance-vacation-forecast-switch"
                        checked={form.vacationForecastEnabled}
                        onCheckedChange={(value) => set("vacationForecastEnabled", value)}
                      />
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Ein Urlaubstag zieht die Stunden des Dienstes an diesem Tag ab — ohne
                      geplanten Dienst die typische Dienstlänge, etwa 8,0 h.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Bestätigte Arbeitsstunden oberhalb des zeitanteiligen Monatssolls erhöhen
                      das Urlaubsguthaben. Der vertragliche Sockel bleibt garantiert.
                    </p>
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button onClick={() => handleSave()} disabled={saving} data-testid="allowance-save-button">
                  {saving ? "Speichern..." : "Speichern"}
                </Button>
                {hasOverride && (
                  <Button
                    variant="outline"
                    onClick={handleRemoveOverride}
                    disabled={saving}
                    data-testid="allowance-remove-override-button"
                  >
                    Team-Regelung entfernen
                  </Button>
                )}
                {saved && <span className="text-xs text-muted-foreground">Gespeichert.</span>}
              </div>
            </>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmTimeTracking} onOpenChange={setConfirmTimeTracking}>
        <AlertDialogContent data-testid="time-tracking-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Zeiterfassung aktivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Assistenzkräfte und Sie können dann Ist-Zeiten (Stundenzettel) erfassen, bearbeiten
              und bestätigen. Die Einstellung gilt konto-weit für alle Teams und wird sofort
              gespeichert. Sie können die Zeiterfassung jederzeit wieder ausschalten — bereits
              erfasste Einträge bleiben dabei erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="time-tracking-confirm-cancel">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              data-testid="time-tracking-confirm-accept"
              onClick={confirmEnableTimeTracking}
            >
              Aktivieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
