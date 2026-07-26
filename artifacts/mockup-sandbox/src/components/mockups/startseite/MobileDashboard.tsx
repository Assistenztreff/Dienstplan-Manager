import logoUrl from "./logo.png";

// ---------------------------------------------------------------------------
// Smartphone-Ansicht (angemeldet, Menü GESCHLOSSEN):
// Header wie im neuen Konzept (Logo links, Hamburger rechts),
// darunter das Dashboard im AKTUELLEN App-Design (heller Hintergrund,
// weiße Karten mit dezenter Umrandung, Serifen-Überschrift).
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

function Chevron() {
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function KpiCard({ titel, wert, einheit }: { titel: string; wert: string; einheit?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500">{titel}</p>
        <Chevron />
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-900">
        {wert}
        {einheit && <span className="ml-1 text-lg font-normal text-slate-500">{einheit}</span>}
      </p>
    </div>
  );
}

export function MobileDashboard() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Header geschlossen: Logo + Hamburger (hellblau wie Startseite) */}
      <header className="flex h-14 items-center justify-between border-b border-[#b8dede] px-4" style={{ backgroundColor: HELLBLAU }}>
        <img src={logoUrl} alt="AssistenzPlaner" className="h-8 w-auto" />
        <Hamburger />
      </header>

      <main className="space-y-5 px-4 py-6">
        <div>
          <h1 className="font-serif text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Übersicht für Juli 2026</p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <KpiCard titel="Aktive Assistenten" wert="6" />
          <KpiCard titel="Schichten Heute" wert="3" />
          <KpiCard titel="Stundenbilanz Monat" wert="412" einheit="/ 486 h" />
        </div>

        {/* Monatsabschluss-Erinnerung (amber, wie in der App) */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
          <svg className="h-5 w-5 shrink-0 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">Monatsabschluss Juni 2026 steht noch aus</p>
            <p className="mt-0.5 text-xs text-amber-800/80">
              Die Lohnauswertung für Juni 2026 kann jetzt abgeschlossen werden.
            </p>
          </div>
          <Chevron />
        </div>

        {/* Hinweise-Karte (amber) */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
          <p className="flex items-center gap-2 text-base font-semibold text-amber-900">
            <svg className="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
            Hinweise
          </p>
          <div className="mt-3 flex items-start gap-3">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            <div>
              <p className="text-sm font-medium text-slate-900">3 offene Zeiterfassungen</p>
              <p className="text-sm text-slate-500">Noch nicht bestätigt und warten auf Prüfung.</p>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-3">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="m17 22 5-5" /><path d="m17 17 5 5" />
            </svg>
            <div>
              <p className="text-sm font-medium text-slate-900">2 Tage ohne geplante Schicht</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-amber-300 bg-amber-100/50 px-2.5 py-0.5 text-xs text-amber-900">Mi, 29.07.</span>
                <span className="rounded-full border border-amber-300 bg-amber-100/50 px-2.5 py-0.5 text-xs text-amber-900">Fr, 31.07.</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
