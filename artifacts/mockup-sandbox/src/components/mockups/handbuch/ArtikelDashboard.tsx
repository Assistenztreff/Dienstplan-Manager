import React from "react";
import { ChevronRight, CalendarDays, BarChart3 } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink } from "./_shared/Chrome";
import dashboardPng from "./_assets/dashboard-desktop.png";
import dashboardMobilPng from "./_assets/dashboard-mobil.png";

export function ArtikelDashboard() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <div className="flex flex-1 w-full max-w-[1400px] mx-auto relative">
        <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 sticky top-16 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <DocsSidebar activeId="dashboard" />
        </aside>

        <main className="flex-1 min-w-0 px-6 py-8 md:px-12 lg:py-12">
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 font-medium">
            <a href="#" className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1">Handbuch</a>
            <ChevronRight className="h-4 w-4" />
            <a href="#" className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1">Modul-Übersicht</a>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[var(--color-brand-dark)]">Dashboard</span>
          </nav>

          <article className="handbuch-content">
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">Dashboard</h1>
            <p className="text-xl text-slate-500 mb-10 leading-relaxed">
              Das Dashboard ist Ihre Startseite nach der Anmeldung. Es fasst die wichtigsten Zahlen
              des laufenden Monats zusammen und zeigt Ihnen auf einen Blick, wo Handlungsbedarf besteht.
            </p>

            <h2 id="ueberblick">Der Überblick auf einen Blick</h2>
            <p>
              Oben sehen Sie Kennzahlen wie geplante Stunden, offene Dienste und anstehende Abwesenheiten.
              Darunter folgen die nächsten Dienste und aktuelle Hinweise, etwa unbestätigte Zeiterfassungen
              oder Urlaubsanträge, die auf eine Entscheidung warten.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={dashboardPng}
                alt="Das Dashboard mit Kennzahlen-Kacheln zum laufenden Monat, den nächsten Diensten und aktuellen Hinweisen"
                className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Das Dashboard bündelt Kennzahlen und offene Aufgaben</figcaption>
            </figure>

            <h2 id="unterwegs">Auch unterwegs im Blick</h2>
            <p>
              Auf dem Smartphone ordnen sich die Kacheln untereinander an, sodass Sie auch von unterwegs
              schnell prüfen können, ob alles im Plan ist.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={dashboardMobilPng}
                alt="Das Dashboard in der mobilen Ansicht mit untereinander angeordneten Kennzahlen-Kacheln"
                className="mx-auto w-full max-w-[280px] rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Das Dashboard auf dem Smartphone</figcaption>
            </figure>

            <h2 id="siehe-auch">Siehe auch</h2>
            <p className="mb-6">
              Von hier aus geht es meist direkt weiter in diese Bereiche:
            </p>
            <div className="grid sm:grid-cols-2 gap-4 not-prose">
              <SeeAlsoLink title="Dienstplan" href="#" icon={CalendarDays} />
              <SeeAlsoLink title="Auswertungen" href="#" icon={BarChart3} />
            </div>
          </article>
        </main>

        <aside className="hidden xl:block w-64 shrink-0 px-6 py-12">
          <div className="sticky top-24">
            <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-4 uppercase tracking-wider">Auf dieser Seite</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#ueberblick" className="text-[var(--color-brand-cyan)] font-medium handbuch-focus rounded px-1 -ml-1">Der Überblick auf einen Blick</a></li>
              <li><a href="#unterwegs" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Auch unterwegs im Blick</a></li>
              <li><a href="#siehe-auch" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Siehe auch</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
