// Automatische Pausen-Vorbefüllung (Pausenregelung in den Einstellungen).
//
// Die Regel ist eine zweistufige Staffel nach Dienstdauer (Defaults =
// gesetzliche Staffel § 4 ArbZG: ab 6 h → 30 min, ab 9 h → 45 min), frei
// konfigurierbar über die Konto-Einstellungen (allowance_settings). Sie dient
// NUR der Vorbefüllung des Felds "Unbezahlte Pause" im Schicht-Dialog —
// bestehende Dienste werden nie rückwirkend verändert, der Wert bleibt pro
// Dienst überschreibbar.

export type PauseRule = {
  pauseAutoEnabled?: boolean;
  pauseThreshold1Hours?: number;
  pauseMinutes1?: number;
  pauseThreshold2Hours?: number;
  pauseMinutes2?: number;
};

/**
 * Liefert die vorzubefüllenden Pausenminuten für eine Dienstdauer (Minuten)
 * gemäß Staffel, oder 0 wenn die Regel aus ist bzw. keine Stufe erreicht wird.
 * Die höhere Stufe gewinnt; sind die Schwellen vertauscht konfiguriert, wird
 * trotzdem die zur Dauer passende höchste erreichte Stufe genommen.
 */
export function computeAutoPauseMinutes(durationMinutes: number, rule: PauseRule): number {
  if (!rule.pauseAutoEnabled) return 0;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  const hours = durationMinutes / 60;
  const stages = [
    { threshold: rule.pauseThreshold1Hours ?? 6, minutes: rule.pauseMinutes1 ?? 30 },
    { threshold: rule.pauseThreshold2Hours ?? 9, minutes: rule.pauseMinutes2 ?? 45 },
  ]
    .filter((s) => s.threshold > 0 && s.minutes >= 0)
    .sort((a, b) => a.threshold - b.threshold);
  let result = 0;
  for (const s of stages) {
    if (hours >= s.threshold) result = s.minutes;
  }
  return result;
}
