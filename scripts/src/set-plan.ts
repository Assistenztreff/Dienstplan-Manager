import "./lib/normalize-db-url";
import { assertNotProdDb } from "./lib/normalize-db-url";
import pg from "pg";

/**
 * Setzt den Abo-Plan eines Nutzers direkt in der DB (per E-Mail).
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht: Premium wird in Produktion
 * manuell im Operator-Dashboard freigeschaltet (kein Stripe). Die E2E-Specs
 * brauchen einen Weg, ein frisch registriertes Free-Konto auf Premium zu heben
 * (bzw. zurueck), um zu pruefen, dass die serverseitige Plan-Durchsetzung
 * (`getUserPlan` liest IMMER frisch aus der DB) sofort wirkt.
 *
 * Aufruf ueber Umgebungsvariablen (analog setup-admin), damit der Aufruf aus
 * dem Test per execSync mit ueberschriebener DATABASE_URL (Test-DB) erfolgen
 * kann:
 *   SET_PLAN_EMAIL  – E-Mail des Zielkontos (Pflicht)
 *   SET_PLAN_VALUE  – "premium" | "free" (Default "premium")
 */
async function main(): Promise<void> {
  // Sicherheitsabbruch: dieses Script ist NICHT fuer Produktionsdaten gedacht.
  assertNotProdDb();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const email = process.env.SET_PLAN_EMAIL;
  if (!email) {
    throw new Error("SET_PLAN_EMAIL muss gesetzt sein.");
  }

  const plan = process.env.SET_PLAN_VALUE ?? "premium";
  if (plan !== "premium" && plan !== "free") {
    throw new Error(`Ungueltiger Plan "${plan}" (erlaubt: premium | free).`);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const res = await client.query(
    "UPDATE users SET plan = $1 WHERE email = $2",
    [plan, email],
  );
  await client.end();

  if (res.rowCount === 0) {
    throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
  }
  console.log(`Plan fuer "${email}" auf "${plan}" gesetzt.`);
}

main().catch((err) => {
  console.error("Fehler beim Setzen des Plans:", err);
  process.exit(1);
});
