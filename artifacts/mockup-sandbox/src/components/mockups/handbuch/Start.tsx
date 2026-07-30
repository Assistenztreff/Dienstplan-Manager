import React from "react";
import { Search, User, Building2, FileText, ArrowRight } from "lucide-react";
import "./_group.css";
import { DocsHeader, handbuchUrl } from "./_shared/Chrome";

export function Start() {
  return (
    <div className="handbuch-theme flex flex-col min-h-dvh">
      <DocsHeader />
      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="bg-[var(--color-brand-hellblau)] py-16 px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-brand-dark)] mb-6">
              Wie können wir Ihnen helfen?
            </h1>
            <div className="relative max-w-2xl mx-auto shadow-lg rounded-full">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-6 w-6 text-slate-400" />
              <input 
                type="search" 
                placeholder="Nach Themen, Stichworten oder Funktionen suchen..." 
                className="h-16 w-full rounded-full border-0 bg-white pl-14 pr-32 text-lg text-[var(--color-brand-dark)] placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[var(--color-brand-dark)]"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 h-12 px-6 bg-[var(--color-brand-dark)] text-white font-bold rounded-full hover:bg-[var(--color-brand-cyan)] transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-dark)]">
                Suchen
              </button>
            </div>
          </div>
        </section>

        {/* Einstiegspunkte */}
        <section className="py-16 px-6 max-w-5xl mx-auto w-full">
          <div className="grid md:grid-cols-2 gap-8">
            <a href={handbuchUrl("ArtikelDashboard")} className="group relative overflow-hidden rounded-2xl border-2 border-slate-100 bg-white p-8 transition-all hover:border-[var(--color-brand-dark)] hover:shadow-xl handbuch-focus">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <User className="w-32 h-32 text-[var(--color-brand-dark)]" />
              </div>
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--color-brand-hellblau)] text-[var(--color-brand-dark)] mb-6">
                <User className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold text-[var(--color-brand-dark)] mb-3">Für private Arbeitgeber</h2>
              <p className="text-slate-600 mb-6 text-lg">
                Alles über Dienstpläne, Zeiterfassung und die Verwaltung Ihres eigenen Assistenzteams.
              </p>
              <span className="inline-flex items-center font-bold text-[var(--color-brand-cyan)] group-hover:text-[var(--color-brand-dark)]">
                Zum Leitfaden <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-2" />
              </span>
            </a>

            <a href={handbuchUrl("ArtikelTeamVerwaltung")} className="group relative overflow-hidden rounded-2xl border-2 border-slate-100 bg-white p-8 transition-all hover:border-[var(--color-brand-dark)] hover:shadow-xl handbuch-focus">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Building2 className="w-32 h-32 text-[var(--color-brand-dark)]" />
              </div>
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--color-brand-yellow)] text-[var(--color-brand-dark)] mb-6">
                <Building2 className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold text-[var(--color-brand-dark)] mb-3">Für Dienstleister & Organisationen</h2>
              <p className="text-slate-600 mb-6 text-lg">
                Verwalten Sie mehrere Teams, Klienten und weisen Sie administrative Rollen zu.
              </p>
              <span className="inline-flex items-center font-bold text-[var(--color-brand-cyan)] group-hover:text-[var(--color-brand-dark)]">
                Zum Leitfaden <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-2" />
              </span>
            </a>
          </div>
        </section>

        {/* Häufige Themen */}
        <section className="bg-slate-50 py-16 px-6 border-t border-slate-200 flex-1">
          <div className="max-w-5xl mx-auto">
            <h3 className="text-xl font-bold text-[var(--color-brand-dark)] mb-8 text-center">Häufig gesuchte Themen</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {([
                ["Dienstplan für den ganzen Monat freigeben", handbuchUrl("ArtikelDienstplan")],
                ["Wie funktioniert die Zeiterfassung?", handbuchUrl("Mobil")],
                ["Zuschläge für Nacht- und Sonntagsarbeit", handbuchUrl("ArtikelEinstellungen")],
                ["Krankmeldung und Ersatz finden", handbuchUrl("ArtikelAbwesenheiten")],
                ["Neuen Assistenten einladen", handbuchUrl("ArtikelAssistenten")],
                ["Stundennachweis als PDF exportieren", handbuchUrl("ArtikelAuswertungen")],
              ] as [string, string][]).map(([topic, href], idx) => (
                <a key={idx} href={href} className="flex items-start gap-3 p-4 bg-white rounded-xl border border-slate-200 hover:border-[var(--color-brand-cyan)] hover:shadow-md transition-all handbuch-focus group">
                  <FileText className="h-5 w-5 text-slate-400 group-hover:text-[var(--color-brand-cyan)] shrink-0" />
                  <span className="font-medium text-slate-700 group-hover:text-[var(--color-brand-dark)] leading-snug">{topic as string}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
