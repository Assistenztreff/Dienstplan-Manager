// ---------------------------------------------------------------------------
// DB-gestützter Regressionstest: Vertretung vormerken (28.08.2026).
// ---------------------------------------------------------------------------
// findPlannedWorkShiftsForDay muss standbyUserId/type/shiftModelId MIT
// zurückgeben — sie werden gebraucht, um den Vertretungs-Aktivierungs-
// Vorschlag (buildVertretungsVorschlag) zu bauen, BEVOR der ersetzte
// Arbeitsdienst gleich gelöscht wird (POST /shifts legt eine Abwesenheit an,
// die ihn überschreibt — s. shifts-crud.ts). Ohne diese Felder wäre die
// Original-Dienstart/-Modell für den Vorschlag unwiederbringlich verloren.
//
// Läuft gegen die isolierte Test-Datenbank, wie die übrigen *.db.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { normalizeDatabaseUrl, resolveDatabaseUrl } from "@workspace/db/database-url";
import { deriveTestDbTarget } from "@workspace/test-fixtures/test-db-name";

function deriveTestDbUrl(base: string): string {
  return deriveTestDbTarget(normalizeDatabaseUrl(base)).url;
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

type Db = typeof import("@workspace/db");
type ShiftsRoute = typeof import("./shifts");

let dbmod: Db;
let mod: ShiftsRoute;

beforeAll(async () => {
  const base = resolveDatabaseUrl();
  if (!base) throw new Error("DATABASE_URL muss gesetzt sein.");

  process.env.DATABASE_URL = deriveTestDbUrl(base);
  process.env.APP_DATABASE_URL = process.env.DATABASE_URL;

  dbmod = await import("@workspace/db");
  mod = await import("./shifts");

  try {
    await dbmod.db.execute(sql`SELECT 1 FROM shifts LIMIT 1`);
  } catch {
    execSync("pnpm --filter @workspace/scripts run setup-test-db", {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
}, 240_000);

afterAll(async () => {
  if (dbmod) {
    await dbmod.pool.end();
  }
});

async function makeTeamUserPair(label: string): Promise<{
  teamId: number;
  ownerId: number;
  userId: number;
  standbyUserId: number;
}> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const [owner] = await dbmod.db
    .insert(dbmod.usersTable)
    .values({
      name: `Vertretung Owner ${label} ${suffix}`,
      email: `vertretung-owner-${label}-${suffix}@dienstplan.test`,
      role: "admin",
      accountType: "privat",
      plan: "premium",
    })
    .returning();
  const [team] = await dbmod.db
    .insert(dbmod.teamsTable)
    .values({ name: `Vertretung Team ${label} ${suffix}`, ownerId: owner!.id })
    .returning();
  const [assistant] = await dbmod.db
    .insert(dbmod.usersTable)
    .values({
      name: `Vertretung Assistant ${label} ${suffix}`,
      email: `vertretung-assistant-${label}-${suffix}@dienstplan.test`,
      role: "assistant",
      accountType: "privat",
      plan: "premium",
    })
    .returning();
  const [standby] = await dbmod.db
    .insert(dbmod.usersTable)
    .values({
      name: `Vertretung Standby ${label} ${suffix}`,
      email: `vertretung-standby-${label}-${suffix}@dienstplan.test`,
      role: "assistant",
      accountType: "privat",
      plan: "premium",
    })
    .returning();
  return { teamId: team!.id, ownerId: owner!.id, userId: assistant!.id, standbyUserId: standby!.id };
}

async function cleanup(teamId: number, userIds: number[]): Promise<void> {
  for (const userId of userIds) {
    await dbmod.db.delete(dbmod.timeTrackingTable).where(eq(dbmod.timeTrackingTable.userId, userId));
    await dbmod.db.delete(dbmod.shiftsTable).where(eq(dbmod.shiftsTable.userId, userId));
  }
  await dbmod.db.delete(dbmod.teamsTable).where(eq(dbmod.teamsTable.id, teamId));
  for (const userId of userIds) {
    await dbmod.db.delete(dbmod.usersTable).where(eq(dbmod.usersTable.id, userId));
  }
}

describe("Vertretung vormerken — findPlannedWorkShiftsForDay + buildVertretungsVorschlag", () => {
  it(
    "findPlannedWorkShiftsForDay liefert standbyUserId/type/shiftModelId des ersetzten Dienstes mit",
    { timeout: 60_000 },
    async () => {
      const { teamId, ownerId, userId, standbyUserId } = await makeTeamUserPair("find");
      try {
        const startTime = new Date("2026-09-21T08:00:00.000Z");
        const endTime = new Date("2026-09-21T16:00:00.000Z");
        await dbmod.db.insert(dbmod.shiftsTable).values({
          teamId,
          userId,
          startTime,
          endTime,
          type: "active",
          standbyUserId,
        });

        const planned = await mod.findPlannedWorkShiftsForDay(
          userId,
          teamId,
          new Date("2026-09-21T00:00:00.000Z"),
          new Date("2026-09-21T23:59:59.000Z"),
        );

        expect(planned.length).toBe(1);
        expect(planned[0]!.standbyUserId).toBe(standbyUserId);
        expect(planned[0]!.type).toBe("active");
        expect(planned[0]!.startTime.toISOString()).toBe(startTime.toISOString());
        expect(planned[0]!.endTime.toISOString()).toBe(endTime.toISOString());
      } finally {
        await cleanup(teamId, [userId, standbyUserId, ownerId]);
      }
    },
  );

  it(
    "buildVertretungsVorschlag löst den Namen der Vertretung auf",
    { timeout: 60_000 },
    async () => {
      const { teamId, ownerId, userId, standbyUserId } = await makeTeamUserPair("build");
      try {
        const startTime = new Date("2026-09-22T08:00:00.000Z");
        const endTime = new Date("2026-09-22T16:00:00.000Z");

        const vorschlag = await mod.buildVertretungsVorschlag({
          teamId,
          standbyUserId,
          startTime,
          endTime,
          type: "active",
          shiftModelId: null,
        });

        expect(vorschlag).not.toBeNull();
        expect(vorschlag!.userId).toBe(standbyUserId);
        expect(vorschlag!.teamId).toBe(teamId);
        expect(vorschlag!.type).toBe("active");
        expect(vorschlag!.userName).toContain("Vertretung Standby build");
      } finally {
        await cleanup(teamId, [userId, standbyUserId, ownerId]);
      }
    },
  );

  it("buildVertretungsVorschlag liefert null ohne standbyUserId", async () => {
    const vorschlag = await mod.buildVertretungsVorschlag({
      teamId: 1,
      standbyUserId: null,
      startTime: new Date(),
      endTime: new Date(),
      type: "active",
      shiftModelId: null,
    });
    expect(vorschlag).toBeNull();
  });
});
