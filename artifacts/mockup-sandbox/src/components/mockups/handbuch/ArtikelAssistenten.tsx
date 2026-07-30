import React from "react";
import { ChevronRight, Users, CalendarDays } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink, handbuchUrl } from "./_shared/Chrome";
import assistentenPng from "./_assets/assistenten-desktop.png";

export function ArtikelAssistenten() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <div className="flex flex-1 w-full max-w-[1400px] mx-auto relative">
        <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 sticky top-16 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <DocsSidebar activeId="assistenten" />
        </aside>

        <main className="flex-1 min-w-0 px-6 py-8 md:px-12 lg:py-12">
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 font-medium">
            <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1">Handbuch</a>
            <ChevronRight className="h-4 w-4" />
            <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1">Modul-Übersicht</a>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[var(--color-brand-dark)]">Assistenten</span>
          </nav>

          <article className="handbuch-content">
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">Assistenten</h1>
            <p className="text-xl text-slate-500 mb-10 leading-relaxed">
              Hier verwalten Sie Ihr Assistenzteam: Sie laden neue Assistenzkräfte ein, hinterlegen
              Verträge mit Wochenstunden und behalten den Überblick über alle aktiven Mitglieder.
            </p>

            <h2 id="einladen">Assistenten einladen</h2>
            <p>
              Über die Schaltfläche "Assistent einladen" verschicken Sie einen persönlichen Einladungslink.
              Die eingeladene Person legt selbst ein Passwort fest und sieht danach nur den eigenen Plan
              und die eigenen Stunden — niemals die Daten anderer Teammitglieder.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={assistentenPng}
                alt="Die Assistenten-Übersicht mit der Liste aller Teammitglieder, ihren Verträgen und der Schaltfläche zum Einladen"
                className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Die Assistenten-Übersicht mit Verträgen und Einladungs-Funktion</figcaption>
            </figure>

            <h2 id="vertraege">Verträge und Wochenstunden</h2>
            <p>
              Für jede Assistenzkraft hinterlegen Sie einen Vertrag mit den vereinbarten Wochenstunden.
              Der AssistenzPlaner vergleicht diese Soll-Stunden automatisch mit dem Dienstplan und zeigt
              in den Auswertungen, ob jemand über oder unter dem Vertrag liegt.
            </p>
            <p>
              Verlässt eine Assistenzkraft das Team, deaktivieren Sie das Konto einfach — die bisherigen
              Dienste und Stundennachweise bleiben für die Abrechnung erhalten.
            </p>

            <h2 id="siehe-auch">Siehe auch</h2>
            <p className="mb-6">
              Diese Themen hängen eng mit der Assistenten-Verwaltung zusammen:
            </p>
            <div className="grid sm:grid-cols-2 gap-4 not-prose">
              <SeeAlsoLink title="Dienstplan" href={handbuchUrl("ArtikelDienstplan")} icon={CalendarDays} />
              <SeeAlsoLink title="Team-Verwaltung" href={handbuchUrl("ArtikelTeamVerwaltung")} icon={Users} />
            </div>
          </article>
        </main>

        <aside className="hidden xl:block w-64 shrink-0 px-6 py-12">
          <div className="sticky top-24">
            <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-4 uppercase tracking-wider">Auf dieser Seite</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#einladen" className="text-[var(--color-brand-cyan)] font-medium handbuch-focus rounded px-1 -ml-1">Assistenten einladen</a></li>
              <li><a href="#vertraege" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Verträge und Wochenstunden</a></li>
              <li><a href="#siehe-auch" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Siehe auch</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
