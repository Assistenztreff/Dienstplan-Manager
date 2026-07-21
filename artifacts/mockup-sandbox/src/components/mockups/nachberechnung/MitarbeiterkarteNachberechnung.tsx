const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const signedEuro = (n: number) => `${n > 0 ? "+" : ""}${euro(n)}`;
const h = (n: number) =>
  `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;

export function MitarbeiterkarteNachberechnung() {
  return (
    <div className="min-h-screen w-full bg-background p-6 flex justify-center">
      <div className="w-full max-w-md space-y-4">
        <div className="text-sm text-muted-foreground">
          Mitarbeiterkarte — Ausschnitt „Lohnauswertung“ (grüner Kasten) mit
          Nachberechnung als Stunden für Urlaub und Krankheit:
        </div>

        <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Lisa Weber</div>
              <div className="text-xs text-muted-foreground">Juli 2026</div>
            </div>
            <div className="text-right text-sm">
              <div className="font-semibold">148 h</div>
              <div className="text-xs text-muted-foreground">Bewertete Stunden</div>
            </div>
          </div>

          {/* Lohnauswertung (Premium) */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Lohnauswertung (Soll)
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Grundlohn</span>
              <span className="font-medium">{euro(2442.0)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Nachtzuschlag</span>
              <span className="font-medium">{euro(148.5)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sonntagszuschlag</span>
              <span className="font-medium">{euro(66.0)}</span>
            </div>

            {/* Nachberechnung — NEU: Stunden je Abwesenheitsart + Geldwert */}
            <div className="pt-1.5 border-t border-emerald-200 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Nachberechnung Juni 2026</span>
                <span className="font-medium whitespace-nowrap text-emerald-800">
                  {signedEuro(197.5)}
                </span>
              </div>
              <div className="pl-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                    Urlaub (Lohnfortzahlung)
                  </span>
                  <span className="text-right">
                    <span className="font-medium text-foreground">{h(8)}</span>
                    <span className="block text-muted-foreground">{euro(132.0)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-gray-400 inline-block" />
                    Krankheit (Lohnfortzahlung)
                  </span>
                  <span className="text-right">
                    <span className="font-medium text-foreground">{h(4)}</span>
                    <span className="block text-muted-foreground">{euro(66.0)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Sonstige Änderungen (Dienste/Zuschläge)
                  </span>
                  <span className="text-right">
                    <span className="font-medium text-foreground">{h(0)}</span>
                    <span className="block text-muted-foreground">{signedEuro(-0.5)}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200">
              <span className="font-medium text-emerald-800">
                Gesamtlohn (brutto) inkl. Nachberechnung
              </span>
              <span className="font-semibold text-emerald-800">{euro(2854.0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
