import './_group.css';

import {
  LayoutDashboard,
  CalendarDays,
  Users,
  CalendarOff,
  BarChart3,
  Settings,
  LogOut,
  ChevronRight,
  Clock3,
  CalendarClock,
  UserRound,
  AlertTriangle,
  CalendarX,
} from "lucide-react";

const BRAND = {
  cyan: "#d4f0f0",
  dark: "#092948",
  brand: "#05305b",
  yellow: "#ebf18b",
  yellowSoft: "#f6f9c9",
  amber: "#f59e0b",
  amberBar: "#f59e0b",
};

const PLATFORM_LINKS = ["Über uns", "Handbuch", "Leistungen"];

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Dienstplan", icon: CalendarDays, active: false },
  { label: "Assistenten", icon: Users, active: false },
  { label: "Abwesenheiten", icon: CalendarOff, active: false },
  { label: "Auswertungen", icon: BarChart3, active: false },
  { label: "Einstellungen", icon: Settings, active: false },
  { label: "Abmelden", icon: LogOut, active: false },
];

const FOOTER_LINKS = ["Impressum", "Datenschutz", "Kontakt"];

const KPIS = [
  { label: "Aktive Assistenten", value: "7", suffix: "", icon: Users, to: "/assistenten" },
  { label: "Schichten Heute", value: "3", suffix: "", icon: CalendarClock, to: "/dienstplan" },
  { label: "Geplante Stunden (Monat)", value: "486", suffix: "h", icon: Clock3, to: "/auswertungen" },
];

const UNCOVERED_DAYS = [
  "Sa., 25.07.",
  "So., 26.07.",
  "Mo., 27.07.",
  "Di., 28.07.",
  "Mi., 29.07.",
];
const UNCOVERED_REST = 9;

function KpiCard({ label, value, suffix, icon: Icon }: (typeof KPIS)[number]) {
  return (
    <button
      type="button"
      className="group flex min-h-[44px] flex-col rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#092948] focus-visible:ring-offset-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: BRAND.yellow }}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" style={{ color: BRAND.dark }} />
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-5 text-sm font-medium text-slate-500">{label}</p>
      <p
        className="mt-1 font-serif font-bold leading-none"
        style={{ fontSize: "40px", color: BRAND.dark }}
      >
        {value}
        {suffix && (
          <span className="ml-1.5 text-lg font-medium text-slate-400">{suffix}</span>
        )}
      </p>
    </button>
  );
}

function TaskRow({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="group relative flex w-full items-start gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 pl-6 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-amber-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#092948] focus-visible:ring-offset-2"
    >
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: BRAND.amberBar }}
        aria-hidden="true"
      />
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5 text-amber-600" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold" style={{ color: BRAND.dark }}>
          {title}
        </p>
        <div className="mt-1 text-sm text-slate-600">{children}</div>
      </div>
      <ChevronRight className="mt-1 h-5 w-5 shrink-0 self-center text-slate-400 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export function DashboardRuhig() {
  return (
    <div className="dienstplan-mockup flex min-h-screen w-full flex-col bg-white font-sans text-[#092948]">
      {/* Plattform-Header (Cyan) */}
      <header className="flex h-16 shrink-0 items-center" style={{ backgroundColor: BRAND.cyan }}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6">
          <a
            href="#"
            className="flex h-11 items-center gap-2.5 rounded-md px-1 outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
            style={{ color: BRAND.dark }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg font-bold text-white"
              style={{ backgroundColor: BRAND.dark }}
              aria-hidden="true"
            >
              A
            </span>
            <span className="text-xl font-bold tracking-tight">AssistenzPlaner</span>
          </a>

          <nav aria-label="Plattform" className="flex items-center gap-1">
            {PLATFORM_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="flex h-11 items-center rounded-md px-3 text-sm font-medium underline decoration-1 underline-offset-4 transition-colors hover:bg-[#ebf18b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
                style={{ color: BRAND.dark }}
              >
                {label}
              </a>
            ))}
            <a
              href="#"
              className="ml-2 flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium underline decoration-1 underline-offset-4 transition-colors hover:bg-[#ebf18b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
              style={{ color: BRAND.dark }}
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              Profil
            </a>
            <a
              href="#"
              className="ml-1 flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-white transition-colors hover:text-[#092948] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948] focus-visible:outline-offset-2"
              style={{ backgroundColor: BRAND.dark, borderColor: BRAND.dark }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = BRAND.yellow;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = BRAND.dark;
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Logout
            </a>
          </nav>
        </div>
      </header>

      {/* App-Navigation */}
      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6">
          <nav aria-label="Dienstplan-App" className="flex flex-wrap items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-current={item.active ? "page" : undefined}
                className={`flex h-12 items-center gap-2 px-4 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948] ${
                  item.active
                    ? "rounded-t-md font-semibold"
                    : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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

      {/* Hauptcontent */}
      <main className="flex-1 bg-slate-50">
        <div className="mx-auto w-full max-w-7xl px-6 py-8">
          {/* Titel */}
          <div>
            <h1 className="font-serif text-3xl font-bold" style={{ color: BRAND.dark }}>
              Dashboard
            </h1>
            <p className="mt-1 text-slate-500">Übersicht für Juli 2026</p>
          </div>

          {/* KPI-Karten */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {KPIS.map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>

          {/* Aufgaben-Sektion */}
          <section className="mt-8" aria-labelledby="aufgaben-heading">
            <h2
              id="aufgaben-heading"
              className="font-serif text-lg font-semibold"
              style={{ color: BRAND.dark }}
            >
              Aufgaben
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4">
              <TaskRow icon={AlertTriangle} title="Monatsabschluss Juni 2026 steht noch aus">
                Die Lohnauswertung für Juni 2026 kann jetzt abgeschlossen werden — spätere
                Änderungen erscheinen dann als Nachberechnung.
              </TaskRow>

              <TaskRow icon={CalendarX} title="14 Tage ohne geplante Schicht">
                <span className="text-slate-500">In den nächsten 14 Tagen.</span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  {UNCOVERED_DAYS.map((d) => (
                    <span
                      key={d}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                    >
                      {d}
                    </span>
                  ))}
                  <span className="px-1 text-xs font-medium text-slate-400">
                    +{UNCOVERED_REST} weitere
                  </span>
                </span>
              </TaskRow>
            </div>
          </section>
        </div>
      </main>

      {/* Fußzeile */}
      <footer className="shrink-0 border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-center px-6 py-6">
          <nav aria-label="Rechtliches" className="flex items-center gap-1">
            {FOOTER_LINKS.map((label, i) => (
              <span key={label} className="flex items-center">
                {i > 0 && <span className="px-1 text-slate-300">·</span>}
                <a
                  href="#"
                  className="flex h-11 items-center rounded-md px-2 text-sm font-medium text-slate-500 hover:text-[#092948] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
                >
                  {label}
                </a>
              </span>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
