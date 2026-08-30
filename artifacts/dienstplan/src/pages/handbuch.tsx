import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarOff,
  ChevronRight,
  FileText,
  Menu,
  Search,
  Settings,
  Star,
  User,
  Users,
  X,
} from "lucide-react";
import platformLogoUrl from "@assets/assistenzplaner-logo-getrimmt.png";
import { useAuth } from "@/context/auth";

// ---------------------------------------------------------------------------
// Handbuch (Benutzerhandbuch) — aus den Canvas-Mockups uebernommen.
//
// WICHTIG: Die Mockups hatten einen eigenen Docs-Header ("DocsHeader"). Der
// entfaellt hier bewusst — eingeloggt liefern Plattform-Header + App-Menue
// (Layout in App.tsx) die Navigation. Ausgeloggt rendert HandbuchShell eine
// schlanke oeffentliche Kopfzeile im Plattform-Look (Logo + Login-Pille),
// denn das Handbuch soll wie die Rechtsseiten OHNE Login erreichbar sein.
//
// Kapitel ohne eigene Seite sind als "folgt" markiert (nicht klickbar),
// damit keine toten Links entstehen. Weitere Kapitel: siehe Aufgabe
// "Restliche Handbuch-Kapitel ausbauen".
// ---------------------------------------------------------------------------

type KapitelEintrag = {
  title: string;
  /** Interner Pfad (z.B. "/handbuch/dienstplan") — undefined = folgt noch. */
  href?: string;
  id?: string;
  isDienstleister?: boolean;
  children?: Array<{ title: string; href?: string; isPremium?: boolean }>;
};

const KAPITEL: Array<{ title: string; items: KapitelEintrag[] }> = [
  {
    title: "Erste Schritte",
    items: [
      {
        title: "Registrierung & Einstieg",
        href: "/handbuch/registrierung",
        id: "registrierung",
      },
      { title: "Rollen verstehen", href: "/handbuch/rollen", id: "rollen" },
    ],
  },
  {
    title: "Modul-Übersicht",
    items: [
      { title: "Dashboard", href: "/handbuch/dashboard", id: "dashboard" },
      { title: "Dienstplan", href: "/handbuch/dienstplan", id: "dienstplan" },
      { title: "Assistenzkräfte", href: "/handbuch/assistenten", id: "assistenten" },
      { title: "Zeiterfassung", href: "/handbuch/zeiterfassung", id: "zeiterfassung" },
      { title: "Abwesenheiten", href: "/handbuch/abwesenheiten", id: "abwesenheiten" },
      {
        title: "Auswertungen",
        href: "/handbuch/auswertungen",
        id: "auswertungen",
        children: [
          {
            title: "Premium-Lohnauswertung",
            href: "/handbuch/auswertungen#lohnauswertung",
            isPremium: true,
          },
          {
            title: "PDF-Stundennachweis",
            href: "/handbuch/auswertungen#pdf-export",
            isPremium: true,
          },
        ],
      },
    ],
  },
  {
    title: "Verwaltung",
    items: [
      {
        title: "Team-Verwaltung",
        href: "/handbuch/team-verwaltung",
        id: "team-verwaltung",
        isDienstleister: true,
      },
      {
        title: "Einstellungen",
        href: "/handbuch/einstellungen",
        id: "einstellungen",
        children: [
          { title: "Schichtmodelle", href: "/handbuch/einstellungen#schichtmodelle" },
          { title: "Zuschläge", href: "/handbuch/einstellungen#zuschlaege" },
          { title: "Kalender-Abo", href: "/handbuch/einstellungen#kalender-abo" },
          { title: "eigenes Logo", href: "/handbuch/einstellungen#firmenlogo", isPremium: true },
        ],
      },
    ],
  },
];

function PremiumBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-brand-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-dark shadow-sm">
      <Star className="h-3 w-3 fill-brand-dark" aria-hidden="true" />
      Premium
    </span>
  );
}

function DienstleisterBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-dark px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-white shadow-sm">
      <Building2 className="h-3 w-3" aria-hidden="true" />
      Nur Dienstleister
    </span>
  );
}

// Fokus-Stil wie in den Mockups: dicker dunkelblauer Rahmen mit Abstand.
const FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark";

// ---------------------------------------------------------------------------
// Shell: eingeloggt kommt das Layout (Header + App-Menue) von App.tsx —
// hier nur der Inhalt. Ausgeloggt: eigene schlanke Kopfzeile im
// Plattform-Look, damit das Handbuch oeffentlich lesbar bleibt.
// ---------------------------------------------------------------------------
function HandbuchShell({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();

  if (currentUser) {
    return <div className="w-full" data-testid="handbuch-page">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-background" data-testid="handbuch-page">
      <header className="flex h-20 items-center bg-brand-hellblau text-brand-dark">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4">
          {/* Fokus-Klassen direkt auf dem Link (wouter rendert ein <a>) —
              auf einem inneren <span> waere der sichtbare Fokus wirkungslos. */}
          <Link href="/" className={`flex h-12 items-center rounded ${FOCUS_CLASSES}`}>
            <img src={platformLogoUrl} alt="AssistenzPlaner" className="h-8 w-auto" />
          </Link>
          <Link
            href="/login"
            className={`flex h-9 items-center rounded-full border border-brand-dark bg-brand-dark px-5 text-sm font-semibold text-brand-white shadow-sm transition-colors hover:bg-brand-yellow hover:text-brand-dark ${FOCUS_CLASSES}`}
          >
            Anmelden
          </Link>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seitenleiste der Artikel-Seiten (Kapitelliste aus den Mockups).
// ---------------------------------------------------------------------------
function KapitelLink({
  item,
  activeId,
}: {
  item: { title: string; href?: string; isPremium?: boolean; isDienstleister?: boolean; id?: string };
  activeId?: string;
}) {
  const base =
    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors";
  if (!item.href) {
    return (
      <span className={`${base} cursor-default text-slate-400`}>
        <span className="flex-1">{item.title}</span>
        {item.isPremium && <PremiumBadge />}
        {item.isDienstleister && (
          <span title="Nur Dienstleister" className="flex shrink-0 items-center">
            <Building2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span className="sr-only">Nur Dienstleister</span>
          </span>
        )}
        {/* Bei Premium-Eintraegen reicht das Badge — sonst wird die Zeile zu eng. */}
        {!item.isPremium && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
            folgt
          </span>
        )}
      </span>
    );
  }
  const isActive = item.id != null && item.id === activeId;
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={`${base} ${FOCUS_CLASSES} ${
        isActive
          ? "bg-brand-hellblau font-semibold text-brand-dark"
          : "text-slate-600 hover:bg-slate-100 hover:text-brand-dark"
      }`}
    >
      <span className="flex-1">{item.title}</span>
      {item.isPremium && <PremiumBadge />}
      {item.isDienstleister && (
        <span title="Nur Dienstleister" className="flex shrink-0 items-center">
          <Building2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Nur Dienstleister</span>
        </span>
      )}
    </Link>
  );
}

// Gemeinsame Kapitelliste: wird in der Desktop-Seitenleiste, im mobilen
// Aufklapp-Bereich der Artikel-Seiten UND im Inhaltsverzeichnis der
// Startseite verwendet (eine Quelle, keine Duplikate).
function KapitelListe({ activeId }: { activeId?: string }) {
  return (
    <>
      {KAPITEL.map((section) => (
        <div key={section.title} className="mb-8 last:mb-0">
          <h4 className="mb-3 px-3 text-xs font-bold uppercase tracking-wider text-slate-400">
            {section.title}
          </h4>
          <div className="space-y-1">
            {section.items.map((item) => (
              <div key={item.title}>
                <KapitelLink item={item} activeId={activeId} />
                {item.children && (
                  <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-2">
                    {item.children.map((child) => (
                      <KapitelLink key={child.title} item={child} activeId={activeId} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function HandbuchSidebar({ activeId }: { activeId: string }) {
  return (
    <nav aria-label="Handbuch-Kapitel" className="h-full overflow-y-auto px-4 py-8 pb-24 lg:px-6">
      <KapitelListe activeId={activeId} />

      <div className="mt-8 rounded-xl border border-brand-cyan/20 bg-brand-hellblau p-4">
        <h4 className="mb-2 text-sm font-bold text-brand-dark">Brauchen Sie Hilfe?</h4>
        <p className="mb-3 text-xs text-slate-600">Wir sind für Sie da.</p>
        <Link
          href="/kontakt"
          className={`inline-flex w-full items-center justify-center rounded-md border border-slate-200 bg-brand-white px-3 py-2 text-sm font-semibold text-brand-dark shadow-sm transition-colors hover:border-brand-dark ${FOCUS_CLASSES}`}
        >
          Kontakt aufnehmen
        </Link>
      </div>
    </nav>
  );
}

function SeeAlsoLink({
  title,
  href,
  icon: Icon,
}: {
  title: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const inner = (
    <>
      {Icon && (
        <Icon className="h-5 w-5 text-brand-cyan group-hover:text-brand-dark" aria-hidden />
      )}
      <span className="flex-1 font-semibold text-brand-dark">{title}</span>
      {href ? (
        <ArrowRight
          className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-brand-dark"
          aria-hidden="true"
        />
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
          folgt
        </span>
      )}
    </>
  );
  if (!href) {
    return (
      <span className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 opacity-70">
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-lg border border-slate-200 p-4 transition-colors hover:border-brand-dark hover:bg-brand-hellblau/30 ${FOCUS_CLASSES}`}
    >
      {inner}
    </Link>
  );
}

function ScreenshotPlatzhalter({ label, aspect = "aspect-video" }: { label: string; aspect?: string }) {
  return (
    <div className="my-8 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center">
      <div
        className={`mx-auto flex ${aspect} max-w-2xl items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm`}
      >
        <span className="text-sm font-bold text-slate-400">{label}</span>
      </div>
    </div>
  );
}

// Hinweis-Box für Tipps und Stolperfallen — gleiches visuelles Muster wie die
// "Brauchen Sie Hilfe?"-Box der Seitenleiste (Plattform-Hellblau, runde Ecken).
function HinweisBox({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="my-8 rounded-xl border border-brand-cyan/20 bg-brand-hellblau p-5">
      <h3 className="mb-2 text-sm font-bold text-brand-dark">{titel}</h3>
      <div className="text-sm leading-relaxed text-slate-700 [&_p]:mb-2 [&_p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

// Gemeinsames Artikel-Geruest: Breadcrumbs, Kapitel-Seitenleiste links,
// Inhaltsverzeichnis rechts (ab xl). Mobil: Drawer von links + Suchleiste.
function ArtikelShell({
  activeId,
  bereich,
  titel,
  toc,
  children,
}: {
  activeId: string;
  bereich: string;
  titel: string;
  toc: Array<{ id: string; label: string }>;
  children: React.ReactNode;
}) {
  const [drawerOffen, setDrawerOffen] = useState(false);
  const [suchbegriff, setSuchbegriff] = useState("");

  // Suche über alle Kapitel-Einträge inkl. Kinder.
  const suchergebnisse = useMemo(() => {
    const q = suchbegriff.trim().toLowerCase();
    if (q.length < 2) return [] as Array<{ title: string; href: string }>;
    const ergebnisse: Array<{ title: string; href: string }> = [];
    for (const section of KAPITEL) {
      for (const item of section.items) {
        if (item.href && item.title.toLowerCase().includes(q)) {
          ergebnisse.push({ title: item.title, href: item.href });
        }
        if (item.children) {
          for (const child of item.children) {
            if (child.href && child.title.toLowerCase().includes(q)) {
              ergebnisse.push({ title: child.title, href: child.href });
            }
          }
        }
      }
    }
    return ergebnisse.slice(0, 6);
  }, [suchbegriff]);

  const schliessen = () => {
    setDrawerOffen(false);
    setSuchbegriff("");
  };

  return (
    <HandbuchShell>
      {/* Mobiler Drawer: von links ausklappbar (ab lg durch feste Seitenleiste ersetzt). */}
      {drawerOffen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={() => setDrawerOffen(false)}
            aria-hidden="true"
          />
          <aside
            data-testid="handbuch-drawer"
            className="fixed left-0 top-0 z-50 flex h-full w-72 flex-col bg-slate-50 shadow-xl lg:hidden"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="font-bold text-brand-dark">Kapitel</span>
              <button
                onClick={() => setDrawerOffen(false)}
                aria-label="Navigation schließen"
                className={`rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-brand-dark ${FOCUS_CLASSES}`}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Handbuch-Kapitel" className="flex-1 overflow-y-auto px-4 py-4 pb-20">
              <KapitelListe activeId={activeId} />
            </nav>
          </aside>
        </>
      )}

      <div className="relative mx-auto flex w-full max-w-[1400px] flex-1">
        <aside className="sticky top-0 hidden max-h-screen w-72 shrink-0 self-start overflow-hidden border-r border-slate-200 bg-slate-50/50 lg:block">
          <HandbuchSidebar activeId={activeId} />
        </aside>

        {/* Bewusst KEIN <main>: das Layout (eingeloggt) bzw. die
            HandbuchShell (ausgeloggt) stellt bereits die main-Landmarke. */}
        <div className="min-w-0 flex-1 px-6 py-8 md:px-12 lg:py-12">
          {/* Steuerleiste: Drawer-Button (nur mobil/tablet) + Suchfeld (alle Breiten).
              Desktop: Suchfeld rechtsbündig über dem Artikel; Drawer-Button ausgeblendet. */}
          <div className="mb-6 flex items-center gap-3">
            <button
              type="button"
              data-testid="handbuch-kapitel-mobil"
              onClick={() => setDrawerOffen(true)}
              aria-label="Kapitel-Navigation öffnen"
              className={`flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-dark shadow-sm transition-colors hover:border-brand-dark hover:bg-brand-hellblau/30 lg:hidden ${FOCUS_CLASSES}`}
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
              Kapitel-Übersicht
            </button>

            {/* Suchfeld: auf Mobilgeräten füllt es den Restplatz neben dem Button;
                auf Desktop ist es rechtsbündig und auf max-w-sm begrenzt. */}
            <div className="relative flex-1 lg:ml-auto lg:flex-none lg:w-80">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={suchbegriff}
                onChange={(e) => setSuchbegriff(e.target.value)}
                placeholder="Im Handbuch suchen …"
                aria-label="Im Handbuch suchen"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-brand-dark placeholder:text-slate-400 transition-colors hover:border-slate-300 focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
              />
              {suchergebnisse.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  {suchergebnisse.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={schliessen}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition-colors first:pt-3 last:pb-3 hover:bg-brand-hellblau/40 hover:text-brand-dark ${FOCUS_CLASSES}`}
                    >
                      <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      {item.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <nav
            aria-label="Pfadnavigation"
            className="mb-8 flex items-center gap-2 text-sm font-medium text-slate-500"
          >
            <Link
              href="/handbuch"
              className={`-ml-1 rounded px-1 hover:text-brand-dark ${FOCUS_CLASSES}`}
            >
              Handbuch
            </Link>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span>{bereich}</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span className="text-brand-dark">{titel}</span>
          </nav>

          <article className="max-w-[65ch] text-[1.0625rem] leading-[1.8] text-slate-700 [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:text-[1.75rem] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-brand-dark [&_p]:mb-5 [&_strong]:text-slate-900">
            {children}
          </article>
        </div>

        <aside className="hidden w-64 shrink-0 px-6 py-12 xl:block">
          <div className="sticky top-6">
            <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-brand-dark">
              Auf dieser Seite
            </h4>
            <ul className="space-y-3 text-sm">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className={`-ml-1 rounded px-1 text-slate-500 transition-colors hover:text-brand-dark ${FOCUS_CLASSES}`}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </HandbuchShell>
  );
}

// ---------------------------------------------------------------------------
// Startseite des Handbuchs
// ---------------------------------------------------------------------------

// Haeufig gesuchte Themen: nur Eintraege mit vorhandener Zielseite sind
// verlinkt, der Rest folgt mit den restlichen Kapiteln.
const THEMEN: Array<{ label: string; href?: string }> = [
  { label: "Dienstplan für den ganzen Monat freigeben", href: "/handbuch/dienstplan" },
  { label: "Neue Teams für Klienten anlegen", href: "/handbuch/team-verwaltung" },
  { label: "Wie funktioniert die Zeiterfassung?", href: "/handbuch/zeiterfassung" },
  { label: "Zuschläge für Nacht- und Sonntagsarbeit" },
  { label: "Krankmeldung und Ersatz finden", href: "/handbuch/abwesenheiten" },
  { label: "Stundennachweis als PDF exportieren", href: "/handbuch/auswertungen" },
];

export function HandbuchStart() {
  const [, navigate] = useLocation();
  const [suchbegriff, setSuchbegriff] = useState("");

  // Einfache Suche: filtert die Themen-Karten live nach dem Suchbegriff.
  const gefiltert = useMemo(() => {
    const q = suchbegriff.trim().toLowerCase();
    if (!q) return THEMEN;
    return THEMEN.filter((t) => t.label.toLowerCase().includes(q));
  }, [suchbegriff]);

  return (
    <HandbuchShell>
      <div className="flex min-h-full flex-col">
        {/* Hero mit Suche */}
        <section className="bg-brand-hellblau px-6 py-16 text-center">
          <div className="mx-auto max-w-3xl">
            <h1 className="mb-6 text-4xl font-bold text-brand-dark md:text-5xl">
              Wie können wir Ihnen helfen?
            </h1>
            <div className="relative mx-auto max-w-2xl rounded-full shadow-lg">
              <Search
                className="absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={suchbegriff}
                onChange={(e) => setSuchbegriff(e.target.value)}
                placeholder="Nach Themen, Stichworten oder Funktionen suchen..."
                aria-label="Handbuch durchsuchen"
                data-testid="handbuch-suche"
                className="h-16 w-full rounded-full border-0 bg-white pl-14 pr-6 text-lg text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-brand-dark"
              />
            </div>
          </div>
        </section>

        {/* Einstiegspunkte */}
        <section className="mx-auto w-full max-w-5xl px-6 py-16">
          <div className="grid gap-8 md:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate("/handbuch/dienstplan")}
              data-testid="handbuch-einstieg-arbeitgeber"
              className={`group relative overflow-hidden rounded-2xl border-2 border-slate-100 bg-white p-8 text-left transition-all hover:border-brand-dark hover:shadow-xl ${FOCUS_CLASSES}`}
            >
              <div className="absolute right-0 top-0 p-8 opacity-5 transition-opacity group-hover:opacity-10">
                <User className="h-32 w-32 text-brand-dark" aria-hidden="true" />
              </div>
              <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-brand-hellblau text-brand-dark">
                <User className="h-7 w-7" aria-hidden="true" />
              </div>
              <h2 className="mb-3 text-2xl font-bold text-brand-dark">Für private Arbeitgeber</h2>
              <p className="mb-6 text-lg text-slate-600">
                Alles über Dienstpläne, Zeiterfassung und die Verwaltung Ihres eigenen Assistenzteams.
              </p>
              <span className="inline-flex items-center font-bold text-brand-cyan group-hover:text-brand-dark">
                Zum Leitfaden
                <ArrowRight
                  className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-2"
                  aria-hidden="true"
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/handbuch/team-verwaltung")}
              data-testid="handbuch-einstieg-dienstleister"
              className={`group relative overflow-hidden rounded-2xl border-2 border-slate-100 bg-white p-8 text-left transition-all hover:border-brand-dark hover:shadow-xl ${FOCUS_CLASSES}`}
            >
              <div className="absolute right-0 top-0 p-8 opacity-5 transition-opacity group-hover:opacity-10">
                <Building2 className="h-32 w-32 text-brand-dark" aria-hidden="true" />
              </div>
              <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-brand-yellow text-brand-dark">
                <Building2 className="h-7 w-7" aria-hidden="true" />
              </div>
              <h2 className="mb-3 text-2xl font-bold text-brand-dark">
                Für Dienstleister & Organisationen
              </h2>
              <p className="mb-6 text-lg text-slate-600">
                Mehrere Teams, Rollen und Rechte: So organisieren Sie Assistenz für mehrere Klienten.
              </p>
              <span className="inline-flex items-center font-bold text-brand-cyan group-hover:text-brand-dark">
                Zum Leitfaden
                <ArrowRight
                  className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-2"
                  aria-hidden="true"
                />
              </span>
            </button>
          </div>
        </section>

        {/* Inhaltsverzeichnis: komplette Kapitel-Übersicht (gleiche Quelle
            wie die Seitenleiste der Artikel-Seiten). */}
        <section
          aria-labelledby="handbuch-inhaltsverzeichnis-titel"
          className="border-t border-slate-200 px-6 py-16"
          data-testid="handbuch-inhaltsverzeichnis"
        >
          <div className="mx-auto max-w-5xl">
            <h3
              id="handbuch-inhaltsverzeichnis-titel"
              className="mb-8 text-center text-xl font-bold text-brand-dark"
            >
              Alle Kapitel im Überblick
            </h3>
            <nav
              aria-label="Handbuch-Kapitel"
              className="grid gap-8 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-2 lg:grid-cols-3 lg:p-8 [&>div]:mb-0"
            >
              <KapitelListe />
            </nav>
          </div>
        </section>

        {/* Häufige Themen */}
        <section className="flex-1 border-t border-slate-200 bg-slate-50 px-6 py-16">
          <div className="mx-auto max-w-5xl">
            <h3 className="mb-8 text-center text-xl font-bold text-brand-dark">
              Häufig gesuchte Themen
            </h3>
            {gefiltert.length === 0 ? (
              <p className="text-center text-slate-500">
                Kein Thema gefunden — probieren Sie einen anderen Suchbegriff.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gefiltert.map((topic) =>
                  topic.href ? (
                    <Link
                      key={topic.label}
                      href={topic.href}
                      className={`group flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-brand-cyan hover:shadow-md ${FOCUS_CLASSES}`}
                    >
                      <FileText
                        className="h-5 w-5 shrink-0 text-slate-400 group-hover:text-brand-cyan"
                        aria-hidden="true"
                      />
                      <span className="font-medium leading-snug text-slate-700 group-hover:text-brand-dark">
                        {topic.label}
                      </span>
                    </Link>
                  ) : (
                    <span
                      key={topic.label}
                      className="flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 opacity-70"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
                      <span className="flex-1 font-medium leading-snug text-slate-500">
                        {topic.label}
                      </span>
                      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                        folgt
                      </span>
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </HandbuchShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Dienstplan
// ---------------------------------------------------------------------------
export function HandbuchDienstplan() {
  return (
    <ArtikelShell
      activeId="dienstplan"
      bereich="Für private Arbeitgeber"
      titel="Dienstplan"
      toc={[
        { id: "monatsansicht", label: "Die Monatsansicht" },
        { id: "dienste-erstellen", label: "Dienste erstellen und zuweisen" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Dienstplan
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Der Dienstplan ist das Herzstück des AssistenzPlaners. Hier organisieren Sie alle
        Schichten, sehen Verfügbarkeiten Ihres Teams und reagieren auf Ausfälle.
      </p>

      <h2 id="monatsansicht">Die Monatsansicht</h2>
      <p>
        In der tabellarischen Monatsansicht sehen Sie alle Assistenzkräfte untereinander und die Tage
        des Monats als Spalten. Diese Ansicht eignet sich besonders gut, um den kompletten Plan für
        den nächsten Monat aufzubauen. Jede Assistenzkraft hat eine eigene Zeile, sodass Sie auf einen
        Blick erkennen, wer wann eingeteilt ist.
      </p>
      <p>
        Sie können Dienste ganz einfach per Klick in eine leere Zelle eintragen. Wenn Sie denselben
        Dienst für mehrere Tage eintragen möchten, können Sie die Kopieren-Funktion nutzen.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Monatsansicht" />

      <h2 id="dienste-erstellen">Dienste erstellen und zuweisen</h2>
      <p>
        Klicken Sie auf ein Datum bei einer Assistenzkraft, um einen neuen Dienst anzulegen. Sie
        können die Uhrzeiten frei wählen oder ein vordefiniertes Schichtmodell (z.&nbsp;B.
        &bdquo;Frühdienst 06:00&nbsp;&ndash;&nbsp;14:00&ldquo;) nutzen, um Zeit zu sparen.
      </p>
      <p>
        <strong>Status-Farben:</strong> Ein neu erstellter Dienst ist zunächst grau (Entwurf).
        Sobald Sie ihn freigeben, wird er für die Assistenzkraft sichtbar und leuchtet in Ihrem
        Plan grün (Fix).
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Dienst-Dialog (Status Fix/Entwurf)" />

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">
        Der Dienstplan ist eng mit anderen Funktionen des AssistenzPlaners verzahnt. Hier finden
        Sie weiterführende Themen:
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink
          title="Krankheit & Urlaub verwalten"
          href="/handbuch/abwesenheiten"
          icon={CalendarOff}
        />
        <SeeAlsoLink title="Schichtmodelle anlegen" icon={Settings} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Team-Verwaltung
// ---------------------------------------------------------------------------
export function HandbuchTeamVerwaltung() {
  return (
    <ArtikelShell
      activeId="team-verwaltung"
      bereich="Für Dienstleister"
      titel="Team-Verwaltung"
      toc={[
        { id: "teams-anlegen", label: "Neue Teams anlegen" },
        { id: "rollen-rechte", label: "Rollen und Rechte verteilen" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <div className="mb-4">
        <DienstleisterBadge />
      </div>
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Team-Verwaltung
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Als Dienstleister verwalten Sie nicht nur einen einzelnen Plan, sondern organisieren
        mehrere Teams für verschiedene Klienten. In diesem Bereich weisen Sie
        Administrationsrechte und Zuständigkeiten zu.
      </p>

      <h2 id="teams-anlegen">Neue Teams anlegen</h2>
      <p>
        Ein Team entspricht in der Regel einem Klienten, bei dem rund um die Uhr oder stundenweise
        Assistenz geleistet wird. Über die Schaltfläche &bdquo;Neues Team&ldquo; können Sie einen
        Arbeitsort erstellen.
      </p>
      <p>
        Für jedes Team wird ein separater Dienstplan generiert. Assistenzkräfte können mehreren Teams
        zugeordnet werden, sodass sie flexibel in verschiedenen Einsatzorten aushelfen können,
        ohne dass es zu Doppelbelegungen im Kalender kommt.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Team-Übersicht (Dienstleister)" aspect="aspect-[2/1]" />

      <h2 id="rollen-rechte">Rollen und Rechte verteilen</h2>
      <p>
        Nicht jeder Mitarbeiter sollte alles sehen dürfen. Sie können in der Team-Verwaltung
        sogenannte <strong>Team-Admins</strong> ernennen. Diese Personen können den Dienstplan für
        ihr spezifisches Team schreiben und Urlaubsanträge genehmigen, sehen aber keine
        Auswertungen oder Pläne von anderen Klienten.
      </p>
      <p>
        Die Rolle <strong>Superadmin</strong> bleibt der Geschäftsführung vorbehalten und erlaubt
        den Zugriff auf globale Einstellungen, Lohnberichte und alle Dienstpläne übergreifend.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">So strukturieren Sie Ihr Unternehmen effektiv im AssistenzPlaner:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Rollen verstehen" href="/handbuch/rollen" icon={Settings} />
        <SeeAlsoLink title="Assistenzkräfte verwalten" href="/handbuch/assistenten" icon={Users} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Registrierung & Einstieg
// ---------------------------------------------------------------------------
export function HandbuchRegistrierung() {
  return (
    <ArtikelShell
      activeId="registrierung"
      bereich="Erste Schritte"
      titel="Registrierung & Einstieg"
      toc={[
        { id: "konto-erstellen", label: "Ein Konto erstellen" },
        { id: "anmelden", label: "Anmelden" },
        { id: "einladung-annehmen", label: "Als Assistenzkraft per Einladung" },
        { id: "passwort-vergessen", label: "Passwort vergessen?" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Registrierung &amp; Einstieg
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Der AssistenzPlaner ist in wenigen Minuten startklar. Diese Seite zeigt Ihnen, wie Sie ein
        Konto erstellen, sich anmelden und wie Assistenzkräfte per Einladung in Ihr Team kommen.
      </p>

      <h2 id="konto-erstellen">Ein Konto erstellen</h2>
      <p>
        Klicken Sie auf der Startseite oben rechts auf &bdquo;Registrieren&ldquo;. Als Erstes
        wählen Sie aus, wie Sie das Konto nutzen möchten:
      </p>
      <p>
        <strong>Privat</strong> ist die richtige Wahl, wenn Sie als einzelner Assistenznehmer im
        Arbeitgebermodell Ihr eigenes Team organisieren. <strong>Gewerblich</strong> wählen Sie
        als Assistenzdienst (Dienstleister), der mehrere Teams für verschiedene Klienten
        verwaltet. Für gewerbliche Konten steht später zusätzlich der Bereich
        Team-Verwaltung zur Verfügung.
      </p>
      <p>
        Danach geben Sie Ihren Vor- und Nachnamen, Ihre E-Mail-Adresse und ein Passwort mit
        mindestens 8 Zeichen ein und bestätigen mit &bdquo;Jetzt registrieren&ldquo;. Sie landen
        direkt auf dem Dashboard und können sofort loslegen.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Registrierung (Kontotyp-Auswahl)" />

      <HinweisBox titel="Hinweis: Kontotyp gut überlegen">
        <p>
          Der Kontotyp lässt sich später nicht selbst umstellen. Wenn Sie unsicher sind, ob
          &bdquo;Privat&ldquo; oder &bdquo;Gewerblich&ldquo; passt, wenden Sie sich vorab über die
          Kontaktseite an uns.
        </p>
      </HinweisBox>

      <p>
        Jedes neue Konto startet im kostenlosen <strong>Free</strong>-Tarif. Erweiterte Funktionen
        wie die Premium-Lohnauswertung oder der PDF-Stundennachweis gehören zum{" "}
        <strong>Premium</strong>-Tarif; das Upgrade fragen Sie über die Seite
        &bdquo;Preise&ldquo; per E-Mail an.
      </p>

      <h2 id="anmelden">Anmelden</h2>
      <p>
        Auf der Login-Seite melden Sie sich mit E-Mail-Adresse und Passwort an. Von dort gelangen
        Sie auch zur Registrierung oder zum Zurücksetzen des Passworts, falls Sie es vergessen
        haben.
      </p>

      <h2 id="einladung-annehmen">Als Assistenzkraft per Einladung</h2>
      <p>
        Assistenzkräfte registrieren sich nicht selbst — sie werden eingeladen. Ihr
        Assistenznehmer oder Dienstleister legt Sie im Bereich &bdquo;Assistenzkräfte&ldquo; an und
        erzeugt dort über &bdquo;Teammitglied einladen&ldquo; einen persönlichen Einladungslink.
      </p>
      <p>
        Öffnen Sie den Link, den Sie erhalten haben. Auf der Seite &bdquo;Passwort setzen&ldquo;
        wählen Sie ein neues Passwort, wiederholen es und bestätigen mit &bdquo;Passwort setzen
        und anmelden&ldquo;. Danach sind Sie direkt eingeloggt und sehen Ihren Dienstplan.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Einladung annehmen (Passwort setzen)" />

      <h2 id="passwort-vergessen">Passwort vergessen?</h2>
      <p>
        Aus Sicherheitsgründen wird das Passwort nicht automatisch per E-Mail zurückgesetzt.
        Wenden Sie sich als Assistenzkraft an Ihren Administrator — dieser kann Ihnen einen neuen
        Einladungslink senden, mit dem Sie ein neues Passwort setzen.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Diese Themen helfen Ihnen bei den ersten Schritten weiter:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Rollen verstehen" href="/handbuch/rollen" icon={Settings} />
        <SeeAlsoLink title="Dashboard" href="/handbuch/dashboard" icon={User} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Rollen verstehen
// ---------------------------------------------------------------------------
export function HandbuchRollen() {
  return (
    <ArtikelShell
      activeId="rollen"
      bereich="Erste Schritte"
      titel="Rollen verstehen"
      toc={[
        { id: "rollen-ueberblick", label: "Die Rollen im Überblick" },
        { id: "assistenznehmer", label: "Was Assistenznehmer sehen" },
        { id: "assistenten-sicht", label: "Was Assistenzkräfte sehen" },
        { id: "kontotypen", label: "Privat oder Gewerblich?" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Rollen verstehen
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Nicht jede Person sieht im AssistenzPlaner dasselbe. Wer plant und verwaltet, braucht
        andere Funktionen als jemand, der Dienste übernimmt. Diese Seite erklärt, welche Rollen es
        gibt und was sie dürfen.
      </p>

      <h2 id="rollen-ueberblick">Die Rollen im Überblick</h2>
      <p>
        Im AssistenzPlaner gibt es zwei Rollen: <strong>Assistenznehmer</strong> und{" "}
        <strong>Assistenzkraft</strong>. Der Assistenznehmer ist die verwaltende Rolle — er erstellt
        den Dienstplan, lädt Teammitglieder ein, pflegt Verträge und gibt Zeiterfassungen frei.
        Assistenzkräfte sind die Mitglieder des Teams: Sie sehen ihren eigenen Plan, erfassen ihre
        Arbeitszeiten und verwalten ihr Profil.
      </p>
      <p>
        Welche Rolle eine Person hat, sehen Sie als Verwaltung in der Mitglieder-Liste — zum
        Beispiel in der Team-Verwaltung, wo neben jedem Namen &bdquo;Assistenznehmer&ldquo; oder
        &bdquo;Assistenzkraft&ldquo; steht.
      </p>

      <HinweisBox titel="Tipp: Rollen werden automatisch vergeben">
        <p>
          Sie müssen Rollen nicht von Hand zuweisen. Wer sich selbst registriert, ist
          Assistenznehmer. Wer über einen Einladungslink dazukommt, ist Assistenzkraft.
        </p>
      </HinweisBox>

      <h2 id="assistenznehmer">Was Assistenznehmer sehen</h2>
      <p>
        Als Assistenznehmer steht Ihnen das App-Menü in voller Breite zur Verfügung: Dashboard,
        Dienstplan, Assistenzkräfte, Zeiterfassung, Abwesenheiten, Auswertungen und Einstellungen.
        Sie legen Dienste an und geben sie frei, genehmigen Abwesenheiten, prüfen Zeiteinträge und
        werten Stunden und Lohn aus.
      </p>
      <p>
        Gewerbliche Konten (Dienstleister) sehen zusätzlich den Bereich{" "}
        <strong>Team-Verwaltung</strong>, um mehrere Teams für verschiedene Klienten zu
        organisieren.
      </p>

      <h2 id="assistenten-sicht">Was Assistenzkräfte sehen</h2>
      <p>
        Assistenzkräfte sehen ein schlankeres Menü: Dashboard, Dienstplan, Zeiterfassung und
        Einstellungen. Im Dienstplan sehen sie die freigegebenen Dienste, in der Zeiterfassung
        tragen sie ihre tatsächlichen Arbeitszeiten ein. In den Einstellungen verwalten sie ihr
        Profil und ihr persönliches Kalender-Abo.
      </p>
      <p>
        Die Verwaltungsbereiche — Assistenzkräfte, Abwesenheiten, Auswertungen — sind für Assistenzkräfte
        nicht sichtbar. So bleibt der Blick frei für das, was für den eigenen Arbeitsalltag
        zählt.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: App-Menü (Assistenznehmer vs. Assistenzkraft)" />

      <h2 id="kontotypen">Privat oder Gewerblich?</h2>
      <p>
        Unabhängig von der Rolle unterscheidet der AssistenzPlaner zwei Kontotypen:{" "}
        <strong>Privat</strong> für einzelne Assistenznehmer im Arbeitgebermodell und{" "}
        <strong>Gewerblich</strong> für Assistenzdienste, die mehrere Teams verwalten. Der
        Kontotyp wird bei der Registrierung festgelegt und bestimmt, ob die Team-Verwaltung zur
        Verfügung steht.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Mehr zum Arbeiten mit Rollen und Teams:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Team-Verwaltung" href="/handbuch/team-verwaltung" icon={Building2} />
        <SeeAlsoLink
          title="Registrierung & Einstieg"
          href="/handbuch/registrierung"
          icon={User}
        />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Dashboard
// ---------------------------------------------------------------------------
export function HandbuchDashboard() {
  return (
    <ArtikelShell
      activeId="dashboard"
      bereich="Modul-Übersicht"
      titel="Dashboard"
      toc={[
        { id: "kennzahlen", label: "Die Kennzahlen-Karten" },
        { id: "hinweise", label: "Der Bereich Hinweise" },
        { id: "assistenten-dashboard", label: "Das Dashboard für Assistenzkräfte" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Dashboard
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Das Dashboard ist Ihre Startseite nach dem Login. Es zeigt die Übersicht für den
        aktuellen Monat: die wichtigsten Kennzahlen auf einen Blick und Hinweise auf Dinge, die
        Ihre Aufmerksamkeit brauchen.
      </p>

      <h2 id="kennzahlen">Die Kennzahlen-Karten</h2>
      <p>
        Im oberen Bereich sehen Sie als Verwaltung vier Karten: <strong>Aktive
        Assistenzkräfte</strong>, <strong>Schichten heute</strong>, <strong>offene
        Zeiteinträge</strong> und die <strong>Stundenbilanz</strong> des Monats mit Ist- und
        Soll-Stunden.
      </p>
      <p>
        Die Karten sind gleichzeitig Schnellzugriffe: Ein Klick auf eine Karte führt Sie direkt in
        den passenden Bereich — zum Beispiel von den aktiven Assistenzkräften zur Assistenzkräfte-Seite
        oder von den offenen Zeiteinträgen zur Zeiterfassung.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Dashboard (Kennzahlen-Karten)" />

      <h2 id="hinweise">Der Bereich Hinweise</h2>
      <p>
        Unter den Kennzahlen fasst der Bereich <strong>Hinweise</strong> zusammen, wo etwas zu tun
        ist: offene Zeiterfassungen, die noch bestätigt werden müssen, Assistenzkräfte mit wenig
        Resturlaub oder Tage, an denen noch keine Schicht geplant ist. Gibt es nichts zu tun,
        bleibt der Bereich leer — dann ist alles im grünen Bereich.
      </p>

      <HinweisBox titel="Tipp: Täglicher Startpunkt">
        <p>
          Ein kurzer Blick auf die Hinweise am Morgen reicht oft aus, um nichts zu übersehen —
          Lücken im Plan und offene Zeiteinträge fallen hier sofort auf.
        </p>
      </HinweisBox>

      <p>
        Gewerbliche Konten mit mehreren Teams wählen oben über die Team-Auswahl aus, für welches
        Team die Zahlen angezeigt werden.
      </p>

      <h2 id="assistenten-dashboard">Das Dashboard für Assistenzkräfte</h2>
      <p>
        Assistenzkräfte sehen auf dem Dashboard ihre persönliche Übersicht — darunter die eigene
        Stundenbilanz und die Karte <strong>Mein Resturlaub</strong> mit Anspruch, bereits
        genommenen und verbleibenden Urlaubstagen für das laufende Jahr. Verwaltungs-Kennzahlen
        wie offene Zeiteinträge anderer Teammitglieder erscheinen hier nicht.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Von hier aus geht es direkt weiter in die Planung:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Dienstplan" href="/handbuch/dienstplan" icon={FileText} />
        <SeeAlsoLink title="Rollen verstehen" href="/handbuch/rollen" icon={Settings} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Assistenten
// ---------------------------------------------------------------------------
export function HandbuchAssistenten() {
  return (
    <ArtikelShell
      activeId="assistenten"
      bereich="Modul-Übersicht"
      titel="Assistenzkräfte"
      toc={[
        { id: "uebersicht", label: "Die Assistenzkräfte-Übersicht" },
        { id: "anlegen", label: "Assistenzkräfte anlegen und bearbeiten" },
        { id: "einladen", label: "Teammitglied einladen" },
        { id: "entfernen", label: "Entfernen und Löschen" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Assistenzkräfte
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Im Bereich Assistenzkräfte verwalten Sie die Mitglieder Ihres Teams: Kontaktdaten, vertragliche
        Konditionen und den Zugang zur App. Der Bereich steht nur der Verwaltung zur Verfügung —
        Assistenzkräfte sehen ihn nicht.
      </p>

      <h2 id="uebersicht">Die Assistenzkräfte-Übersicht</h2>
      <p>
        Jede Assistenzkraft erscheint als eigene Karte mit Namen, Kontaktdaten und den wichtigsten
        Vertragsdaten: Wochenstunden, Arbeitstage pro Woche, Urlaubsanspruch und Vertragsbeginn.
        Ein Status zeigt, ob die Person aktiv oder inaktiv ist. Gewerbliche Konten wählen oben
        über die Team-Auswahl, welches Team angezeigt wird.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Assistenzkräfte-Übersicht (Karten)" />

      <h2 id="anlegen">Assistenzkräfte anlegen und bearbeiten</h2>
      <p>
        Über die Schaltfläche &bdquo;Neu anlegen&ldquo; öffnen Sie den Dialog für eine neue
        Assistenzkraft. Er ist in drei Bereiche gegliedert:
      </p>
      <p>
        <strong>Personendaten:</strong> Vorname, Nachname, E-Mail-Adresse und Adresse sind
        Pflichtfelder, eine Telefonnummer können Sie zusätzlich hinterlegen.
      </p>
      <p>
        <strong>Lohn- und Sozialversicherungsdaten</strong> (Premium): Hier erfassen Sie unter
        anderem Steuerklasse, Krankenkasse, IBAN und den Stundenlohn. Der Stundenlohn ist die
        Grundlage für die Premium-Lohnauswertung. Im Free-Tarif sind diese Felder gesperrt.
      </p>
      <p>
        <strong>Vertragliche Konditionen:</strong> Wochenstunden, Urlaubsanspruch in Tagen pro
        Jahr, Arbeitstage pro Woche und der Vertragsbeginn. Aus diesen Angaben berechnet der
        AssistenzPlaner die SOLL-Stunden und das Urlaubskonto.
      </p>
      <p>
        Über &bdquo;Bearbeiten&ldquo; auf der Karte ändern Sie die Daten später jederzeit —
        zum Beispiel bei einer Vertragsänderung.
      </p>

      <HinweisBox titel="Hinweis: Free-Tarif mit bis zu 6 Assistenzkräften">
        <p>
          Im Free-Tarif können Sie maximal 6 Assistenzkräfte anlegen. Ist die Grenze erreicht,
          erscheint ein Hinweis mit der Möglichkeit, ein Premium-Upgrade anzufragen.
        </p>
      </HinweisBox>

      <h2 id="einladen">Teammitglied einladen</h2>
      <p>
        Damit sich eine Assistenzkraft selbst anmelden kann, laden Sie sie ein: Klicken Sie auf
        der Karte auf &bdquo;Einladen&ldquo; und im Dialog &bdquo;Teammitglied einladen&ldquo; auf
        &bdquo;Einladungslink generieren&ldquo;. Den erzeugten Link kopieren Sie und senden ihn
        der Person auf einem Weg Ihrer Wahl. Der Link ist 48 Stunden gültig; danach können Sie
        jederzeit einen neuen generieren. Der eigene Zugang für Assistenzkräfte ist eine
        Premium-Funktion.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Dialog Teammitglied einladen" />

      <p>
        Über &bdquo;Nachweis&ldquo; auf der Karte exportieren Sie außerdem den
        PDF-Stundennachweis einer einzelnen Person (Premium) — mehr dazu im Kapitel Auswertungen.
      </p>

      <h2 id="entfernen">Entfernen und Löschen</h2>
      <p>
        Gewerbliche Konten mit mehreren Teams können eine Person über &bdquo;Aus Team
        entfernen&ldquo; aus dem gerade gewählten Team nehmen — ihre Daten und Zuordnungen in
        anderen Teams bleiben erhalten. Ist es die letzte Team-Zuordnung, weist ein roter Hinweis
        darauf hin, dass die Person danach in keiner Team-Liste mehr erscheint.
      </p>
      <p>
        Das endgültige Löschen finden Sie im Bearbeiten-Dialog. Es entfernt die Person
        unwiderruflich — einschließlich ihrer Verträge, Dienste und erfassten Zeiten. Prüfen Sie
        vorher, ob das Deaktivieren oder Entfernen aus dem Team nicht ausreicht.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">So arbeiten Sie mit den angelegten Assistenzkräften weiter:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Dienstplan" href="/handbuch/dienstplan" icon={FileText} />
        <SeeAlsoLink title="Auswertungen" href="/handbuch/auswertungen" icon={Star} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Zeiterfassung
// ---------------------------------------------------------------------------
export function HandbuchZeiterfassung() {
  return (
    <ArtikelShell
      activeId="zeiterfassung"
      bereich="Modul-Übersicht"
      titel="Zeiterfassung"
      toc={[
        { id: "grundprinzip", label: "SOLL und IST" },
        { id: "erfassen", label: "Zeiten erfassen" },
        { id: "pruefen", label: "Prüfen und bestätigen" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Zeiterfassung
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        In der Zeiterfassung halten Assistenzkräfte fest, wann sie tatsächlich gearbeitet haben.
        Die Verwaltung prüft die Einträge und gibt sie frei — so entsteht die Grundlage für
        Stundenbilanz und Abrechnung.
      </p>

      <h2 id="grundprinzip">SOLL und IST</h2>
      <p>
        Der AssistenzPlaner unterscheidet geplante Zeiten (SOLL) aus dem Dienstplan und
        tatsächlich geleistete Zeiten (IST) aus der Zeiterfassung. Jeder IST-Eintrag hat einen
        Status: <strong>Offen</strong>, <strong>Bestätigt</strong> oder{" "}
        <strong>Abgelehnt</strong>. Über die Reiter &bdquo;Alle&ldquo;, &bdquo;Offen&ldquo;,
        &bdquo;Bestätigt&ldquo; und &bdquo;Abgelehnt&ldquo; filtern Sie die Liste danach.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Zeiterfassung (Liste mit Status)" />

      <h2 id="erfassen">Zeiten erfassen</h2>
      <p>
        Am schnellsten geht es über den Bereich <strong>Geplante Schichten übernehmen</strong>:
        Dort erscheinen alle Dienste, für die noch keine IST-Zeit erfasst wurde. Ein Klick auf
        &bdquo;Übernehmen&ldquo; öffnet den Dialog mit den geplanten Zeiten als Vorschlag — passen
        Sie sie bei Bedarf an, ergänzen Sie optional eine Notiz und speichern Sie mit
        &bdquo;Ist-Zeit speichern&ldquo;. Der Eintrag steht danach auf &bdquo;Offen&ldquo;.
      </p>
      <p>
        Unabhängig vom Dienstplan erfassen Sie Zeiten über die Schaltfläche &bdquo;Zeit
        erfassen&ldquo; oben rechts: Datum, Start- und Endzeit wählen und speichern. Für
        Nachtdienste, die über Mitternacht gehen, aktivieren Sie den Schalter &bdquo;Endet am
        Folgetag&ldquo; — zum Beispiel 22:00 bis 06:00 Uhr.
      </p>
      <p>
        Assistenzkräfte erfassen Zeiten nur für sich selbst. Als Verwaltung können Sie im Dialog
        eine Assistenzkraft auswählen und Zeiten stellvertretend nachtragen.
      </p>

      <h2 id="pruefen">Prüfen und bestätigen</h2>
      <p>
        Als Verwaltung sehen Sie in der Liste zusätzlich die Spalte mit den Aktionen: Mit dem
        grünen Häkchen bestätigen Sie einen Eintrag, mit dem roten X lehnen Sie ihn ab. Erst
        bestätigte Einträge fließen in die IST-Stunden ein. Der Bestätigungs-Workflow ist eine
        Premium-Funktion.
      </p>
      <p>
        Für viele Einträge auf einmal nutzen Sie <strong>Alle offenen bestätigen</strong>: Ein
        Dialog fasst die Anzahl der offenen Einträge und die Stundensumme zusammen, bevor Sie die
        Sammelbestätigung abschließen.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Sammelbestätigung (Dialog)" />

      <HinweisBox titel="Tipp: Wöchentlich prüfen">
        <p>
          Filtern Sie regelmäßig auf &bdquo;Offen&ldquo; und bestätigen Sie zeitnah. So bleibt
          die Stundenbilanz auf dem Dashboard aktuell und der Monatsabschluss in den Auswertungen
          geht ohne Rückstau über die Bühne.
        </p>
      </HinweisBox>

      <p>
        Falls die Zeiterfassung in Ihren Einstellungen deaktiviert ist, zeigt die Seite den
        Hinweis &bdquo;Zeiterfassung ist deaktiviert&ldquo; — als Verwaltung gelangen Sie von dort
        direkt in die Einstellungen, um sie wieder einzuschalten.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Die erfassten Stunden laufen hier zusammen:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Auswertungen" href="/handbuch/auswertungen" icon={Star} />
        <SeeAlsoLink title="Dienstplan" href="/handbuch/dienstplan" icon={FileText} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Abwesenheiten
// ---------------------------------------------------------------------------
export function HandbuchAbwesenheiten() {
  return (
    <ArtikelShell
      activeId="abwesenheiten"
      bereich="Modul-Übersicht"
      titel="Abwesenheiten"
      toc={[
        { id: "arten", label: "Die Abwesenheitsarten" },
        { id: "eintragen", label: "Abwesenheit eintragen" },
        { id: "resturlaub", label: "Resturlaub im Blick" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Abwesenheiten
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Im Bereich Abwesenheiten erfassen Sie Urlaub, Krankheit und andere Fehlzeiten als
        Zeitraum. Die Einträge erscheinen automatisch im Dienstplan und fließen korrekt in
        Stundenbilanz und Urlaubskonto ein. Der Bereich steht der Verwaltung zur Verfügung.
      </p>

      <h2 id="arten">Die Abwesenheitsarten</h2>
      <p>
        Neben <strong>Urlaub</strong> und <strong>Krank</strong> kennt der AssistenzPlaner
        weitere Arten, die unterschiedlich bewertet werden: &bdquo;Freizeitausgleich
        (Ersatzruhetag)&ldquo;, &bdquo;Kind krank (unbezahlt)&ldquo;, &bdquo;Freistellung
        (bezahlt)&ldquo;, &bdquo;Abgesagt durch Arbeitgeber (bezahlt)&ldquo;, &bdquo;Abgesagt
        durch Assistenz (unbezahlt)&ldquo; und &bdquo;Urlaubsabgeltung (ausgezahlt)&ldquo;. Die
        Zusätze in Klammern zeigen direkt, ob die Zeit bezahlt wird. In den Auswertungen erscheint
        jede Art als eigene Zeile.
      </p>

      <h2 id="eintragen">Abwesenheit eintragen</h2>
      <p>
        In der Karte <strong>Abwesenheit eintragen</strong> wählen Sie die Assistenzkraft, die
        Art und den Zeitraum von/bis. Optional wählen Sie ein Schichtmodell: Dann wird die
        Abwesenheit mit dessen Zeiten bewertet — ohne Modell zählt sie ganztägig. Mit
        &bdquo;Eintragen&ldquo; wird der Zeitraum gebucht; Tage, an denen bereits eine Abwesenheit
        besteht, werden automatisch übersprungen.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Abwesenheit eintragen (Formular)" />

      <p>
        Die App warnt Sie an den richtigen Stellen: bei Überschneidungen mit bestehenden
        Diensten, beim Eintragen in einen bereits abgeschlossenen Monat und wenn ein Dienst vom
        Vortag (etwa eine Nachtwache bis 06:00 Uhr) in den gewählten Tag hineinragt — dieser
        gehört zum Vortag und bleibt bestehen.
      </p>
      <p>
        In der Liste <strong>Eingetragene Abwesenheiten</strong> sehen Sie alle Einträge und
        können sie über das Papierkorb-Symbol wieder löschen — gutgeschriebene Urlaubstage werden
        dabei zurückgebucht.
      </p>

      <h2 id="resturlaub">Resturlaub im Blick</h2>
      <p>
        Die Karte <strong>Resturlaub</strong> zeigt pro Assistenzkraft den Jahresanspruch, die
        bereits genommenen und die verbleibenden Urlaubstage. Urlaub wird stundengenau geführt:
        Ein Urlaubstag entspricht standardmäßig 8 Stunden, ein längerer Dienst kann also mehr als
        einen Urlaubstag kosten. Das automatische Resturlaub-Tracking ist eine Premium-Funktion —
        das Eintragen von Abwesenheiten selbst ist in allen Tarifen enthalten.
      </p>

      <HinweisBox titel="Hinweis: Bewertung bei neuen Verträgen">
        <p>
          Liegt noch keine ausreichende IST-Historie vor, bewertet der AssistenzPlaner
          Urlaubstage nach den Vertragsdaten (Arbeitstage pro Woche). Ein gelber Hinweis zeigt
          das an — dort können Sie die Arbeitstage pro Woche direkt korrigieren und mit
          &bdquo;Übernehmen&ldquo; speichern. Sobald genug erfasste Zeiten vorliegen, wechselt
          die Bewertung automatisch auf den Durchschnitt der letzten 13 Wochen.
        </p>
      </HinweisBox>

      <p>
        Assistenzkräfte sehen ihren eigenen Resturlaub auf dem Dashboard in der Karte
        &bdquo;Mein Resturlaub&ldquo;.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Abwesenheiten wirken sich hier direkt aus:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Dienstplan" href="/handbuch/dienstplan" icon={FileText} />
        <SeeAlsoLink title="Auswertungen" href="/handbuch/auswertungen" icon={Star} />
      </div>
    </ArtikelShell>
  );
}

// ---------------------------------------------------------------------------
// Artikel: Auswertungen
// ---------------------------------------------------------------------------
export function HandbuchAuswertungen() {
  return (
    <ArtikelShell
      activeId="auswertungen"
      bereich="Modul-Übersicht"
      titel="Auswertungen"
      toc={[
        { id: "ansichten", label: "Übersicht und Karten" },
        { id: "kategorien", label: "Die Kategorien-Zeilen" },
        { id: "lohnauswertung", label: "Premium-Lohnauswertung" },
        { id: "monatsabschluss", label: "Monat abschließen" },
        { id: "pdf-export", label: "PDF-Stundennachweis" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Auswertungen
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Die Auswertungen stellen für jeden Monat SOLL und IST gegenüber: geplante Stunden,
        geleistete Stunden, Zuschläge und Abwesenheiten. Die Soll/Ist-Auswertung gehört zum
        Premium-Tarif; Assistenzkräfte sehen den Bereich nicht.
      </p>

      <h2 id="ansichten">Übersicht und Karten</h2>
      <p>
        Oben wählen Sie den Monat, das Team und über &bdquo;Assistenzkraft filtern&ldquo; entweder
        &bdquo;Alle Assistenzkräfte&ldquo; oder eine einzelne Person. Zwei Ansichten stehen bereit:
        Die <strong>Übersicht</strong> zeigt alle Assistenzkräfte nebeneinander in einer
        Matrix-Tabelle, die <strong>Karten</strong>-Ansicht eine ausführliche Karte pro Person
        mit Fortschrittsbalken für geleistete und geplante Stunden.
      </p>
      <p>
        Gesamtübersicht und Einzelansicht nutzen dasselbe Tabellenformat — ein Klick auf den
        Namen einer Assistenzkraft im Spaltenkopf setzt den Filter direkt auf diese Person.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Auswertungen (Matrix-Übersicht)" />

      <HinweisBox titel="Hinweis: Nur bestätigte Dienste zählen">
        <p>
          In die Auswertung fließen nur freigegebene Dienste ein — Entwürfe und Vorschläge
          bleiben außen vor. Prüfen Sie vor dem Monatsende auch, ob noch offene Zeiteinträge in
          der Zeiterfassung auf Bestätigung warten.
        </p>
      </HinweisBox>

      <h2 id="kategorien">Die Kategorien-Zeilen</h2>
      <p>
        Die Tabelle gliedert die Stunden in Kategorien: geleistete Stunden (gewertet), erfüllte
        Stunden gesamt inklusive Urlaub und Krankheit sowie Nacht-, Sonntags- und
        Feiertagsstunden. Weitere Zeilen wie &bdquo;Teamsitzung&ldquo;,
        &bdquo;Bereitschaften&ldquo;, &bdquo;Pausen (unbezahlt)&ldquo;, &bdquo;Kind krank
        (unbezahlt)&ldquo;, &bdquo;Freistellung (bezahlt)&ldquo; oder
        &bdquo;Urlaubsabgeltung&ldquo; erscheinen automatisch, sobald im Monat entsprechende
        Einträge vorhanden sind.
      </p>

      <h2 id="lohnauswertung">Premium-Lohnauswertung</h2>
      <p>
        Ist bei den Assistenzkräften ein Stundenlohn hinterlegt, rechnet die{" "}
        <strong>Lohnauswertung</strong> (Premium) die Stunden in Euro um: Grundlohn,
        Nachtzuschlag, Sonntagszuschlag, Feiertagszuschlag und die Bruttosumme &bdquo;GESAMT
        (brutto)&ldquo;. Die Zuschlagssätze pflegen Sie in den Einstellungen unter Zuschläge.
      </p>

      <h2 id="monatsabschluss">Monat abschließen</h2>
      <p>
        Mit <strong>Monat abschließen</strong> (Premium) frieren Sie den geprüften Stand als
        Referenz ein. Gibt es zu dem Zeitpunkt noch offene Ist-Zeiten, warnt der Dialog vorab.
        Ändert sich nach dem Abschluss doch noch etwas — etwa eine nachgetragene Krankmeldung —
        zeigt der Folgemonat eine gelb markierte <strong>Nachberechnung</strong> mit den
        Differenzen in Stunden und Euro. So bleibt nachvollziehbar, was bereits abgerechnet war.
      </p>

      <h2 id="pdf-export">PDF-Stundennachweis</h2>
      <p>
        Über <strong>PDF Export</strong> (Premium) erzeugen Sie den Stundennachweis für die
        Lohnabrechnung: Ist eine einzelne Person gefiltert, als einzelnes PDF — bei
        &bdquo;Alle Assistenzkräfte&ldquo; als Sammelnachweis mit allen Personen. Den Export für
        eine einzelne Person erreichen Sie auch direkt über &bdquo;Nachweis&ldquo; auf der
        jeweiligen Karte im Bereich Assistenzkräfte.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Dialog Stundennachweis exportieren" />

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Diese Bereiche liefern die Daten für die Auswertung:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Zeiterfassung" href="/handbuch/zeiterfassung" icon={FileText} />
        <SeeAlsoLink title="Abwesenheiten" href="/handbuch/abwesenheiten" icon={CalendarOff} />
      </div>
    </ArtikelShell>
  );
}

export function HandbuchEinstellungen() {
  return (
    <ArtikelShell
      activeId="einstellungen"
      bereich="Verwaltung"
      titel="Einstellungen"
      toc={[
        { id: "aufbau", label: "Aufbau der Seite" },
        { id: "profil", label: "Profil & Passwort" },
        { id: "kalender-abo", label: "Kalender-Export & Abo" },
        { id: "schichtmodelle", label: "Schichtmodelle (Dienste)" },
        { id: "firmenlogo", label: "Firmenlogo (Premium)" },
        { id: "assistenzkraft-farben", label: "Assistenzkraft-Farben" },
        { id: "zuschlaege", label: "Zuschläge & Abrechnungsart" },
        { id: "pausen", label: "Pausen & Pausenabzug" },
        { id: "weitere-schalter", label: "Weitere Schalter" },
        { id: "rollen", label: "Was sehen Assistenzkräfte?" },
        { id: "siehe-auch", label: "Siehe auch" },
      ]}
    >
      <h1 className="mb-6 text-4xl font-bold leading-tight text-brand-dark md:text-5xl">
        Einstellungen
      </h1>
      <p className="mb-10 text-xl leading-relaxed text-slate-500">
        Die Einstellungen bündeln alles, was konto- und teamweit gilt: Ihr Profil, Schichtmodelle
        für den Dienstplan, Zuschlagssätze, Pausen&shy;regelungen und den Kalender-Export.
        Administrierende sehen alle Bereiche; Assistenzkräfte finden hier nur ihr Profil und den
        Kalender-Export.
      </p>

      <h2 id="aufbau">Aufbau der Seite</h2>
      <p>
        Die Einstellungen sind nach Tragweite geordnet — oben steht, was Stunden und Geld bestimmt,
        unten das Aussehen. Vier Gruppen:
      </p>
      <ul>
        <li>
          <strong>Abrechnungsgrundlagen</strong> — Zeiterfassung, Abrechnungsart, Vollzeit-Bezug,
          Urlaubsanspruch und Bundesland. Änderungen hier wirken auf Auswertung und
          Stundennachweis.
        </li>
        <li>
          <strong>Zuschläge und Zeitregeln</strong> — Zuschlagssätze, Pausen, Ersatzruhetag,
          Teamsitzung und die automatische Genehmigung von Stundenzetteln.
        </li>
        <li>
          <strong>Dienste und Struktur</strong> — Schichtmodelle, monatliches Stundenbudget und Ihr
          Profil.
        </li>
        <li>
          <strong>Darstellung und Export</strong> — Firmenlogo, Assistenzkraft-Farben sowie
          Kalender-Export und Abo.
        </li>
      </ul>
      <p>
        Die beiden oberen Gruppen sind immer geöffnet. Die beiden unteren sind zugeklappt; ein
        Klick auf die Überschrift öffnet sie, und die Seite merkt sich Ihre Wahl für den nächsten
        Besuch.
      </p>

      <HinweisBox titel="Hinweis: Speichern in den oberen beiden Gruppen">
        <p>
          Abrechnungsgrundlagen und Zuschläge gehören zu einem gemeinsamen Formular. Sobald Sie
          etwas ändern, erscheint unten am Bildschirmrand eine Leiste mit der Anzahl der offenen
          Änderungen sowie <strong>Speichern</strong> und <strong>Verwerfen</strong>. Eine Ausnahme
          ist der Schalter <strong>Zeiterfassung aktivieren</strong>: Er wird sofort nach der
          Rückfrage gespeichert, damit er nie in einem unklaren Zwischenzustand hängt.
        </p>
      </HinweisBox>

      <h2 id="profil">Profil &amp; Passwort</h2>
      <p>
        Die Karte <strong>Profilinformationen</strong> zeigt Ihren Namen, Ihre E-Mail-Adresse und
        ein abgedecktes Passwortfeld. Über <strong>Bearbeiten</strong> ändern Sie Name und
        E-Mail-Adresse; über <strong>Passwort ändern</strong> legen Sie ein neues Passwort fest.
        Geben Sie dazu zunächst Ihr aktuelles Passwort ein.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Einstellungen – Profilinformationen" />

      <h2 id="kalender-abo">Kalender-Export &amp; Abo</h2>
      <p>
        Unter <strong>Kalender-Export</strong> können Sie Ihre verbindlichen (freigegebenen) Dienste
        in eine Kalender-App übernehmen. Zwei Wege stehen bereit:
      </p>
      <ul>
        <li>
          <strong>Als .ics herunterladen</strong> — erzeugt sofort eine Datei, die Sie einmalig in
          Google Kalender, Apple Kalender, Outlook oder eine andere App importieren.
        </li>
        <li>
          <strong>Kalender-Abo</strong> — eine persönliche Abo-URL, die Ihre Kalender-App
          regelmäßig abruft. Neue oder verschobene Dienste erscheinen dann automatisch, ohne
          erneuten Download. Klicken Sie auf <strong>Abo-Link erstellen</strong>, um die URL zu
          erzeugen, und fügen Sie sie in Ihrer Kalender-App als Kalender-Abonnement hinzu.
        </li>
      </ul>

      <HinweisBox titel="Hinweis: Abo-URL geheim halten">
        <p>
          Die Abo-URL enthält einen persönlichen Zugriffs-Token. Geben Sie sie nicht weiter. Wurde
          sie versehentlich geteilt, erneuern Sie sie über <strong>Link erneuern</strong> — die alte
          URL wird damit sofort ungültig.
        </p>
      </HinweisBox>

      <p>
        Der Kalender-Export steht ab dem Premium-Tarif zur Verfügung. Im Free-Tarif ist die
        Schaltfläche sichtbar, aber gesperrt.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Einstellungen – Kalender-Export & Abo" />

      <h2 id="schichtmodelle">Schichtmodelle (Dienste)</h2>
      <p>
        Schichtmodelle legen die Vorlagen für Ihren Dienstplan fest — zum Beispiel
        &bdquo;Frühdienst&ldquo;, &bdquo;Spätdienst&ldquo; oder &bdquo;24-Stunden&ldquo;. Beim
        Anlegen einer Schicht im Dienstplan wählen Sie eines dieser Modelle aus; Start- und
        Endzeit sowie Zeitwertung werden dann vorausgefüllt.
      </p>
      <p>
        Über <strong>Neuen Dienst</strong> legen Sie ein Modell an. Sie vergeben eine
        Bezeichnung, Standard-Start- und Endzeit, die Wochentage, an denen der Dienst typischerweise
        anfällt, sowie die <strong>Zeitwertung</strong> in Prozent (100 % = volle Stunden). Für die
        Vergütung wählen Sie zwischen regulärem Stundenlohn, einem prozentualen Stundenlohn oder
        einem Festbetrag pro Schicht.
      </p>

      <HinweisBox titel="Hinweis: Free-Tarif – maximal 5 Dienste">
        <p>
          Im Free-Tarif sind bis zu 5 Schichtmodelle möglich. Die Schaltfläche{" "}
          <strong>Neuen Dienst</strong> wird gesperrt, sobald diese Grenze erreicht ist. Für
          unbegrenzte Modelle ist ein Upgrade auf Premium nötig.
        </p>
      </HinweisBox>

      <p>
        Bestehende Modelle lassen sich jederzeit <strong>bearbeiten</strong> oder auf{" "}
        <strong>Inaktiv</strong> setzen — inaktive Modelle werden im Dienstplan nicht mehr zur
        Auswahl angeboten, bleiben aber für ältere Einträge erhalten. Haben Sie mehrere Teams,
        wählen Sie oben über <strong>Dienste für Team</strong>, für welches Team die Liste gilt.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Einstellungen – Schichtmodelle" />

      <h2 id="firmenlogo">Firmenlogo <PremiumBadge /></h2>
      <p>
        Das Logo erscheint oben rechts auf dem PDF-Stundennachweis. Klicken Sie auf{" "}
        <strong>Logo hochladen</strong> und wählen Sie eine PNG- oder JPG-Datei (max. 5 MB). Über{" "}
        <strong>Logo ersetzen</strong> laden Sie ein anderes Bild hoch; über{" "}
        <strong>Entfernen</strong> kehren Sie zum Standard-Logo zurück.
      </p>
      <p>
        Als Dienstleister-Konto mit mehreren Teams können Sie je Team ein eigenes Logo hinterlegen:
        Wechseln Sie dazu im Team-Umschalter oben in das gewünschte Team, bevor Sie das Logo
        hochladen. Ohne Team-Logo gilt das Konto-Logo als Fallback.
      </p>

      <h2 id="assistenzkraft-farben">Assistenzkraft-Farben</h2>
      <p>
        Die Karte <strong>Assistenzkraft-Farben</strong> bestimmt, mit welcher Farbpalette die
        Assistenzkräfte im Monatskalender des Dienstplans unterschieden werden. Zwei Paletten
        stehen zur Wahl:
      </p>
      <ul>
        <li>
          <strong>Hell</strong> — zwölf helle Farben mit schwarzer Schrift.
        </li>
        <li>
          <strong>Dunkel</strong> — zwölf dunkle Farben mit weißer Schrift.
        </li>
      </ul>
      <p>
        Beide Paletten erfüllen die Kontrastanforderungen der Barrierefreiheit (WCAG&nbsp;AA). Jede
        Assistenzkraft behält beim Wechsel ihre Slot-Nummer — nur die Optik ändert sich. Die
        Auswahl wirkt sofort und rückwirkend auf alle Monate, da die Farben eine reine
        Darstellungseinstellung sind.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Einstellungen – Assistenzkraft-Farben" />

      <h2 id="zuschlaege">Zuschläge &amp; Abrechnungsart</h2>
      <p>
        Die Karte <strong>Zuschläge</strong> steuert, wie Nacht-, Sonntags- und Feiertagsstunden
        bewertet werden. Als Dienstleister-Konto sehen Sie oben ein Auswahlfeld{" "}
        <strong>Gilt für</strong>: Wählen Sie <strong>Konto-Standard (alle Teams)</strong> für eine
        kontoweite Regelung oder ein einzelnes Team, um für dieses Team abweichende Sätze zu
        hinterlegen. Eine Team-Regelung überschreibt den Konto-Standard vollständig für dieses Team.
        Über <strong>Team-Regelung entfernen</strong> kehren Sie zum Konto-Standard zurück.
      </p>

      <ScreenshotPlatzhalter label="Screenshot: Einstellungen – Zuschläge" />

      <p>Folgende Felder stehen bereit:</p>
      <ul>
        <li>
          <strong>Nachtzuschlag</strong> — Prozentwert sowie Von/Bis-Uhrzeiten des Nachtfensters
          (auch über Mitternacht hinweg möglich).
        </li>
        <li>
          <strong>Sonntagszuschlag</strong> und <strong>Feiertagszuschlag</strong> — jeweils als
          Prozentwert auf den Grundlohn.
        </li>
        <li>
          <strong>Bundesland</strong> — bestimmt, welche regionalen Feiertage (z. B. Fronleichnam)
          berücksichtigt werden. Ohne Auswahl gelten nur die bundesweiten Feiertage.
        </li>
        <li>
          <strong>Abrechnungsart</strong> — wählen Sie zwischen{" "}
          <strong>Soll – nach geplanten Schichten</strong> und{" "}
          <strong>Ist – nach erfassten Zeiten</strong>. Diese Einstellung bestimmt, woraus
          Auswertungen und der Stundennachweis berechnet werden. Eine abweichende Einstellung in der
          Personalakte einer Assistenzkraft hat Vorrang vor dieser Regelung.
        </li>
      </ul>

      <HinweisBox titel="Tipp: Änderungen wirken rückwirkend">
        <p>
          Zuschlagsänderungen wirken sich sofort auf alle vorhandenen Auswertungen aus — Schichten
          müssen nicht neu gespeichert werden. Prüfen Sie daher bestehende Monatsauswertungen,
          nachdem Sie Sätze angepasst haben.
        </p>
      </HinweisBox>

      <h2 id="pausen">Pausen &amp; Pausenabzug</h2>
      <p>
        Zwei Schalter steuern, wie Pausen im AssistenzPlaner behandelt werden:
      </p>

      <h3>Pausen automatisch vorbefüllen</h3>
      <p>
        Ist dieser Schalter aktiviert, befüllt der Dienstplan beim Anlegen eines neuen Dienstes das
        Pausenfeld automatisch — abhängig von der Dienstdauer. Sie legen eine zweistufige Staffel
        fest: ab welcher Dienstlänge (in Stunden) wie viele Pausenminuten eingetragen werden. Die
        gesetzliche Voreinstellung entspricht § 4 ArbZG: ab 6 Stunden 30 Minuten, ab 9 Stunden
        45 Minuten. Der Wert bleibt pro Dienst überschreibbar; bestehende Dienste werden nicht
        verändert. Außerdem wird die Staffel im Stundenzettel der Zeiterfassung als Vorbelegung
        für das Pausenfeld verwendet.
      </p>

      <h3>Pausen von bezahlten Stunden abziehen</h3>
      <p>
        Ist dieser Schalter aktiviert, zieht der AssistenzPlaner die eingetragenen unbezahlten
        Pausenminuten von den gewerteten Stunden und dem Grundlohn ab — in Auswertungen und
        Stundennachweis, für beide Abrechnungsarten (Soll und Ist), rückwirkend schaltbar.
        Zuschläge bleiben davon unberührt. Solange der Schalter ausgeschaltet ist, sind Pausen
        eine reine Info-Kennzahl ohne Auswirkung auf die Lohnberechnung.
      </p>

      <HinweisBox titel="Hinweis: Beide Schalter gelten kontoweit">
        <p>
          Die Pausenregelung und der Pausenabzug gelten für alle Teams Ihres Kontos. Eine
          Team-spezifische Einstellung ist hier nicht möglich.
        </p>
      </HinweisBox>

      <h2 id="weitere-schalter">Weitere Schalter</h2>
      <p>
        Die folgenden Schalter sind ebenfalls unter Zuschläge zu finden und gelten kontoweit:
      </p>
      <ul>
        <li>
          <strong>Stundenzettel automatisch genehmigen</strong> — eingereichte Zeiteinträge werden
          ohne manuelle Prüfung sofort bestätigt und in die Auswertung übernommen.
        </li>
        <li>
          <strong>Zeiterfassung aktivieren</strong> — schaltet die Zeiterfassung für alle Teams
          frei. Solange ausgeschaltet, können keine neuen Zeiteinträge angelegt werden; bestehende
          Einträge bleiben erhalten. Das Ein- und Ausschalten erfordert eine Bestätigung.
        </li>
        <li>
          <strong>Ersatzruhetag-Konto für Feiertage</strong> — wer an einem gesetzlichen Feiertag
          arbeitet, erhält nach § 11 Abs. 3 ArbZG einen Ausgleichs-Ruhetag gutgeschrieben. Der
          Schalter kann ausgeschaltet werden, wenn kein Ausgleichskonto geführt werden soll.
        </li>
        <li>
          <strong>Team-Dienst (Teamsitzung)</strong> — erlaubt das Anlegen von Team-Einträgen im
          Dienstplan. Ein Team-Eintrag schreibt allen Assistenzkräften des Teams die eingestellte
          Stunden-Gutschrift als Arbeitszeit gut.
        </li>
        <li>
          <strong>Urlaubsberechnung</strong> — wählen Sie zwischen dem gesetzlichen
          13-Wochen-Durchschnitt (§ 11 BUrlG) und einem festen Faktor pro Arbeitsstunde.
        </li>
      </ul>

      <h2 id="rollen">Was sehen Assistenzkräfte?</h2>
      <p>
        Assistenzkräfte erreichen die Einstellungen über das Menü und sehen dort zwei Bereiche:
        <strong> Profilinformationen</strong> (Name, E-Mail, Passwort ändern) und{" "}
        <strong>Kalender-Export</strong>. Alle übrigen Bereiche — Schichtmodelle, Firmenlogo,
        Zuschläge und die konto&shy;weiten Schalter — sind ausschließlich für
        Administrierende sichtbar.
      </p>

      <h2 id="siehe-auch">Siehe auch</h2>
      <p className="mb-6">Diese Bereiche arbeiten eng mit den Einstellungen zusammen:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SeeAlsoLink title="Auswertungen" href="/handbuch/auswertungen" icon={FileText} />
        <SeeAlsoLink title="Zeiterfassung" href="/handbuch/zeiterfassung" icon={CalendarDays} />
        <SeeAlsoLink title="Dienstplan" href="/handbuch/dienstplan" icon={Settings} />
        <SeeAlsoLink title="Assistenzkräfte" href="/handbuch/assistenten" icon={Users} />
      </div>
    </ArtikelShell>
  );
}
