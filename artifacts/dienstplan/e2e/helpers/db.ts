import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";
import { deleteAccountTrees } from "@workspace/test-fixtures";

/**
 * In-Prozess-DB-Zugriff fuer die E2E-Helfer.
 *
 * Frueher liefen setAccountPlan/deleteAccountByEmail/addTeamMemberViaDb/
 * seedForeignAdmin jeweils als `execSync("pnpm --filter @workspace/scripts
 * run <skript>")` — jeder Aufruf kostete ~3s reinen Prozess-Overhead (pnpm-
 * Start + tsx-Boot), bei weit ueber 100 Aufrufen pro Suite-Lauf summierte
 * sich das auf mehrere Minuten. Die eigentliche Arbeit ist jeweils nur ein
 * bis zwei SQL-Statements; die laufen jetzt direkt hier im Worker-Prozess
 * (~10-30ms pro Aufruf, lokale DB).
 *
 * DB-Targeting wie zuvor beim execSync-Weg: gegen den isolierten Test-Stack
 * stellt die Playwright-Config die `_test`-DB-URL als `E2E_TEST_DATABASE_URL`
 * bereit; gegen einen externen Stack (E2E_BASE_URL-Override) greift die
 * vorhandene `DATABASE_URL`.
 *
 * Verbindungs-Modell: pro Aufruf ein kurzlebiger `pg.Client` (connect/end).
 * Bewusst KEIN langlebiger Pool — Playwright-Worker koennen jederzeit enden,
 * und offene Pool-Handles wuerden den Prozess-Exit verzoegern. Der Connect
 * gegen die lokale DB kostet nur wenige Millisekunden.
 */

function resolveDbUrl(): string {
  const url = process.env.E2E_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Weder E2E_TEST_DATABASE_URL noch DATABASE_URL gesetzt — E2E-DB-Helfer brauchen ein DB-Ziel.",
    );
  }
  return url;
}

async function withDbClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: resolveDbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Aktiviert oder deaktiviert ein Konto direkt in der (Test-)DB (per E-Mail).
 * Verwendet für Specs, die prüfen, ob ein deaktiviertes Konto sofort aus allen
 * Zugangswegen ausgeschlossen wird (z. B. Kalender-Feed-404, Session-Revoke).
 */
/** Setzt den Kalender-Token eines Nutzers direkt in der (Test-)DB. */
export async function dbSetCalendarToken(
  email: string,
  token: string | null,
): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE users SET calendar_token = $1 WHERE email = $2",
      [token, email],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }
  });
}

export async function dbSetUserActive(email: string, isActive: boolean): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE users SET is_active = $1 WHERE email = $2",
      [isActive, email],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }
  });
}

/** Setzt den Abo-Plan eines Kontos direkt in der (Test-)DB (per E-Mail). */
export async function dbSetAccountPlan(
  email: string,
  plan: "premium" | "free",
): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query("UPDATE users SET plan = $1 WHERE email = $2", [
      plan,
      email,
    ]);
    if (res.rowCount === 0) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }
  });
}

/** Fuegt eine Team-Mitgliedschaft direkt in der (Test-)DB ein (idempotent). */
export async function dbAddTeamMember(teamId: number, userId: number): Promise<void> {
  await withDbClient(async (client) => {
    await client.query(
      `INSERT INTO team_members (team_id, user_id)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2
       )`,
      [teamId, userId],
    );
  });
}

/**
 * Loescht ein (Test-)Konto samt Datenbaum direkt in der (Test-)DB — dieselbe
 * FK-sichere Loeschlogik (`deleteAccountTrees`) wie das delete-account-Skript
 * und der cleanup-test-accounts-Teardown. Sicherung wie im Skript: nur
 * E-Mails der Test-Domain `@dienstplan.test`. Idempotent.
 */
export async function dbDeleteAccountByEmail(email: string): Promise<void> {
  if (!email.endsWith("@dienstplan.test")) {
    throw new Error(
      `Sicherheitsstopp: "${email}" ist keine Test-Adresse (@dienstplan.test).`,
    );
  }
  await withDbClient(async (client) => {
    const userRes = await client.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    const row = userRes.rows[0] as { id: number } | undefined;
    if (!row) return; // idempotent: kein Konto = nichts zu tun
    await deleteAccountTrees(client, [row.id]);
  });
}

/**
 * Setzt die (VERALTETE) Spalte contracts.billing_method direkt in der DB.
 * Der Vertrags-Override der Abrechnungsart wurde aus API/UI entfernt — dieser
 * Helfer stellt einen HISTORISCHEN Alt-Wert nach, um zu beweisen, dass er die
 * Auswertung nicht mehr beeinflusst.
 */
export async function dbSetContractBillingMethod(
  contractId: number,
  method: "SOLL" | "IST",
): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE contracts SET billing_method = $1 WHERE id = $2",
      [method, contractId],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein Vertrag mit id ${contractId} gefunden.`);
    }
  });
}

/** Passwort-Hashing exakt wie das setup-admin-Skript (scrypt, salt:hash). */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Seedet einen superadmin direkt in der (Test-)DB — In-Prozess-Variante des
 * setup-superadmin-Skripts fuer FRISCHE Test-E-Mails (idempotent: existiert
 * die E-Mail bereits als superadmin, No-Op; existiert sie mit anderer Rolle,
 * Fehler — Specs sollen eindeutige e2e.*@dienstplan.test-Adressen nutzen).
 * Ersetzt den ~3s teuren execSync-Skriptaufruf pro Spec-Setup.
 */
export async function dbSeedSuperadmin(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await withDbClient(async (client) => {
    const normalized = email.toLowerCase().trim();
    const existing = await client.query(
      "SELECT id, role FROM users WHERE email = $1",
      [normalized],
    );
    const row = existing.rows[0] as { id: number; role: string } | undefined;
    if (row) {
      if (row.role === "superadmin") return; // idempotent
      throw new Error(
        `Konto "${normalized}" existiert bereits mit Rolle "${row.role}" — kein stilles Befoerdern im Test-Helfer.`,
      );
    }
    await client.query(
      `INSERT INTO users (name, email, role, password_hash, is_active)
       VALUES ($1, $2, 'superadmin', $3, true)`,
      [name, normalized, hashPassword(password)],
    );
  });
}

/**
 * Backdatiert einen plan_changes-Eintrag (identifiziert per eindeutiger
 * Notiz) direkt in der (Test-)DB — In-Prozess-Variante des
 * backdate-plan-change-Skripts (created_at wird serverseitig immer auf
 * "jetzt" gesetzt; fuer Zeitraum-Filter-Specs muessen Eintraege nachtraeglich
 * auf definierte Grenz-Zeitpunkte gesetzt werden).
 */
export async function dbBackdatePlanChange(
  note: string,
  createdAt: Date,
): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE plan_changes SET created_at = $1 WHERE note = $2",
      [createdAt.toISOString(), note],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein plan_changes-Eintrag mit Notiz "${note}" gefunden.`);
    }
    if ((res.rowCount ?? 0) > 1) {
      throw new Error(
        `Notiz "${note}" traf ${res.rowCount} plan_changes-Eintraege — Notizen muessen im Spec eindeutig sein (verschmutzte Test-DB?).`,
      );
    }
  });
}

/**
 * Fuegt einen platform_errors-Eintrag direkt in der (Test-)DB ein — fuer
 * Fehlerlisten-Specs, die volle Kontrolle ueber message/context/lastSeenAt
 * brauchen (z. B. Zeitraum-Presets und Suche). Gibt die neue Zeilen-ID
 * zurueck.
 */
export async function dbInsertPlatformError(opts: {
  level?: "error" | "warning";
  message: string;
  context: string;
  lastSeenAt?: Date;
}): Promise<number> {
  return withDbClient(async (client) => {
    const level = opts.level ?? "error";
    const lastSeenAt = (opts.lastSeenAt ?? new Date()).toISOString();
    const res = await client.query(
      `INSERT INTO platform_errors (level, message, context, last_seen_at, created_at)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING id`,
      [level, opts.message, opts.context, lastSeenAt],
    );
    return (res.rows[0] as { id: number }).id;
  });
}

/**
 * Loescht platform_errors-Eintraege, deren Kontext mit dem angegebenen
 * Praefix beginnt — gezielte Cleanup-Hilfe fuer Fehlerlisten-Specs
 * (idempotent).
 */
export async function dbDeletePlatformErrorsByContextPrefix(
  prefix: string,
): Promise<void> {
  await withDbClient(async (client) => {
    await client.query("DELETE FROM platform_errors WHERE context LIKE $1", [
      `${prefix}%`,
    ]);
  });
}

/**
 * Seedet einen Admin direkt in der (Test-)DB — Verhalten identisch zum
 * setup-admin-Skript: idempotent (bestehende E-Mail = No-Op), legt NUR dann
 * ein "Standard-Team" an, wenn noch GAR KEIN Team existiert (Bootstrap-
 * Semantik; in der laufenden Test-DB existieren immer schon Teams, der
 * geseedete Admin bleibt also team-los — genau das brauchen die
 * Isolations-Specs).
 */
/**
 * Markiert ein Konto als E-Mail-verifiziert direkt in der (Test-)DB —
 * benoetigt, wenn die Test-Umgebung RESEND_API_KEY gesetzt hat und die
 * Registrierung deshalb mit emailVerified=false startet. Setzt auch den
 * Verifikationstoken auf NULL (wie nach einem echten Klick).
 */
export async function dbMarkEmailVerified(email: string): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE users SET email_verified = true, email_verification_token = NULL WHERE email = $1",
      [email],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }
  });
}

/**
 * Liest den aktuellen E-Mail-Verifikationstoken eines Nutzers aus der
 * (Test-)DB — benoetigt fuer E2E-Tests des E-Mail-Flows, weil keine echte
 * Inbox verfuegbar ist. Gibt null zurueck, wenn kein Token gesetzt ist.
 */
export async function dbGetEmailVerificationToken(email: string): Promise<string | null> {
  return withDbClient(async (client) => {
    const res = await client.query(
      "SELECT email_verification_token FROM users WHERE email = $1",
      [email],
    );
    const row = res.rows[0] as { email_verification_token: string | null } | undefined;
    if (!row) throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    return row.email_verification_token;
  });
}

/**
 * Setzt emailVerified = false und einen frei waehlbaren Verifikationstoken
 * direkt in der (Test-)DB — simuliert einen gerade registrierten, noch nicht
 * verifizierten Nutzer ohne echten Resend-Versand.
 */
export async function dbSetEmailVerification(
  email: string,
  token: string,
): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE users SET email_verified = false, email_verification_token = $1 WHERE email = $2",
      [token, email],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }
  });
}

/**
 * Liest den aktuellen Passwort-Reset-Token eines Nutzers aus der (Test-)DB.
 * Gibt null zurueck, wenn kein Token gesetzt ist.
 */
export async function dbGetPasswordResetToken(email: string): Promise<string | null> {
  return withDbClient(async (client) => {
    const res = await client.query(
      "SELECT password_reset_token FROM users WHERE email = $1",
      [email],
    );
    const row = res.rows[0] as { password_reset_token: string | null } | undefined;
    if (!row) throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    return row.password_reset_token;
  });
}

/**
 * Setzt einen Passwort-Reset-Token mit Ablaufzeit direkt in der (Test-)DB.
 * Erlaubt Tests mit kuenstlich abgelaufenen Tokens (expiresAt in der
 * Vergangenheit) ohne auf den Server-Ablauf warten zu muessen.
 */
export async function dbSetPasswordResetToken(
  email: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
  await withDbClient(async (client) => {
    const res = await client.query(
      "UPDATE users SET password_reset_token = $1, password_reset_token_expiry = $2 WHERE email = $3",
      [token, expiresAt.toISOString(), email],
    );
    if (res.rowCount === 0) {
      throw new Error(`Kein Nutzer mit E-Mail "${email}" gefunden.`);
    }
  });
}

export async function dbSeedAdmin(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await withDbClient(async (client) => {
    const normalized = email.toLowerCase().trim();
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [
      normalized,
    ]);
    if ((existing.rowCount ?? 0) > 0) return;

    const inserted = await client.query(
      `INSERT INTO users (name, email, role, password_hash, is_active)
       VALUES ($1, $2, 'admin', $3, true)
       RETURNING id`,
      [name, normalized, hashPassword(password)],
    );
    const adminId = (inserted.rows[0] as { id: number }).id;

    const teamResult = await client.query(
      `INSERT INTO teams (name, owner_id)
       SELECT 'Standard-Team', $1
       WHERE NOT EXISTS (SELECT 1 FROM teams)
       RETURNING id`,
      [adminId],
    );
    const teamRow = teamResult.rows[0] as { id: number } | undefined;
    if (teamRow) {
      await client.query(
        `INSERT INTO team_members (team_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [teamRow.id, adminId],
      );
    }
  });
}
