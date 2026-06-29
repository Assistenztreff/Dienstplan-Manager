import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Clock,
  CalendarOff,
  BarChart3,
  Settings,
  Building2,
  LogOut,
  CircleUser,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import logoUrl from "@assets/Arbeitgebermodell oder Assistenzdienst.png";
import { useAuth } from "@/context/auth";
import { useToast } from "@/hooks/use-toast";
import { isEmbedded } from "@/lib/embed";
import { DevUserSwitcher } from "./dev-user-switcher";

// Interne Navigationspunkte der Dienstplan-App. Rollen-/Konto-Typ-Sichtbarkeit
// bleibt unveraendert: adminOnly nur fuer Admins, dienstleisterOnly nur fuer
// Dienstleister-Konten.
const ALL_NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false, dienstleisterOnly: false },
  { href: "/dienstplan", label: "Dienstplan", icon: CalendarDays, adminOnly: false, dienstleisterOnly: false },
  { href: "/assistenten", label: "Assistenten", icon: Users, adminOnly: true, dienstleisterOnly: false },
  { href: "/zeiterfassung", label: "Zeiterfassung", icon: Clock, adminOnly: false, dienstleisterOnly: false },
  { href: "/abwesenheiten", label: "Abwesenheiten", icon: CalendarOff, adminOnly: true, dienstleisterOnly: false },
  { href: "/auswertungen", label: "Auswertungen", icon: BarChart3, adminOnly: true, dienstleisterOnly: false },
  { href: "/team-verwaltung", label: "Team-Verwaltung", icon: Building2, adminOnly: true, dienstleisterOnly: true },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings, adminOnly: true, dienstleisterOnly: false },
];

// ---------------------------------------------------------------------------
// PLATZHALTER: Plattform-Header (AssistenzTreff)
// ---------------------------------------------------------------------------
// Dieser Header ist ein reiner Platzhalter fuer das spaetere HTML/PHP der
// AssistenzTreff-Hauptseite. Beim Umzug auf den eigenen All-Inkl-Server wird
// dieser Block durch das echte Plattform-Markup ersetzt. Im Embed-Modus
// (?embed=1) wird er ausgeblendet, damit keine doppelte Plattform-Huelle
// entsteht (die Plattform liefert dann ihren eigenen Header).
// ---------------------------------------------------------------------------

const PLATFORM_LINKS = ["Leistungen", "Über uns", "Kontakt"];

const PLATFORM_PILLS: { label: string; active: boolean }[] = [
  { label: "Job Börse", active: false },
  { label: "Map", active: false },
  { label: "Connect", active: true }, // Dienstplan-App lebt unter "Connect"
  { label: "Aktuelles", active: false },
  { label: "Wissen", active: false },
  { label: "Speaker:in", active: false },
];

function PlatformHeaderPlaceholder() {
  return (
    <header className="shrink-0 bg-brand-cyan text-brand-white">
      {/* Obere Zeile: Logo + externe Plattform-Links (Platzhalter).
          HINWEIS: Beim Server-Umzug wird hier spaeter Conditional Rendering
          fuer Dienstleister-Logos ergaenzt (z. B. eigenes Logo des Mandanten
          statt des AssistenzTreff-Logos). */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <img src={logoUrl} alt="AssistenzTreff" className="h-9 w-auto object-contain" />
        <nav className="hidden items-center gap-6 text-sm font-medium sm:flex">
          {PLATFORM_LINKS.map((label) => (
            <span key={label} className="cursor-default opacity-90 hover:opacity-100">
              {label}
            </span>
          ))}
        </nav>
      </div>

      {/* Untere Zeile: Pillen-Navigation der Plattform (Platzhalter).
          "Connect" ist aktiv markiert, da die Dienstplan-App dort eingebettet
          ist. Auf Mobil horizontal scrollbar. */}
      <div className="border-t border-white/20">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto whitespace-nowrap px-4 py-2">
          {PLATFORM_PILLS.map((pill) => (
            <span
              key={pill.label}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                pill.active
                  ? "bg-brand-dark text-brand-white"
                  : "bg-white/15 text-brand-white"
              }`}
            >
              {pill.label}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// PLATZHALTER: Plattform-Footer (AssistenzTreff)
// ---------------------------------------------------------------------------
// Reiner Platzhalter fuer den spaeteren globalen Footer der Plattform. Wird
// beim Server-Umzug durch das echte Markup ersetzt und im Embed-Modus
// ausgeblendet.
// ---------------------------------------------------------------------------

const FOOTER_COLUMNS: { heading: string; links: string[] }[] = [
  { heading: "AssistenzTreff", links: ["Über uns", "Leistungen", "Kontakt"] },
  { heading: "Connect", links: ["Job Börse", "Map", "Aktuelles"] },
  { heading: "Rechtliches", links: ["Impressum", "Datenschutz", "AGB"] },
];

function PlatformFooterPlaceholder() {
  return (
    <footer className="shrink-0 bg-brand-dark text-brand-white">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-6 sm:grid-cols-3">
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.heading}>
            <h3 className="mb-2 text-sm font-semibold text-brand-yellow">{col.heading}</h3>
            <ul className="space-y-1 text-sm">
              {col.links.map((link) => (
                <li key={link} className="cursor-default text-brand-white/90 hover:text-brand-white">
                  {link}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Dienstplan-App: Sub-Navigation (das eigentliche App-Menue)
// ---------------------------------------------------------------------------
// Internes Menue der Dienstplan-App, direkt unter dem Plattform-Header.
// Bleibt auch im Embed-Modus sichtbar (gehoert zur App, nicht zur Plattform).
// Enthaelt zusaetzlich die App-Funktionalitaet (Dev-Switcher, Nutzerinfo,
// Abmelden) rechts, damit diese im Embed-Modus erreichbar bleibt.
// ---------------------------------------------------------------------------

function AppSubNavigation() {
  const [location] = useLocation();
  const { currentUser, logout } = useAuth();
  const { toast } = useToast();

  const navItems = ALL_NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || currentUser?.role === "admin") &&
      (!item.dienstleisterOnly || currentUser?.accountType === "dienstleister"),
  );

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      toast({ title: "Fehler beim Abmelden", variant: "destructive" });
    }
  };

  return (
    <div className="shrink-0 border-b border-slate-200 bg-slate-100">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-2 md:px-4">
        {/* App-Navigation: auf Mobil horizontal scrollbar */}
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                  location === item.href
                    ? "bg-brand-yellow text-brand-dark font-medium"
                    : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </span>
            </Link>
          ))}
        </nav>

        {/* App-Funktionalitaet rechts: Dev-User-Switcher (nur Dev), Nutzerinfo
            und Abmelden. Bewusst Teil der App-Sub-Nav (nicht des Plattform-
            Platzhalters), damit im Embed-Modus weiter erreichbar. */}
        <div className="flex shrink-0 items-center gap-2 pl-2">
          <DevUserSwitcher />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2" aria-label="Nutzermenue">
                <CircleUser className="h-5 w-5" />
                <span className="hidden text-sm font-medium sm:inline">{currentUser?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="leading-tight">{currentUser?.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {currentUser?.role === "admin" ? "Administrator" : "Assistent"}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Abmelden</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App-Shell: striktes Flexbox-Layout. Header (Plattform-Platzhalter) und
// Footer (Plattform-Platzhalter) bleiben fixiert; nur der Hauptbereich in der
// Mitte scrollt. Im Embed-Modus werden die Plattform-Platzhalter ausgeblendet.
// ---------------------------------------------------------------------------
export function Layout({ children }: { children: React.ReactNode }) {
  const embedded = isEmbedded();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-brand-white font-sans text-foreground">
      {/* Plattform-Header (Platzhalter) — im Embed-Modus ausgeblendet */}
      {!embedded && <PlatformHeaderPlaceholder />}

      {/* Dienstplan-App: Sub-Navigation */}
      <AppSubNavigation />

      {/* Hauptbereich: einziger scrollbarer Bereich, zentriert & breitenbegrenzt */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
      </main>

      {/* Plattform-Footer (Platzhalter) — im Embed-Modus ausgeblendet */}
      {!embedded && <PlatformFooterPlaceholder />}
    </div>
  );
}
