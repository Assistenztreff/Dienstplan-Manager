import logoUrl from "./logo.png";
import tabelleShotUrl from "./screenshot-tabelle-crop.jpg";

// ---------------------------------------------------------------------------
// Startseite (ausgeloggt) — Mockup nach Vorbild assistenztreff.de:
// hellblauer Hintergrund, Plattform-Header oben, zentraler Claim,
// darunter 3 "App-Screenshots" (stilisierte Nachbauten mit Dummy-Namen)
// mit einfachen Funktions-Erklärungen daneben.
// Farben: brand-hellblau #d4f0f0, brand-dark #092948, brand-yellow #ebf18b
// ---------------------------------------------------------------------------

const DARK = "#092948";
const HELLBLAU = "#d4f0f0";
const YELLOW = "#ebf18b";

const NAV_LINK =
  "px-3 py-1.5 text-sm font-medium text-[#092948] underline decoration-[1px] underline-offset-4 transition-colors hover:decoration-[#092948] hover:text-[#092948] no-underline hover:underline";

function Header() {
  return (
    <header
      className="flex h-16 items-center border-b border-[#b8dede]"
      style={{ backgroundColor: HELLBLAU, color: DARK }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6">
        {/* Logo + Nav */}
        <div className="flex items-center gap-10">
          <img src={logoUrl} alt="AssistenzPlaner" className="h-9 w-auto" />
          <nav className="flex items-center gap-1">
            <a href="#" className={NAV_LINK}>Leistungen</a>
            <a href="#" className={NAV_LINK}>Über uns</a>
            <a href="#" className={NAV_LINK}>Handbuch</a>
          </nav>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-5">
          <a
            href="#"
            className="text-sm font-medium text-[#092948] underline decoration-[1px] underline-offset-4 hover:decoration-[#092948]"
          >
            Login
          </a>
          <a
            href="#"
            className="flex h-9 rounded-full border border-[#092948] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#ebf18b] hover:text-[#092948] pl-[16px] pr-[16px] justify-center items-center"
            style={{ backgroundColor: DARK }}
          >
            Registrieren
          </a>
        </div>
      </div>
    </header>
  );
}

// --- Stilisierter Screenshot 1: Dienstplan im Tabellenmodus -----------------

function ShotTabelle() {
  return (
    <MockWindow title="Dienstplan · Tabelle · Juli 2026">
      <img
        src={tabelleShotUrl}
        alt="Echter Screenshot: Dienstplan im Tabellenmodus (Juli 2026)"
        className="block w-full"
      />
    </MockWindow>
  );
}

// --- Stilisierter Screenshot 2: Dienstplan-Ansicht für Assistenzkräfte ------

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
              <p className="text-sm font-semibold" style={{ color: DARK }}>{e.tag}</p>
              <p className="text-xs text-slate-500">{e.dienst}</p>
            </div>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
              style={
                e.status === "FIX"
                  ? { backgroundColor: YELLOW, color: DARK }
                  : { backgroundColor: "#eef6f6", color: "#64748b" }
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

// --- Stilisierter Screenshot 3: Auswertung (Kartenansicht) -------------------

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
            <p className="mt-1 text-xl font-bold" style={{ color: DARK }}>{k.wert}</p>
          </div>
        ))}
        <div
          className="col-span-2 flex items-center justify-between rounded-xl p-3"
          style={{ backgroundColor: DARK }}
        >
          <p className="text-xs font-medium text-white/80">Vergütung (Juli)</p>
          <p className="text-xl font-bold" style={{ color: YELLOW }}>2.486,20 €</p>
        </div>
      </div>
    </MockWindow>
  );
}

// --- Rahmen für die "Screenshots" -------------------------------------------

function MockWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
        <span className="ml-2 truncate text-xs font-medium text-slate-500">{title}</span>
      </div>
      {children}
    </div>
  );
}

// --- Feature-Abschnitt: Screenshot + Erklärung -------------------------------

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
    <div className={`flex items-center gap-10 ${reverse ? "flex-row-reverse" : ""}`}>
      <div className="w-[55%] shrink-0">{shot}</div>
      <div>
        <h3 className="text-2xl font-bold" style={{ color: DARK }}>{titel}</h3>
        <p className="mt-3 text-base leading-relaxed text-slate-600">{text}</p>
      </div>
    </div>
  );
}

export function Startseite() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: HELLBLAU }}>
      <Header />
      {/* Zentraler Claim */}
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <h1 className="text-4xl font-extrabold leading-tight md:text-5xl" style={{ color: DARK }}>Dein Dienstplan. 
        Deine Entscheidung. 
        Dein Team.</h1>
        <h2 className="mx-auto mt-6 max-w-3xl text-lg font-normal leading-relaxed md:text-xl" style={{ color: DARK }}>
          Mit dem Assistenz Planer behältst du die Kontrolle über deine persönliche
          Assistenz – ganz gleich, wo du gerade bist. Dienste planen, Ausfälle regeln,
          Team informieren: alles an einem Ort.
        </h2>
        <div className="mt-8 flex justify-center gap-4">
          <a
            href="#"
            className="flex h-12 items-center rounded-full px-8 text-base font-semibold text-white shadow-md"
            style={{ backgroundColor: DARK }}
          >
            Jetzt kostenlos registrieren
          </a>
        </div>
      </section>
      {/* Screenshots + Erklärungen (statt Fotos) */}
      <section className="rounded-t-[3rem] bg-white/70 py-20 backdrop-blur">
        <div className="mx-auto max-w-6xl space-y-20 px-6">
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
      {/* Footer-Andeutung */}
      <footer className="py-10 text-center text-sm" style={{ backgroundColor: DARK, color: "#cbd5e1" }}>
        Impressum · Datenschutz · Kontakt · Barrierefreiheit — © 2026 AssistenzTreff
      </footer>
    </div>
  );
}
