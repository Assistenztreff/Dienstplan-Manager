import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * App-eigener Datums-Picker (Muster aus dem Schicht-Dialog extrahiert).
 *
 * Ersetzt native <input type="date">-Felder: Auf iPad/iOS öffnet deren
 * Kalender-Rad unvorhersehbar von selbst. Hier öffnet erst ein Klick auf den
 * Button ein ZENTRIERTES Kalender-Overlay (Position immer vorhersehbar),
 * mit Monats-/Jahres-Dropdowns (locale de), Anzeige TT.MM.JJJJ.
 *
 * API bewusst string-basiert (ISO yyyy-MM-dd bzw. "" = leer), damit die
 * bestehende Formularlogik der Seiten unverändert bleibt.
 */
export interface DatePickerFieldProps {
  /** ISO-Datum (yyyy-MM-dd) oder "" für leer. */
  value: string;
  onChange: (iso: string) => void;
  /** Testid des Buttons; der Kalender-Dialog bekommt `<testid>-picker`. */
  "data-testid"?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Rote Umrandung bei Validierungsfehlern. */
  invalid?: boolean;
  className?: string;
  /** Untergrenze/Obergrenze (ISO) — außerhalb liegende Tage sind gesperrt. */
  min?: string;
  max?: string;
  /** Auswählbare Jahre relativ zu heute (Default 3 zurück / 3 voraus). */
  yearsBack?: number;
  yearsForward?: number;
  /** Leeren erlauben (X-Knopf), z. B. für optionale Filter-Felder. */
  clearable?: boolean;
}

export function DatePickerField({
  value,
  onChange,
  "data-testid": testId,
  placeholder = "Datum wählen...",
  disabled,
  invalid,
  className,
  min,
  max,
  yearsBack = 3,
  yearsForward = 3,
  clearable,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const now = new Date();

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        data-testid={testId}
        data-value={value}
        onClick={() => setOpen(true)}
        className={cn(
          "w-full justify-start font-normal bg-card",
          !value && "text-muted-foreground",
          invalid && "border-destructive",
          clearable && value && "pr-8",
        )}
      >
        <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        {selected ? format(selected, "dd.MM.yyyy") : placeholder}
      </Button>
      {clearable && value && !disabled && (
        <button
          type="button"
          aria-label="Datum leeren"
          data-testid={testId ? `${testId}-clear` : undefined}
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {/* Zentriertes Kalender-Overlay statt ankerbasiertem Popover: auf
          iPad/Mobil bleibt die Position damit immer vorhersehbar. Feste
          Breite (statt w-auto), damit Monats-/Jahres-Dropdowns und die
          Navigations-Pfeile nicht gequetscht wirken. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[min(22rem,calc(100vw-2rem))] p-4"
          data-testid={testId ? `${testId}-picker` : undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-base">Datum wählen</DialogTitle>
          </DialogHeader>
          <Calendar
            mode="single"
            locale={de}
            showOutsideDays={false}
            captionLayout="dropdown"
            startMonth={new Date(now.getFullYear() - yearsBack, 0)}
            endMonth={new Date(now.getFullYear() + yearsForward, 11)}
            disabled={[
              ...(min ? [{ before: new Date(`${min}T00:00:00`) }] : []),
              ...(max ? [{ after: new Date(`${max}T00:00:00`) }] : []),
            ]}
            selected={selected}
            defaultMonth={selected ?? now}
            onSelect={(d) => {
              if (!d) return;
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }}
            className="mx-auto"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
