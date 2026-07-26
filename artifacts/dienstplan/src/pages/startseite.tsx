import { Link } from "wouter";
import { PlatformHeaderPlaceholder } from "@/components/layout";
import tabelleShotUrl from "@/assets/startseite-tabelle-crop.jpg";

// ---------------------------------------------------------------------------
// Startseite (ausgeloggt) — vom Canvas-Mockup uebernommen (Vorbild
// assistenztreff.de): hellblauer Hintergrund, Plattform-Header oben,
// zentraler Claim mit Registrieren-Button, darunter drei "App-Screenshots"
// (ein echter Screenshot + zwei stilisierte Nachbauten mit Dummy-Daten)
// mit kurzen Funktions-Erklaerungen daneben.
// Farben kommen aus den Brand-Tokens (brand-hellblau, brand-dark,
// brand-yellow) — dieselbe Palette wie im Mockup.
// ---------------------------------------------------------------------------

// --- Screenshot 1: Dienstplan im Tabellenmodus (echter Screenshot) ----------

function ShotTabelle() {
  return (
    <MockWindow title="Dienstplan · Tabelle · Juli 2026">
      <img
        src={tabelleShotUrl}
        alt="Screenshot: Dienstplan im Tabellenmodus (Juli 2026)"
        className="block w-full"
        loading="lazy"
      />
    </MockWindow>
  );
}

// --- Screenshot 2: Dienstplan-Ansicht fuer Assistenzkraefte (stilisiert) ----

function ShotAssistent() {
  const eintraege = [
    { tag: "Mo, 6. Juli", dienst: "Frühdienst · 06–14 Uhr", status: "FIX" },
    { tag: "Mi, 8. Juli", dienst: "Frühdienst · 06–14 Uhr", status: "FIX" },
    { tag: "Sa, 11. Juli", dienst: "Nachtdienst · 22–06 Uhr", status: "FIX" },
    { tag: "Di, 14. Juli", dienst: "Spätdienst · 14–22 Uhr", status: "ANGEBOTEN" },
  ];
  return (
    <MockWindow title="Mein Dienstplan · Julia Sommer">
      <div className="space-y-2 p-4">
        {eintraege.map((e) => (
          <div
            key={e.tag}
            className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm"
          >
            <div>
              <p className="text-sm font-semibold text-brand-dark">{e.tag}</p>
              <p className="text-xs text-slate-500">{e.dienst}</p>
            </div>
            <span
              className={
                e.status === "FIX"
                  ? "rounded-full bg-brand-yellow px-2.5 py-0.5 text-[11px] font-bold text-brand-dark"
                  : "rounded-full bg-[#eef6f6] px-2.5 py-0.5 text-[11px] font-bold text-slate-500"
              }
            >
              {e.status}
            </span>
          </div>
        ))}
      </div>
    </MockWindow>
  );
}

// --- Screenshot 3: Auswertung (stilisierte Kartenansicht) -------------------

function ShotAuswertung() {
  return (
    <MockWindow title="Auswertung · Juli 2026 · Julia Sommer">
      <div className="grid grid-cols-2 gap-3 p-4">
        {[
          { label: "Soll-Stunden", wert: "130,0 h" },
          { label: "Erfüllt", wert: "127,5 h" },
          { label: "Nacht-Zuschlag (25 %)", wert: "16,0 h" },
          { label: "Sonntags-Zuschlag (50 %)", wert: "8,0 h" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <p className="text-[11px] font-medium text-slate-500">{k.label}</p>
            <p className="mt-1 text-xl font-bold text-brand-dark">{k.wert}</p>
          </div>
        ))}
        <div className="col-span-2 flex items-center justify-between rounded-xl bg-brand-dark p-3">
          <p className="text-xs font-medium text-white/80">Vergütung (Juli)</p>
          <p className="text-xl font-bold text-brand-yellow">2.486,20 €</p>
        </div>
      </div>
    </MockWindow>
  );
}

// --- Rahmen fuer die "Screenshots" ------------------------------------------

function MockWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-300" aria-hidden="true" />
        <span className="ml-2 truncate text-xs font-medium text-slate-500">{title}</span>
      </div>
      {children}
    </div>
  );
}

// --- Feature-Abschnitt: Screenshot + Erklaerung ------------------------------
// Mobil untereinander (Text unter dem Screenshot), ab md nebeneinander mit
// abwechselnder Seite (reverse).

function Feature({
  shot,
  titel,
  text,
  reverse,
}: {
  shot: React.ReactNode;
  titel: string;
  text: string;
  reverse?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-8 md:gap-10 ${
        reverse ? "md:flex-row-reverse" : "md:flex-row"
      }`}
    >
      <div className="w-full shrink-0 md:w-[55%]">{shot}</div>
      <div>
        <h3 className="text-2xl font-bold text-brand-dark">{titel}</h3>
        <p className="mt-3 text-base leading-relaxed text-slate-600">{text}</p>
      </div>
    </div>
  );
}

export default function Startseite() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-hellblau">
      {/* Gemeinsamer Plattform-Header: zeigt ausgeloggt automatisch
          "Login" + "Registrieren" (gleiche Optik wie im Mockup). */}
      <PlatformHeaderPlaceholder />

      <main className="flex-1">
        {/* Zentraler Claim */}
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-14 text-center md:pt-20">
          <h1 className="text-4xl font-extrabold leading-tight text-brand-dark md:text-5xl">
            Dein Dienstplan. Deine Entscheidung. Dein Team.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg font-normal leading-relaxed text-brand-dark md:text-xl">
            Mit dem Assistenz Planer behältst du die Kontrolle über deine persönliche
            Assistenz – ganz gleich, wo du gerade bist. Dienste planen, Ausfälle regeln,
            Team informieren: alles an einem Ort.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/registrierung"
              className="flex h-12 items-center rounded-full border border-brand-dark bg-brand-dark px-8 text-base font-semibold text-white shadow-md transition-colors hover:bg-brand-yellow hover:text-brand-dark focus-visible:bg-brand-yellow focus-visible:text-brand-dark focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
              data-testid="startseite-cta-registrieren"
            >
              Jetzt kostenlos registrieren
            </Link>
          </div>
        </section>

        {/* Screenshots + Erklaerungen */}
        <section className="rounded-t-[3rem] bg-white/70 py-16 backdrop-blur md:py-20">
          <div className="mx-auto max-w-6xl space-y-16 px-6 md:space-y-20">
            <Feature
              shot={<ShotTabelle />}
              titel="Der ganze Monat auf einen Blick"
              text="Im Tabellenmodus siehst du alle Assistenzkräfte und ihre Dienste übersichtlich untereinander. Dienste anlegen, verschieben und mit einem Klick für den ganzen Monat bestätigen – fertig ist der Plan."
            />
            <Feature
              reverse
              shot={<ShotAssistent />}
              titel="Dein Team sieht immer den aktuellen Stand"
              text="Jede Assistenzkraft hat ihren eigenen Zugang und sieht nur die eigenen Dienste – auf dem Handy genauso wie am PC. Änderungen sind sofort sichtbar, Zettelwirtschaft und Gruppenchats entfallen."
            />
            <Feature
              shot={<ShotAuswertung />}
              titel="Stunden und Vergütung automatisch ausgewertet"
              text="Die Auswertung rechnet Soll- und Ist-Stunden, Nacht-, Sonntags- und Feiertagszuschläge automatisch zusammen – pro Person und Monat, inklusive PDF-Stundennachweis für die Abrechnung."
            />
          </div>
        </section>
      </main>

      {/* Dunkler Footer wie im Mockup — mit echten Zielen. */}
      <footer className="bg-brand-dark py-8 text-center text-sm text-slate-300">
        <nav aria-label="Rechtliches" className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 px-4">
          <a
            href="https://assistenztreff.de/impressum"
            target="_blank"
            rel="noreferrer"
            className="rounded px-2 py-1 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-yellow"
          >
            Impressum
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://assistenztreff.de/datenschutzerklaerung"
            target="_blank"
            rel="noreferrer"
            className="rounded px-2 py-1 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-yellow"
          >
            Datenschutz
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://assistenztreff.de/kontakt"
            target="_blank"
            rel="noreferrer"
            className="rounded px-2 py-1 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-yellow"
          >
            Kontakt
          </a>
          <span aria-hidden="true">·</span>
          <Link
            href="/barrierefreiheit"
            className="rounded px-2 py-1 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-yellow"
          >
            Barrierefreiheit
          </Link>
        </nav>
        <p className="mt-3 text-xs text-slate-400">© 2026 AssistenzTreff</p>
      </footer>
    </div>
  );
}
