import React from "react";
import { BookOpen, Search, Star, Building2, Menu, X, ArrowRight } from "lucide-react";
import "../_group.css";

export function PremiumBadge({ inline }: { inline?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded bg-[var(--color-brand-yellow)] font-bold text-[var(--color-brand-dark)] shadow-sm shrink-0 ${inline ? 'px-1.5 py-0.5 text-[10px] uppercase tracking-wider' : 'px-1.5 py-0.5 text-[10px] uppercase tracking-wider'}`}>
      <Star className="h-3 w-3 fill-[var(--color-brand-dark)]" />
      Premium
    </span>
  );
}

export function DienstleisterBadge({ inline }: { inline?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded bg-[var(--color-brand-dark)] font-bold text-[var(--color-brand-white)] shadow-sm shrink-0 ${inline ? 'px-1.5 py-0.5 text-[10px] uppercase tracking-wider' : 'px-1.5 py-0.5 text-[10px] uppercase tracking-wider'}`}>
      <Building2 className="h-3 w-3" />
      Nur Dienstleister
    </span>
  );
}

export const CHAPTERS: Array<{
  title: string;
  items: Array<{
    title: string;
    href: string;
    id?: string;
    isDienstleister?: boolean;
    children?: Array<{
      title: string;
      href: string;
      isPremium?: boolean;
    }>;
  }>;
}> = [
  {
    title: "Erste Schritte",
    items: [
      { title: "Registrierung & Einstieg", href: "#" },
      { title: "Rollen verstehen", href: "#" },
    ]
  },
  {
    title: "Modul-Übersicht",
    items: [
      { title: "Dashboard", href: "#" },
      { title: "Dienstplan", href: "#", id: "dienstplan" },
      { title: "Assistenten", href: "#" },
      { title: "Zeiterfassung", href: "#", id: "zeiterfassung" },
      { title: "Abwesenheiten", href: "#" },
      { 
        title: "Auswertungen", 
        href: "#",
        children: [
          { title: "Premium-Lohnauswertung", href: "#", isPremium: true },
          { title: "PDF-Stundennachweis", href: "#", isPremium: true },
        ]
      },
    ]
  },
  {
    title: "Verwaltung",
    items: [
      { title: "Team-Verwaltung", href: "#", id: "team-verwaltung", isDienstleister: true },
      { 
        title: "Einstellungen", 
        href: "#",
        children: [
          { title: "Schichtmodelle", href: "#" },
          { title: "Zuschläge", href: "#" },
          { title: "Kalender-Abo", href: "#" },
          { title: "eigenes Logo", href: "#", isPremium: true },
        ]
      }
    ]
  }
];

export function DocsHeader({ mobileMenuOpen, setMobileMenuOpen }: { mobileMenuOpen?: boolean, setMobileMenuOpen?: (v: boolean) => void }) {
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-[var(--color-brand-hellblau)] bg-[var(--color-brand-white)] px-4 lg:px-8 shrink-0">
      <div className="flex items-center gap-4">
        {setMobileMenuOpen && (
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 -ml-2 text-[var(--color-brand-dark)] handbuch-focus rounded-md hover:bg-[var(--color-brand-hellblau)]"
            aria-label="Menü umschalten"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        )}
        <a href="#" className="flex items-center gap-2 font-serif text-xl font-bold text-[var(--color-brand-dark)] handbuch-focus rounded">
          <BookOpen className="h-6 w-6 text-[var(--color-brand-cyan)]" />
          AssistenzPlaner <span className="font-light hidden sm:inline">Handbuch</span>
        </a>
      </div>
      <div className="flex items-center gap-4 lg:gap-6">
        <div className="relative hidden md:block w-64 lg:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="search" 
            placeholder="Handbuch durchsuchen..." 
            className="h-10 w-full rounded-full border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-[var(--color-brand-dark)] placeholder:text-slate-500 focus:border-[var(--color-brand-cyan)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-cyan)]/20"
          />
        </div>
        <a href="#" className="handbuch-link font-semibold handbuch-focus rounded hidden sm:inline-block px-2 py-1">
          Zur App
        </a>
      </div>
    </header>
  );
}

export function DocsSidebar({ activeId }: { activeId?: string }) {
  return (
    <nav className="h-full overflow-y-auto px-4 py-8 pb-24 lg:px-6">
      <div className="mb-8 md:hidden">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="search" 
            placeholder="Suchen..." 
            className="h-10 w-full rounded-full border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-[var(--color-brand-dark)] focus:border-[var(--color-brand-cyan)] focus:bg-white focus:outline-none"
          />
        </div>
      </div>
      
      {CHAPTERS.map((section, idx) => (
        <div key={idx} className="mb-8">
          <h4 className="mb-3 px-3 text-xs font-bold uppercase tracking-wider text-slate-400">
            {section.title}
          </h4>
          <div className="space-y-1">
            {section.items.map((item, iIdx) => (
              <div key={iIdx}>
                <a 
                  href={item.href} 
                  className={`handbuch-sidebar-link handbuch-focus ${item.id === activeId ? 'active' : ''}`}
                >
                  <span className="flex-1">{item.title}</span>
                  {item.isDienstleister && <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                </a>
                {item.children && (
                  <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-2">
                    {item.children.map((child, cIdx) => (
                      <a 
                        key={cIdx} 
                        href={child.href}
                        className="handbuch-sidebar-link handbuch-focus text-[13px] py-1.5 flex items-center gap-2"
                      >
                        <span className="flex-1">{child.title}</span>
                        {child.isPremium && <PremiumBadge inline />}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      
      <div className="mt-8 rounded-xl bg-[var(--color-brand-hellblau)] p-4 border border-[var(--color-brand-cyan)]/20">
        <h4 className="font-bold text-[var(--color-brand-dark)] text-sm mb-2">Brauchen Sie Hilfe?</h4>
        <p className="text-xs text-slate-600 mb-3">Unser Support-Team ist für Sie da.</p>
        <a href="#" className="inline-flex w-full justify-center items-center rounded-md bg-[var(--color-brand-white)] px-3 py-2 text-sm font-semibold text-[var(--color-brand-dark)] shadow-sm border border-slate-200 hover:border-[var(--color-brand-dark)] handbuch-focus transition-colors">
          Kontakt aufnehmen
        </a>
      </div>
    </nav>
  );
}

export function SeeAlsoLink({ title, href, icon: Icon }: { title: string, href: string, icon?: any }) {
  return (
    <a href={href} className="group flex items-center gap-3 rounded-lg border border-slate-200 p-4 transition-colors hover:border-[var(--color-brand-dark)] hover:bg-[var(--color-brand-hellblau)]/30 handbuch-focus">
      {Icon && <Icon className="h-5 w-5 text-[var(--color-brand-cyan)] group-hover:text-[var(--color-brand-dark)]" />}
      <span className="flex-1 font-semibold text-[var(--color-brand-dark)]">{title}</span>
      <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-[var(--color-brand-dark)] transition-transform group-hover:translate-x-1" />
    </a>
  );
}
