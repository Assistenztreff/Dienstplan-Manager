import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Clock,
  CalendarOff,
  BarChart3,
  Building2,
  Settings,
  LogOut,
} from "lucide-react";

const ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Dienstplan", icon: CalendarDays },
  { label: "Assistenten", icon: Users },
  { label: "Zeiterfassung", icon: Clock },
  { label: "Abwesenheiten", icon: CalendarOff },
  { label: "Auswertungen", icon: BarChart3 },
  { label: "Team-Verwaltung", icon: Building2 },
  { label: "Einstellungen", icon: Settings },
];

export function Aktuell() {
  return (
    <div className="min-h-screen bg-slate-200 flex items-center justify-center p-4 font-sans">
      <aside className="w-64 h-[760px] bg-slate-900 text-slate-100 rounded-xl shadow-xl flex flex-col p-4">
        <div className="px-2 mb-6">
          <div className="text-lg font-semibold tracking-tight">AssistenzTreff</div>
          <div className="text-xs text-slate-400">Assistenzdienst</div>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {ITEMS.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                item.active
                  ? "bg-teal-500 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        <div className="pt-4 mt-2 border-t border-slate-700 space-y-3">
          <div className="px-3">
            <p className="text-sm font-medium leading-tight">Assistenzdienst</p>
            <p className="text-xs text-slate-400">Administrator</p>
          </div>
          <button className="flex items-center gap-3 px-3 py-2 rounded-md w-full text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <LogOut className="h-4 w-4" />
            <span>Abmelden</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
