import { useState, useEffect, useRef } from "react";
import {
  useGetAllowanceSettings,
  useUpdateAllowanceSettings,
  useDeleteAllowanceSettingsOverride,
  getGetAllowanceSettingsQueryKey,
  getGetTimeTrackingStatusQueryKey,
  type AllowanceSettingsInputState,
  type AllowanceSettingsInputBillingMethod,
  type AllowanceSettingsInputVacationMethod,
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
  vacationHoursPerDay: string;
  vacationFactor: string;
  ersatzruhetagEnabled: boolean;
  teamMeetingEnabled: boolean;
  teamMeetingHours: string;
};

// Sonderwert für "erbt" (Abrechnungsart nicht auf dieser Ebene gesetzt).
const INHERIT_BILLING = "inherit";

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// "" steht für "kein Bundesland" (nur bundesweite Feiertage).
const NO_STATE = "none";

// Sonderwert des Bereichs-Wählers: Konto-weite Einstellungen (kein Team-Override).
const ACCOUNT_SCOPE = "account";

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
  const { teams, isDienstleister } = useTeam();

  // Bereich: Konto-Standard oder ein bestimmtes Team (nur Dienstleister mit Teams).
  const [scope, setScope] = useState<string>(ACCOUNT_SCOPE);
  const showTeamPicker = isDienstleister && teams.length > 0;
  const scopeTeamId = scope === ACCOUNT_SCOPE ? undefined : Number(scope);

  const queryParams = scopeTeamId !== undefined ? { teamId: scopeTeamId } : undefined;
  const { data: settings, isLoading } = useGetAllowanceSettings(queryParams);
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
    vacationHoursPerDay: "8",
    vacationFactor: "0.0941",
    ersatzruhetagEnabled: true,
    teamMeetingEnabled: false,
    teamMeetingHours: "1",
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

  useEffect(() => {
    if (settings && hydratedScopeRef.current !== scope) {
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
        vacationHoursPerDay: String(settings.vacationHoursPerDay ?? 8),
        vacationFactor: String(settings.vacationFactor ?? 0.0941),
        ersatzruhetagEnabled: settings.ersatzruhetagEnabled ?? true,
        teamMeetingEnabled: settings.teamMeetingEnabled ?? false,
        teamMeetingHours: String(settings.teamMeetingHours ?? 1),
      });
      setErrors({});
      setSaved(false);
    }
  }, [settings, scope]);

  function changeScope(next: string) {
    setScope(next);
    hydratedScopeRef.current = null;
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
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
    if (scopeTeamId === undefined) {
      const hpd = Number(form.vacationHoursPerDay);
      if (form.vacationHoursPerDay === "" || Number.isNaN(hpd) || hpd < 0.1)
        errs.vacationHoursPerDay = "Mindestens 0,1";
      if (form.vacationMethod === "factor") {
        const vf = Number(form.vacationFactor);
        if (form.vacationFactor === "" || Number.isNaN(vf) || vf < 0)
          errs.vacationFactor = "Mindestens 0";
      }
      const tmh = Number(form.teamMeetingHours);
      if (form.teamMeetingHours === "" || Number.isNaN(tmh) || tmh < 0.1)
        errs.teamMeetingHours = "Mindestens 0,1";
    }
    const cleaned = Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
    setErrors(cleaned);
    return Object.keys(cleaned).length === 0;
  }

  async function invalidateAll() {
    // Prefix-Match: trifft die Konto-Abfrage UND alle Team-Abfragen.
    await queryClient.invalidateQueries({ queryKey: getGetAllowanceSettingsQueryKey() });
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
          // Konto-weite Regeln (Auto-Genehmigung, Zeiterfassung, Urlaubsberechnung)
          // gelten global und werden nur im Konto-Bereich mitgesendet, nicht bei
          // Team-Overrides.
          ...(scopeTeamId === undefined
            ? {
                autoApproveTimesheets: f.autoApproveTimesheets,
                timeTrackingEnabled: f.timeTrackingEnabled,
                vacationMethod: f.vacationMethod as AllowanceSettingsInputVacationMethod,
                vacationHoursPerDay: Number(f.vacationHoursPerDay),
                vacationFactor: Number(f.vacationFactor),
                ersatzruhetagEnabled: f.ersatzruhetagEnabled,
                teamMeetingEnabled: f.teamMeetingEnabled,
                teamMeetingHours: Number(f.teamMeetingHours),
              }
            : {}),
        },
        params: queryParams,
      });
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
        <CardTitle className="font-serif text-xl">Zuschläge</CardTitle>
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
                        <Label htmlFor="timeTrackingEnabled" className="text-sm font-semibold">
                          Zeiterfassung aktivieren
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Erlaubt das Erfassen und Bearbeiten von Ist-Zeiten (Stundenzettel) für
                          alle Teams dieses Kontos. Solange ausgeschaltet, können keine neuen
                          Zeiteinträge angelegt oder bestätigt werden; bestehende Einträge bleiben
                          sichtbar. Die Änderung wird sofort gespeichert.
                        </p>
                      </div>
                      <Switch
                        id="timeTrackingEnabled"
                        data-testid="allowance-time-tracking-switch"
                        checked={form.timeTrackingEnabled}
                        disabled={saving}
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
                    <div className="space-y-1.5">
                      <Label htmlFor="vacationMethod" className="text-sm font-semibold">
                        Urlaubsberechnung
                      </Label>
                      <Select
                        value={form.vacationMethod}
                        onValueChange={(v) => set("vacationMethod", v)}
                      >
                        <SelectTrigger id="vacationMethod" data-testid="allowance-vacation-method-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bwavg">
                            §11 BUrlG – Durchschnitt der letzten 13 Wochen
                          </SelectItem>
                          <SelectItem value="factor">
                            Faktor – feste Urlaubsstunden je Arbeitsstunde
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Bestimmt, wie viele Stunden ein Urlaubstag wert ist. Der §11-BUrlG-Schnitt
                        rechnet nach dem Durchschnitt der letzten 13 Wochen; der Faktor rechnet einen
                        festen Anteil pro geleisteter Arbeitsstunde.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="vacationHoursPerDay">Stunden je Urlaubstag</Label>
                        <Input
                          id="vacationHoursPerDay"
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={form.vacationHoursPerDay}
                          onChange={(e) => set("vacationHoursPerDay", e.target.value)}
                          className={errors.vacationHoursPerDay ? "border-destructive" : ""}
                        />
                        <p className="text-xs text-muted-foreground">
                          Anzeige: Tage = Urlaubsstunden ÷ diesem Wert (Standard 8).
                        </p>
                        {errors.vacationHoursPerDay && (
                          <p className="text-xs text-destructive">{errors.vacationHoursPerDay}</p>
                        )}
                      </div>
                      {form.vacationMethod === "factor" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="vacationFactor">Urlaubsstunden je Arbeitsstunde</Label>
                          <Input
                            id="vacationFactor"
                            type="number"
                            min="0"
                            step="0.0001"
                            value={form.vacationFactor}
                            onChange={(e) => set("vacationFactor", e.target.value)}
                            className={errors.vacationFactor ? "border-destructive" : ""}
                          />
                          <p className="text-xs text-muted-foreground">
                            Nur bei Methode „Faktor" (Standard 0,0941).
                          </p>
                          {errors.vacationFactor && (
                            <p className="text-xs text-destructive">{errors.vacationFactor}</p>
                          )}
                        </div>
                      )}
                    </div>
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
