import React, { useState } from "react";
import { ChevronRight, CalendarDays, BarChart3, Settings, Building2, Search, ArrowRight, X } from "lucide-react";
import "./_group.css";
import { DocsHeader, DocsSidebar, SeeAlsoLink, handbuchUrl } from "./_shared/Chrome";
import einstellungenMobilPng from "./_assets/einstellungen-mobil.png";

export function Mobil() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(true);

  return (
    <div className="handbuch-theme flex flex-col min-h-dvh max-w-[390px] mx-auto border-x border-slate-200 bg-white relative shadow-2xl overflow-hidden">
      <DocsHeader mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      
      {/* Mobile Navigation Sheet - shown based on state */}
      {mobileMenuOpen && (
        <div className="absolute inset-x-0 bottom-0 z-30 top-16 bg-white overflow-hidden flex flex-col animate-in slide-in-from-left-full duration-300 border-r border-slate-200 shadow-xl">
          <div className="flex-1 overflow-y-auto">
            <DocsSidebar activeId="zeiterfassung" />
          </div>
        </div>
      )}

      {/* Main Content behind the sheet, visibly pushed back or just under */}
      <main className={`flex-1 px-5 py-6 transition-opacity duration-300 overflow-y-auto ${mobileMenuOpen ? 'opacity-20 pointer-events-none' : 'opacity-100'}`}>
        <nav className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mb-6 font-medium">
          <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)]">Handbuch</a>
          <ChevronRight className="h-3 w-3" />
          <a href={handbuchUrl("Start")} className="hover:text-[var(--color-brand-dark)]">Arbeitgeber</a>
          <ChevronRight className="h-3 w-3" />
          <span className="text-[var(--color-brand-dark)] truncate">Zeiterfassung</span>
        </nav>

        <article className="handbuch-content" style={{ fontSize: '1rem' }}>
          <h1 className="text-3xl font-bold text-[var(--color-brand-dark)] mb-4">Zeiterfassung</h1>
          <p className="text-[17px] text-slate-500 mb-8 leading-relaxed">
            Mit der digitalen Stempeluhr dokumentieren Assistenten ihre reale Arbeitszeit sekundengenau.
          </p>

          <div className="my-8 rounded-xl border border-[var(--color-brand-cyan)] bg-[var(--color-brand-hellblau)]/30 p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-brand-dark)] mb-5">Der Zeiterfassungs-Kreislauf</h3>
            
            <div className="flex flex-col gap-6 relative">
              <div className="absolute left-[15px] top-6 bottom-6 w-0.5 bg-[var(--color-brand-cyan)]/40"></div>
              
              <div className="relative flex gap-4">
                <div className="h-8 w-8 rounded-full bg-[var(--color-brand-cyan)] text-white font-bold flex items-center justify-center shrink-0 z-10 border-[3px] border-white shadow-sm text-sm ring-1 ring-slate-100">1</div>
                <div className="pt-1.5">
                  <a href="#" className="font-bold text-[var(--color-brand-dark)] underline hover:no-underline">Aktivieren</a>
                  <p className="text-sm text-slate-600 mt-1 leading-snug">Schalten Sie die Stempeluhr in den Einstellungen ein.</p>
                </div>
              </div>
              
              <div className="relative flex gap-4">
                <div className="h-8 w-8 rounded-full bg-[var(--color-brand-cyan)] text-white font-bold flex items-center justify-center shrink-0 z-10 border-[3px] border-white shadow-sm text-sm ring-1 ring-slate-100">2</div>
                <div className="pt-1.5">
                  <span className="font-bold text-[var(--color-brand-dark)]">Nutzen</span>
                  <p className="text-sm text-slate-600 mt-1 leading-snug">Das Team stempelt sich via Smartphone ein und aus.</p>
                </div>
              </div>

              <div className="relative flex gap-4">
                <div className="h-8 w-8 rounded-full bg-[var(--color-brand-cyan)] text-white font-bold flex items-center justify-center shrink-0 z-10 border-[3px] border-white shadow-sm text-sm ring-1 ring-slate-100">3</div>
                <div className="pt-1.5">
                  <a href="#" className="font-bold text-[var(--color-brand-dark)] underline hover:no-underline">Auswerten</a>
                  <p className="text-sm text-slate-600 mt-1 leading-snug">Geleistete Stunden fließen automatisch in die Lohnauswertung.</p>
                </div>
              </div>
            </div>
          </div>

          <h2 className="text-2xl mt-8 mb-4">Schritt 1: Aktivieren</h2>
          <p>
            Bevor Sie die Zeiterfassung nutzen können, müssen Sie diese in den Einstellungen aktivieren. 
            Damit wird die Stempeluhr für alle Assistenten sichtbar.
          </p>
          
          <figure className="my-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
            <img
              src={einstellungenMobilPng}
              alt="Einstellungen-Seite auf dem Smartphone mit Profilinformationen und Kalender-Export"
              className="mx-auto w-full max-w-[240px] rounded-lg border border-slate-200 bg-white shadow-sm"
              loading="lazy"
            />
            <figcaption className="mt-2 text-xs text-slate-500">Die Einstellungen auf dem Smartphone</figcaption>
          </figure>

          <h2 className="text-2xl mt-8 mb-4">Schritt 2: Einstempeln</h2>
          <p>
            Assistenten sehen auf ihrem Smartphone-Dashboard nun einen großen, blauen "Kommen"-Button. 
            Am Ende der Schicht wird über "Gehen" ausgestempelt.
          </p>

          <h2 className="text-2xl mt-8 mb-4">Siehe auch</h2>
          <div className="flex flex-col gap-3 not-prose mb-8">
            <SeeAlsoLink title="Einstellungen" href={handbuchUrl("ArtikelEinstellungen")} icon={Settings} />
            <SeeAlsoLink title="Auswertungen & Lohn" href={handbuchUrl("ArtikelAuswertungen")} icon={BarChart3} />
          </div>
        </article>
      </main>
    </div>
  );
}
