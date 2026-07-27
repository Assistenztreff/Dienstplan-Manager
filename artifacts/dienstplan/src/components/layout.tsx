import { useCallback, useEffect, useRef, useState } from "react";
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
import platformLogoUrl from "@assets/assistenzplaner-logo-getrimmt.png";
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
  { label: "Leistungen", href: "https://assistenztreff.de/leistungen" },
  { label: "Über uns", href: "https://assistenztreff.de/ueber-uns" },
  { label: "Kontakt", href: "https://assistenztreff.de/kontakt" },
];

// Gemeinsamer Look der Plattform-Textlinks (Leistungen/Über uns/Handbuch/
// Login bzw. Profil), Vorbild „Kontakt" auf assistenztreff.de:
// - Ruhezustand: unterstrichener Text.
// - Hover (Desktop) bzw. Antippen (Touch): gelbes Kästchen mit dünnem
//   dunkelblauem Rahmen, Unterstreichung verschwindet.
// - Klick/Fokus: zusätzlich ein dicker dunkelblauer Rahmen mit Abstand um das
//   gelbe Kästchen (Barrierefreiheits-Hilfe).
const PLATFORM_LINK_CLASSES =
  "items-center rounded-full border border-transparent px-4 text-base font-semibold underline decoration-1 underline-offset-4 transition-colors hover:border-brand-dark hover:bg-brand-yellow hover:no-underline active:border-brand-dark active:bg-brand-yellow active:no-underline active:outline active:outline-[3px] active:outline-offset-2 active:outline-brand-dark focus-visible:border-brand-dark focus-visible:bg-brand-yellow focus-visible:no-underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark";

// Pillen-Button rechts (Registrieren bzw. Logout): dunkelblau, weiße Schrift;
// Hover/Tap = gelb mit dunkler Schrift und dünnem dunkelblauem Rahmen;
// Klick/Fokus = zusätzlich dicker dunkelblauer Rahmen mit Abstand.
const PLATFORM_PILL_CLASSES =
  "flex h-9 items-center rounded-full border border-brand-dark bg-brand-dark px-5 text-sm font-semibold text-brand-white shadow-sm transition-colors hover:bg-brand-yellow hover:text-brand-dark active:bg-brand-yellow active:text-brand-dark active:outline active:outline-[3px] active:outline-offset-2 active:outline-brand-dark focus-visible:bg-brand-yellow focus-visible:text-brand-dark focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark";

export function PlatformHeaderPlaceholder() {
  const { currentUser, logout } = useAuth();
  const { toast } = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  // Mobil (< md): EIN Hamburger buendelt Plattform-Links UND App-Menue in
  // einem Vollbild-Menue (Mockup "Mobile-Menü").
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
        {/* Links: Wortmarke + Plattform-Links direkt daneben (wie auf
            assistenztreff.de); rechts nur Login/Profil + Pillen-Button. */}
        <div className="flex min-w-0 items-center gap-4 md:gap-8">
          <span className="flex h-12 shrink-0 items-center">
            <img
              src={platformLogoUrl}
              alt="AssistenzPlaner"
              className="h-8 w-auto"
              data-testid="platform-header-logo"
            />
          </span>

          <nav
            aria-label="Plattform"
            className="hidden items-center gap-1 md:flex lg:gap-2"
          >
            {/* Desktop: externe Plattform-Text-Links (nur ab md sichtbar). */}
            {PLATFORM_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className={`flex h-12 ${PLATFORM_LINK_CLASSES}`}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {currentUser ? (
            <>
              {/* Eingeloggt, ab md: Profil + Logout oben rechts (wie
                  AssistenzTreff). Darunter uebernimmt der Hamburger. */}
              <Link
                href="/einstellungen"
                className={`hidden h-12 md:flex ${PLATFORM_LINK_CLASSES}`}
                data-testid="platform-header-profil"
              >
                Profil
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className={`ml-1 hidden sm:ml-2 md:flex ${PLATFORM_PILL_CLASSES}`}
                data-testid="platform-header-logout"
              >
                {loggingOut ? "Wird abgemeldet..." : "Logout"}
              </button>
              {/* Mobil: "Menü" + Hamburger oeffnet das Vollbild-Menue
                  (wie die AssistenzTreff-Smartphone-Ansicht: unterstrichener
                  Text-Link mit ≡-Symbol daneben). */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="-mr-2 flex h-12 items-center gap-1.5 rounded-full px-2 text-lg font-semibold text-brand-dark transition-colors hover:bg-brand-yellow focus-visible:bg-brand-yellow focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark md:hidden"
                aria-label="Menü öffnen"
                aria-expanded={mobileMenuOpen}
                data-testid="platform-header-hamburger"
              >
                <span className="underline decoration-1 underline-offset-4">
                  Menü
                </span>
                <Menu className="h-6 w-6" strokeWidth={3} />
              </button>
              {mobileMenuOpen && (
                <MobileFullMenu
                  onClose={() => setMobileMenuOpen(false)}
                  onLogout={() => {
                    setMobileMenuOpen(false);
                    void handleLogout();
                  }}
                  loggingOut={loggingOut}
                />
              )}
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
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Mobiles Vollbild-Menue (Mockup "Mobile-Menü", < md)
// ---------------------------------------------------------------------------
// EIN Hamburger im Plattform-Header oeffnet dieses Menue. Oben Logo +
// "schließen", darunter die App-Navigation als grosse Pillen-Buttons
// (aktiver Punkt gelb), unten kleiner die Plattform-Links sowie
// "Angemeldet als ..." + Abmelden-Pille.
// ---------------------------------------------------------------------------

function MobileFullMenu({
  onClose,
  onLogout,
  loggingOut,
}: {
  onClose: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const { currentUser } = useAuth();
  const [location] = useLocation();
  const { enabled: timeTrackingEnabled } = useTimeTrackingEnabled();
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Modal-Verhalten: Fokus beim Oeffnen auf "schließen", Escape schliesst,
  // Tab bleibt im Menue (Fokus-Falle), Hintergrund-Scroll wird gesperrt und
  // der Fokus kehrt beim Schliessen zum ausloesenden Element zurueck.
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    // Hintergrund-Scroll sperren: Das Dokument scrollt nie selbst — gescrollt
    // wird der innere Layout-Container (falls vorhanden, z. B. nicht auf der
    // Startseite).
    const scrollContainer = document.querySelector<HTMLElement>(
      "[data-testid='layout-scroll-container']",
    );
    const previousOverflow = scrollContainer?.style.overflowY ?? "";
    if (scrollContainer) scrollContainer.style.overflowY = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = overlayRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (scrollContainer) scrollContainer.style.overflowY = previousOverflow;
      // preventScroll: Der Fokus-Ruecksprung darf die Scroll-Position nicht
      // veraendern (sonst springt die Seite beim Schliessen nach oben).
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const navItems = ALL_NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || isAdminRole(currentUser?.role)) &&
      (!item.dienstleisterOnly || currentUser?.accountType === "dienstleister") &&
      (item.href !== "/zeiterfassung" || timeTrackingEnabled),
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto bg-brand-hellblau text-brand-dark md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Menü"
      data-testid="mobile-full-menu"
    >
      <div className="flex min-h-full flex-col">
        {/* Kopfzeile: Logo links, schließen rechts */}
        <div className="flex items-center justify-between px-5 pt-5">
          <img src={platformLogoUrl} alt="AssistenzPlaner" className="h-7 w-auto" />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="flex h-12 items-center gap-2 rounded-full px-3 text-base font-semibold underline decoration-1 underline-offset-4 transition-colors hover:bg-brand-yellow hover:no-underline focus-visible:bg-brand-yellow focus-visible:no-underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
            aria-label="Menü schließen"
            data-testid="mobile-full-menu-close"
          >
            schließen
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* App-Navigation als Pillen-Buttons */}
        <nav aria-label="Dienstplan-App" className="mt-8 flex flex-col gap-4 px-6">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`flex h-14 items-center justify-center rounded-full border border-brand-dark text-lg font-semibold text-brand-dark shadow-sm transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
                  isActive ? "bg-brand-yellow" : "bg-white hover:bg-brand-yellow"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Plattform-Links + Konto */}
        <div className="mt-10 flex items-start justify-between gap-4 px-8 pb-10">
          <div className="flex flex-col gap-4 text-base font-medium">
            {PLATFORM_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-1 underline-offset-4 hover:text-brand-dark/70"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-4">
            {currentUser && (
              <span className="text-sm text-slate-600">
                Angemeldet als {currentUser.name}
              </span>
            )}
            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
              className={PLATFORM_PILL_CLASSES}
              data-testid="mobile-full-menu-logout"
            >
              {loggingOut ? "Wird abgemeldet..." : "Abmelden"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
      {/* Mobil (< md) gibt es KEINE eigene App-Menue-Leiste mehr: das
          App-Menue steckt im Hamburger des Plattform-Headers (Vollbild-
          Menue, siehe MobileFullMenu). */}

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
  // Vollbreite Seiten ohne max-w-Container und ohne Innenabstand: der
  // Dienstplan (breite Tabellen) und das Handbuch (farbige Hero-/Sidebar-
  // Flaechen sollen bis an den Rand laufen).
  const fullBleed = location === "/dienstplan" || location.startsWith("/handbuch");

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
            className={`w-full flex-1 ${
              location.startsWith("/handbuch")
                ? "" // Handbuch: farbige Flaechen bis an den Rand, ohne Innenabstand
                : `p-4 md:p-6 ${fullBleed ? "" : "mx-auto max-w-7xl"}`
            }`}
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
