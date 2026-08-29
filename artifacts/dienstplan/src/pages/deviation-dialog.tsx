import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Shift } from "./dienstplan-helpers";

/** Wandelt eine "HH:mm"-Uhrzeit in einen vollen ISO-Zeitstempel um, auf
 *  Basis des Kalendertags von referenceDate (wie im Melde-Dialog gebraucht:
 *  der geplante Starttag der Schicht). */
function timeToIso(time: string, referenceDate: Date): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(referenceDate);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

export interface DeviationReportValues {
  startTime: string;
  endTime: string;
  pauseMinutes: number;
  ausgefallen: boolean;
}

/** Melde-Dialog "Zeit korrigieren" — Assistenzkraft meldet die tatsächlich
 *  geleistete Zeit für einen bereits vergangenen, bestätigten Dienst.
 *  Feldset/Verhalten folgt dem abgenommenen Mockup
 *  (02 Projekte/Dienstplan-Mockups/abweichung-mockup.html im Vault). */
export function ReportDeviationDialog({
  shift,
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  shift: Shift;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DeviationReportValues) => void;
  submitting?: boolean;
}) {
  const planStart = new Date(shift.startTime);
  const planEnd = new Date(shift.endTime);
  const [von, setVon] = useState(format(planStart, "HH:mm"));
  const [bis, setBis] = useState(format(planEnd, "HH:mm"));
  const [pause, setPause] = useState(String(shift.pauseMinutes ?? 0));
  const [ausgefallen, setAusgefallen] = useState(false);

  const vonIso = timeToIso(von, planStart);
  let bisIso = timeToIso(bis, planStart);
  // Nachtdienst-Fall: "Bis" liegt vor "Von" — ein Tag addieren (gleiche
  // Annahme wie im regulären Schicht-Dialog).
  if (new Date(bisIso).getTime() <= new Date(vonIso).getTime()) {
    const d = new Date(bisIso);
    d.setDate(d.getDate() + 1);
    bisIso = d.toISOString();
  }
  const stunden = ausgefallen
    ? 0
    : Math.max(
        0,
        (new Date(bisIso).getTime() - new Date(vonIso).getTime()) / 3_600_000 -
          (Number(pause) || 0) / 60,
      );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="deviation-report-dialog"
        onClick={(e) => e.stopPropagation()}
        // Ohne das öffnet der Dialog automatisch das native Zeit-Popup des
        // ersten Felds (Von) beim Aufklappen — soll nur bei bewusstem Klick
        // ins Feld aufgehen (gleiches Muster wie im Schicht-Dialog).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Zeit korrigieren</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Geplant: {format(planStart, "HH:mm")}–{format(planEnd, "HH:mm")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Von</Label>
              <Input
                type="time"
                data-testid="deviation-from"
                value={von}
                disabled={ausgefallen}
                onChange={(e) => setVon(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bis</Label>
              <Input
                type="time"
                data-testid="deviation-to"
                value={bis}
                disabled={ausgefallen}
                onChange={(e) => setBis(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Pause (Min.)</Label>
            <Input
              type="number"
              min={0}
              max={1440}
              step={5}
              data-testid="deviation-pause"
              value={pause}
              disabled={ausgefallen}
              onChange={(e) => setPause(e.target.value)}
            />
          </div>
          <p className="text-sm" data-testid="deviation-hours">
            Ergibt: <span className="font-semibold">{stunden.toFixed(1).replace(".", ",")} Std.</span>
            {ausgefallen && " (ausgefallen)"} · automatisch berechnet, nicht editierbar
          </p>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            data-testid="deviation-ausgefallen"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={ausgefallen}
              onChange={(e) => setAusgefallen(e.target.checked)}
            />
            Dienst ist ausgefallen
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            data-testid="deviation-submit"
            disabled={submitting}
            onClick={() =>
              onSubmit({
                startTime: vonIso,
                endTime: ausgefallen ? vonIso : bisIso,
                pauseMinutes: ausgefallen ? 0 : Math.max(0, Number(pause) || 0),
                ausgefallen,
              })
            }
          >
            Korrektur senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Widerspruch-Dialog — Planer lehnt eine gemeldete Abweichung mit
 *  Begründung ab. Der Planwert bleibt maßgeblich, die Schicht wird dabei
 *  NICHT geändert. */
export function DisputeDeviationDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  submitting?: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="deviation-dispute-dialog"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Gemeldete Korrektur ablehnen</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label>Grund *</Label>
          <Textarea
            data-testid="deviation-dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="z. B. Übergabe war um 15:00 beendet"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="deviation-dispute-submit"
            disabled={submitting || reason.trim().length === 0}
            onClick={() => onSubmit(reason.trim())}
          >
            Widerspruch senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Widerspruch der Assistenzkraft gegen eine Planer-Korrektur ("Weg A",
 * 28.08.2026). Bewusst dasselbe schlichte Muster wie DisputeDeviationDialog —
 * es ist derselbe Vorgang in die andere Richtung, und beide Seiten sollen ihn
 * wiedererkennen. Zeigt zusätzlich die bestrittene Zeit, damit klar ist,
 * wogegen der Widerspruch geht.
 */
export function ObjectCorrectionDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  zeitraum,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  submitting?: boolean;
  /** Die vom Planer eingetragene Zeit, z. B. "09:00–18:00". */
  zeitraum?: string;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="correction-object-dialog"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Korrektur ablehnen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            {zeitraum
              ? `Der Arbeitgeber hat diesen Dienst nachträglich auf ${zeitraum} geändert.`
              : "Der Arbeitgeber hat diesen Dienst nachträglich geändert."}{" "}
            Dein Widerspruch ändert die Zeit nicht — er hält fest, dass ihr euch
            nicht einig seid. Der Arbeitgeber kann die Korrektur danach
            zurücknehmen oder nachbearbeiten.
          </p>
          <div className="space-y-1.5">
            <Label>Grund *</Label>
            <Textarea
              data-testid="correction-object-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="z. B. Ich habe bis 20:00 gearbeitet, nicht bis 18:00"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="correction-object-submit"
            disabled={submitting || reason.trim().length === 0}
            onClick={() => onSubmit(reason.trim())}
          >
            Widerspruch senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
