import { useState } from "react";
import { format, addDays } from "date-fns";
import { de } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, CalendarDays, Minus, Plus } from "lucide-react";
import { useBulkCreateAbsence } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateShiftDerivedQueries } from "@/lib/shift-cache";
import { DatePickerField } from "@/components/date-picker-field";

/** Erzeugt ein Array von { startTime, endTime } für jeden UTC-Kalendertag
 *  von startUtcDay bis endUtcDay (inkl.). Beide Argumente als YYYY-MM-DD-String.
 *  Gibt ISO-Strings zurück, wie die API (BulkAbsenceInputDaysItem) sie erwartet. */
function buildDays(
  startUtcDay: string,
  endUtcDay: string,
): Array<{ startTime: string; endTime: string }> {
  const days: Array<{ startTime: string; endTime: string }> = [];
  const cursor = new Date(`${startUtcDay}T00:00:00.000Z`);
  const last = new Date(`${endUtcDay}T23:59:59.999Z`);
  while (cursor <= last) {
    const dayStr = cursor.toISOString().split("T")[0]!;
    days.push({
      startTime: `${dayStr}T00:00:00.000Z`,
      endTime: `${dayStr}T23:59:59.999Z`,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

type DurationMode = "today" | "tomorrow" | "days" | "until";

interface Props {
  open: boolean;
  onClose: () => void;
  userId: number;
}

/**
 * Schnell-Dialog für die Selbst-Krankmeldung einer Assistenzkraft.
 * Schritt 1: Dauer wählen (Heute / Morgen / X Tage / Bis Datum).
 * Schritt 2: Zusammenfassung bestätigen → POST /shifts/bulk-absence.
 */
export function KrankmeldungDialog({ open, onClose, userId }: Props) {
  const [mode, setMode] = useState<DurationMode>("today");
  const [dayCount, setDayCount] = useState(3);
  const [step, setStep] = useState<"select" | "confirm">("select");

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0]!;
  const tomorrowStr = addDays(new Date(`${todayStr}T00:00:00.000Z`), 1)
    .toISOString()
    .split("T")[0]!;

  const [untilDate, setUntilDate] = useState(() => {
    const d = addDays(new Date(`${todayStr}T00:00:00.000Z`), 6);
    return d.toISOString().split("T")[0]!;
  });

  const queryClient = useQueryClient();
  const { mutateAsync, isPending } = useBulkCreateAbsence();

  // Berechne Start/End-Tag aus der gewählten Dauer.
  function getRange(): { startDay: string; endDay: string } {
    if (mode === "today") return { startDay: todayStr, endDay: todayStr };
    if (mode === "tomorrow") return { startDay: tomorrowStr, endDay: tomorrowStr };
    if (mode === "days") {
      const end = addDays(new Date(`${todayStr}T00:00:00.000Z`), dayCount - 1);
      return { startDay: todayStr, endDay: end.toISOString().split("T")[0]! };
    }
    // "until": Enddatum darf nicht vor heute liegen.
    const until =
      untilDate < todayStr ? todayStr : untilDate;
    return { startDay: todayStr, endDay: until };
  }

  const { startDay, endDay } = getRange();
  const days = buildDays(startDay, endDay);
  const count = days.length;

  const startLabel = format(new Date(`${startDay}T12:00:00Z`), "EEE d. MMM", { locale: de });
  const endLabel = format(new Date(`${endDay}T12:00:00Z`), "EEE d. MMM yyyy", { locale: de });

  function handleClose() {
    // Dialog-State zurücksetzen.
    setStep("select");
    setMode("today");
    setDayCount(3);
    onClose();
  }

  async function handleSubmit() {
    try {
      await mutateAsync({
        data: { userId, type: "sick" as const, days },
      });
      await invalidateShiftDerivedQueries(queryClient);
      const successMsg =
        mode === "today"
          ? "Krankmeldung für heute eingetragen."
          : mode === "tomorrow"
            ? "Krankmeldung für morgen eingetragen."
            : `Krankmeldung für ${count} Tage eingetragen.`;
      toast.success(successMsg);
      handleClose();
    } catch (err) {
      // 409 = bereits krank an diesen Tagen — Server überspringt sie, Client
      // kann das als Teilerfolg behandeln.
      const status = (err as { status?: number }).status;
      if (status === 409) {
        await invalidateShiftDerivedQueries(queryClient);
        toast.success("Krankmeldung eingetragen (bereits vorhandene Tage übersprungen).");
        handleClose();
      } else {
        toast.error("Krankmeldung konnte nicht eingetragen werden — bitte erneut versuchen.");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" aria-hidden />
            Krank melden
          </DialogTitle>
        </DialogHeader>

        {step === "select" ? (
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Wie lange bist du krank? Die betroffenen Tage werden automatisch eingetragen.
            </p>

            {/* Dauer-Auswahl: 4 Touch-freundliche Karten */}
            <div className="grid grid-cols-2 gap-2">
              {(["today", "tomorrow", "days", "until"] as DurationMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-xl border-2 px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    mode === m
                      ? "border-destructive bg-destructive/5"
                      : "border-border bg-card hover:border-destructive/40"
                  }`}
                >
                  <span
                    className={`block font-semibold text-sm ${mode === m ? "text-destructive" : "text-foreground"}`}
                  >
                    {m === "today" && "Heute"}
                    {m === "tomorrow" && "Morgen"}
                    {m === "days" && "Mehrere Tage"}
                    {m === "until" && "Bis Datum"}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {m === "today" &&
                      format(new Date(`${todayStr}T12:00:00Z`), "EEE d. MMM", { locale: de })}
                    {m === "tomorrow" &&
                      format(new Date(`${tomorrowStr}T12:00:00Z`), "EEE d. MMM", {
                        locale: de,
                      })}
                    {m === "days" && `${dayCount} Tage ab heute`}
                    {m === "until" && "Enddatum wählen"}
                  </span>
                </button>
              ))}
            </div>

            {/* Tage-Stepper */}
            {mode === "days" && (
              <div className="flex items-center justify-center gap-4 py-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDayCount(Math.max(2, dayCount - 1))}
                  aria-label="Weniger Tage"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-2xl font-bold tabular-nums w-12 text-center">
                  {dayCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDayCount(Math.min(14, dayCount + 1))}
                  aria-label="Mehr Tage"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Datum-Picker */}
            {mode === "until" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Letzter Krankheitstag</label>
                <DatePickerField
                  value={untilDate}
                  onChange={setUntilDate}
                  data-testid="krankmeldung-until-date"
                />
              </div>
            )}
          </div>
        ) : (
          /* Bestätigungs-Schritt */
          <div className="space-y-4 py-1">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
                {count === 1 ? startLabel : `${startLabel} – ${endLabel}`}
              </div>
              <p className="text-sm text-muted-foreground">
                {count === 1
                  ? "1 Krankheitstag wird eingetragen."
                  : `${count} Krankheitstage werden eingetragen.`}{" "}
                Bereits eingetragene Tage werden übersprungen.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Der zuständige Koordinator wird per E-Mail informiert.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "select" ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Abbrechen
              </Button>
              <Button onClick={() => setStep("confirm")} disabled={count === 0}>
                Weiter
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("select")}
                disabled={isPending}
              >
                Zurück
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleSubmit()}
                disabled={isPending}
                data-testid="krankmeldung-absenden"
              >
                {isPending ? "Wird eingetragen…" : "Krankmeldung absenden"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
