import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolveDatabaseUrl } from "@workspace/db/database-url";

/**
 * Anonymisiert die Personaldaten der Assistenzkräfte in der STAGING-DB.
 *
 * - Läuft NUR gegen eine Datenbank, deren Name "staging" enthält (Guard).
 * - Admin-Konten (role != 'assistant') bleiben unverändert.
 * - Assistenzkräfte werden fortlaufend nach id umbenannt: "Assistenz 1", … ,
 *   E-Mail assistenz1@test.de, … Sensible Felder (Adresse, Geburtsdatum,
 *   SV-Nummer, Steuer-ID, Steuerklasse, Krankenkasse, IBAN, Telefon) werden
 *   mit plausiblen Beispieldaten gefüllt.
 * - Stundenlohn (hourly_wage), Passwörter, Schichten/Verträge bleiben unangetastet.
 * - Idempotent: mehrfaches Ausführen ergibt dasselbe Ergebnis.
 */

const SAMPLE_INSURANCES = ["AOK Bayern", "Techniker Krankenkasse", "Barmer", "DAK-Gesundheit", "IKK classic"];
const SAMPLE_STREETS = ["Musterstraße", "Beispielweg", "Testallee", "Probegasse", "Demoplatz"];

async function main(): Promise<void> {
  // resolveDatabaseUrl beruecksichtigt APP_DATABASE_URL-Vorrang UND das
  // rotierte Scaleway-Passwort (SCALEWAY_DB_PASSWORD) — nie direkt normalisieren.
  const url = resolveDatabaseUrl();
  if (!url) throw new Error("APP_DATABASE_URL/DATABASE_URL nicht gesetzt.");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: [{ db }] } = await client.query<{ db: string }>("SELECT current_database() AS db");
    if (!db.includes("staging")) {
      throw new Error(`ABBRUCH: Ziel-DB "${db}" ist keine Staging-DB (Name muss "staging" enthalten).`);
    }
    console.log(`Ziel-Datenbank: ${db}`);

    const { rows: assistants } = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE role = 'assistant' ORDER BY id",
    );
    console.log(`${assistants.length} Assistenzkraft/-kräfte gefunden.`);

    // Preflight: Ziel-E-Mails dürfen nicht mit Konten kollidieren, die NICHT
    // Teil der Umbenennung sind (UNIQUE(email) würde sonst mitten in der
    // Transaktion abbrechen). Platzhalter sind per Lauf-UUID kollisionsfrei.
    const targetEmails = assistants.map((_, i) => `assistenz${i + 1}@test.de`);
    const { rows: collisions } = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE role != 'assistant' AND email = ANY($1)",
      [targetEmails],
    );
    if (collisions.length > 0) {
      throw new Error(
        `ABBRUCH: ${collisions.length} Nicht-Assistenten-Konto/-Konten (ids: ${collisions.map((c) => c.id).join(", ")}) belegen bereits Ziel-E-Mails. Bitte zuerst bereinigen.`,
      );
    }

    await client.query("BEGIN");
    // Zwei Phasen wegen UNIQUE(email): erst auf lauf-eindeutige Platzhalter
    // (UUID pro Lauf → keine Kollision mit Alt-Platzhaltern möglich), dann final.
    const runId = randomUUID();
    for (let i = 0; i < assistants.length; i++) {
      await client.query("UPDATE users SET email = $1 WHERE id = $2", [
        `tmp-anon-${runId}-${assistants[i].id}@tmp.invalid`,
        assistants[i].id,
      ]);
    }
    for (let i = 0; i < assistants.length; i++) {
      const n = i + 1;
      const a: { id: number } = assistants[i];
      await client.query(
        `UPDATE users SET
           name = $1,
           email = $2,
           phone = $3,
           address = $4,
           birth_date = $5,
           social_security_number = $6,
           tax_id = $7,
           tax_class = $8,
           health_insurance = $9,
           iban = $10
         WHERE id = $11`,
        [
          `Assistenz ${n}`,
          `assistenz${n}@test.de`,
          `+49 170 000000${n}`,
          `${SAMPLE_STREETS[i % SAMPLE_STREETS.length]} ${n}, 12345 Musterstadt`,
          `199${n % 10}-01-${String((n % 28) + 1).padStart(2, "0")}`,
          `12 ${String(n).padStart(2, "0")}0190 X 00${n}`,
          `9900000000${n}`,
          "1",
          SAMPLE_INSURANCES[i % SAMPLE_INSURANCES.length],
          `DE89 3704 0044 0532 0130 ${String(n).padStart(2, "0")}`,
          a.id,
        ],
      );
      // Bewusst KEINE Alt-Daten (Name/E-Mail) loggen — das wäre ein neuer PII-Leak-Pfad.
      console.log(`  Nutzer-ID ${a.id} → "Assistenz ${n}" <assistenz${n}@test.de>`);
    }
    await client.query("COMMIT");
    console.log("Fertig: Personaldaten anonymisiert (Stundenlohn, Passwörter, Dienstplan unverändert).");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler bei anonymize-staging:", err);
  process.exit(1);
});
