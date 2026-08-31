import "./lib/normalize-db-url";
import pg from "pg";
import { resolveDatabaseUrl } from "@workspace/db/database-url";
import { USER_BOUND_RESTRICT_TABLES } from "@workspace/db/user-bound-tables";

/**
 * Prueft die LOESCHREGELN der Nachweis-Tabellen gegen den Soll-Zustand.
 *
 * WARUM ES DIESEN CHECK BRAUCHT (verifiziert 30.08.2026):
 * `drizzle-kit push` aendert die ON-DELETE-Regel eines BESTEHENDEN
 * Fremdschluessels NICHT — es meldet trotzdem "Changes applied". Die Regel
 * kommt ausschliesslich ueber die idempotenten Vorab-Schritte
 * (scripts/src/lib/pre-push-sql.ts) an, die post-merge.sh und migrate-prod
 * ausfuehren. Und weder `verify-test-db-schema` noch der Publish-Guard
 * `check-prod-schema-drift` schauen auf Fremdschluessel-Aktionen: die pruefen
 * Tabellen und Spalten. Eine falsche Loeschregel rutscht damit durch jeden
 * bestehenden Waechter.
 *
 * Das ist nicht kosmetisch. Steht `shift_changes.shift_id` noch auf CASCADE,
 * reisst das Loeschen EINES Dienstes seine Aenderungshistorie mit — genau den
 * Nachweis, den § 16 ArbZG und § 17 MiLoG zwei Jahre lang sehen wollen.
 *
 * REIN LESEND. Aendert nichts, faellt bei Abweichung mit Exit-Code 1 aus.
 *
 * Ziel-Datenbank: die aufgeloeste `DATABASE_URL` (in der Replit-Dev-Umgebung
 * also die Scaleway-Staging-DB via APP_DATABASE_URL). Fuer die Produktion
 * `PROD_DATABASE_URL` voranstellen:
 *   APP_DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run check-loeschregeln
 */

// pg_constraint.confdeltype: a=no action, r=restrict, c=cascade, n=set null, d=set default
const REGEL_KLARTEXT: Record<string, string> = {
  a: "keine Aktion",
  r: "restrict (blockiert)",
  c: "CASCADE (reisst mit!)",
  n: "set null (Zeile bleibt)",
  d: "set default",
};

type Erwartung = {
  tabelle: string;
  spalte: string;
  soll: string;
  warum: string;
};

const ERWARTUNGEN: Erwartung[] = [
  {
    tabelle: "shift_changes",
    spalte: "shift_id",
    soll: "n",
    warum:
      "Wird ein einzelner Dienst geloescht, muss seine Aenderungshistorie stehen bleiben. " +
      "before/after sind vollstaendige Snapshots, der Fremdschluessel wird nicht gebraucht.",
  },
  // Alle nutzergebundenen Nachweis-Tabellen blockieren das Loeschen einer
  // Person, bis der Loesch-Workflow (Stufe 5) ihre Zeilen bewusst abgeraeumt
  // und vorher archiviert hat. Quelle ist dieselbe Liste, die der
  // Loesch-Endpunkt benutzt — eine neue Tabelle wird damit automatisch
  // mitgeprueft.
  ...USER_BOUND_RESTRICT_TABLES.map((tabelle) => ({
    tabelle,
    spalte: "user_id",
    soll: "r",
    warum:
      "Zeitnachweise duerfen beim Loeschen einer Assistenzkraft nicht " +
      "stillschweigend verschwinden (§ 16 ArbZG, § 17 MiLoG).",
  })),
];

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();

  // KRITISCH: der Schutz ist weg (cascade/set null, wo blockiert werden muss).
  const kritisch: string[] = [];
  // DRIFT: der Schutz greift, aber die Datenbank weicht vom Schema ab.
  const driftet: string[] = [];
  const fehlend: string[] = [];

  try {
    const ziel = await client.query<{ db: string; host: string }>(
      "SELECT current_database() AS db, inet_server_addr()::text AS host",
    );
    console.log(`Geprueft wird die Datenbank "${ziel.rows[0]?.db}".\n`);

    for (const e of ERWARTUNGEN) {
      const res = await client.query<{ confdeltype: string; conname: string }>(
        `SELECT c.confdeltype, c.conname
           FROM pg_constraint c
           JOIN pg_class t   ON t.oid = c.conrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'
            AND t.relname = $1
            AND a.attname = $2
          LIMIT 1`,
        [e.tabelle, e.spalte],
      );

      const zeile = res.rows[0];
      if (!zeile) {
        fehlend.push(`${e.tabelle}.${e.spalte}`);
        console.log(`  ?  ${e.tabelle}.${e.spalte} — kein Fremdschluessel gefunden`);
        continue;
      }

      const ist = zeile.confdeltype;
      if (ist === e.soll) {
        console.log(
          `  OK ${e.tabelle}.${e.spalte} — ${REGEL_KLARTEXT[ist] ?? ist}`,
        );
      } else if (e.soll === "r" && ist === "a") {
        // NO ACTION statt RESTRICT: Postgres blockiert das Loeschen in beiden
        // Faellen gleichermaessen (der Unterschied ist nur der Pruefzeitpunkt
        // innerhalb der Anweisung). Der Nachweis ist also NICHT in Gefahr —
        // die Datenbank weicht nur vom Drizzle-Schema ab. Trotzdem melden:
        // eine stille Abweichung, die kein anderer Waechter sieht, ist genau
        // das, was spaeter jemanden in die Irre fuehrt.
        driftet.push(
          `${e.tabelle}.${e.spalte}: "keine Aktion" statt "restrict" — ` +
            `das Loeschen wird trotzdem blockiert, der Nachweis ist sicher.`,
        );
        console.log(
          `  ~  ${e.tabelle}.${e.spalte} — keine Aktion statt restrict ` +
            `(blockiert trotzdem, aber weicht vom Schema ab)`,
        );
      } else {
        kritisch.push(
          `${e.tabelle}.${e.spalte}: ist "${REGEL_KLARTEXT[ist] ?? ist}", ` +
            `soll "${REGEL_KLARTEXT[e.soll] ?? e.soll}"\n     ${e.warum}`,
        );
        console.log(
          `  !! ${e.tabelle}.${e.spalte} — ${REGEL_KLARTEXT[ist] ?? ist} ` +
            `(erwartet: ${REGEL_KLARTEXT[e.soll] ?? e.soll})`,
        );
      }
    }

    // Das Loesch-Archiv darf KEINEN Fremdschluessel auf users tragen — er
    // wuerde genau die Loeschung blockieren, die das Archiv ermoeglichen soll.
    const archivFk = await client.query<{ conname: string }>(
      `SELECT c.conname
         FROM pg_constraint c
         JOIN pg_class t  ON t.oid = c.conrelid
         JOIN pg_class rt ON rt.oid = c.confrelid
        WHERE c.contype = 'f'
          AND t.relname = 'deletion_archives'
          AND rt.relname = 'users'`,
    );
    if (archivFk.rowCount && archivFk.rowCount > 0) {
      kritisch.push(
        `deletion_archives hat einen Fremdschluessel auf users ` +
          `(${archivFk.rows.map((r) => r.conname).join(", ")}).\n` +
          `     Das Archiv muss die geloeschte Person ueberleben — ein Verweis ` +
          `blockiert genau das Loeschen, das es ermoeglichen soll.`,
      );
      console.log("  !! deletion_archives — unerwarteter Verweis auf users");
    } else {
      console.log("  OK deletion_archives — kein Verweis auf users (richtig)");
    }
  } finally {
    await client.end();
  }

  if (fehlend.length > 0) {
    console.log(
      `\nHinweis: ${fehlend.length} Fremdschluessel wurden nicht gefunden ` +
        `(${fehlend.join(", ")}).\n` +
        `Wahrscheinlich ist das Schema aelter als der Code — ` +
        `"bash scripts/post-merge.sh" nachziehen.`,
    );
  }

  const behebung =
    `Behebung: "bash scripts/post-merge.sh" (Dev/Staging) bzw.\n` +
    `"pnpm --filter @workspace/scripts run migrate-prod --yes <dbname>" (Produktion).\n` +
    `Ein blosser "db push" reicht NICHT — drizzle-kit fasst bestehende\n` +
    `Fremdschluessel nicht an.`;

  if (kritisch.length > 0) {
    console.error(
      `\nKRITISCH — DER LOESCHSCHUTZ GREIFT NICHT (${kritisch.length}):\n\n` +
        kritisch.map((a) => `  - ${a}`).join("\n\n") +
        `\n\n${behebung}\n`,
    );
    process.exit(1);
  }

  if (driftet.length > 0) {
    console.error(
      `\nABWEICHUNG VOM SCHEMA (${driftet.length}) — kein Datenrisiko:\n\n` +
        driftet.map((a) => `  - ${a}`).join("\n") +
        `\n\n${behebung}\n`,
    );
    process.exit(1);
  }

  console.log("\nAlle Loeschregeln stimmen.");
}

main().catch((err) => {
  console.error("Pruefung der Loeschregeln fehlgeschlagen:", err);
  process.exit(1);
});
