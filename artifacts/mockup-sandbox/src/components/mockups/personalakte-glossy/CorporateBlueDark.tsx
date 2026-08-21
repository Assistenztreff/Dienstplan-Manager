import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Download,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

const actionBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-semibold outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-[#ebf18b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#062544]";

export function CorporateBlueDark() {
  const [notice, setNotice] = useState("Akte zuletzt aktualisiert: heute, 09:42 Uhr");

  return (
    <main className="cb-dark-preview min-h-screen px-4 py-6 text-[#eff9fb] sm:px-8 sm:py-10">
      <style>{`
        .cb-dark-preview {
          --navy: #05305b;
          --ink: #08213d;
          --cyan: #3fb8cc;
          --mint: #d4f0f0;
          --yellow: #ebf18b;
          background:
            radial-gradient(circle at 82% 2%, rgba(63,184,204,.17), transparent 26rem),
            radial-gradient(circle at 4% 93%, rgba(235,241,139,.11), transparent 23rem),
            linear-gradient(135deg, #031a33 0%, #062b50 48%, #041f3d 100%);
          font-family: "Rubik", ui-sans-serif, system-ui, sans-serif;
          isolation: isolate;
        }
        .cb-dark-preview::before {
          content: "";
          position: fixed;
          z-index: -1;
          inset: 0;
          pointer-events: none;
          opacity: .22;
          background-image: linear-gradient(rgba(212,240,240,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(212,240,240,.035) 1px, transparent 1px);
          background-size: 34px 34px;
          mask-image: linear-gradient(to bottom, black, transparent 75%);
        }
        .cb-lacquer {
          position: relative;
          overflow: hidden;
          background: linear-gradient(145deg, rgba(10,52,91,.96), rgba(4,31,61,.98) 62%, rgba(3,24,49,.98));
          box-shadow: 0 28px 70px rgba(0, 10, 27, .46), inset 0 1px 0 rgba(222,250,255,.34), inset 0 -1px 0 rgba(0,0,0,.24);
        }
        .cb-lacquer::before, .cb-lacquer::after {
          content: "";
          position: absolute;
          z-index: 0;
          pointer-events: none;
        }
        .cb-lacquer::before {
          width: 34rem; height: 15rem; right: -12rem; top: -8rem;
          transform: rotate(-15deg);
          background: linear-gradient(105deg, transparent 23%, rgba(212,240,240,.16) 47%, rgba(63,184,204,.07) 58%, transparent 74%);
          filter: blur(2px);
        }
        .cb-lacquer::after {
          inset: 0;
          background: linear-gradient(110deg, transparent 37%, rgba(255,255,255,.045) 47%, transparent 55%);
        }
        .cb-lacquer > * { position: relative; z-index: 1; }
        .cb-data-row {
          border-bottom: 1px solid rgba(212,240,240,.13);
        }
        .cb-data-row:last-child { border-bottom: 0; }
        .cb-action:hover { transform: translateY(-1px); }
        .cb-action:active { transform: translateY(0); }
        @media (prefers-reduced-motion: reduce) {
          .cb-action { transition: none; }
        }
      `}</style>

      <section className="mx-auto max-w-[760px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#a9dce3]">
              <span className="h-px w-7 bg-[#3fb8cc]" />
              Team · Personalakte
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-[-0.035em] text-[#f2fbfc]">1 Assistenzkraft</h1>
          </div>
          <button
            type="button"
            onClick={() => setNotice("Neue Assistenzkraft kann jetzt angelegt werden.")}
            className={`${actionBase} cb-action border border-[#ebf18b]/80 bg-[#ebf18b] text-[#05305b] shadow-[0_8px_20px_rgba(0,0,0,.2)] hover:bg-[#f3f7ad]`}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Assistenzkraft anlegen
          </button>
        </header>

        <article className="cb-lacquer rounded-2xl border border-[#9fdce3]/30">
          <div className="border-b border-[#b4e9ed]/20 px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[#bcecf0]/35 bg-[#0d426f]/80 text-lg font-bold tracking-tight text-[#ebf18b] shadow-[inset_0_1px_0_rgba(255,255,255,.22)]">
                  KK
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a9dce3]">Assistenzkraft · Personal-Nr. 0248</p>
                  <h2 className="text-xl font-bold tracking-[-0.025em] text-white">Klara König</h2>
                  <div className="mt-3 grid gap-1.5 text-sm text-[#d4f0f0]">
                    <p className="flex min-w-0 items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-[#76cfdb]" aria-hidden="true" /><span className="truncate">klara.koenig@example.de</span></p>
                    <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-[#76cfdb]" aria-hidden="true" />0176 45678910</p>
                    <p className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-[#76cfdb]" aria-hidden="true" /><span className="truncate">Kantstraße 18, 10623 Berlin</span></p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-row gap-2 sm:flex-col sm:items-end">
                <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#dce99c]/65 bg-[#eaf08e]/15 px-3 text-xs font-bold text-[#f5f8bd]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Aktiv
                </span>
                <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#a9dce3]/35 bg-[#d4f0f0]/10 px-3 text-xs font-bold text-[#e4f9fa]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#7bd4df]" aria-hidden="true" /> Teamleiter
                </span>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1.35fr_.9fr]">
            <section className="p-5 sm:p-7">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-[#a9dce3]">Vertragsprofil</p>
                  <h3 className="mt-1 text-base font-bold text-white">Aktuelle Vereinbarung</h3>
                </div>
                <BriefcaseBusiness className="h-5 w-5 text-[#ebf18b]" aria-hidden="true" />
              </div>
              <dl>
                <div className="cb-data-row flex items-center justify-between gap-4 py-3">
                  <dt className="text-sm text-[#b8d9df]">Wochenstunden</dt>
                  <dd className="text-base font-bold text-white">32 h</dd>
                </div>
                <div className="cb-data-row flex items-center justify-between gap-4 py-3">
                  <dt className="text-sm text-[#b8d9df]">Arbeitstage/Woche</dt>
                  <dd className="text-base font-bold text-white">4 Tage</dd>
                </div>
                <div className="cb-data-row flex items-center justify-between gap-4 py-3">
                  <dt className="text-sm text-[#b8d9df]">Urlaubsanspruch</dt>
                  <dd className="text-base font-bold text-white">30 Tage</dd>
                </div>
                <div className="cb-data-row flex items-center justify-between gap-4 py-3">
                  <dt className="flex items-center gap-2 text-sm text-[#b8d9df]}"><CalendarDays className="h-4 w-4 text-[#76cfdb]" aria-hidden="true" />Vertragsbeginn</dt>
                  <dd className="font-bold text-white">01.02.2025</dd>
                </div>
              </dl>
            </section>

            <aside className="border-t border-[#b4e9ed]/20 bg-[#031c38]/45 p-5 lg:border-l lg:border-t-0 lg:p-7">
              <Sparkles className="h-5 w-5 text-[#ebf18b]" aria-hidden="true" />
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.17em] text-[#a9dce3]">Planungshinweis</p>
              <p className="mt-2 text-sm leading-6 text-[#e6f7f8]">Fester Dienstplan Montag bis Donnerstag.</p>
              <div className="mt-5 border-l-2 border-[#3fb8cc] pl-3 text-xs leading-5 text-[#b8d9df]">
                Beschäftigung läuft aktiv. Die Rolle als Teamleiter ist zusätzlich gekennzeichnet.
              </div>
            </aside>
          </div>

          <footer className="flex flex-col gap-3 border-t border-[#b4e9ed]/20 bg-[#031b36]/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="text-xs text-[#a9dce3]" aria-live="polite">{notice}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setNotice("Stundennachweis für Klara König wird vorbereitet.")} className={`${actionBase} cb-action text-[#d4f0f0] hover:bg-[#d4f0f0]/10`}>
                <Download className="h-4 w-4" aria-hidden="true" />Nachweis
              </button>
              <button type="button" onClick={() => setNotice("Einladung für Klara König kann jetzt versendet werden.")} className={`${actionBase} cb-action text-[#d4f0f0] hover:bg-[#d4f0f0]/10`}>
                <Send className="h-4 w-4" aria-hidden="true" />Einladen
              </button>
              <button type="button" onClick={() => setNotice("Bearbeitung der Personalakte geöffnet.")} className={`${actionBase} cb-action border border-[#9fdce3]/45 bg-[#d4f0f0]/10 text-white hover:border-[#d4f0f0]/70 hover:bg-[#d4f0f0]/18`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />Bearbeiten
              </button>
            </div>
          </footer>
        </article>
      </section>
    </main>
  );
}