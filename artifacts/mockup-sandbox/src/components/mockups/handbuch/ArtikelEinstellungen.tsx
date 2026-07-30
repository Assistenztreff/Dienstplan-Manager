import React from "react";
import { ChevronRight, Users, BarChart3 } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink, PremiumBadge, handbuchUrl } from "./_shared/Chrome";
import einstellungenPng from "./_assets/einstellungen-desktop.png";

export function ArtikelEinstellungen() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <div className="flex flex-1 w-full max-w-[1400px] mx-auto relative">
        <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 sticky top-16 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <DocsSidebar activeId="einstellungen" />
        </aside>

        <main className="flex-1 min-w-0 px-6 py-8 md:px-12 lg:py-12">
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 font-medium">
            <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1">Handbuch</a>
            <ChevronRight className="h-4 w-4" />
            <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1">Verwaltung</a>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[var(--color-brand-dark)]">Einstellungen</span>
          </nav>

          <article className="handbuch-content">
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">Einstellungen</h1>
            <p className="text-xl text-slate-500 mb-10 leading-relaxed">
              In den Einstellungen passen Sie den AssistenzPlaner an Ihren Betrieb an: Schichtmodelle,
              Zuschläge, das Kalender-Abo und Ihr Profil werden hier zentral gepflegt.
            </p>

            <h2 id="schichtmodelle">Schichtmodelle und Zuschläge</h2>
            <p>
              <strong>Schichtmodelle</strong> sind Vorlagen für wiederkehrende Dienste (z.&nbsp;B. Frühdienst
              oder 24-Stunden-Dienst), die das Planen deutlich beschleunigen. Unter <strong>Zuschläge</strong> legen
              Sie fest, wie Nacht-, Sonntags- und Feiertagsstunden bewertet werden — die Auswertungen
              rechnen automatisch damit.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={einstellungenPng}
                alt="Die Einstellungen-Seite mit den Bereichen Profil, Schichtmodelle, Zuschläge und Kalender-Abo"
                className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Die Einstellungen mit Schichtmodellen, Zuschlägen und Kalender-Abo</figcaption>
            </figure>

            <h2 id="kalender-logo">Kalender-Abo und eigenes Logo</h2>
            <p>
              Über das <strong>Kalender-Abo</strong> abonnieren Sie und Ihre Assistenzkräfte den Dienstplan
              in der eigenen Kalender-App — Änderungen erscheinen dort automatisch. Der Link ist persönlich
              und lässt sich jederzeit zurückziehen.
            </p>
            <p className="flex items-start gap-2">
              <span>
                Mit einem Premium-Konto hinterlegen Sie zusätzlich ein <strong>eigenes Logo</strong>, das auf
                PDF-Exporten wie dem Stundennachweis erscheint.
              </span>
              <PremiumBadge inline />
            </p>

            <h2 id="siehe-auch">Siehe auch</h2>
            <p className="mb-6">
              Diese Bereiche greifen auf Ihre Einstellungen zurück:
            </p>
            <div className="grid sm:grid-cols-2 gap-4 not-prose">
              <SeeAlsoLink title="Auswertungen" href={handbuchUrl("ArtikelAuswertungen")} icon={BarChart3} />
              <SeeAlsoLink title="Team-Verwaltung" href={handbuchUrl("ArtikelTeamVerwaltung")} icon={Users} />
            </div>
          </article>
        </main>

        <aside className="hidden xl:block w-64 shrink-0 px-6 py-12">
          <div className="sticky top-24">
            <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-4 uppercase tracking-wider">Auf dieser Seite</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#schichtmodelle" className="text-[var(--color-brand-cyan)] font-medium handbuch-focus rounded px-1 -ml-1">Schichtmodelle und Zuschläge</a></li>
              <li><a href="#kalender-logo" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Kalender-Abo und eigenes Logo</a></li>
              <li><a href="#siehe-auch" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Siehe auch</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
