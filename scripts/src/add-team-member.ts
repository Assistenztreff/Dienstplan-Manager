import pg from "pg";

/**
 * Fuegt eine Team-Mitgliedschaft direkt in der DB ein — bzw. entfernt sie.
 *
 * Ausschliesslich fuer Test-Infrastruktur gedacht: POST /api/teams/:id/members
 * nimmt aus Sicherheitsgruenden nur Nutzer an, die bereits Mitglied eines
 * Teams DESSELBEN Eigentuemers sind (Schutz vor mandantenuebergreifender
 * Annexion per ID-Enumeration). E2E-Specs, die den Kanten-Fall "Admin ist
 * Mitglied in einem FREMDEN Team" (historischer/DB-seitiger Zustand) pruefen,
 * brauchen daher einen DB-direkten Weg.
 *
 * Aufruf ueber Umgebungsvariablen (analog seed-owned-team), damit der Aufruf
 * aus dem Test per execSync mit ueberschriebener DATABASE_URL (Test-DB)
 * erfolgen kann:
 *   TEAM_MEMBER_TEAM_ID – Ziel-Team-ID (Pflicht)
 *   TEAM_MEMBER_USER_ID – Nutzer-ID (Pflicht)
 *   TEAM_MEMBER_ACTION  – "create" (Default) | "delete"
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const teamId = Number(process.env.TEAM_MEMBER_TEAM_ID);
  const userId = Number(process.env.TEAM_MEMBER_USER_ID);
  if (!Number.isInteger(teamId) || !Number.isInteger(userId)) {
    throw new Error("TEAM_MEMBER_TEAM_ID und TEAM_MEMBER_USER_ID muessen gesetzt sein.");
  }

  const action = process.env.TEAM_MEMBER_ACTION ?? "create";
  if (action !== "create" && action !== "delete") {
    throw new Error(`Ungueltige Aktion "${action}" (erlaubt: create | delete).`);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (action === "create") {
      await client.query(
        `INSERT INTO team_members (team_id, user_id)
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2
         )`,
        [teamId, userId],
      );
      console.log(`Mitgliedschaft user ${userId} in Team ${teamId} sichergestellt.`);
    } else {
      const res = await client.query(
        "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
        [teamId, userId],
      );
      console.log(
        `${res.rowCount ?? 0} Mitgliedschaft(en) von user ${userId} in Team ${teamId} entfernt.`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Verwalten der Team-Mitgliedschaft:", err);
  process.exit(1);
});
