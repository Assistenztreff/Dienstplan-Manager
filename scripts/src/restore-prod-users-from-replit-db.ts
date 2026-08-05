/**
 * restore-prod-users-from-replit-db.ts
 *
 * Stellt die realen Personaldaten (Name, E-Mail, Telefon, Adresse, Geburtsdatum,
 * SV-Nummer, Steuer-ID, Steuerklasse, Krankenkasse, IBAN, Stundenlohn) der
 * Assistenzkräfte in der Scaleway-Staging-DB (= aktive App-DB) wieder her.
 *
 * Quelle : Replit-Managed-Postgres (DATABASE_URL, unverändert — kein APP_DATABASE_URL-Override)
 * Ziel   : Scaleway-Staging-DB (APP_DATABASE_URL via normalize-db-url)
 *
 * Matching (zwei Durchgänge):
 *   1. Exakt  : start_date + weekly_hours stimmen überein
 *   2. Fallback: nur weekly_hours, wenn nach Pass 1 beidseitig je genau 1 Rest übrig
 *
 * Passworte werden NICHT übertragen (jede DB hat eigene Hashes).
 *
 * Ausführung:
 *   cd /home/runner/workspace
 *   DATABASE_SSL_NO_VERIFY=1 pnpm --filter @workspace/scripts exec tsx src/restore-prod-users-from-replit-db.ts [--dry-run]
 *
 * Hinweis: Replit-Publish überschreibt KEINE Zeilendaten (nur Schema-DDL).
 * Die wiederhergestellten Daten bleiben bei jedem Republish erhalten.
 */

// WICHTIG: normalize-db-url NICHT importieren — sonst überschreibt APP_DATABASE_URL
// die Replit-Managed-Postgres-URL in process.env.DATABASE_URL.
// Die Ziel-URL wird direkt aus APP_DATABASE_URL + SCALEWAY_DB_PASSWORD gebaut.
import pg from "pg";
import { normalizeDatabaseUrl } from "@workspace/db/database-url";

const DRY_RUN = process.argv.includes("--dry-run");

function buildTargetUrl(): string {
  // APP_DATABASE_URL → Scaleway Staging (= aktive App-DB für dev UND deploy)
  const raw = process.env.APP_DATABASE_URL;
  if (!raw) throw new Error("APP_DATABASE_URL nicht gesetzt");
  let url = normalizeDatabaseUrl(raw);
  const pw = process.env.SCALEWAY_DB_PASSWORD;
  if (pw) {
    const parsed = new URL(url);
    parsed.password = encodeURIComponent(pw);
    url = parsed.toString();
  }
  return url;
}

function d(v: Date | string | null): string {
  return v ? String(v).slice(0, 10) : "null";
}

function sameDate(a: Date | string | null, b: Date | string | null): boolean {
  if (!a || !b) return false;
  return d(a) === d(b);
}

function sameHours(a: number | string | null, b: number | string | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(parseFloat(String(a)) - parseFloat(String(b))) < 0.1;
}

type SrcUser = {
  src_id: number; name: string; email: string; phone: string | null;
  address: string | null; birth_date: Date | null; social_security_number: string | null;
  tax_id: string | null; tax_class: string | null; health_insurance: string | null;
  iban: string | null; hourly_wage: number | null;
  start_date: Date | null; weekly_hours: number | null; contract_notes: string | null;
};

type TgtUser = {
  tgt_id: number; current_name: string; start_date: Date | null;
  weekly_hours: number | null; contract_id: number | null;
};

async function main(): Promise<void> {
  // Quell-DB: Replit-Managed-Postgres (echte Personaldaten, kein APP_DATABASE_URL-Override)
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL nicht gesetzt (Replit-Managed-DB fehlt)");

  // Ziel-DB: Scaleway Staging (= aktive App-Datenbank)
  const targetUrl = buildTargetUrl();

  const src = new pg.Client({
    connectionString: sourceUrl,
    ssl: process.env.DATABASE_SSL_NO_VERIFY === "1" ? { rejectUnauthorized: false } : undefined,
  });
  const tgt = new pg.Client({
    connectionString: targetUrl,
    ssl: { rejectUnauthorized: false },
  });

  await src.connect();
  await tgt.connect();

  const { rows: [{ db: srcDb }] } = await src.query<{ db: string }>("SELECT current_database() AS db");
  const { rows: [{ db: tgtDb }] } = await tgt.query<{ db: string }>("SELECT current_database() AS db");
  console.log(`Quelle : ${srcDb}`);
  console.log(`Ziel   : ${tgtDb}`);
  if (DRY_RUN) console.log("⚠️  DRY-RUN — es werden keine Änderungen geschrieben");
  console.log();

  // Quell-Daten: Team 1, aktive Verträge (end_date IS NULL), echte Assistenten
  const { rows: srcAll } = await src.query<SrcUser>(`
    SELECT u.id AS src_id, u.name, u.email, u.phone, u.address,
           u.birth_date, u.social_security_number, u.tax_id, u.tax_class,
           u.health_insurance, u.iban, u.hourly_wage,
           c.start_date, c.weekly_hours, c.notes AS contract_notes
    FROM users u
    JOIN team_members tm ON tm.user_id = u.id AND tm.team_id = 1
    LEFT JOIN contracts c ON c.user_id = u.id AND c.team_id = 1 AND c.end_date IS NULL
    WHERE u.role = 'assistant'
      AND u.email NOT LIKE '%@dienstplan.local'
    ORDER BY c.start_date, u.id
  `);

  // Ziel-Daten: Team 1, Assistenten mit Vertrags-Matching-Keys
  const { rows: tgtAll } = await tgt.query<TgtUser>(`
    SELECT u.id AS tgt_id, u.name AS current_name,
           c.start_date, c.weekly_hours, c.id AS contract_id
    FROM users u
    JOIN team_members tm ON tm.user_id = u.id AND tm.team_id = 1
    LEFT JOIN contracts c ON c.user_id = u.id AND c.team_id = 1 AND c.end_date IS NULL
    WHERE u.role = 'assistant'
      AND u.email NOT LIKE '%@dienstplan.local'
    ORDER BY c.start_date, u.id
  `);

  console.log(`Quell-Assistenten : ${srcAll.length}`);
  console.log(`Ziel-Assistenten  : ${tgtAll.length}`);
  console.log();

  // ── Pass 1: exaktes Matching (start_date + weekly_hours) ──────────────────
  const pairs: Array<{ src: SrcUser; tgt: TgtUser; exact: boolean }> = [];
  const unmatchedSrc = new Set(srcAll.map((_, i) => i));
  const unmatchedTgt = new Set(tgtAll.map((_, i) => i));

  for (const [si, s] of srcAll.entries()) {
    for (const [ti, t] of tgtAll.entries()) {
      if (!unmatchedTgt.has(ti)) continue;
      if (sameDate(t.start_date, s.start_date) && sameHours(t.weekly_hours, s.weekly_hours)) {
        pairs.push({ src: s, tgt: t, exact: true });
        unmatchedSrc.delete(si);
        unmatchedTgt.delete(ti);
        break;
      }
    }
  }

  // ── Pass 2: Fallback — weekly_hours allein (je genau 1 Rest pro Seite) ───
  const restSrc = [...unmatchedSrc].map((i) => srcAll[i]);
  const restTgt = [...unmatchedTgt].map((i) => tgtAll[i]);

  for (const s of restSrc) {
    const candidates = restTgt.filter((t) => sameHours(t.weekly_hours, s.weekly_hours));
    if (candidates.length === 1) {
      pairs.push({ src: s, tgt: candidates[0], exact: false });
      restTgt.splice(restTgt.indexOf(candidates[0]), 1);
    } else {
      console.log(`⚠️  KEIN MATCH: ${s.name} (Start ${d(s.start_date)}, ${s.weekly_hours}h) — ${candidates.length === 0 ? "keine" : "mehrdeutige"} Kandidaten`);
    }
  }

  // ── Ergebnis anzeigen ─────────────────────────────────────────────────────
  console.log("Geplante Aktualisierungen:");
  console.log("──────────────────────────────────────────────────────────────");
  for (const { src: s, tgt: t, exact } of pairs) {
    const hint = exact ? "✓ exakt" : "~ Fallback (nur h/Woche)";
    console.log(`  ${hint.padEnd(20)} ${t.current_name.padEnd(14)} → ${s.name}`);
    console.log(`                       Vertrag  Start ${d(t.start_date)} ${t.weekly_hours}h/Wo (Ziel)  |  Start ${d(s.start_date)} ${s.weekly_hours}h/Wo (Quelle)`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log();

  if (DRY_RUN) {
    console.log(`Dry-Run abgeschlossen: ${pairs.length} würden aktualisiert.`);
    await src.end();
    await tgt.end();
    return;
  }

  // ── Aktualisierungen durchführen ──────────────────────────────────────────
  let updated = 0;
  for (const { src: s, tgt: t } of pairs) {
    await tgt.query(
      `UPDATE users SET
         name                   = $1,
         email                  = $2,
         phone                  = $3,
         address                = $4,
         birth_date             = $5,
         social_security_number = $6,
         tax_id                 = $7,
         tax_class              = $8,
         health_insurance       = $9,
         iban                   = $10,
         hourly_wage            = $11
       WHERE id = $12`,
      [
        s.name, s.email, s.phone, s.address,
        s.birth_date, s.social_security_number, s.tax_id,
        s.tax_class, s.health_insurance, s.iban, s.hourly_wage,
        t.tgt_id,
      ],
    );

    // Vertrags-Notizen übernehmen (z. B. "Teilzeit Vormittag")
    if (s.contract_notes && t.contract_id) {
      await tgt.query("UPDATE contracts SET notes = $1 WHERE id = $2", [
        s.contract_notes,
        t.contract_id,
      ]);
    }

    updated++;
  }

  console.log(`Fertig: ${updated} von ${srcAll.length} Nutzer(n) in der App-DB aktualisiert.`);
  await src.end();
  await tgt.end();
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
