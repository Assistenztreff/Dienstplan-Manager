import './_group.css';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  CalendarOff,
  BarChart3,
  Settings,
  LogOut,
  Sun,
  ChevronRight,
  AlertTriangle,
  CalendarX,
} from "lucide-react";

const BRAND = {
  cyan: "#d4f0f0",
  brand: "#05305b",
  dark: "#092948",
  yellow: "#ebf18b",
};

const PLATFORM_LINKS = ["Über uns", "Handbuch", "Leistungen"];

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Dienstplan", icon: CalendarDays },
  { label: "Assistenten", icon: Users },
  { label: "Abwesenheiten", icon: CalendarOff },
  { label: "Auswertungen", icon: BarChart3 },
  { label: "Einstellungen", icon: Settings },
  { label: "Abmelden", icon: LogOut },
];

const KPIS = [
  { label: "Aktive Assistenten", value: "7", suffix: null },
  { label: "Schichten Heute", value: "3", suffix: null },
  { label: "Geplante Stunden (Monat)", value: "486", suffix: "h" },
];

const HEUTE = [
  { name: "Anna Schmidt", zeit: "06 – 14 Uhr", dienst: "Frühdienst", color: "#cae677" },
  { name: "Sarah Klein", zeit: "14 – 22 Uhr", dienst: "Spätdienst", color: "#f5c7a9" },
  { name: "Jonas Vogt", zeit: "22 – 06 Uhr", dienst: "Nachtdienst", color: "#e2d4f0" },
];

const FREIE_TAGE = [
  "Sa., 25.07.",
  "So., 26.07.",
  "Mo., 27.07.",
  "Di., 28.07.",
  "Mi., 29.07.",
];

const FOOTER_LINKS = ["Impressum", "Datenschutz", "Kontakt"];

export function DashboardAkzent() {
  return (
    <div className="dienstplan-mockup flex min-h-screen w-full flex-col bg-white font-sans text-[#092948]">
      {/* Plattform-Header */}
      <header
        className="flex h-16 shrink-0 items-center"
        style={{ backgroundColor: BRAND.cyan }}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6">
          <a
            href="#"
            className="flex h-11 items-center gap-2.5 rounded-md px-1 outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
            style={{ color: BRAND.dark }}
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-base font-bold text-white"
              style={{ backgroundColor: BRAND.dark }}
              aria-hidden="true"
            >
              A
            </span>
            <span className="font-serif text-xl font-bold tracking-tight">AssistenzPlaner</span>
          </a>

          <nav aria-label="Plattform" className="flex items-center gap-1">
            {PLATFORM_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="flex h-11 items-center rounded-md px-3 text-sm font-medium underline underline-offset-4 transition-colors hover:bg-[#ebf18b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
                style={{ color: BRAND.dark }}
              >
                {label}
              </a>
            ))}
            <a
              href="#"
              className="ml-2 flex h-11 items-center rounded-md px-3 text-sm font-medium underline underline-offset-4 transition-colors hover:bg-[#ebf18b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
              style={{ color: BRAND.dark }}
            >
              Profil
            </a>
            <a
              href="#"
              className="flex h-11 items-center rounded-full border px-5 text-sm font-semibold text-white transition-colors hover:bg-[#ebf18b] hover:text-[#092948] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#092948]"
              style={{ backgroundColor: BRAND.dark, borderColor: BRAND.dark }}
            >
              Logout
            </a>
          </nav>
        </div>
      </header>

      {/* App-Navigation */}
      <div className="shrink-0 border-b border-slate-200 bg-[#f6f7f9]">
        <div className="mx-auto max-w-7xl px-6">
          <nav aria-label="Dienstplan-App" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-current={item.active ? "page" : undefined}
                className={`flex h-12 items-center gap-2 px-3.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948] ${
                  item.active
                    ? "font-semibold"
                    : "font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                }`}
                style={item.active ? { backgroundColor: BRAND.yellow, color: BRAND.dark } : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pb-10 pt-6">
        {/* Begrüßungs-Panel (Markanter Auftakt) mit überlappenden KPIs */}
        <section className="relative">
          <div
            className="rounded-2xl px-8 pb-20 pt-7"
            style={{ backgroundColor: BRAND.brand }}
          >
            <div className="flex items-center gap-2" style={{ color: BRAND.yellow }}>
              <Sun className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm font-semibold uppercase tracking-wide">Samstag, 25. Juli 2026</span>
            </div>
            <h1 className="mt-2 font-serif text-3xl font-bold text-white">
              Guten Morgen, Oliver
            </h1>
            <p className="mt-1 text-sm text-white/70">Übersicht für Juli 2026</p>
          </div>

          {/* KPI-Karten, überlappend ins Panel */}
          <div className="relative -mt-14 grid grid-cols-3 gap-5 px-2">
            {KPIS.map((kpi) => (
              <button
                key={kpi.label}
                type="button"
                className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 text-left shadow-md transition-colors hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-500">{kpi.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </div>
                <div className="mt-3 font-serif text-4xl font-bold text-[#05305b]">
                  {kpi.value}
                  {kpi.suffix && (
                    <span className="ml-1 text-xl font-normal text-slate-400">{kpi.suffix}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Zwei-Spalten-Zone */}
        <div className="mt-8 grid grid-cols-[1.15fr_1fr] gap-5">
          {/* Heute im Dienst */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-serif text-lg font-semibold text-[#05305b]">Heute im Dienst</h2>
            <ul className="mt-4 divide-y divide-slate-100">
              {HEUTE.map((s) => (
                <li key={s.name} className="flex items-center gap-4 py-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/5"
                    style={{ backgroundColor: s.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.dienst}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-sm font-medium tabular-nums text-slate-700">
                    {s.zeit}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Aufgaben / Warnungen */}
          <section className="flex flex-col gap-4">
            <h2 className="font-serif text-lg font-semibold text-[#05305b]">Aufgaben</h2>

            <button
              type="button"
              className="group flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left shadow-sm transition-colors hover:border-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  Monatsabschluss Juni 2026 steht noch aus
                </p>
                <p className="mt-0.5 text-xs text-amber-800/80">
                  Die Lohnauswertung kann jetzt abgeschlossen werden.
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <CalendarX className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    14 Tage ohne geplante Schicht
                    <span className="font-normal text-amber-800/70"> (nächste 14 Tage)</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {FREIE_TAGE.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600"
                      >
                        {d}
                      </button>
                    ))}
                    <span className="flex items-center px-1 text-xs text-amber-800/70">+9 weitere</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Fußzeile */}
      <footer className="shrink-0 border-t border-slate-200 bg-[#f6f7f9]">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-2 px-6 py-6">
          <nav aria-label="Rechtliches" className="flex flex-wrap items-center justify-center gap-2">
            {FOOTER_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="flex h-11 items-center rounded-md px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
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
