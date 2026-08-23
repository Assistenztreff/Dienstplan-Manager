import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

const MONTH = 7;
const YEAR = 2026;
const DAY_A = "2026-07-10";
const DAY_B = "2026-07-11";
const PRIMARY_API_PORT = Number(process.env.E2E_API_PORT ?? "8099");
const SECONDARY_API_PORT = PRIMARY_API_PORT + 1_000;
const SECONDARY_API_URL = `http://localhost:${SECONDARY_API_PORT}`;
const TEST_DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;

const specDir = path.dirname(fileURLToPath(import.meta.url));
const apiServerDir = path.resolve(specDir, "..", "..", "api-server");

let h: TeamTestHarness;
let teamId: number;
let assistantId: number;
let secondaryApiProcess: ChildProcess | null = null;
let secondaryApiContext: APIRequestContext | null = null;
let secondaryShiftId: number | null = null;
let secondaryApiOutput = "";

const percentile = (values: number[], factor: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * factor) - 1)]!;
};

async function waitForSecondaryApi(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (
      secondaryApiProcess?.exitCode !== null ||
      secondaryApiProcess.signalCode !== null
    ) {
      throw new Error(
        `Zweite API-Instanz wurde vorzeitig beendet.\n${secondaryApiOutput.slice(-4_000)}`,
      );
    }

    try {
      const response = await fetch(`${SECONDARY_API_URL}/api/healthz`);
      if (response.ok) return;
    } catch {
      // Der Prozess bindet den Port noch.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Zweite API-Instanz wurde nicht rechtzeitig erreichbar.\n${secondaryApiOutput.slice(-4_000)}`,
  );
}

function stopSecondaryApi(): void {
  if (
    secondaryApiProcess?.pid &&
    secondaryApiProcess.exitCode === null &&
    secondaryApiProcess.signalCode === null
  ) {
    secondaryApiProcess.kill("SIGTERM");
  }
}

test.skip(
  !TEST_DATABASE_URL,
  "Der Zwei-Instanzen-Test läuft nur gegen den isolierten Playwright-Test-Stack.",
);
test.setTimeout(120_000);

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamId = await h.createTeam(`E2E Stundenbilanz Cache ${h.run}`);
  assistantId = await h.createUser({ teamId, role: "assistant" });
  await h.createContract(teamId, assistantId);
  await h.createShift(teamId, assistantId, DAY_A);

  secondaryApiProcess = spawn(
    "node",
    ["--enable-source-maps", "dist/index.mjs"],
    {
      cwd: apiServerDir,
      env: {
        ...process.env,
        PORT: String(SECONDARY_API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        APP_DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: "development",
        REGISTER_RATE_LIMIT_MAX: "0",
        EMAIL_RATE_LIMIT_MAX: "0",
      },
      stdio: "pipe",
    },
  );
  secondaryApiProcess.stdout?.on("data", (chunk: Buffer) => {
    secondaryApiOutput += chunk.toString();
  });
  secondaryApiProcess.stderr?.on("data", (chunk: Buffer) => {
    secondaryApiOutput += chunk.toString();
  });
  process.once("exit", stopSecondaryApi);

  await waitForSecondaryApi();

  secondaryApiContext = await playwrightRequest.newContext({
    baseURL: SECONDARY_API_URL,
  });
  const loginResponse = await secondaryApiContext.post("/api/auth/login", {
    data: { email: h.email, password: h.password },
  });
  expect(
    loginResponse.status(),
    `Login über Instanz B fehlgeschlagen: ${await loginResponse.text()}`,
  ).toBe(200);
});

test.afterAll(async () => {
  if (secondaryShiftId !== null) {
    await h.ctx.delete(`/api/shifts/${secondaryShiftId}`).catch(() => undefined);
  }
  await secondaryApiContext?.dispose().catch(() => undefined);
  stopSecondaryApi();
  process.removeListener("exit", stopSecondaryApi);
  await h.cleanup();
});

test("Instanz A verwirft ihren warmen Stundenbilanz-Cache nach einem Write über Instanz B", async () => {
  const url = `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}&teamId=${teamId}`;
  const durations: number[] = [];

  for (let index = 0; index < 8; index += 1) {
    const startedAt = performance.now();
    const response = await h.ctx.get(url);
    durations.push(performance.now() - startedAt);
    expect(response.status(), await response.text()).toBe(200);
  }

  const warmDurations = durations.slice(2);
  console.info(
    `[stundenbilanz-cache] cold=${durations[0]!.toFixed(1)}ms ` +
      `warm-median=${percentile(warmDurations, 0.5).toFixed(1)}ms ` +
      `warm-p95=${percentile(warmDurations, 0.95).toFixed(1)}ms`,
  );

  const beforeResponse = await h.ctx.get(url);
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const beforeRows = (await beforeResponse.json()) as Array<{
    userId: number;
    plannedHours: number;
  }>;
  expect(beforeRows.find((row) => row.userId === assistantId)?.plannedHours).toBe(8);

  const writeResponse = await secondaryApiContext!.post("/api/shifts", {
    data: {
      userId: assistantId,
      teamId,
      startTime: `${DAY_B}T08:00:00.000Z`,
      endTime: `${DAY_B}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(
    writeResponse.status(),
    `Schicht über Instanz B anlegen fehlgeschlagen: ${await writeResponse.text()}`,
  ).toBe(201);
  secondaryShiftId = ((await writeResponse.json()) as { id: number }).id;

  const afterResponse = await h.ctx.get(url);
  expect(afterResponse.status(), await afterResponse.text()).toBe(200);
  const afterRows = (await afterResponse.json()) as Array<{
    userId: number;
    plannedHours: number;
  }>;
  expect(afterRows.find((row) => row.userId === assistantId)?.plannedHours).toBe(16);
});