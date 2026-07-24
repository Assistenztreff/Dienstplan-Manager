import { useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  CalendarOff,
  BarChart3,
  Settings,
} from "lucide-react";

// Variante A: Plattform-Header in Cyan (#3fb8cc), wie bisheriger brand-cyan.
// Schriftgroessen bewusst moderat gehalten (Header text-sm/base); nur die
// App-Menuepunkte sind etwas groesser (text-base statt text-xs).

const BRAND = {
  cyan: "#3fb8cc",
  dark: "#092948",
  yellow: "#ebf18b",
  gray: "#f3f4f6",
};

const PLATFORM_LINKS = ["Über uns", "Handbuch", "Leistungen"];

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Dienstplan", icon: CalendarDays },
  { label: "Assistenten", icon: Users },
  { label: "Abwesenheiten", icon: CalendarOff },
  { label: "Auswertungen", icon: BarChart3 },
  { label: "Einstellungen", icon: Settings },
];

const FOOTER_LINKS = ["Impressum", "Datenschutz", "Kontakt", "Barrierefreiheit"];

export function ShellDesktop() {
  const [active, setActive] = useState("Dashboard");

  return (
    <div className="flex min-h-screen w-full flex-col bg-white font-sans text-[#092948]">
      {/* Plattform-Header: ~80px, Cyan, alles vertikal mittig */}
      <header
        className="flex h-20 shrink-0 items-center"
        style={{ backgroundColor: BRAND.cyan }}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6">
          {/* Logo / Schriftzug — proportional zu den Links, vertikal mittig */}
          <a
            href="#"
            className="flex h-12 items-center gap-2.5 rounded-md px-2 text-white outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold"
              style={{ color: BRAND.dark }}
              aria-hidden="true"
            >
              A
            </span>
            <span className="text-xl font-bold tracking-tight">AssistenzPlaner</span>
          </a>

          <nav aria-label="Plattform" className="flex items-center gap-2">
            {PLATFORM_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="flex h-12 items-center rounded-md px-4 text-sm font-medium text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {label}
              </a>
            ))}
            <a
              href="#"
              className="ml-2 flex h-12 items-center rounded-md px-4 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              Login
            </a>
            <a
              href="#"
              className="flex h-12 items-center rounded-md px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ backgroundColor: BRAND.dark }}
            >
              Registrieren
            </a>
          </nav>
        </div>
      </header>

      {/* App-Menueleiste: hellgrau, TEXT-Links (keine Pills), aktiver Punkt gelb */}
      <div
        className="shrink-0 border-b border-slate-200"
        style={{ backgroundColor: BRAND.gray }}
      >
        <div className="mx-auto max-w-7xl px-6">
          <nav aria-label="Dienstplan-App" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.label;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setActive(item.label)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-12 items-center gap-2 px-4 text-base transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948] ${
                    isActive
                      ? "font-semibold"
                      : "font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                  style={isActive ? { backgroundColor: BRAND.yellow, color: BRAND.dark } : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Hauptcontent: weiss, zentriert max-w-7xl */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          Beispielinhalt — der Hauptcontent bleibt unverändert (weiß, zentriert).
        </p>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {["Geplante Stunden", "Offene Zeiterfassungen", "Assistenzkräfte"].map((t, i) => (
            <div key={t} className="rounded-lg border border-slate-200 bg-[#f9f9f9] p-5">
              <p className="text-sm font-medium text-slate-600">{t}</p>
              <p className="mt-1 text-2xl font-bold">{[164, 3, 7][i]}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Plattform-Footer: ~120px, schlicht/grau */}
      <footer
        className="flex h-[120px] shrink-0 items-center border-t border-slate-200"
        style={{ backgroundColor: BRAND.gray }}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-3 px-6">
          <nav aria-label="Rechtliches" className="flex flex-wrap items-center justify-center gap-2">
            {FOOTER_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="flex h-11 items-center rounded-md px-4 text-sm font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
              >
                {label}
              </a>
            ))}
          </nav>
          <p className="text-xs text-slate-500">© 2026 AssistenzTreff</p>
        </div>
      </footer>
    </div>
  );
}
