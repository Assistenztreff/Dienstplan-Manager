import { useState } from "react";
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
  Menu,
  X,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import logoUrl from "@assets/Arbeitgebermodell oder Assistenzdienst.png";
import { useAuth } from "@/context/auth";
import { useToast } from "@/hooks/use-toast";
import { isEmbedded } from "@/lib/embed";
import { isAdminRole } from "@/lib/roles";
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
  { href: "/einstellungen", label: "Einstellungen", icon: Settings, adminOnly: false, dienstleisterOnly: false },
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

        {/* Desktop: externe Plattform-Text-Links (nur ab md sichtbar). */}
        <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
          {PLATFORM_LINKS.map((label) => (
            <span key={label} className="cursor-default opacity-90 hover:opacity-100">
              {label}
            </span>
          ))}
        </nav>

        {/* Mobile: Hamburger-Button im Stil der Hauptplattform (nur < md).
            Platzhalter — oeffnet auf der echten Plattform das mobile Menue. */}
        <button
          type="button"
          className="flex items-center gap-2 rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium text-brand-white md:hidden"
          aria-label="Menü"
        >
          <span>Menü</span>
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Untere Zeile: Pillen-Navigation der Plattform (Platzhalter).
          "Connect" ist aktiv markiert, da die Dienstplan-App dort eingebettet
          ist. Auf Mobil ausgeblendet (dort uebernimmt der Hamburger-Button). */}
      <div className="hidden border-t border-white/20 md:block">
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
  const { currentUser } = useAuth();
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

      {/* Dezenter, versteckter Zugang zum Operator-Dashboard — nur fuer
          Superadmins sichtbar (nicht Teil der regulaeren Navigation). */}
      {currentUser?.role === "superadmin" && (
        <div className="border-t border-white/10">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <Link href="/operator-dashboard">
              <span className="inline-flex items-center gap-1.5 text-xs text-brand-white/50 hover:text-brand-white cursor-pointer">
                <ShieldCheck className="h-3.5 w-3.5" />
                Operator-Dashboard
              </span>
            </Link>
          </div>
        </div>
      )}
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Dienstplan-App: Sub-Navigation (das eigentliche App-Menue)
// ---------------------------------------------------------------------------
// Internes Menue der Dienstplan-App, direkt unter dem Plattform-Header.
// Bleibt auch im Embed-Modus sichtbar (gehoert zur App, nicht zur Plattform).
// Responsiv: auf Mobil eine wischbare Zeile (horizontal scrollbar, kein
// Umbruch); ab md zentrierte Pillen mit natuerlichem Umbruch in zweite Zeile.
// ---------------------------------------------------------------------------

function AppSubNavigation() {
  const [location] = useLocation();
  const { currentUser, logout } = useAuth();
  const { toast } = useToast();
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const navItems = ALL_NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || isAdminRole(currentUser?.role)) &&
      (!item.dienstleisterOnly || currentUser?.accountType === "dienstleister"),
  );

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      toast({
        variant: "destructive",
        title: "Fehler beim Abmelden",
        description: "Bitte versuchen Sie es erneut.",
      });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <>
      {/* Mobile: schmale Toggle-Leiste mit "App-Menue"-Button (oeffnet Drawer).
          Scrollt mit der Seite mit; der Drawer selbst ist fixed und bleibt
          damit unabhaengig von der Scroll-Position voll funktionsfaehig. */}
      <div className="border-b border-slate-200 bg-slate-100 px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setIsAppMenuOpen(true)}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-200"
          aria-label="App-Menü öffnen"
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span>App-Menü</span>
        </button>
      </div>

      {/* Mobile: Backdrop hinter dem Drawer (Klick schliesst das Menue). */}
      {isAppMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-brand-dark/50 md:hidden"
          onClick={() => setIsAppMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile: Off-Canvas Slide-In-Menue (Drawer) von links. */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-64 transform flex-col bg-slate-100 shadow-xl transition-transform duration-300 md:hidden ${
          isAppMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">Menü</span>
          <button
            type="button"
            onClick={() => setIsAppMenuOpen(false)}
            className="rounded-md p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
            aria-label="Menü schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-2 p-4">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span
                onClick={() => setIsAppMenuOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer ${
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

        {/* Mobile: Nutzerinfo + Abmelden am unteren Rand des Drawers. */}
        <div className="mt-auto border-t border-slate-200 p-4">
          {currentUser && (
            <p className="mb-2 truncate px-1 text-xs text-slate-500" title={currentUser.name}>
              {currentUser.name}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setIsAppMenuOpen(false);
              void handleLogout();
            }}
            disabled={loggingOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>{loggingOut ? "Wird abgemeldet..." : "Abmelden"}</span>
          </button>
        </div>
      </div>

      {/* Desktop: kompakter, einzeiliger Pillen-Balken (text-xs, wenig
          vertikales Padding), damit die Navigation auf iPad/Desktop in einer
          Zeile bleibt und maximal Hoehe fuer den Inhalt (Kalender) frei wird.
          Nicht sticky: scrollt mit der Seite nach oben weg. */}
      <div className="hidden shrink-0 border-b border-slate-200 bg-slate-100 md:block">
        <div className="mx-auto max-w-7xl px-4 py-2">
          <nav className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <span
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${
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
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:opacity-60"
              title={currentUser ? `Angemeldet als ${currentUser.name}` : "Abmelden"}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>{loggingOut ? "Wird abgemeldet..." : "Abmelden"}</span>
            </button>

            {/* Dev-only: Test-Nutzer-Wechsler (rendert in Produktion nichts,
                Guard via import.meta.env.DEV in der Komponente selbst). */}
            <DevUserSwitcher />
          </nav>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// App-Layout.
// Der aeussere Wrapper ist exakt viewport-hoch (h-dvh, overflow-hidden) —
// das Dokument selbst scrollt nie; gescrollt wird ein innerer Container.
// Plattform-Header und App-Sub-Navigation stehen IM Scroll-Container und
// scrollen deshalb mit der Seite nach oben weg; nur seiteneigene sticky
// Kopfzeilen (z. B. die Dienstplanleiste) bleiben beim Scrollen oben kleben.
//
// Zwei Modi:
// - Dienstplan (/dienstplan): full-bleed — der Inhalt nutzt die VOLLE Breite
//   (kein max-w-7xl), scrollt natuerlich nach unten (kein viewport-fixes
//   Grid mehr). Der Plattform-Footer bleibt hier ausgeblendet, damit die
//   App-Ansicht nicht durch die Plattform-Huelle unterbrochen wird.
// - Alle anderen Seiten: zentrierter Inhalt (max-w-7xl) + Footer am Ende.
// Im Embed-Modus werden die Plattform-Platzhalter ausgeblendet.
// ---------------------------------------------------------------------------
export function Layout({ children }: { children: React.ReactNode }) {
  const embedded = isEmbedded();
  const [location] = useLocation();
  // Dienstplan nutzt die volle Bildschirmbreite (kein zentrierter Container).
  const fullBleed = location === "/dienstplan";

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-brand-white font-sans text-foreground">
      {/* Kopf-Leisten + Inhalt + Footer scrollen gemeinsam in EINEM
          Scroll-Container. Beim Runterscrollen verschwinden Plattform-Header
          und Menueleiste nach oben; sticky Kopfzeilen der Seiten (Dienstplan)
          kleben am oberen Rand dieses Containers. min-h-full + flex-1 auf
          main druecken den Footer bei kurzen Seiten an den unteren
          Viewport-Rand. Dienstplan nutzt zusaetzlich die volle Breite (kein
          zentrierter max-w-Container). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {/* Plattform-Header (Platzhalter) — im Embed-Modus ausgeblendet */}
          {!embedded && <PlatformHeaderPlaceholder />}

          {/* Dienstplan-App: Sub-Navigation (scrollt mit) */}
          <AppSubNavigation />

          <main
            className={`w-full flex-1 p-4 md:p-6 ${fullBleed ? "" : "mx-auto max-w-7xl"}`}
          >
            {children}
          </main>

          {/* Plattform-Footer (Platzhalter) — im Embed-Modus ausgeblendet */}
          {!embedded && <PlatformFooterPlaceholder />}
        </div>
      </div>
    </div>
  );
}
