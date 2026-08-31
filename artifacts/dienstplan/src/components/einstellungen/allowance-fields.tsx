/**
 * Die Eingabefelder der Abrechnungs-Einstellungen, aufgeteilt auf die beiden
 * oberen Gruppen der Einstellungsseite. Zustand und Speichern liegen im
 * gemeinsamen Context (allowance-settings-context.tsx).
 *
 * Sichtbar bleiben Name, Wert und Bedienelement — die Erklärungen stecken
 * hinter dem Fragezeichen daneben (siehe erklaer-hilfe.tsx). Rechtlich
 * relevante Warnungen bleiben als Hinweiskasten stehen.
 */
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
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import {
  useAllowanceSettings,
  ACCOUNT_SCOPE,
  INHERIT_BILLING,
  NO_STATE,
  GERMAN_STATE_OPTIONS,
} from "./allowance-settings-context";
import { ErklaerHilfe, type HandbuchAnker } from "./erklaer-hilfe";
import { useTeam } from "@/context/team";

/**
 * Breite für Auswahlfelder mit kurzem Inhalt. Ein Bundesland-Auswahlfeld über
 * die volle Spaltenbreite zu ziehen macht "Bayern" nicht lesbarer, kostet aber
 * Ruhe im Layout.
 */
const KURZFELD = "max-w-sm";

/**
 * Premium-Hinweis unter gesperrten Schaltern (Free-Tarif): nach dem Muster der
 * bestehenden Free-Limits — sichtbar, aber gesperrt, mit direktem Upgrade-Weg.
 * Bereits aktive Einstellungen bleiben wirksam (Bestandsschutz), gesperrt ist
 * nur das Ändern; der Server lehnt Wert-Änderungen im Free-Tarif zusätzlich ab.
 *
 * Bleibt bewusst sichtbar statt hinter dem Fragezeichen: das ist keine
 * Erklärung, sondern der Grund, warum das Bedienelement nicht reagiert.
 */
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

/** Beschriftung mit Fragezeichen daneben. */
function FeldLabel({
  htmlFor,
  titel,
  anker,
  erklaerung,
  fett = false,
}: {
  htmlFor?: string;
  titel: string;
  anker?: HandbuchAnker;
  erklaerung?: ReactNode;
  fett?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} className={fett ? "text-sm font-semibold" : undefined}>
        {titel}
      </Label>
      {erklaerung && (
        <ErklaerHilfe titel={titel} anker={anker}>
          {erklaerung}
        </ErklaerHilfe>
      )}
    </div>
  );
}

function PercentField({
  id,
  label,
  value,
  error,
  anker,
  erklaerung,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  anker?: HandbuchAnker;
  erklaerung?: ReactNode;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FeldLabel htmlFor={id} titel={label} anker={anker} erklaerung={erklaerung} />
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Ein Schalter mit Beschriftung, Erklärung auf Abruf und optionalem Schloss. */
function SchalterZeile({
  id,
  testId,
  label,
  anker,
  erklaerung,
  gesperrt = false,
  lockTestId,
  disabled = false,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  testId: string;
  label: string;
  anker?: HandbuchAnker;
  erklaerung: ReactNode;
  gesperrt?: boolean;
  lockTestId?: string;
  disabled?: boolean;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label htmlFor={id} className="text-sm font-semibold">
            {label}
          </Label>
          {gesperrt && (
            <Lock
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              data-testid={lockTestId}
              aria-label="Premium-Feature"
            />
          )}
          <ErklaerHilfe titel={label} anker={anker}>
            {erklaerung}
          </ErklaerHilfe>
        </div>
        <Switch
          id={id}
          data-testid={testId}
          checked={checked}
          disabled={disabled || gesperrt}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {gesperrt && <PremiumSwitchHint />}
      {children}
    </div>
  );
}

/** Trennlinie zwischen zwei Unterabschnitten innerhalb einer Gruppe. */
function Abschnitt({ children }: { children: ReactNode }) {
  return <div className="border-t border-border/60 pt-5">{children}</div>;
}

function LadeSkelett() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Bereichs-Wähler "Gilt für" (Konto-Standard oder einzelnes Team). Nur für
 * Dienstleister mit mindestens einem Team sichtbar; steht ganz oben in der
 * Gruppe "Abrechnungsgrundlagen", weil er für BEIDE Gruppen gilt.
 */
export function AllowanceScopePicker() {
  const { scope, changeScope, showTeamPicker, isTeamScope, hasOverride, handleRemoveOverride, saving } =
    useAllowanceSettings();
  const { teams } = useTeam();

  if (!showTeamPicker) return null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="allowance-scope">Gilt für</Label>
      <Select value={scope} onValueChange={changeScope}>
        <SelectTrigger id="allowance-scope" data-testid="allowance-scope-select" className={KURZFELD}>
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
            ? "Eigene Regelung, überschreibt den Konto-Standard."
            : "Nutzt den Konto-Standard. Speichern legt eine eigene Regelung an."}
        </p>
      )}
      {hasOverride && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={handleRemoveOverride}
          disabled={saving}
          data-testid="allowance-remove-override-button"
        >
          Team-Regelung entfernen
        </Button>
      )}
    </div>
  );
}

/**
 * Gruppe 1 — Abrechnungsgrundlagen.
 *
 * Alles, was die Grundlage von Stunden und Geld umschaltet: Zeiterfassung,
 * Abrechnungsart, Vollzeit-Bezug, Urlaubsanspruch, Bundesland.
 */
export function AbrechnungsgrundlagenFelder() {
  const { form, errors, set, isLoading, isTeamScope, switchesLocked, saving, onTimeTrackingToggle } =
    useAllowanceSettings();

  if (isLoading) return <LadeSkelett />;

  return (
    <div className="space-y-5">
      {!isTeamScope && (
        <SchalterZeile
          id="timeTrackingEnabled"
          testId="allowance-time-tracking-switch"
          label="Zeiterfassung aktivieren"
          anker="weitere-schalter"
          erklaerung={
            <p>
              Assistenzkräfte tragen ihre tatsächlichen Zeiten ein. Ausgeschaltet zählt nur der
              Plan. Wird sofort gespeichert.
            </p>
          }
          gesperrt={switchesLocked}
          lockTestId="lock-time-tracking"
          disabled={saving}
          checked={form.timeTrackingEnabled}
          onCheckedChange={onTimeTrackingToggle}
        />
      )}

      <div className={isTeamScope ? "space-y-1.5" : "border-t border-border/60 pt-5 space-y-1.5"}>
        <FeldLabel
          htmlFor="billingMethod"
          titel="Abrechnungsart"
          anker="zuschlaege"
          erklaerung={
            <p>
              Soll rechnet mit den geplanten Schichten, Ist mit den erfassten Zeiten. Die
              Personalakte einer Person schlägt diese {isTeamScope ? "Team-" : "Konto-"}Regel.
            </p>
          }
        />
        <Select value={form.billingMethod} onValueChange={(v) => set("billingMethod", v)}>
          <SelectTrigger
            id="billingMethod"
            data-testid="allowance-billing-method-select"
            className={KURZFELD}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_BILLING}>
              {isTeamScope ? "Konto-Standard übernehmen" : "Standard (Soll-Stunden)"}
            </SelectItem>
            <SelectItem value="SOLL">Soll – nach geplanten Schichten</SelectItem>
            <SelectItem value="IST">Ist – nach erfassten Zeiten</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isTeamScope && (
        <Abschnitt>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <FeldLabel
                titel="Vollzeit entspricht"
                fett
                anker="weitere-schalter"
                erklaerung={<p>Bezugsgröße für Teilzeit und Urlaubsanspruch.</p>}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      className={
                        errors.fulltimeWorkdaysPerWeek ? "border-destructive pr-32" : "pr-32"
                      }
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
              <FeldLabel
                htmlFor="defaultVacationDays"
                titel="Urlaub bei Vollzeit"
                anker="weitere-schalter"
                erklaerung={
                  <p>
                    Vorbelegung für neue Verträge, pro Person änderbar. Ein Urlaubstag zieht die
                    Stunden des Dienstes an dem Tag ab, sonst etwa 8 Stunden.
                  </p>
                }
              />
              <div className={`relative ${KURZFELD}`}>
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
              {/* Berechneter Wert, keine Erklärung — bleibt sichtbar. */}
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
            </div>

            <SchalterZeile
              id="vacationForecastEnabled"
              testId="allowance-vacation-forecast-switch"
              label="13-Wochen-Prognose anzeigen"
              anker="weitere-schalter"
              erklaerung={
                <p>
                  Schätzt den Jahresendstand aus den letzten 13 Wochen. Ändert den verfügbaren
                  Urlaub nicht.
                </p>
              }
              checked={form.vacationForecastEnabled}
              onCheckedChange={(value) => set("vacationForecastEnabled", value)}
            />
          </div>
        </Abschnitt>
      )}

      <Abschnitt>
        <div className="space-y-1.5">
          <FeldLabel
            htmlFor="state"
            titel="Bundesland"
            anker="zuschlaege"
            erklaerung={
              <p>
                Legt fest, welche regionalen Feiertage zählen. Ohne Auswahl nur die bundesweiten.
              </p>
            }
          />
          <Select value={form.state} onValueChange={(v) => set("state", v)}>
            <SelectTrigger id="state" className={KURZFELD}>
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
        </div>
      </Abschnitt>
    </div>
  );
}

/**
 * Gruppe 2 — Zuschläge und Zeitregeln.
 *
 * Werte, die regelmäßig gepflegt werden, ohne die Abrechnung als Ganzes
 * umzuschalten: Zuschlagssätze, Pausen, Ersatzruhetag, Teamsitzung,
 * Auto-Genehmigung.
 */
export function ZuschlaegeUndZeitregelnFelder() {
  const { form, errors, set, isLoading, isTeamScope, switchesLocked } = useAllowanceSettings();

  if (isLoading) return <LadeSkelett />;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Nachtzuschlag</h3>
          <ErklaerHilfe titel="Nachtzuschlag" anker="zuschlaege">
            <p>Das Zeitfenster darf über Mitternacht laufen.</p>
          </ErklaerHilfe>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      {/*
        Rechtlicher Hinweis, KEINE Erklärung: die Sozialversicherungspflicht
        entscheidet über die Lohnabrechnung. Was man wegklicken muss, hat man
        nicht gelesen — dieser Kasten bleibt deshalb sichtbar.
      */}
      <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
        <p className="font-medium mb-1">Zuschläge auf Urlaubs- und Kranktage</p>
        <p className="text-blue-800 dark:text-blue-300">
          Fällt ein ganztägiger Urlaubs- oder Kranktag auf einen Sonntag oder Feiertag, werden die
          oben konfigurierten Zuschlagssätze auf die vertraglichen Tagesstunden angerechnet
          (§&nbsp;11 BUrlG, §&nbsp;2 EFZG). Diese Zuschläge sind{" "}
          <strong>sozialversicherungs- und lohnsteuerpflichtig</strong> – im Gegensatz zu Zuschlägen
          auf geleistete Arbeit, die nach §&nbsp;3b&nbsp;EStG steuerfrei sein können.
        </p>
      </div>

      {/*
        Vertretungsverguetung gilt auch im Team-Bereich (wie die Zuschlagssaetze
        darueber) und steht deshalb vor dem konto-weiten Block.
      */}
      <Abschnitt>
        <div className="space-y-1.5">
          <FeldLabel
            htmlFor="vertretungCompensationMode"
            titel="Vertretungsvergütung"
            anker="zuschlaege"
            erklaerung={
              <p>
                Kommt zusätzlich zum normalen Lohn. Zuschlag rechnet einen Prozentsatz des
                Dienst-Lohns obendrauf, Pauschale einen festen Betrag.
              </p>
            }
          />
          <Select
            value={form.vertretungCompensationMode}
            onValueChange={(v) => set("vertretungCompensationMode", v)}
          >
            <SelectTrigger
              id="vertretungCompensationMode"
              data-testid="allowance-vertretung-compensation-mode-select"
              className={KURZFELD}
            >
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
        </div>
      </Abschnitt>

      {!isTeamScope && (
        <>
          <Abschnitt>
            <SchalterZeile
              id="pauseAutoEnabled"
              testId="allowance-pause-auto-switch"
              label="Pausen automatisch vorbefüllen"
              anker="pausen"
              erklaerung={
                <p>
                  Trägt die Pause beim Anlegen eines Dienstes nach Dauer ein, pro Dienst
                  überschreibbar. Voreinstellung ist § 4 ArbZG: ab 6 Std. 30 Min., ab 9 Std. 45 Min.
                </p>
              }
              gesperrt={switchesLocked}
              lockTestId="lock-pause-auto"
              checked={form.pauseAutoEnabled}
              onCheckedChange={(v) => set("pauseAutoEnabled", v)}
            >
              {form.pauseAutoEnabled && (
                <div className="grid max-w-md grid-cols-2 gap-4">
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
              )}
            </SchalterZeile>
          </Abschnitt>

          <Abschnitt>
            <SchalterZeile
              id="deductPausesEnabled"
              testId="allowance-deduct-pauses-switch"
              label="Pausen von bezahlten Stunden abziehen"
              anker="pausen"
              erklaerung={
                <p>
                  Zieht unbezahlte Pausen von Stunden und Grundlohn ab, auch rückwirkend. Zuschläge
                  bleiben.
                </p>
              }
              gesperrt={switchesLocked}
              lockTestId="lock-deduct-pauses"
              checked={form.deductPausesEnabled}
              onCheckedChange={(v) => set("deductPausesEnabled", v)}
            />
          </Abschnitt>

          <Abschnitt>
            <SchalterZeile
              id="ersatzruhetagEnabled"
              testId="allowance-ersatzruhetag-switch"
              label="Ersatzruhetag-Konto für Feiertage"
              anker="weitere-schalter"
              erklaerung={
                <p>
                  Wer an einem Feiertag arbeitet, bekommt einen Ausgleichstag (§ 11 Abs. 3 ArbZG).
                  Nur Feiertage von Montag bis Samstag zählen.
                </p>
              }
              checked={form.ersatzruhetagEnabled}
              onCheckedChange={(v) => set("ersatzruhetagEnabled", v)}
            />
          </Abschnitt>

          <Abschnitt>
            <SchalterZeile
              id="teamMeetingEnabled"
              testId="allowance-team-meeting-switch"
              label="Team-Dienst (Teamsitzung)"
              anker="weitere-schalter"
              erklaerung={
                <p>
                  Ein Team-Eintrag pro Tag schreibt allen im Team die eingestellte Stundenzahl gut.
                </p>
              }
              checked={form.teamMeetingEnabled}
              onCheckedChange={(v) => set("teamMeetingEnabled", v)}
            >
              {form.teamMeetingEnabled && (
                <div className="space-y-1.5">
                  <FeldLabel
                    htmlFor="teamMeetingHours"
                    titel="Stunden-Gutschrift pro Teamsitzung"
                    anker="weitere-schalter"
                    erklaerung={
                      <p>Wird jeder Assistenzkraft je Team-Eintrag gutgeschrieben und vergütet.</p>
                    }
                  />
                  <Input
                    id="teamMeetingHours"
                    data-testid="allowance-team-meeting-hours"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={form.teamMeetingHours}
                    onChange={(e) => set("teamMeetingHours", e.target.value)}
                    className={`${KURZFELD} ${errors.teamMeetingHours ? "border-destructive" : ""}`}
                  />
                  {errors.teamMeetingHours && (
                    <p className="text-xs text-destructive">{errors.teamMeetingHours}</p>
                  )}
                </div>
              )}
            </SchalterZeile>
          </Abschnitt>

          <Abschnitt>
            <SchalterZeile
              id="autoApproveTimesheets"
              testId="allowance-auto-approve-switch"
              label="Stundenzettel automatisch genehmigen"
              anker="weitere-schalter"
              erklaerung={
                <p>Eingereichte Zeiten gelten sofort als bestätigt, ohne Prüfung.</p>
              }
              checked={form.autoApproveTimesheets}
              onCheckedChange={(v) => set("autoApproveTimesheets", v)}
            />
          </Abschnitt>
        </>
      )}
    </div>
  );
}

/**
 * Speicherleiste für die Gruppen 1 und 2.
 *
 * Schwebt unten ein, sobald mindestens ein Feld geändert wurde, und speichert
 * beide Gruppen in einem Zug. Ohne Änderungen ist sie unsichtbar und nimmt
 * keinen Platz weg.
 */
export function AllowanceSaveBar() {
  const { geaenderteFelder, saving, saved, handleSave, handleReset, isLoading } =
    useAllowanceSettings();

  if (isLoading) return null;

  if (geaenderteFelder === 0) {
    // Nach dem Speichern kurz sichtbar bleiben: die Rückmeldung "Gespeichert."
    // gehört an dieselbe Stelle, an der der Knopf stand.
    return saved ? (
      <p className="text-xs text-muted-foreground" data-testid="allowance-saved-hint">
        Gespeichert.
      </p>
    ) : null;
  }

  return (
    <>
      {/* Platzhalter in der Seite: die Leiste liegt fix ueber dem Inhalt und
          wuerde sonst die unterste Karte verdecken. */}
      <div className="h-20" aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background shadow-[0_-2px_12px_rgba(0,0,0,0.10)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="allowance-save-bar"
        role="region"
        aria-label="Ungespeicherte Änderungen"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-foreground">
            <span className="font-semibold">
              {geaenderteFelder === 1 ? "1 Änderung" : `${geaenderteFelder} Änderungen`}
            </span>{" "}
            <span className="text-muted-foreground">noch nicht gespeichert</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saving}
              data-testid="allowance-reset-button"
            >
              Verwerfen
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving}
              data-testid="allowance-save-button"
            >
              {saving ? "Speichern..." : "Speichern"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Bestätigungs-Dialog vor dem Aktivieren der Zeiterfassung. */
export function ZeiterfassungBestaetigung() {
  const { confirmTimeTracking, setConfirmTimeTracking, confirmEnableTimeTracking } =
    useAllowanceSettings();

  return (
    <AlertDialog open={confirmTimeTracking} onOpenChange={setConfirmTimeTracking}>
      <AlertDialogContent data-testid="time-tracking-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Zeiterfassung aktivieren?</AlertDialogTitle>
          <AlertDialogDescription>
            Assistenzkräfte und Sie können dann Ist-Zeiten (Stundenzettel) erfassen, bearbeiten und
            bestätigen. Die Einstellung gilt konto-weit für alle Teams und wird sofort gespeichert.
            Sie können die Zeiterfassung jederzeit wieder ausschalten — bereits erfasste Einträge
            bleiben dabei erhalten.
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
  );
}
