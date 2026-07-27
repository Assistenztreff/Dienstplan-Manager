import React from "react";
import { ChevronRight, Users, Settings, Briefcase } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink, DienstleisterBadge } from "./_shared/Chrome";
import teamVerwaltungPng from "./_assets/team-verwaltung-desktop.png";

export function ArtikelTeamVerwaltung() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <div className="flex flex-1 w-full max-w-[1400px] mx-auto relative">
        <aside className="hidden lg:block w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 sticky top-16 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
          <DocsSidebar activeId="team-verwaltung" />
        </aside>

        <main className="flex-1 min-w-0 px-6 py-8 md:px-12 lg:py-12">
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-8 font-medium">
            <a href="#" className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1">Handbuch</a>
            <ChevronRight className="h-4 w-4" />
            <a href="#" className="hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1">Für Dienstleister</a>
            <ChevronRight className="h-4 w-4" />
            <span className="text-[var(--color-brand-dark)]">Team-Verwaltung</span>
          </nav>

          <article className="handbuch-content">
            <div className="mb-4">
              <DienstleisterBadge inline={false} />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">Team-Verwaltung</h1>
            <p className="text-xl text-slate-500 mb-10 leading-relaxed">
              Als Dienstleister verwalten Sie nicht nur einen einzelnen Plan, sondern organisieren mehrere Teams
              für verschiedene Klienten. In diesem Bereich weisen Sie Administrationsrechte und Zuständigkeiten zu.
            </p>

            <h2 id="teams-anlegen">Neue Teams anlegen</h2>
            <p>
              Ein Team entspricht in der Regel einem Klienten, bei dem rund um die Uhr oder stundenweise Assistenz 
              geleistet wird. Über die Schaltfläche "Neues Team" können Sie einen Arbeitsort erstellen.
            </p>
            <p>
              Für jedes Team wird ein separater Dienstplan generiert. Assistenten können mehreren Teams zugeordnet 
              werden, sodass sie flexibel in verschiedenen Einsatzorten aushelfen können, ohne dass es zu 
              Doppelbelegungen im Kalender kommt.
            </p>

            <figure className="my-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={teamVerwaltungPng}
                alt="Team-Verwaltung mit der Team-Liste, Schaltflächen zum Überführen, Bearbeiten und Löschen sowie dem Button Neues Team"
                className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-sm"
                loading="lazy"
              />
              <figcaption className="mt-3 text-sm text-slate-500">Die Team-Übersicht für Dienstleister-Konten</figcaption>
            </figure>

            <h2 id="rollen-rechte">Rollen und Rechte verteilen</h2>
            <p>
              Nicht jeder Mitarbeiter sollte alles sehen dürfen. Sie können in der Team-Verwaltung sogenannte 
              <strong>Team-Admins</strong> ernennen. Diese Personen können den Dienstplan für ihr spezifisches Team 
              schreiben und Urlaubsanträge genehmigen, sehen aber keine Auswertungen oder Pläne von anderen Klienten.
            </p>
            <p>
              Die Rolle <strong>Superadmin</strong> bleibt der Geschäftsführung vorbehalten und erlaubt den Zugriff 
              auf globale Einstellungen, Lohnberichte und alle Dienstpläne übergreifend.
            </p>

            <h2 id="siehe-auch">Siehe auch</h2>
            <p className="mb-6">
              So strukturieren Sie Ihr Unternehmen effektiv im AssistenzPlaner:
            </p>
            <div className="grid sm:grid-cols-2 gap-4 not-prose">
              <SeeAlsoLink title="Rollen verstehen" href="#" icon={Settings} />
              <SeeAlsoLink title="Assistenten verwalten" href="#" icon={Users} />
            </div>
          </article>
        </main>

        <aside className="hidden xl:block w-64 shrink-0 px-6 py-12">
          <div className="sticky top-24">
            <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-4 uppercase tracking-wider">Auf dieser Seite</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#teams-anlegen" className="text-[var(--color-brand-cyan)] font-medium handbuch-focus rounded px-1 -ml-1">Neue Teams anlegen</a></li>
              <li><a href="#rollen-rechte" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Rollen und Rechte verteilen</a></li>
              <li><a href="#siehe-auch" className="text-slate-500 hover:text-[var(--color-brand-dark)] handbuch-focus rounded px-1 -ml-1 transition-colors">Siehe auch</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
