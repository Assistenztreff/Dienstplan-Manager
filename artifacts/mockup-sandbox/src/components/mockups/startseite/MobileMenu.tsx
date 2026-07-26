import logoUrl from "./logo.png";

// ---------------------------------------------------------------------------
// Mobile-Menü (eingeloggt) — Mockup nach Vorbild assistenztreff.de:
// EIN Hamburger oben rechts öffnet das Menü. Oben die Dienstplan-App-
// Navigation als weiße Pillen-Buttons (aktiver Punkt gelb markiert),
// darunter kleiner die Plattform-Links + Logout.
// Farben: brand-hellblau #d4f0f0, brand-dark #092948, brand-yellow #ebf18b
// ---------------------------------------------------------------------------

const DARK = "#092948";
const HELLBLAU = "#d4f0f0";
const YELLOW = "#ebf18b";

const APP_MENU = [
  { label: "Dashboard", active: false },
  { label: "Dienstplan", active: true },
  { label: "Auswertungen", active: false },
  { label: "Abwesenheiten", active: false },
  { label: "Zeiterfassung", active: false },
  { label: "Einstellungen", active: false },
];

function Pill({ label, active }: { label: string; active: boolean }) {
  return (
    <a
      href="#"
      className="flex h-14 items-center justify-center rounded-full border text-lg font-semibold shadow-sm transition-colors"
      style={{
        backgroundColor: active ? YELLOW : "#ffffff",
        borderColor: DARK,
        color: DARK,
      }}
    >
      {label}
    </a>
  );
}

export function MobileMenu() {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: HELLBLAU, color: DARK }}
    >
      {/* Kopfzeile: Logo links, schließen rechts */}
      <div className="flex items-center justify-between px-5 pt-5">
        <img src={logoUrl} alt="AssistenzPlaner" className="h-9 w-auto" />
        <button className="flex items-center gap-2 text-base font-semibold underline decoration-[1px] underline-offset-4">
          schließen
          <span aria-hidden className="text-xl leading-none">×</span>
        </button>
      </div>

      {/* App-Navigation als Pillen-Buttons */}
      <nav className="mt-8 flex flex-col gap-4 px-6">
        {APP_MENU.map((m) => (
          <Pill key={m.label} label={m.label} active={m.active} />
        ))}
      </nav>

      {/* Plattform-Links + Konto */}
      <div className="mt-10 flex items-start justify-between px-8 pb-10">
        <div className="flex flex-col gap-4 text-base font-medium">
          <a href="#" className="underline decoration-[1px] underline-offset-4">Leistungen</a>
          <a href="#" className="underline decoration-[1px] underline-offset-4">Über uns</a>
          <a href="#" className="underline decoration-[1px] underline-offset-4">Handbuch</a>
        </div>
        <div className="flex flex-col items-end gap-4">
          <span className="text-sm text-slate-600">Angemeldet als Julia</span>
          <a
            href="#"
            className="inline-flex h-9 items-center rounded-full px-5 text-sm font-semibold text-white"
            style={{ backgroundColor: DARK }}
          >
            Abmelden
          </a>
        </div>
      </div>
    </div>
  );
}
