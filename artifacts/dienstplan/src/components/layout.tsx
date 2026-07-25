import { useCallback, useRef, useState } from "react";
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
  ArrowUp,
} from "lucide-react";
import { useAuth } from "@/context/auth";
import { useToast } from "@/hooks/use-toast";
import { isAdminRole } from "@/lib/roles";
import { useTimeTrackingEnabled } from "@/hooks/use-time-tracking-enabled";
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
// dieser Block durch das echte Plattform-Markup ersetzt. Die App laeuft
// eigenstaendig unter dienstplan.assistenztreff.de und liefert die
// "Plattform-Optik" selbst — der Header ist daher IMMER sichtbar.
// ---------------------------------------------------------------------------

// Echte Ziele auf der AssistenzTreff-Plattform (verifiziert am 2026-07-24).
// "Handbuch" verweist auf den Wissensbereich der Plattform (/wissen) — eine
// eigene Handbuch-Seite existiert dort (noch) nicht.
const PLATFORM_LINKS = [
  { label: "Über uns", href: "https://assistenztreff.de/ueber-uns" },
  { label: "Handbuch", href: "https://assistenztreff.de/wissen" },
  { label: "Leistungen", href: "https://assistenztreff.de/leistungen" },
];

// Gemeinsamer Look der Plattform-Textlinks (Über uns/Handbuch/Leistungen/
// Login bzw. Profil): gleiche Schriftgröße, unterstrichen wie auf
// assistenztreff.de, gelber Hover-Effekt (Desktop) — auf Touch-Geräten
// erscheint derselbe Effekt beim Antippen (active:).
const PLATFORM_LINK_CLASSES =
  "items-center rounded-full px-4 text-base font-semibold underline decoration-2 underline-offset-4 transition-colors hover:bg-brand-yellow hover:no-underline active:bg-brand-yellow active:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-dark";

// Pillen-Button rechts (Registrieren bzw. Logout): dunkelblau, weiße Schrift,
// schmaler dunkelblauer Rand; Hover/Tap = gelb mit dunkler Schrift.
const PLATFORM_PILL_CLASSES =
  "flex h-12 items-center rounded-full border-2 border-brand-dark bg-brand-dark px-6 text-base font-semibold text-brand-white shadow-sm transition-colors hover:bg-brand-yellow hover:text-brand-dark active:bg-brand-yellow active:text-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-dark focus-visible:outline-offset-2";

function PlatformHeaderPlaceholder() {
  const { currentUser, logout } = useAuth();
  const { toast } = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

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
    <header
      className="flex h-20 shrink-0 items-center bg-brand-hellblau text-brand-dark"
      data-testid="platform-header"
    >
      {/* Eine Zeile: Wortmarke links, Plattform-Links + Login + Registrieren
          rechts. Alles Platzhalter fuer das spaetere Plattform-Markup —
          Klickflaechen h-12 fuer gute Erreichbarkeit. */}
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4">
        <span className="flex h-12 items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-dark text-lg font-bold text-brand-white"
            aria-hidden="true"
          >
            A
          </span>
          <span className="text-xl font-bold tracking-tight">AssistenzPlaner</span>
        </span>

        <nav aria-label="Plattform" className="flex items-center gap-1 sm:gap-2">
          {/* Desktop: externe Plattform-Text-Links (nur ab md sichtbar). */}
          {PLATFORM_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              className={`hidden h-12 md:flex ${PLATFORM_LINK_CLASSES}`}
            >
              {label}
            </a>
          ))}
          {currentUser ? (
            <>
              {/* Eingeloggt: Profil + Logout oben rechts (wie AssistenzTreff). */}
              <Link
                href="/einstellungen"
                className={`hidden h-12 sm:flex ${PLATFORM_LINK_CLASSES}`}
                data-testid="platform-header-profil"
              >
                Profil
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className={`ml-1 sm:ml-2 ${PLATFORM_PILL_CLASSES}`}
                data-testid="platform-header-logout"
              >
                {loggingOut ? "Wird abgemeldet..." : "Logout"}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={`hidden h-12 sm:flex ${PLATFORM_LINK_CLASSES}`}
                data-testid="platform-header-login"
              >
                Login
              </Link>
              <Link
                href="/registrierung"
                className={`ml-1 sm:ml-2 ${PLATFORM_PILL_CLASSES}`}
                data-testid="platform-header-registrieren"
              >
                Registrieren
              </Link>
            </>
          )}
        </nav>
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

// Echte Ziele auf der AssistenzTreff-Plattform (verifiziert am 2026-07-24).
// "Barrierefreiheit" hat auf der Plattform (noch) keine eigene Seite und
// verweist deshalb auf die statische In-App-Seite (pages/rechtliches.tsx);
// dort liegen auch In-App-Fallbacks fuer Impressum/Datenschutz/Kontakt.
const FOOTER_LINKS = [
  { label: "Impressum", href: "https://assistenztreff.de/impressum" },
  { label: "Datenschutz", href: "https://assistenztreff.de/datenschutzerklaerung" },
  { label: "Kontakt", href: "https://assistenztreff.de/kontakt" },
];

function PlatformFooterPlaceholder() {
  const { currentUser } = useAuth();
  return (
    <footer className="shrink-0 border-t border-slate-200 bg-slate-100 text-slate-600">
      {/* ~120px hohe, schlanke Fusszeile: zentrierte Rechtliches-Links +
          Copyright. Klickflaechen h-11 fuer gute Erreichbarkeit. */}
      <div className="mx-auto flex min-h-[120px] w-full max-w-7xl flex-col items-center justify-center gap-3 px-4 py-4">
        <nav
          aria-label="Rechtliches"
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {FOOTER_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center rounded-md px-4 text-sm font-medium hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-dark"
            >
              {label}
            </a>
          ))}
          {/* Barrierefreiheit: In-App-Seite (auf der Plattform existiert noch
              keine Erklaerungsseite). Gleiche Fokus-/Hover-Stile wie oben. */}
          <Link
            href="/barrierefreiheit"
            className="flex h-11 items-center rounded-md px-4 text-sm font-medium hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-dark"
          >
            Barrierefreiheit
          </Link>
        </nav>
        <p className="text-xs text-slate-500">© 2026 AssistenzTreff</p>
      </div>

      {/* Dezenter, versteckter Zugang zum Operator-Dashboard — nur fuer
          Superadmins sichtbar (nicht Teil der regulaeren Navigation). */}
      {currentUser?.role === "superadmin" && (
        <div className="border-t border-slate-200">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <Link href="/operator-dashboard">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 cursor-pointer">
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

  // Zeiterfassung nur anzeigen, wenn der Konto-Schalter (bzw. der des
  // Arbeitgebers bei Assistenzkräften) eingeschaltet ist. Standard AUS —
  // während des Ladens bleibt der Punkt verborgen (kein Aufblitzen).
  const { enabled: timeTrackingEnabled } = useTimeTrackingEnabled();

  const navItems = ALL_NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || isAdminRole(currentUser?.role)) &&
      (!item.dienstleisterOnly || currentUser?.accountType === "dienstleister") &&
      (item.href !== "/zeiterfassung" || timeTrackingEnabled),
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
      <div className="border-b border-slate-200 bg-slate-100 px-4 py-3 md:hidden" data-testid="app-menu-bar">
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
        data-testid="app-menu-drawer"
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
                className={`flex items-center gap-2 px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                  location === item.href
                    ? "bg-brand-yellow text-brand-dark font-semibold"
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

      {/* Desktop: Menueleiste als TEXT-LINKS (keine Pillen) auf hellgrauem
          Band — aktiver Punkt gelb hinterlegt (rechteckig, kein rounded).
          text-sm statt text-xs fuer bessere Lesbarkeit; h-12 Klickflaechen.
          Nicht sticky: scrollt mit der Seite nach oben weg. */}
      <div className="hidden shrink-0 border-b border-slate-200 bg-slate-100 md:block" data-testid="app-subnav-desktop">
        <div className="mx-auto max-w-7xl px-4">
          <nav
            aria-label="Dienstplan-App"
            className="flex flex-wrap items-center gap-x-1 gap-y-0"
          >
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <span
                    aria-current={isActive ? "page" : undefined}
                    className={`flex h-12 shrink-0 items-center gap-1.5 px-3 text-sm transition-colors cursor-pointer ${
                      isActive
                        ? "bg-brand-yellow text-brand-dark font-semibold"
                        : "font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="flex h-12 shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:opacity-60"
              title={currentUser ? `Angemeldet als ${currentUser.name}` : "Abmelden"}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
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
// Die App laeuft eigenstaendig (Standalone unter dienstplan.assistenztreff.de)
// und rendert die Plattform-Platzhalter daher IMMER.
// ---------------------------------------------------------------------------
// Ab dieser Scrolltiefe (px) erscheint mobil der "Nach oben"-Button.
const SCROLL_TOP_THRESHOLD = 300;

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  // Dienstplan nutzt die volle Bildschirmbreite (kein zentrierter Container).
  const fullBleed = location === "/dienstplan";

  // Mobil scrollt die App-Menue-Leiste mit der Seite weg. Damit man das Menue
  // nicht muehsam zurueckscrollen muss, blenden wir nach ~300px Scrolltiefe
  // einen kleinen schwebenden "Nach oben"-Button ein (nur < md). Gescrollt
  // wird der INNERE Container (das Dokument selbst scrollt nie), daher haengt
  // der Listener direkt am Scroll-Container.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setShowScrollTop(el.scrollTop > SCROLL_TOP_THRESHOLD);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-brand-white font-sans text-foreground">
      {/* Kopf-Leisten + Inhalt + Footer scrollen gemeinsam in EINEM
          Scroll-Container. Beim Runterscrollen verschwinden Plattform-Header
          und Menueleiste nach oben; sticky Kopfzeilen der Seiten (Dienstplan)
          kleben am oberen Rand dieses Containers. min-h-full + flex-1 auf
          main druecken den Footer bei kurzen Seiten an den unteren
          Viewport-Rand. Dienstplan nutzt zusaetzlich die volle Breite (kein
          zentrierter max-w-Container). */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="layout-scroll-container"
      >
        <div className="flex min-h-full flex-col">
          {/* Plattform-Header (Platzhalter) — immer sichtbar (Standalone) */}
          <PlatformHeaderPlaceholder />

          {/* Dienstplan-App: Sub-Navigation (scrollt mit) */}
          <AppSubNavigation />

          <main
            className={`w-full flex-1 p-4 md:p-6 ${fullBleed ? "" : "mx-auto max-w-7xl"}`}
          >
            {children}
          </main>

          {/* Plattform-Footer (Platzhalter) — immer sichtbar (Standalone) */}
          <PlatformFooterPlaceholder />
        </div>
      </div>

      {/* Mobile: schwebender "Nach oben"-Button (nur < md). Erscheint erst
          nach SCROLL_TOP_THRESHOLD Scrolltiefe und verschwindet oben wieder.
          z-30 liegt bewusst UNTER Drawer-Backdrop (z-40) und Drawer/Dialogen
          (z-50), damit er nichts ueberdeckt; klein und halbtransparent, um
          Aktions-Buttons am Seitenende nicht zu verstellen. */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Nach oben scrollen"
        data-testid="scroll-to-top"
        className={`fixed bottom-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-brand-dark/70 text-brand-white shadow-lg backdrop-blur-sm transition-all duration-200 hover:bg-brand-dark md:hidden ${
          showScrollTop
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0"
        }`}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </div>
  );
}
