import { useState, useEffect, useRef } from "react";
import {
  useGetAllowanceSettings,
  useUpdateAllowanceSettings,
  getGetAllowanceSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type FormState = {
  nightPercent: string;
  nightStart: string;
  nightEnd: string;
  sundayPercent: string;
  holidayPercent: string;
};

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

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
  const { data: settings, isLoading } = useGetAllowanceSettings();
  const updateSettings = useUpdateAllowanceSettings();

  const [form, setForm] = useState<FormState>({
    nightPercent: "25",
    nightStart: "23:00",
    nightEnd: "06:00",
    sundayPercent: "50",
    holidayPercent: "100",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const hydratedRef = useRef(false);

  // Nur einmal mit den geladenen Werten befüllen, damit ein Refetch
  // (z.B. bei Fensterfokus) keine ungespeicherten Eingaben überschreibt.
  useEffect(() => {
    if (settings && !hydratedRef.current) {
      hydratedRef.current = true;
      setForm({
        nightPercent: String(settings.nightPercent),
        nightStart: settings.nightStart,
        nightEnd: settings.nightEnd,
        sundayPercent: String(settings.sundayPercent),
        holidayPercent: String(settings.holidayPercent),
      });
    }
  }, [settings]);

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
    const cleaned = Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
    setErrors(cleaned);
    return Object.keys(cleaned).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await updateSettings.mutateAsync({
        data: {
          nightPercent: Number(form.nightPercent),
          nightStart: form.nightStart,
          nightEnd: form.nightEnd,
          sundayPercent: Number(form.sundayPercent),
          holidayPercent: Number(form.holidayPercent),
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetAllowanceSettingsQueryKey() });
      setSaved(true);
    } catch {
      setErrors({ holidayPercent: "Speichern fehlgeschlagen. Bitte erneut versuchen." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader>
        <CardTitle className="font-serif text-xl">Zuschläge</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
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

            <div className="flex items-center gap-3 pt-1">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Speichern..." : "Speichern"}
              </Button>
              {saved && <span className="text-xs text-muted-foreground">Gespeichert.</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
