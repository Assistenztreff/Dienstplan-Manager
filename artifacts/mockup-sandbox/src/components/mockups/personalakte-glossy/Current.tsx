import {
  Calendar,
  Download,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import "./_group.css";

const buttonBase =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05305b] focus-visible:ring-offset-2";

export function Current() {
  return (
    <main className="personalakte-preview min-h-screen bg-white px-8 py-8 text-[#05305b]">
      <section className="mx-auto max-w-[520px] space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[#5c6670]">1 Assistenzkraft</p>
            <h1 className="mt-1 text-xl font-semibold">Personalakte</h1>
          </div>
          <button className={`${buttonBase} border border-[#d8de83] bg-[#ebf18b] text-[#05305b]`}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Assistenzkraft anlegen
          </button>
        </header>

        <article className="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-[#f9f9f9] shadow-sm transition-shadow hover:shadow-md">
          <header className="flex items-start justify-between gap-3 border-b border-black/10 bg-black/[0.02] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight">Klara König</h2>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[#5c6670]">
                <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">klara.koenig@example.de</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-[#5c6670]">
                <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>0176 45678910</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-[#5c6670]">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">Kantstraße 18, 10623 Berlin</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full border border-[#d8de83] bg-[#ebf18b] px-2.5 py-0.5 text-xs font-medium text-[#05305b]">
                Aktiv
              </span>
              <span className="flex items-center gap-1 rounded-full border border-black/15 bg-white px-2.5 py-0.5 text-xs font-medium">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Teamleiter
              </span>
            </div>
          </header>

          <div className="flex flex-1 flex-col justify-between gap-4 p-5">
            <dl className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <dt className="text-[#5c6670]">Wochenstunden</dt>
                <dd className="font-medium">32 h</dd>
              </div>
              <div className="flex items-center justify-between text-sm">
                <dt className="text-[#5c6670]">Arbeitstage/Woche</dt>
                <dd className="font-medium">4 Tage</dd>
              </div>
              <div className="flex items-center justify-between text-sm">
                <dt className="text-[#5c6670]">Urlaubsanspruch</dt>
                <dd className="font-medium">30 Tage</dd>
              </div>
              <div className="flex items-center justify-between text-sm">
                <dt className="flex items-center gap-1 text-[#5c6670]">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  Seit
                </dt>
                <dd className="font-medium">01.02.2025</dd>
              </div>
              <p className="border-t border-black/10 pt-2.5 text-xs text-[#5c6670]">
                Fester Dienstplan Montag bis Donnerstag.
              </p>
            </dl>

            <footer className="flex flex-wrap justify-end gap-2">
              <button className={`${buttonBase} text-[#5c6670] hover:bg-black/5 hover:text-[#05305b]`}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Nachweis
              </button>
              <button className={`${buttonBase} text-[#5c6670] hover:bg-black/5 hover:text-[#05305b]`}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Einladen
              </button>
              <button className={`${buttonBase} border border-black/15 bg-white text-[#05305b] hover:bg-black/[0.03]`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Bearbeiten
              </button>
            </footer>
          </div>
        </article>

        <p className="text-xs leading-relaxed text-[#6c747d]">
          Referenz: aktuelle Karte mit unveränderter Inhaltsstruktur und denselben Aktionen.
        </p>
      </section>
    </main>
  );
}