import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formatiert abgeleitete Urlaubs-Tageswerte einheitlich im deutschen Format:
 * ganze Tage ohne Nachkommastelle ("3"), Bruchteile mit einer Stelle und
 * Dezimalkomma ("3,5"). Wird überall in der Urlaubs-UI und im PDF-Export
 * genutzt, damit halbe Urlaubstage konsistent erscheinen.
 */
export function formatDays(days: number): string {
  return days.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
}

/**
 * Wie {@link formatDays}, hängt aber die passende deutsche Einheit an
 * ("1 Tag" / "3,5 Tage"). Grammatik: nur exakt 1 → "Tag", sonst "Tage".
 */
export function formatDaysWithUnit(days: number): string {
  return `${formatDays(days)} ${days === 1 ? "Tag" : "Tage"}`
}

/**
 * Formatiert Stundenwerte im deutschen Format (Dezimalkomma), ohne
 * unnötige Nullen. Genutzt z. B. für "1 Urlaubstag = 5,6 h".
 */
export function formatHours(hours: number): string {
  return hours.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
