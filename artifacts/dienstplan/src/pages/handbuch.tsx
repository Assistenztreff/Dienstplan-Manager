import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Building2,
  CalendarOff,
  ChevronRight,
  FileText,
  Search,
  Settings,
  Star,
  User,
  Users,
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
      { title: "Registrierung & Einstieg" },
      { title: "Rollen verstehen" },
    ],
  },
  {
    title: "Modul-Übersicht",
    items: [
      { title: "Dashboard" },
      { title: "Dienstplan", href: "/handbuch/dienstplan", id: "dienstplan" },
      { title: "Assistenten" },
      { title: "Zeiterfassung" },
      { title: "Abwesenheiten" },
      {
        title: "Auswertungen",
        children: [
          { title: "Premium-Lohnauswertung", isPremium: true },
          { title: "PDF-Stundennachweis", isPremium: true },
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
        children: [
          { title: "Schichtmodelle" },
          { title: "Zuschläge" },
          { title: "Kalender-Abo" },
          { title: "eigenes Logo", isPremium: true },
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
          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
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
        <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      )}
    </Link>
  );
}

function HandbuchSidebar({ activeId }: { activeId: string }) {
  return (
    <nav aria-label="Handbuch-Kapitel" className="h-full overflow-y-auto px-4 py-8 pb-24 lg:px-6">
      {KAPITEL.map((section) => (
        <div key={section.title} className="mb-8">
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

// Gemeinsames Artikel-Geruest: Breadcrumbs, Kapitel-Seitenleiste links,
// Inhaltsverzeichnis rechts (ab xl).
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
  return (
    <HandbuchShell>
      <div className="relative mx-auto flex w-full max-w-[1400px] flex-1">
        <aside className="sticky top-0 hidden max-h-screen w-72 shrink-0 self-start overflow-hidden border-r border-slate-200 bg-slate-50/50 lg:block">
          <HandbuchSidebar activeId={activeId} />
        </aside>

        {/* Bewusst KEIN <main>: das Layout (eingeloggt) bzw. die
            HandbuchShell (ausgeloggt) stellt bereits die main-Landmarke. */}
        <div className="min-w-0 flex-1 px-6 py-8 md:px-12 lg:py-12">
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
  { label: "Wie funktioniert die Zeiterfassung?" },
  { label: "Zuschläge für Nacht- und Sonntagsarbeit" },
  { label: "Krankmeldung und Ersatz finden" },
  { label: "Stundennachweis als PDF exportieren" },
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
        In der tabellarischen Monatsansicht sehen Sie alle Assistenten untereinander und die Tage
        des Monats als Spalten. Diese Ansicht eignet sich besonders gut, um den kompletten Plan für
        den nächsten Monat aufzubauen. Jeder Assistent hat eine eigene Zeile, sodass Sie auf einen
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
        <SeeAlsoLink title="Krankheit & Urlaub verwalten" icon={CalendarOff} />
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
        Für jedes Team wird ein separater Dienstplan generiert. Assistenten können mehreren Teams
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
        <SeeAlsoLink title="Rollen verstehen" icon={Settings} />
        <SeeAlsoLink title="Assistenten verwalten" icon={Users} />
      </div>
    </ArtikelShell>
  );
}
