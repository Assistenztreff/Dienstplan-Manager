import React from "react";
import { ChevronRight, Clock, CalendarOff } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink, PremiumBadge } from "./_shared/Chrome";
import auswertungenPng from "./_assets/auswertungen-desktop.png";

export function ArtikelAuswertungen() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <div className="flex flex-1 w-full max-w-[1400px] mx-auto relative">
        <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 sticky top-16 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <DocsSidebar activeId="auswertungen" />
        </aside>

        <main className="flex-1 min-w-0 px-6 py-8 md:px-12 lg:py-12">
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 font-medium">
            <a href="#" className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1">Handbuch</a>
            <ChevronRight className="h-4 w-4" />
            <a href="#" className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1">Modul-Übersicht</a>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[var(--color-brand-dark)]">Auswertungen</span>
          </nav>

          <article className="handbuch-content">
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">Auswertungen</h1>
            <p className="text-xl text-slate-500 mb-10 leading-relaxed">
              Die Auswertungen zeigen pro Monat und pro Assistenzkraft, wie viele Stunden geplant und
              geleistet wurden — inklusive Zuschlägen für Nacht-, Sonntags- und Feiertagsarbeit.
            </p>

            <h2 id="stundenbilanz">Stundenbilanz pro Assistenzkraft</h2>
            <p>
              Für jede Assistenzkraft sehen Sie die Soll-Stunden aus dem Vertrag, die tatsächlich
              geplanten bzw. erfassten Stunden und die daraus entstehende Über- oder Unterdeckung.
              Abwesenheiten wie Urlaub und Krankheit werden dabei korrekt bewertet.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={auswertungenPng}
                alt="Die Auswertungen-Seite mit der monatlichen Stundenbilanz pro Assistenzkraft, Zuschlägen und Export-Schaltflächen"
                className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Die monatliche Stundenbilanz mit Zuschlägen und Exporten</figcaption>
            </figure>

            <h2 id="exporte" className="flex items-center gap-3">Exporte für die Lohnabrechnung <PremiumBadge inline /></h2>
            <p>
              Mit einem Premium-Konto exportieren Sie die <strong>Premium-Lohnauswertung</strong> als
              aufbereitete Tabelle und den <strong>PDF-Stundennachweis</strong> als unterschriftsreifes
              Dokument — beides direkt aus der Auswertung heraus, fertig für Lohnbüro oder Kostenträger.
            </p>

            <h2 id="siehe-auch">Siehe auch</h2>
            <p className="mb-6">
              Die Zahlen der Auswertung speisen sich aus diesen Bereichen:
            </p>
            <div className="grid sm:grid-cols-2 gap-4 not-prose">
              <SeeAlsoLink title="Zeiterfassung" href="#" icon={Clock} />
              <SeeAlsoLink title="Abwesenheiten" href="#" icon={CalendarOff} />
            </div>
          </article>
        </main>

        <aside className="hidden xl:block w-64 shrink-0 px-6 py-12">
          <div className="sticky top-24">
            <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-4 uppercase tracking-wider">Auf dieser Seite</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#stundenbilanz" className="text-[var(--color-brand-cyan)] font-medium handbuch-focus rounded px-1 -ml-1">Stundenbilanz pro Assistenzkraft</a></li>
              <li><a href="#exporte" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Exporte für die Lohnabrechnung</a></li>
              <li><a href="#siehe-auch" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Siehe auch</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
