/**
 * Gemeinsamer Zustand fuer die Abrechnungs-Einstellungen.
 *
 * Die Felder verteilen sich seit dem Umbau der Einstellungsseite auf zwei
 * Gruppen ("Abrechnungsgrundlagen" und "Zuschlaege und Zeitregeln"), gehoeren
 * aber weiterhin zu EINEM Formular und EINEM Speichervorgang. Deshalb liegt der
 * Zustand hier im Context und nicht in einer der beiden Karten — sonst haetten
 * zwei Speichern-Knoepfe dieselbe Ressource ueberschrieben und jeweils die
 * ungespeicherten Werte der anderen Gruppe verworfen.
 */
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { readableApiError } from "@/lib/api-error";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { hasAccess } from "@/lib/entitlements";

export type FormState = {
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
};

/** Sonderwert fuer "erbt" (Abrechnungsart nicht auf dieser Ebene gesetzt). */
export const INHERIT_BILLING = "inherit";

/** "none" steht fuer "kein Bundesland" (nur bundesweite Feiertage). */
export const NO_STATE = "none";

/** Sonderwert des Bereichs-Waehlers: Konto-weite Einstellungen (kein Team-Override). */
export const ACCOUNT_SCOPE = "account";

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const LEERES_FORMULAR: FormState = {
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
};

function ausSettings(settings: AllowanceSettings): FormState {
  return {
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
  };
}

type AllowanceSettingsContextValue = {
  form: FormState;
  errors: Partial<Record<keyof FormState, string>>;
  set: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  isLoading: boolean;
  saving: boolean;
  saved: boolean;
  /** Anzahl der Felder, die seit dem letzten Laden/Speichern geaendert wurden. */
  geaenderteFelder: number;
  handleSave: (overrides?: Partial<FormState>) => Promise<void>;
  /** Setzt alle Eingaben auf den zuletzt geladenen Serverstand zurueck. */
  handleReset: () => void;
  scope: string;
  changeScope: (next: string) => void;
  showTeamPicker: boolean;
  isTeamScope: boolean;
  hasOverride: boolean;
  handleRemoveOverride: () => Promise<void>;
  switchesLocked: boolean;
  onTimeTrackingToggle: (next: boolean) => void;
  confirmTimeTracking: boolean;
  setConfirmTimeTracking: (open: boolean) => void;
  confirmEnableTimeTracking: () => void;
};

const AllowanceSettingsContext = createContext<AllowanceSettingsContextValue | null>(null);

export function useAllowanceSettings(): AllowanceSettingsContextValue {
  const ctx = useContext(AllowanceSettingsContext);
  if (!ctx) {
    throw new Error("useAllowanceSettings muss innerhalb von AllowanceSettingsProvider stehen");
  }
  return ctx;
}

export function AllowanceSettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { teams, isDienstleister, isTeamScopeReady } = useTeam();
  const { currentUser } = useAuth();
  // Free-Tarif: Die Schalter Zeiterfassung/Pausen sind sichtbar, aber gesperrt
  // (Premium-Feature "timeTrackingSettings"). Der Server lehnt Wert-Aenderungen
  // zusaetzlich ab — das hier ist reine UX.
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

  const [form, setForm] = useState<FormState>(LEERES_FORMULAR);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Bestätigungs-Dialog vor dem AKTIVIEREN der Zeiterfassung (Ausschalten ohne Dialog).
  const [confirmTimeTracking, setConfirmTimeTracking] = useState(false);
  // Welche Felder seit dem letzten Laden/Speichern angefasst wurden. Als State
  // (nicht nur als Ref), weil die Speicherleiste daran haengt und sichtbar
  // werden muss, sobald das erste Feld sich aendert.
  const [dirtyFields, setDirtyFields] = useState<ReadonlySet<string>>(() => new Set());
  // Pro Bereich nur einmal mit den geladenen Werten befüllen, damit ein Refetch
  // (z.B. bei Fensterfokus) keine ungespeicherten Eingaben überschreibt. Ein
  // Bereichswechsel lädt bewusst neu.
  const hydratedScopeRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  // Letzter vom Server geladener Stand — Grundlage fuer "Verwerfen".
  const serverStandRef = useRef<FormState>(LEERES_FORMULAR);

  const markiereSauber = useCallback(() => {
    isDirtyRef.current = false;
    setDirtyFields(new Set());
  }, []);

  useEffect(() => {
    if (
      settings &&
      !settingsFetching &&
      (hydratedScopeRef.current !== scope || !isDirtyRef.current)
    ) {
      hydratedScopeRef.current = scope;
      const geladen = ausSettings(settings);
      serverStandRef.current = geladen;
      setForm(geladen);
      setErrors({});
      setSaved(false);
      markiereSauber();
    }
  }, [settings, settingsFetching, scope, markiereSauber]);

  const changeScope = useCallback(
    (next: string) => {
      setScope(next);
      hydratedScopeRef.current = null;
      markiereSauber();
    },
    [markiereSauber],
  );

  const set = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    isDirtyRef.current = true;
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setSaved(false);
    setDirtyFields((d) => {
      if (d.has(field as string)) return d;
      const next = new Set(d);
      next.add(field as string);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setForm(serverStandRef.current);
    setErrors({});
    setSaved(false);
    markiereSauber();
  }, [markiereSauber]);

  function validatePercent(value: string): string | undefined {
    const n = Number(value);
    if (value === "" || Number.isNaN(n)) return "Bitte Zahl eingeben";
    if (n < 0 || n > 100) return "Wert zwischen 0 und 100";
    return undefined;
  }

  function validate(f: FormState): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    errs.nightPercent = validatePercent(f.nightPercent);
    errs.sundayPercent = validatePercent(f.sundayPercent);
    errs.holidayPercent = validatePercent(f.holidayPercent);
    if (!TIME_PATTERN.test(f.nightStart)) errs.nightStart = "Ungültige Uhrzeit";
    if (!TIME_PATTERN.test(f.nightEnd)) errs.nightEnd = "Ungültige Uhrzeit";
    if (scopeTeamId === undefined) {
      if (f.vacationMethod === "factor") {
        const vf = Number(f.vacationFactor);
        if (f.vacationFactor === "" || Number.isNaN(vf) || vf < 0)
          errs.vacationFactor = "Mindestens 0";
      }
      const fwd = Number(f.fulltimeWorkdaysPerWeek);
      if (f.fulltimeWorkdaysPerWeek === "" || Number.isNaN(fwd) || fwd < 1 || fwd > 7)
        errs.fulltimeWorkdaysPerWeek = "Zahl zwischen 1 und 7";
      const fwh = Number(f.fulltimeWeeklyHours);
      if (f.fulltimeWeeklyHours === "" || Number.isNaN(fwh) || fwh < 1 || fwh > 60)
        errs.fulltimeWeeklyHours = "Zahl zwischen 1 und 60";
      const dvd = Number(f.defaultVacationDays);
      if (f.defaultVacationDays === "" || Number.isNaN(dvd) || dvd < 0 || dvd > 365)
        errs.defaultVacationDays = "Zahl zwischen 0 und 365";
      const tmh = Number(f.teamMeetingHours);
      if (f.teamMeetingHours === "" || Number.isNaN(tmh) || tmh < 0.1)
        errs.teamMeetingHours = "Mindestens 0,1";
      if (f.pauseAutoEnabled) {
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
        errs.pauseThreshold1Hours = validateThreshold(f.pauseThreshold1Hours);
        errs.pauseThreshold2Hours = validateThreshold(f.pauseThreshold2Hours);
        errs.pauseMinutes1 = validateMinutes(f.pauseMinutes1);
        errs.pauseMinutes2 = validateMinutes(f.pauseMinutes2);
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
    const f = { ...form, ...overrides };
    if (!validate(f)) return;
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
      serverStandRef.current = f;
      markiereSauber();
      await invalidateAll();
      setSaved(true);
    } catch (err) {
      setErrors({
        holidayPercent: readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."),
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Zeiterfassungs-Schalter: Einschalten nur nach Bestätigungs-Dialog,
   * Ausschalten sofort. Gespeichert wird direkt (nicht erst über die
   * Speicherleiste), damit der Konto-Schalter nie in einem ungespeicherten
   * Zwischenzustand hängt.
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
      markiereSauber();
      await invalidateAll();
      setSaved(false);
    } catch (err) {
      setErrors({
        holidayPercent: readableApiError(err, "Entfernen fehlgeschlagen. Bitte erneut versuchen."),
      });
    } finally {
      setSaving(false);
    }
  }

  const isTeamScope = scopeTeamId !== undefined;
  const hasOverride = isTeamScope && settings?.isOverride === true;

  const value: AllowanceSettingsContextValue = {
    form,
    errors,
    set,
    isLoading,
    saving,
    saved,
    geaenderteFelder: dirtyFields.size,
    handleSave,
    handleReset,
    scope,
    changeScope,
    showTeamPicker,
    isTeamScope,
    hasOverride,
    handleRemoveOverride,
    switchesLocked,
    onTimeTrackingToggle,
    confirmTimeTracking,
    setConfirmTimeTracking,
    confirmEnableTimeTracking,
  };

  return (
    <AllowanceSettingsContext.Provider value={value}>{children}</AllowanceSettingsContext.Provider>
  );
}

/** Nur fuer Tests/Fehlermeldungen: die deutschen Bundeslaender in Auswahl-Reihenfolge. */
export const GERMAN_STATE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
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
