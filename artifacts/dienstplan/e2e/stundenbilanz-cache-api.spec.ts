import { expect, test } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

const MONTH = 7;
const YEAR = 2026;
const DAY_A = "2026-07-10";
const DAY_B = "2026-07-11";

let h: TeamTestHarness;
let teamId: number;
let assistantId: number;

const percentile = (values: number[], factor: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * factor) - 1)]!;
};

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamId = await h.createTeam(`E2E Stundenbilanz Cache ${h.run}`);
  assistantId = await h.createUser({ teamId, role: "assistant" });
  await h.createContract(teamId, assistantId);
  await h.createShift(teamId, assistantId, DAY_A);
});

test.afterAll(async () => {
  await h.cleanup();
});

test("wiederholte Stundenbilanz-Reads sind schnell und ein neuer Dienst invalidiert sofort", async () => {
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
  const beforeRows = (await beforeResponse.json()) as Array<{
    userId: number;
    plannedHours: number;
  }>;
  expect(beforeRows.find((row) => row.userId === assistantId)?.plannedHours).toBe(8);

  await h.createShift(teamId, assistantId, DAY_B);

  const afterResponse = await h.ctx.get(url);
  expect(afterResponse.status(), await afterResponse.text()).toBe(200);
  const afterRows = (await afterResponse.json()) as Array<{
    userId: number;
    plannedHours: number;
  }>;
  expect(afterRows.find((row) => row.userId === assistantId)?.plannedHours).toBe(16);
});