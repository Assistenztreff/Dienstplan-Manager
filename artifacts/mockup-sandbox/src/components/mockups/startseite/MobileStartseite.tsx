import logoUrl from "./logo.png";

// ---------------------------------------------------------------------------
// Smartphone-Ansicht (abgemeldet, Menü GESCHLOSSEN):
// kompakter Header mit Logo links und Hamburger rechts,
// darunter die Startseite: Claim, Registrieren-CTA und ein
// stilisierter App-Screenshot mit Erklärung.
// ---------------------------------------------------------------------------

const DARK = "#092948";
const HELLBLAU = "#d4f0f0";

function Hamburger() {
  return (
    <button aria-label="Menü öffnen" className="flex h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-full">
      <span className="h-[2px] w-6 rounded-full" style={{ backgroundColor: DARK }} />
      <span className="h-[2px] w-6 rounded-full" style={{ backgroundColor: DARK }} />
      <span className="h-[2px] w-6 rounded-full" style={{ backgroundColor: DARK }} />
    </button>
  );
}

const ROWS = [
  { name: "Anna Schmidt", dot: "#7dd3fc", dienst: "Früh · 06–14" },
  { name: "Max Müller", dot: "#d9f99d", dienst: "Spät · 14–22" },
  { name: "Lisa Weber", dot: "#a3e635", dienst: "Nacht · 22–06" },
  { name: "Tom Bauer", dot: "#fdba74", dienst: "Früh · 06–14" },
];

export function MobileStartseite() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: HELLBLAU, color: DARK }}>
      {/* Header geschlossen: Logo + Hamburger */}
      <header className="flex h-14 items-center justify-between border-b border-[#b8dede] px-4" style={{ backgroundColor: HELLBLAU }}>
        <img src={logoUrl} alt="AssistenzPlaner" className="h-8 w-auto" />
        <Hamburger />
      </header>

      {/* Claim */}
      <section className="px-6 pb-10 pt-12 text-center">
        <h1 className="text-2xl font-extrabold leading-snug">
          Assistenz Planer – mit unserer Dienstplaner behältst du und dein Team
          immer den Überblick – egal an welchen Ort.
        </h1>
        <div className="mt-6 flex flex-col items-center gap-3">
          <a
            href="#"
            className="inline-flex h-11 items-center rounded-full px-6 text-sm font-semibold text-white shadow-md"
            style={{ backgroundColor: DARK }}
          >
            Jetzt kostenlos registrieren
          </a>
          <a href="#" className="text-sm font-medium underline decoration-[1px] underline-offset-4">
            Login
          </a>
        </div>
      </section>

      {/* Screenshot + Erklärung */}
      <section className="rounded-t-[2rem] bg-white/70 px-5 py-10 backdrop-blur">
        <div className="overflow-hidden rounded-2xl bg-white shadow-md">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
            Dienstplan · Tabelle · Juli 2026
          </div>
          <div className="divide-y divide-slate-100">
            {ROWS.map((r) => (
              <div key={r.name} className="flex items-center justify-between px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.dot }} />
                  {r.name}
                </span>
                <span className="rounded-md bg-[#eef6f6] px-2 py-0.5 text-[11px] font-medium">{r.dienst}</span>
              </div>
            ))}
          </div>
        </div>
        <h3 className="mt-5 text-lg font-bold">Der ganze Monat auf einen Blick</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Alle Assistenzkräfte und ihre Dienste übersichtlich untereinander –
          Dienste anlegen, verschieben und mit einem Klick bestätigen.
        </p>
      </section>

      <footer className="px-6 py-6 text-center text-xs text-slate-500">
        Impressum · Datenschutz · Kontakt · Barrierefreiheit — © 2026 AssistenzTreff
      </footer>
    </div>
  );
}
