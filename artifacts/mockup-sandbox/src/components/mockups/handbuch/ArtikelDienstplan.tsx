import React from "react";
import { ChevronRight, CalendarDays, CalendarOff, Settings } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink, handbuchUrl } from "./_shared/Chrome";
import monatsansichtPng from "./_assets/dienstplan-monatsansicht-desktop.png";
import dienstDialogPng from "./_assets/dienst-dialog-desktop.png";

export function ArtikelDienstplan() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <div className="flex flex-1 w-full max-w-[1400px] mx-auto relative">
        {/* Sidebar */}
        <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 sticky top-16 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <DocsSidebar activeId="dienstplan" />
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 px-6 py-8 md:px-12 lg:py-12">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 font-medium">
            <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1">Handbuch</a>
            <ChevronRight className="h-4 w-4" />
            <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1">Für private Arbeitgeber</a>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[var(--color-brand-dark)]">Dienstplan</span>
          </nav>

          <article className="handbuch-content">
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">Dienstplan</h1>
            <p className="text-xl text-slate-500 mb-10 leading-relaxed">
              Der Dienstplan ist das Herzstück des AssistenzPlaners. Hier organisieren Sie alle Schichten,
              sehen Verfügbarkeiten Ihres Teams und reagieren auf Ausfälle.
            </p>

            <h2 id="monatsansicht">Die Monatsansicht</h2>
            <p>
              In der tabellarischen Monatsansicht sehen Sie alle Assistenzkräfte untereinander und die Tage des
              Monats als Spalten. Diese Ansicht eignet sich besonders gut, um den kompletten Plan für den
              nächsten Monat aufzubauen. Jede Assistenzkraft hat eine eigene Zeile, sodass Sie auf einen Blick
              erkennen, wer wann eingeteilt ist.
            </p>
            <p>
              Sie können Dienste ganz einfach per Klick in eine leere Zelle eintragen. Wenn Sie denselben Dienst
              für mehrere Tage eintragen möchten, können Sie die Kopieren-Funktion nutzen.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={monatsansichtPng}
                alt="Dienstplan in der tabellarischen Monatsansicht: Assistenzkräfte als Zeilen, Tage des Monats als Spalten, farbige Dienst-Blöcke mit Uhrzeiten"
                className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Die Monatsansicht mit allen Assistenzkräften und ihren Diensten</figcaption>
            </figure>

            <h2 id="dienste-erstellen">Dienste erstellen und zuweisen</h2>
            <p>
              Klicken Sie auf ein Datum bei einer Assistenzkraft, um einen neuen Dienst anzulegen. Sie können
              die Uhrzeiten frei wählen oder ein vordefiniertes Schichtmodell (z. B. "Frühdienst 06:00 - 14:00") nutzen,
              um Zeit zu sparen.
            </p>
            <p>
              <strong>Status-Farben:</strong> Ein neu erstellter Dienst ist zunächst grau (Entwurf). Sobald Sie
              ihn freigeben, wird er für die Assistenzkraft sichtbar und leuchtet in Ihrem Plan grün (Fix).
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={dienstDialogPng}
                alt="Dialog Neue Schicht anlegen mit Feldern für Assistenzkraft, Datum, Typ (Frühdienst), Status (Entwurf), Start- und Endzeit"
                className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Der Dienst-Dialog: neue Dienste starten als Entwurf und werden per Freigabe fix</figcaption>
            </figure>

            <h2 id="siehe-auch">Siehe auch</h2>
            <p className="mb-6">
              Der Dienstplan ist eng mit anderen Funktionen des AssistenzPlaners verzahnt. Hier finden Sie weiterführende Themen:
            </p>
            <div className="grid sm:grid-cols-2 gap-4 not-prose">
              <SeeAlsoLink title="Krankheit & Urlaub verwalten" href={handbuchUrl("ArtikelAbwesenheiten")} icon={CalendarOff} />
              <SeeAlsoLink title="Schichtmodelle anlegen" href={handbuchUrl("ArtikelEinstellungen")} icon={Settings} />
            </div>
          </article>
        </main>

        {/* Right TOC */}
        <aside className="hidden xl:block w-64 shrink-0 px-6 py-12">
          <div className="sticky top-24">
            <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-4 uppercase tracking-wider">Auf dieser Seite</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#monatsansicht" className="text-[var(--color-brand-cyan)] font-medium handbuch-focus rounded px-1 -ml-1">Die Monatsansicht</a></li>
              <li><a href="#dienste-erstellen" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Dienste erstellen und zuweisen</a></li>
              <li><a href="#siehe-auch" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Siehe auch</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
