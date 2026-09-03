// ---------------------------------------------------------------------------
// Planungsmodus — Werkzeugleiste (Etappe 2, Kay-Auftrag 02.09.2026)
// ---------------------------------------------------------------------------
// Im Planungsmodus wirken Klicks anders: Ein Klick auf eine Dienstpille dreht
// die Person weiter, statt den Bearbeiten-Dialog zu oeffnen. Genau deshalb
// BRAUCHT es einen sichtbaren Modus — ohne ihn waere ein Fehlklick eine
// stille Umbesetzung. Die Leiste macht ausserdem sichtbar, was der Modus
// kann, statt es im Ueberlauf-Menue zu verstecken.
//
// Aufbau (Kays Punkt 5): Zauberstab = automatische Planung, Zahnrad = ihre
// Grenzen, Auswahl-Symbol = alles auswaehlen, Muelleimer = Auswahl loeschen.
// Der Muelleimer erscheint erst, wenn Tage ausgewaehlt sind — ein Loeschknopf
// ohne Ziel ist nur eine Stolperfalle.
//
// Das Auswahl-Symbol waehlt seit dem 03.09.2026 (Kays Punkt 4) mit EINEM
// Druck alle Dienste des Monats aus. Der Grund ist die Praxis: Wer im
// Planungsmodus etwas loescht, raeumt fast immer den ganzen Monat ab und
// behaelt ein paar Dienste. Erst auswaehlen und dann 30-mal klicken waere die
// Arbeit andersherum. Abgewaehlt wird danach durch einen Klick auf die Pille
// selbst — sie ist der Haken (Weg 1 von drei Vorschlaegen, Kays Wahl).
import { useState } from "react";
import { Wand2, Settings2, SquareDashedMousePointer, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type PlanungsGrenzen = {
  blockLaenge: number;
  ruhezeitStunden: number;
};

/** Der gesetzliche Regelfall nach ArbZG § 5 — Abweichung nur tariflich (§ 7). */
export const RUHEZEIT_REGELFALL = 11;

export function PlanungsmodusLeiste({
  grenzen,
  onGrenzenAendern,
  grenzenSpeichern,
  laeuft,
  onAutomatik,
  auswahlAktiv,
  onAuswahlUmschalten,
  anzahlAusgewaehlt,
  anzahlAuswaehlbar,
  onAuswahlLoeschen,
  onBeenden,
}: {
  grenzen: PlanungsGrenzen;
  /** Waehrend des Tippens — noch nicht gespeichert. */
  onGrenzenAendern: (g: PlanungsGrenzen) => void;
  /** Beim Schliessen des Zahnrads: an den Server. */
  grenzenSpeichern: () => void;
  laeuft: boolean;
  onAutomatik: () => void;
  auswahlAktiv: boolean;
  /** Ein Druck waehlt ALLE Dienste des Monats; der naechste hebt sie auf. */
  onAuswahlUmschalten: () => void;
  anzahlAusgewaehlt: number;
  /** Wie viele Dienste im Monat ueberhaupt auswaehlbar sind. */
  anzahlAuswaehlbar: number;
  onAuswahlLoeschen: () => void;
  onBeenden: () => void;
}) {
  const [zahnradOffen, setZahnradOffen] = useState(false);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-assistenz-brand/40 bg-assistenz-mint/40 px-3 py-2"
      data-testid="planungsmodus-leiste"
    >
      <span className="text-sm font-semibold text-[#151515]">Planungsmodus</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {auswahlAktiv
          ? "Klick auf eine Pille wählt sie ab"
          : "Klick auf eine Pille wechselt die Person"}
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={onAutomatik}
          disabled={laeuft}
          title="Offene Plätze des Regelplans reihum besetzen — als Entwürfe"
          data-testid="planungsmodus-automatik"
        >
          <Wand2 className="h-4 w-4" />
          {laeuft ? "Plane..." : "Automatisch planen"}
        </Button>

        <Popover
          open={zahnradOffen}
          onOpenChange={(offen) => {
            setZahnradOffen(offen);
            // Beim Zuklappen einmal speichern — nicht bei jedem Tastendruck.
            if (!offen) grenzenSpeichern();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 px-0"
              title="Grenzen der automatischen Planung"
              aria-label="Grenzen der automatischen Planung"
              data-testid="planungsmodus-zahnrad"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3" align="end">
            <div className="space-y-1.5">
              <Label htmlFor="planung-block">Dienste am Stück</Label>
              <Input
                id="planung-block"
                data-testid="planung-block"
                type="number"
                min="1"
                max="14"
                value={String(grenzen.blockLaenge)}
                onChange={(e) =>
                  onGrenzenAendern({ ...grenzen, blockLaenge: Number(e.target.value) || 1 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Wie viele Dienste eine Person hintereinander übernimmt, bevor die nächste dran
                ist. 1 = täglich wechseln.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planung-ruhezeit">Ruhezeit (Stunden)</Label>
              <Input
                id="planung-ruhezeit"
                data-testid="planung-ruhezeit"
                type="number"
                min="0"
                max="48"
                value={String(grenzen.ruhezeitStunden)}
                onChange={(e) =>
                  onGrenzenAendern({
                    ...grenzen,
                    ruhezeitStunden: Number(e.target.value) || 0,
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Mindestabstand zwischen zwei Diensten einer Person — innerhalb eines Blocks
                bewusst ausgenommen.
              </p>
            </div>
            {grenzen.ruhezeitStunden < RUHEZEIT_REGELFALL && (
              <p
                className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900"
                data-testid="planung-ruhezeit-hinweis"
              >
                Unter {RUHEZEIT_REGELFALL} Stunden: Das ArbZG sieht {RUHEZEIT_REGELFALL} Stunden
                Ruhezeit vor (§ 5). Abweichungen sind nur auf tariflicher Grundlage zulässig
                (§ 7 — auch nicht tarifgebundene Arbeitgeber können einen einschlägigen
                Tarifvertrag übernehmen).
              </p>
            )}
          </PopoverContent>
        </Popover>

        {/* Kay-Auftrag 03.09.2026, Punkt 4: Ein Druck waehlt alle Dienste des
            Monats — danach klickt man die wenigen Pillen wieder ab, die
            bleiben sollen. Das ist der haeufigere Weg: „fast alles weg" statt
            „ein paar einzelne weg". Der Zaehler steht im Knopf, damit man ohne
            Nachzaehlen sieht, worauf der Muelleimer gleich zielt. */}
        <Button
          size="sm"
          variant={auswahlAktiv ? "default" : "outline"}
          className={anzahlAusgewaehlt > 0 ? "gap-1.5" : "h-9 w-9 px-0"}
          onClick={onAuswahlUmschalten}
          disabled={anzahlAuswaehlbar === 0 && !auswahlAktiv}
          title={
            auswahlAktiv
              ? "Auswahl aufheben"
              : anzahlAuswaehlbar === 0
                ? "Keine Dienste zum Auswählen"
                : `Alle ${anzahlAuswaehlbar} Dienste auswählen`
          }
          aria-label={auswahlAktiv ? "Auswahl aufheben" : "Alle Dienste auswählen"}
          aria-pressed={auswahlAktiv}
          data-testid="planungsmodus-auswahl"
        >
          <SquareDashedMousePointer className="h-4 w-4" />
          {anzahlAusgewaehlt > 0 && <span>{anzahlAusgewaehlt}</span>}
        </Button>

        {/* Erst mit Ziel: ein Loeschknopf ohne Auswahl ist nur eine Falle. */}
        {anzahlAusgewaehlt > 0 && (
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={onAuswahlLoeschen}
            title={`${anzahlAusgewaehlt} ${anzahlAusgewaehlt === 1 ? "Dienst" : "Dienste"} löschen`}
            aria-label={`${anzahlAusgewaehlt} ${anzahlAusgewaehlt === 1 ? "Dienst" : "Dienste"} löschen`}
            data-testid="planungsmodus-loeschen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-9 w-9 px-0"
          onClick={onBeenden}
          title="Planungsmodus beenden"
          aria-label="Planungsmodus beenden"
          data-testid="planungsmodus-beenden"
        >
          <X className="h-4 w-4" />
        </Button>
      </span>
    </div>
  );
}
