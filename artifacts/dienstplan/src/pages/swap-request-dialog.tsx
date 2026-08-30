// ---------------------------------------------------------------------------
// Tauschwunsch — die beiden Dialoge (Kay 30.08.2026).
// ---------------------------------------------------------------------------
// Bewusst getrennt vom Melde-Dialog (deviation-dialog.tsx): Der Tauschwunsch
// betrifft einen NOCH NICHT gearbeiteten Dienst und fragt nach einem Grund,
// nicht nach Uhrzeiten. Gemeinsam waere daraus ein Formular mit zwei Moden
// geworden — dieselbe Verwechslungsgefahr wie beim Vertretungs-Feld.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Assistenzkraft stellt den Tauschwunsch — Grund ist Pflicht. */
export function SwapRequestDialog({
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
        data-testid="swap-request-dialog"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Tausch anfragen</DialogTitle>
          <DialogDescription>
            Der Dienst bleibt zunächst bei dir. Die Planung entscheidet, ob sie ihn
            umbesetzen kann.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="swap-request-reason">Grund *</Label>
          <Textarea
            id="swap-request-reason"
            data-testid="swap-request-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="z. B. Arzttermin an diesem Vormittag"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            data-testid="swap-request-submit"
            disabled={submitting || reason.trim().length < 3}
            onClick={() => onSubmit(reason.trim())}
          >
            Anfrage senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Planer lehnt einen Tauschwunsch ab. Eigener Dialog statt eines schlichten
 * Knopfs, weil eine Ablehnung ohne Antwort die Assistenzkraft ratlos
 * zuruecklaesst — der Hinweis ist optional, aber er soll angeboten werden.
 *
 * Fuer die Zusage gibt es KEINEN Dialog: Der Planer besetzt den Dienst wie
 * immer um und hakt den Wunsch danach mit einem Klick ab.
 */
export function DeclineSwapRequestDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (note: string) => void;
  submitting?: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="swap-decline-dialog"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Tauschwunsch ablehnen</DialogTitle>
          <DialogDescription>
            Der Dienst bleibt unverändert. Die Assistenzkraft sieht deine Antwort.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="swap-decline-note">Antwort (optional)</Label>
          <Textarea
            id="swap-decline-note"
            data-testid="swap-decline-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Niemand sonst ist an dem Tag verfügbar"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="swap-decline-submit"
            disabled={submitting}
            onClick={() => onSubmit(note.trim())}
          >
            Ablehnen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
