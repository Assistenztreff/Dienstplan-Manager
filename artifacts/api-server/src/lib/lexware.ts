// ---------------------------------------------------------------------------
// Lexware-Adapter (Buchungs-Log fuer das Operator-Dashboard)
// ---------------------------------------------------------------------------
// Die ECHTE Lexware-Anbindung ist bewusst verschoben, bis die Datenbank auf
// einen deutschen Server migriert ist. Bis dahin liefert der MockLexwareClient
// realistische Beispieldaten in EXAKT der Response-Form des spaeteren echten
// Clients (Vertrag: LexwareBookingList in lib/api-spec/openapi.yaml).
//
// Austausch spaeter OHNE Frontend-/Schema-Aenderung:
//   1. Secret LEXWARE_API_KEY hinterlegen (environment-secrets).
//   2. LiveLexwareClient implementieren (fetch gegen die Lexware Office API,
//      Rechnungsentwuerfe + Zahlungseingaenge auf LexwareBooking mappen).
//   3. getLexwareClient() unten liefert ihn automatisch, sobald der Key da
//      ist — source wechselt von "demo" auf "live", UI blendet das
//      Demo-Badge selbststaendig aus.
// ---------------------------------------------------------------------------

import type { LexwareBooking, LexwareBookingList } from "@workspace/api-zod";

// Adapter-Interface: jede Implementierung (Mock heute, echte API spaeter)
// liefert dieselbe Form. source kennzeichnet die Datenquelle fuer die UI.
export interface LexwareClient {
  readonly source: LexwareBookingList["source"];
  listBookings(): Promise<LexwareBooking[]>;
}

// --- Mock-Adapter (Demo-Daten, deutlich als solche gekennzeichnet) ---------
// Statische, realistisch wirkende Beispiel-Buchungen: Rechnungsentwuerfe und
// Zahlungseingaenge rund um die Premium-Freischaltung (19 € privat / 49 €
// Dienstleister), neueste zuerst. KEINE realen Zahlungen.
const DEMO_BOOKINGS: LexwareBooking[] = [
  {
    id: "LX-2026-0058",
    accountName: "Pflegedienst Nord GmbH",
    accountEmail: "buchhaltung@pflegedienst-nord.example",
    type: "Zahlungseingang",
    amount: 49,
    date: "2026-06-28",
    status: "bezahlt",
  },
  {
    id: "LX-2026-0057",
    accountName: "Maria Beispiel",
    accountEmail: "maria.beispiel@example.com",
    type: "Rechnungsentwurf",
    amount: 19,
    date: "2026-06-27",
    status: "offen",
  },
  {
    id: "LX-2026-0056",
    accountName: "Assistenzdienst Rhein-Main e. V.",
    accountEmail: "verwaltung@ad-rheinmain.example",
    type: "Zahlungseingang",
    amount: 49,
    date: "2026-06-24",
    status: "bezahlt",
  },
  {
    id: "LX-2026-0055",
    accountName: "Jonas Muster",
    accountEmail: "jonas.muster@example.com",
    type: "Rechnungsentwurf",
    amount: 19,
    date: "2026-06-20",
    status: "storniert",
  },
  {
    id: "LX-2026-0054",
    accountName: "Lena Beispielfrau",
    accountEmail: "lena.beispielfrau@example.com",
    type: "Zahlungseingang",
    amount: 19,
    date: "2026-06-18",
    status: "bezahlt",
  },
];

class MockLexwareClient implements LexwareClient {
  readonly source = "demo" as const;

  async listBookings(): Promise<LexwareBooking[]> {
    // Kopie zurueckgeben, damit Aufrufer die Modul-Konstante nicht mutieren.
    return DEMO_BOOKINGS.map((booking) => ({ ...booking }));
  }
}

// --- Auswahl der Implementierung -------------------------------------------
// Env pro Aufruf lesen (kein Modul-Load-Cache): ein nachtraeglich gesetztes
// Secret wirkt so ohne Code-Aenderung nach dem naechsten Neustart bzw. in
// Umgebungen, die Env zur Laufzeit setzen — analog zum Alert-Mailer.
export function getLexwareClient(): LexwareClient {
  const apiKey = process.env.LEXWARE_API_KEY;
  if (apiKey) {
    // Platzhalter: Der echte Client existiert noch nicht. Bewusst LAUT
    // scheitern statt still Demo-Daten als "live" auszugeben — der Fehler
    // landet ueber den zentralen Error-Handler im Fehler-Tracking.
    throw new Error(
      "LEXWARE_API_KEY ist gesetzt, aber der echte Lexware-Client ist noch nicht implementiert (folgt nach der Server-Migration). Secret entfernen, um den Demo-Modus zu nutzen.",
    );
  }
  return new MockLexwareClient();
}
