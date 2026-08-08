import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/auth";

// ---------------------------------------------------------------------------
// Statische Rechtstexte fuer den Standalone-Betrieb unter
// dienstplan.assistenztreff.de: Impressum, Datenschutz, Kontakt,
// Barrierefreiheit. Die Seiten sind OEFFENTLICH erreichbar (Impressum und
// Datenschutzerklaerung muessen auch ohne Login zugaenglich sein) und werden
// aus der Fusszeile (PlatformFooterPlaceholder) verlinkt.
//
// Impressum und Datenschutzerklaerung werden NICHT dupliziert, sondern
// verweisen auf die massgeblichen Rechtstexte der Hauptseite
// assistenztreff.de (Entscheidung des Betreibers, Juli 2026). So gibt es
// genau eine Quelle fuer die Betreiber-Angaben.
// ---------------------------------------------------------------------------

const OPERATOR = {
  company: "AssistenzTreff",
  email: "kontakt@assistenztreff.de", // verifiziert gegen assistenztreff.de/impressum
};

// Massgebliche Rechtstexte auf der Plattform (verifiziert am 27.07.2026).
const PLATFORM_LEGAL = {
  impressum: "https://assistenztreff.de/impressum",
  datenschutz: "https://assistenztreff.de/datenschutzerklaerung",
  kontakt: "https://assistenztreff.de/kontakt",
};

function ExternalLegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="font-semibold underline hover:text-slate-900"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

function LegalPageShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { currentUser } = useAuth();
  const [, navigate] = useLocation();

  const content = (
    <article className="mx-auto w-full max-w-3xl">
      {/* Ohne Login rendert die App kein Layout — dann braucht die Seite
          einen eigenen Rueckweg zur Anmeldung. Mit Login genuegt die normale
          Navigation, ein zusaetzlicher Zurueck-Link schadet aber nicht. */}
      <button
        type="button"
        onClick={() => (currentUser ? window.history.back() : navigate("/login"))}
        className="mb-6 inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-dark"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {currentUser ? "Zurück" : "Zurück zur Anmeldung"}
      </button>

      <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      <div className="space-y-6 text-sm leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
        {children}
      </div>
    </article>
  );

  if (currentUser) {
    // Eingeloggt: Layout (Header/Footer) kommt von App.tsx — nur Inhalt.
    return content;
  }

  // Oeffentlich (ohne Login): eigenstaendige, schlicht zentrierte Seite.
  return (
    <div className="min-h-screen bg-background">
      <main className="px-4 py-10">{content}</main>
    </div>
  );
}

export function Impressum() {
  return (
    <LegalPageShell title="Impressum">
      <section>
        <p>
          Die Dienstplan-App ist ein Angebot von {OPERATOR.company}. Es gilt das
          Impressum der Hauptseite:
        </p>
        <p>
          <ExternalLegalLink href={PLATFORM_LEGAL.impressum}>
            Impressum auf assistenztreff.de
          </ExternalLegalLink>
        </p>
        <p>
          E-Mail:{" "}
          <a className="underline hover:text-slate-900" href={`mailto:${OPERATOR.email}`}>
            {OPERATOR.email}
          </a>
        </p>
      </section>
    </LegalPageShell>
  );
}

export function Datenschutz() {
  return (
    <LegalPageShell title="Datenschutzerklärung">
      <section>
        <h2>1. Verantwortlicher</h2>
        <p>
          Verantwortlich für die Datenverarbeitung ist der Betreiber von{" "}
          {OPERATOR.company}. Name und Anschrift finden Sie in der{" "}
          <ExternalLegalLink href={PLATFORM_LEGAL.datenschutz}>
            Datenschutzerklärung auf assistenztreff.de
          </ExternalLegalLink>{" "}
          sowie im{" "}
          <ExternalLegalLink href={PLATFORM_LEGAL.impressum}>Impressum</ExternalLegalLink>.
          <br />
          E-Mail:{" "}
          <a className="underline hover:text-slate-900" href={`mailto:${OPERATOR.email}`}>
            {OPERATOR.email}
          </a>
        </p>
        <p>
          Die nachfolgenden Abschnitte ergänzen die Datenschutzerklärung der Hauptseite
          um die Besonderheiten der Dienstplan-App.
        </p>
      </section>
      <section>
        <h2>2. Zweck der Verarbeitung</h2>
        <p>
          Die Dienstplan-App dient der Dienstplanung und Zeiterfassung im Rahmen der
          Persönlichen Assistenz im Arbeitgebermodell. Verarbeitet werden hierfür
          insbesondere:
        </p>
        <ul>
          <li>Stammdaten (Name, E-Mail-Adresse, ggf. Adress- und Kontaktdaten)</li>
          <li>Dienstplan- und Zeiterfassungsdaten (Schichten, Abwesenheiten, Ist-Zeiten)</li>
          <li>
            Personalakten- und Abrechnungsdaten, soweit sie vom jeweiligen Arbeitgeber
            (Assistenznehmer bzw. Assistenzdienst) erfasst werden
          </li>
        </ul>
        <p>
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) sowie
          Art. 88 DSGVO i. V. m. § 26 BDSG (Beschäftigtendatenverarbeitung).
        </p>
      </section>
      <section>
        <h2>3. Cookies und Sitzungen</h2>
        <p>
          Die App verwendet ausschließlich ein technisch notwendiges Sitzungs-Cookie
          („connect.sid“), um Sie nach der Anmeldung angemeldet zu halten. Es werden
          keine Tracking- oder Werbe-Cookies eingesetzt.
        </p>
      </section>
      <section>
        <h2>4. Speicherdauer</h2>
        <p>
          Personenbezogene Daten werden gespeichert, solange das Nutzerkonto besteht bzw.
          solange gesetzliche Aufbewahrungspflichten (z. B. für Abrechnungsunterlagen)
          dies erfordern.
        </p>
      </section>
      <section>
        <h2>5. Ihre Rechte</h2>
        <p>Sie haben nach der DSGVO insbesondere folgende Rechte:</p>
        <ul>
          <li>Auskunft über die zu Ihrer Person gespeicherten Daten (Art. 15 DSGVO)</li>
          <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
          <li>Löschung (Art. 17 DSGVO) und Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
          <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
          <li>Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO)</li>
        </ul>
        <p>
          Zur Ausübung Ihrer Rechte genügt eine formlose E-Mail an{" "}
          <a className="underline hover:text-slate-900" href={`mailto:${OPERATOR.email}`}>
            {OPERATOR.email}
          </a>
          .
        </p>
      </section>
      <section>
        <h2>6. Hosting</h2>
        <p>
          Die Anwendung wird auf Servern in der Europäischen Union betrieben. Beim Aufruf
          der Website werden technisch notwendige Verbindungsdaten (z. B. IP-Adresse,
          Zeitpunkt des Zugriffs) in Server-Logs verarbeitet (Art. 6 Abs. 1 lit. f DSGVO).
        </p>
      </section>
    </LegalPageShell>
  );
}

export function Kontakt() {
  return (
    <LegalPageShell title="Kontakt">
      <section>
        <p>
          Bei Fragen zur Dienstplan-App, zu Ihrem Konto oder zur Premium-Freischaltung
          erreichen Sie uns per E-Mail:
        </p>
        <p>
          <a
            className="font-semibold underline hover:text-slate-900"
            href={`mailto:${OPERATOR.email}`}
          >
            {OPERATOR.email}
          </a>
        </p>
        <p>
          Die Postanschrift finden Sie im{" "}
          <ExternalLegalLink href={PLATFORM_LEGAL.impressum}>
            Impressum auf assistenztreff.de
          </ExternalLegalLink>
          ; weitere Kontaktmöglichkeiten auf der{" "}
          <ExternalLegalLink href={PLATFORM_LEGAL.kontakt}>
            Kontaktseite der Hauptseite
          </ExternalLegalLink>
          .
        </p>
        <p>
          Hinweis für Assistenzkräfte: Bei Fragen zu Ihrem Zugang (z. B. Passwort
          vergessen) wenden Sie sich bitte zuerst an Ihren Arbeitgeber (Assistenznehmer
          bzw. Assistenzdienst) — dieser kann Ihnen einen neuen Einladungslink senden.
        </p>
      </section>
    </LegalPageShell>
  );
}

export function Barrierefreiheit() {
  return (
    <LegalPageShell title="Erklärung zur Barrierefreiheit">
      <section>
        <p>
          Wir bemühen uns, die Dienstplan-App im Einklang mit den Anforderungen der
          Barrierefreiheit (BITV 2.0 / WCAG 2.1, Stufe AA) zugänglich zu gestalten.
        </p>
      </section>
      <section>
        <h2>Umgesetzte Maßnahmen</h2>
        <ul>
          <li>Strukturierte Bereiche, Überschriften und ein Sprunglink zum Hauptinhalt</li>
          <li>Bedienbarkeit per Tastatur inklusive sichtbarer Fokus-Markierungen</li>
          <li>Großzügige Klick- und Touch-Flächen</li>
          <li>Beschriftete Formularfelder, verständliche Statusmeldungen und aussagekräftige Link-Texte</li>
          <li>Tabellen mit Überschriften und Beschreibungen für Screenreader</li>
        </ul>
      </section>
      <section>
        <h2>Bekannte Einschränkungen</h2>
        <p>
          Einzelne komplexe Ansichten, insbesondere der Monatskalender und PDF-Exporte,
          werden weiterhin schrittweise verbessert. Für Kalenderansichten stehen
          Tastaturbedienung und zusätzliche Screenreader-Beschreibungen im Fokus.
        </p>
      </section>
      <section>
        <h2>Barriere melden</h2>
        <p>
          Sind Ihnen Mängel bei der barrierefreien Nutzung aufgefallen? Schreiben Sie uns
          an{" "}
          <a className="underline hover:text-slate-900" href={`mailto:${OPERATOR.email}`}>
            {OPERATOR.email}
          </a>
          . Wir bemühen uns, gemeldete Barrieren zeitnah zu beheben.
        </p>
      </section>
      <section>
        <p className="text-xs text-slate-500">Diese Erklärung wurde am 8. August 2026 aktualisiert.</p>
      </section>
    </LegalPageShell>
  );
}

// Reihenfolge/Ziele der Fusszeilen-Links (von layout.tsx konsumiert).
export const LEGAL_PAGES = [
  { href: "/impressum", label: "Impressum" },
  { href: "/datenschutz", label: "Datenschutz" },
  { href: "/kontakt", label: "Kontakt" },
  { href: "/barrierefreiheit", label: "Barrierefreiheit" },
] as const;

export function LegalFooterLinks({ linkClassName }: { linkClassName: string }) {
  return (
    <>
      {LEGAL_PAGES.map((page) => (
        <Link key={page.href} href={page.href} className={linkClassName}>
          {page.label}
        </Link>
      ))}
    </>
  );
}
