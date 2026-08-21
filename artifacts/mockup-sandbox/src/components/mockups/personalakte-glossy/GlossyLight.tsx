import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Download,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  ShieldCheck,
  UserRound,
  UserPlus,
} from "lucide-react";
import "./_group.css";

const actionBase =
  "relative inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-[#05305b] focus-visible:ring-offset-2";

export function GlossyLight() {
  const [notice, setNotice] = useState("");

  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };

  return (
    <main
      className="personalakte-preview min-h-screen overflow-hidden bg-[#f4f8f5] px-4 py-7 text-[#05305b] sm:px-8 sm:py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 9% 12%, rgba(212,240,240,.72), transparent 25rem), radial-gradient(circle at 89% 4%, rgba(235,241,139,.43), transparent 19rem), linear-gradient(135deg, #f8fbf8 0%, #eef5f2 100%)",
      }}
    >
      <section className="mx-auto max-w-[720px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#0f6b6b]">
              <span className="h-2 w-2 rounded-full bg-[#0f6b6b]" aria-hidden="true" />
              Personalverwaltung
            </div>
            <div className="flex items-baseline gap-3">
              <h1 className="font-['Rubik'] text-3xl font-bold tracking-[-0.04em] text-[#05305b]">
                Personalakte
              </h1>
              <span className="text-sm text-[#4b6577]">1 Assistenzkraft</span>
            </div>
          </div>
          <button
            type="button"
            className={`${actionBase} border border-[#c7d46a] bg-[#ebf18b] text-[#05305b] shadow-[0_8px_20px_rgba(85,96,10,.14),inset_0_1px_0_rgba(255,255,255,.75)] hover:-translate-y-0.5 hover:bg-[#f0f59e]`}
            onClick={() => announce("Neue Assistenzkraft wird angelegt.")}
          >
            <UserPlus className="h-[18px] w-[18px]" aria-hidden="true" />
            Assistenzkraft anlegen
          </button>
        </header>

        <article className="relative isolate overflow-hidden rounded-[28px] border border-white/90 bg-[#fbfdfb]/95 shadow-[0_26px_65px_rgba(5,48,91,.16),0_3px_10px_rgba(5,48,91,.08)]">
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-90"
            style={{
              background:
                "linear-gradient(112deg, rgba(255,255,255,.86) 0%, rgba(255,255,255,.08) 27%, rgba(212,240,240,.34) 47%, rgba(255,255,255,.6) 67%, rgba(235,241,139,.18) 100%)",
            }}
          />
          <div className="pointer-events-none absolute -right-20 -top-32 -z-10 h-72 w-72 rounded-full bg-[#d4f0f0]/50 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 -z-10 h-48 w-72 rounded-full bg-[#ebf18b]/20 blur-3xl" />

          <header className="relative grid gap-6 border-b border-[#05305b]/10 px-5 pb-6 pt-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-8 sm:py-7">
            <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[22px] border border-white bg-[#05305b] text-xl font-bold tracking-[-0.06em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.3),0_12px_22px_rgba(5,48,91,.2)]">
              KK
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-[#0f6b6b]">
                Assistenzkraft · Personalprofil
              </p>
              <h2 className="font-['Rubik'] text-[28px] font-bold leading-none tracking-[-0.045em] text-[#05305b]">
                Klara König
              </h2>
              <div className="mt-4 grid gap-2 text-sm text-[#36556d] sm:grid-cols-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-[#0f6b6b]" aria-hidden="true" />
                  <span className="truncate">klara.koenig@example.de</span>
                </span>
                <span className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-[#0f6b6b]" aria-hidden="true" />
                  0176 45678910
                </span>
                <span className="flex min-w-0 items-center gap-2 sm:col-span-2">
                  <MapPin className="h-4 w-4 shrink-0 text-[#0f6b6b]" aria-hidden="true" />
                  <span className="truncate">Kantstraße 18, 10623 Berlin</span>
                </span>
              </div>
            </div>
            <div className="flex flex-row gap-2 sm:flex-col sm:items-end">
              <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[#c7d46a] bg-[#ebf18b] px-3 text-xs font-bold text-[#05305b]">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Aktiv
              </span>
              <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[#05305b]/15 bg-white/70 px-3 text-xs font-bold text-[#05305b]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Teamleiter
              </span>
            </div>
          </header>

          <div className="grid gap-7 px-5 py-6 sm:grid-cols-[1fr_180px] sm:px-8 sm:py-7">
            <section aria-labelledby="employment-heading">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f6b6b]">Aktuelles Verhältnis</p>
                  <h3 id="employment-heading" className="mt-1 font-['Rubik'] text-lg font-bold tracking-[-0.025em]">
                    Beschäftigungsdaten
                  </h3>
                </div>
                <CalendarDays className="h-5 w-5 text-[#0f6b6b]" aria-hidden="true" />
              </div>
              <dl className="grid overflow-hidden rounded-2xl border border-[#05305b]/10 bg-white/60 sm:grid-cols-2">
                <div className="border-b border-[#05305b]/10 p-4 sm:border-r">
                  <dt className="text-xs font-medium text-[#4b6577]">Wochenstunden</dt>
                  <dd className="mt-1 font-['Rubik'] text-xl font-bold tracking-[-0.035em]">32 h</dd>
                </div>
                <div className="border-b border-[#05305b]/10 p-4">
                  <dt className="text-xs font-medium text-[#4b6577]">Arbeitstage/Woche</dt>
                  <dd className="mt-1 font-['Rubik'] text-xl font-bold tracking-[-0.035em]">4 Tage</dd>
                </div>
                <div className="border-b border-[#05305b]/10 p-4 sm:border-b-0 sm:border-r">
                  <dt className="text-xs font-medium text-[#4b6577]">Urlaubsanspruch</dt>
                  <dd className="mt-1 font-['Rubik'] text-xl font-bold tracking-[-0.035em]">30 Tage</dd>
                </div>
                <div className="p-4">
                  <dt className="text-xs font-medium text-[#4b6577]">Beschäftigt seit</dt>
                  <dd className="mt-1 font-['Rubik'] text-xl font-bold tracking-[-0.035em]">01.02.2025</dd>
                </div>
              </dl>
              <p className="mt-4 border-l-2 border-[#3fb8cc] pl-3 text-sm leading-relaxed text-[#36556d]">
                Fester Dienstplan Montag bis Donnerstag.
              </p>
            </section>

            <aside className="rounded-2xl border border-[#05305b]/10 bg-[#d4f0f0]/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.8)]">
              <UserRound className="h-5 w-5 text-[#0f6b6b]" aria-hidden="true" />
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-[#0f6b6b]">Im Team</p>
              <p className="mt-1 font-['Rubik'] text-lg font-bold leading-tight">Verantwortung mit Überblick</p>
              <p className="mt-3 text-sm leading-relaxed text-[#36556d]">
                Als Teamleiter sieht Klara die Teamplanung und hält sie aktuell.
              </p>
            </aside>
          </div>

          <footer className="flex flex-col gap-2 border-t border-[#05305b]/10 bg-white/45 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p className="text-xs text-[#4b6577]">Personalakte · zuletzt geprüft heute</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${actionBase} text-[#36556d] hover:bg-[#05305b]/[.06] hover:text-[#05305b]`} onClick={() => announce("Nachweis wird vorbereitet.")}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Nachweis
              </button>
              <button type="button" className={`${actionBase} text-[#36556d] hover:bg-[#05305b]/[.06] hover:text-[#05305b]`} onClick={() => announce("Einladung für Klara König wird erstellt.")}>
                <Send className="h-4 w-4" aria-hidden="true" />
                Einladen
              </button>
              <button type="button" className={`${actionBase} border border-[#05305b]/20 bg-white text-[#05305b] shadow-[inset_0_1px_0_rgba(255,255,255,.9)] hover:-translate-y-px hover:border-[#05305b]/40 hover:bg-[#f9fdfc]`} onClick={() => announce("Bearbeiten geöffnet.")}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Bearbeiten
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </footer>
        </article>
        <p className="mt-4 text-center text-xs leading-relaxed text-[#547083]">
          Luminöse Akte: Kontakt, Beschäftigung und Rolle bleiben auf einen Blick erfassbar.
        </p>
      </section>
      <div aria-live="polite" className="sr-only">{notice}</div>
    </main>
  );
}