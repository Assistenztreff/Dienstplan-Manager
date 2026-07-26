import logoUrl from "./logo.png";

// ---------------------------------------------------------------------------
// Smartphone-Ansicht (angemeldet, Menü GESCHLOSSEN):
// kompakter Header mit Logo links und Hamburger rechts,
// darunter das Dashboard der Dienstplan-App (stilisiert).
// ---------------------------------------------------------------------------

const DARK = "#092948";
const HELLBLAU = "#d4f0f0";
const YELLOW = "#ebf18b";

function Hamburger() {
  return (
    <button aria-label="Menü öffnen" className="flex h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-full">
      <span className="h-[2px] w-6 rounded-full" style={{ backgroundColor: DARK }} />
      <span className="h-[2px] w-6 rounded-full" style={{ backgroundColor: DARK }} />
      <span className="h-[2px] w-6 rounded-full" style={{ backgroundColor: DARK }} />
    </button>
  );
}

function Kachel({ titel, wert, hinweis }: { titel: string; wert: string; hinweis?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{titel}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: DARK }}>{wert}</p>
      {hinweis && <p className="mt-0.5 text-[11px] text-slate-400">{hinweis}</p>}
    </div>
  );
}

export function MobileDashboard() {
  const dienste = [
    { tag: "Mo, 27. Juli", dienst: "Frühdienst · 06–14 Uhr", wer: "Anna Schmidt" },
    { tag: "Mo, 27. Juli", dienst: "Spätdienst · 14–22 Uhr", wer: "Max Müller" },
    { tag: "Di, 28. Juli", dienst: "Nachtdienst · 22–06 Uhr", wer: "Lisa Weber" },
  ];
  return (
    <div className="min-h-screen" style={{ backgroundColor: HELLBLAU, color: DARK }}>
      {/* Header geschlossen: Logo + Hamburger */}
      <header className="flex h-14 items-center justify-between border-b border-[#b8dede] px-4" style={{ backgroundColor: HELLBLAU }}>
        <img src={logoUrl} alt="AssistenzPlaner" className="h-8 w-auto" />
        <Hamburger />
      </header>

      <main className="space-y-5 px-4 py-5">
        <div>
          <h1 className="text-xl font-bold">Guten Morgen, Oliver</h1>
          <p className="text-sm text-slate-600">Sonntag, 26. Juli 2026</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Kachel titel="Dienste diesen Monat" wert="42" hinweis="davon 38 FIX" />
          <Kachel titel="Offene Stundenzettel" wert="3" hinweis="zu bestätigen" />
          <Kachel titel="Plan-Stunden Juli" wert="486 h" />
          <Kachel titel="Abwesenheiten" wert="2" hinweis="Urlaub · Krankheit" />
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Nächste Dienste</h2>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: YELLOW }}>Juli</span>
          </div>
          <div className="mt-3 space-y-2">
            {dienste.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold">{d.tag}</p>
                  <p className="text-[11px] text-slate-500">{d.dienst}</p>
                </div>
                <span className="text-[11px] font-medium text-slate-600">{d.wer}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ backgroundColor: DARK }}>
          <p className="text-sm font-semibold text-white">Monatsabschluss Juni offen</p>
          <p className="mt-1 text-xs text-slate-300">Friere die Lohnauswertung ein, sobald alle Stunden bestätigt sind.</p>
          <button className="mt-3 rounded-full px-4 py-1.5 text-xs font-semibold" style={{ backgroundColor: YELLOW, color: DARK }}>
            Jetzt abschließen
          </button>
        </div>
      </main>
    </div>
  );
}
