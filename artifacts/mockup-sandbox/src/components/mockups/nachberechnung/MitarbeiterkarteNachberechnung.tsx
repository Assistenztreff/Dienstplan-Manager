const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const signedEuro = (n: number) => `${n > 0 ? "+" : ""}${euro(n)}`;
const h = (n: number) =>
  `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;

export function MitarbeiterkarteNachberechnung() {
  return (
    <div className="min-h-screen w-full bg-background p-6 flex justify-center">
      <div className="w-full max-w-lg space-y-3">
        <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
          <div className="font-semibold text-lg">Tolga Kahraman</div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Geleistete Stunden (gewertet)</span>
            <span className="font-semibold">120 / 120 h</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full w-full bg-lime-400" />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Differenz: <span className="text-green-700 font-medium">0 h</span>
            </span>
            <span>100% geleistet</span>
          </div>

          <div className="rounded-lg border bg-muted/40 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Erfüllt gesamt (inkl. Urlaub/Krank)</span>
            <span className="font-semibold">120 h</span>
          </div>

          <div className="rounded-lg border bg-muted/40 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Krankheitsstunden (Lohnfortzahlung)</span>
            <span className="font-semibold">0 h</span>
          </div>

          {/* NEU: eigenes Kästchen für die Nachberechnung des Vormonats */}
          <div className="rounded-lg border border-amber-300/70 bg-amber-50/50 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Nachberechnung Krankheitsstunden Vormonat
              </span>
              <span className="font-semibold">4 h</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Nachberechnung Urlaubsstunden Vormonat
              </span>
              <span className="font-semibold">8 h</span>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/40 px-3 py-2 space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bewertete Stunden &amp; Zuschläge
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Bewertete Stunden</span>
              <span className="font-semibold">120 h</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Nacht (25%)</span>
              <span className="font-medium">
                35 h <span className="text-emerald-700">(+8,75 h)</span>
              </span>
            </div>
          </div>

          {/* Grüner Kasten: bleibt exakt wie heute in der App */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Lohnauswertung (Soll)
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Grundlohn</span>
              <span className="font-medium">{euro(2448.0)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Nachtzuschlag</span>
              <span className="font-medium">{euro(178.5)}</span>
            </div>
            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200">
              <span className="text-muted-foreground">
                Nachberechnung Juni 2026
                <span className="block text-xs">
                  Grundlohn {signedEuro(-285.6)} · Zuschläge {signedEuro(-35.7)}
                </span>
              </span>
              <span className="font-medium whitespace-nowrap text-red-700">
                {signedEuro(-321.3)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200">
              <span className="font-medium text-emerald-800">
                Gesamtlohn (brutto) inkl. Nachberechnung
              </span>
              <span className="font-semibold text-emerald-800">{euro(2305.2)}</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Neu ist nur das gelb umrandete Kästchen: Nachberechnungs-Stunden für
          Krankheit und Urlaub aus dem Vormonat ({h(4)} Krankheit, {h(8)} Urlaub).
          Der grüne Kasten „Lohnauswertung“ bleibt unverändert.
        </p>
      </div>
    </div>
  );
}
