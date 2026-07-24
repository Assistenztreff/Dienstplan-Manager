import { useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  CalendarOff,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
} from "lucide-react";

// Mobile Ansicht (390px): Cyan-Header kompakt, App-Menue-Leiste mit
// Hamburger, Off-Canvas-Drawer mit Text-Links + gelbem Aktiv-Status.
// Grosse Touch-Flaechen (h-12), Fokus auf Screenreader (aria-Attribute).

const BRAND = {
  cyan: "#3fb8cc",
  dark: "#092948",
  yellow: "#ebf18b",
  gray: "#f3f4f6",
};

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Dienstplan", icon: CalendarDays },
  { label: "Assistenten", icon: Users },
  { label: "Abwesenheiten", icon: CalendarOff },
  { label: "Auswertungen", icon: BarChart3 },
  { label: "Einstellungen", icon: Settings },
];

const FOOTER_LINKS = ["Impressum", "Datenschutz", "Kontakt", "Barrierefreiheit"];

export function ShellMobile() {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState("Dienstplan");

  return (
    <div className="flex min-h-screen w-full justify-center bg-slate-200 font-sans">
      <div className="relative flex min-h-screen w-full max-w-[390px] flex-col bg-white text-[#092948]">
        {/* Plattform-Header mobil: Logo + Login/Registrieren kompakt */}
        <header
          className="flex h-16 shrink-0 items-center justify-between px-4"
          style={{ backgroundColor: BRAND.cyan }}
        >
          <a href="#" className="flex h-12 items-center gap-2 rounded-md text-white">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-base font-bold"
              style={{ color: BRAND.dark }}
              aria-hidden="true"
            >
              A
            </span>
            <span className="text-lg font-bold tracking-tight">AssistenzPlaner</span>
          </a>
          <a
            href="#"
            className="flex h-11 items-center rounded-md px-4 text-sm font-semibold text-white"
            style={{ backgroundColor: BRAND.dark }}
          >
            Registrieren
          </a>
        </header>

        {/* App-Menue-Leiste: Hamburger oeffnet Drawer */}
        <div
          className="shrink-0 border-b border-slate-200 px-3 py-2"
          style={{ backgroundColor: BRAND.gray }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="App-Menü öffnen"
            aria-expanded={open}
            className="flex h-12 items-center gap-2 rounded-md px-3 text-base font-medium text-slate-700 hover:bg-slate-200"
          >
            <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>App-Menü</span>
          </button>
        </div>

        {/* Hauptcontent */}
        <main className="flex-1 px-4 py-6">
          <h1 className="text-xl font-bold">Dienstplan</h1>
          <div className="mt-4 space-y-3">
            {["Frühdienst 06–14 · Anna Schmidt", "Spätdienst 14–22 · Max Müller"].map((t) => (
              <div key={t} className="rounded-lg border border-slate-200 bg-[#f9f9f9] p-4 text-sm">
                {t}
              </div>
            ))}
          </div>
        </main>

        {/* Footer mobil: gestapelte Links, grosse Touch-Flaechen */}
        <footer
          className="shrink-0 border-t border-slate-200 py-4"
          style={{ backgroundColor: BRAND.gray }}
        >
          <nav aria-label="Rechtliches" className="flex flex-wrap justify-center gap-x-1 gap-y-0 px-2">
            {FOOTER_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="flex h-11 items-center rounded-md px-3 text-sm font-medium text-slate-600"
              >
                {label}
              </a>
            ))}
          </nav>
          <p className="mt-1 text-center text-xs text-slate-500">© 2026 AssistenzTreff</p>
        </footer>

        {/* Drawer-Backdrop */}
        {open && (
          <div
            className="absolute inset-0 z-40 bg-[#092948]/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Off-Canvas-Drawer: Text-Links, gelber Aktiv-Status, h-12 Touch-Ziele */}
        <div
          role="dialog"
          aria-label="App-Menü"
          className={`absolute inset-y-0 left-0 z-50 flex w-72 transform flex-col bg-slate-100 shadow-xl transition-transform duration-300 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <span className="text-base font-semibold text-slate-700">Menü</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Menü schließen"
              className="flex h-11 w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Dienstplan-App" className="flex flex-col gap-1 p-3">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.label;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setActive(item.label)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-12 items-center gap-3 rounded-md px-4 text-base transition-colors ${
                    isActive
                      ? "font-semibold"
                      : "font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                  style={isActive ? { backgroundColor: BRAND.yellow, color: BRAND.dark } : undefined}
                >
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-slate-200 p-3">
            <p className="mb-1 truncate px-2 text-sm text-slate-500">Oliver Straub</p>
            <button
              type="button"
              className="flex h-12 w-full items-center gap-3 rounded-md px-4 text-base font-medium text-slate-600 hover:bg-slate-200"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Abmelden</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
