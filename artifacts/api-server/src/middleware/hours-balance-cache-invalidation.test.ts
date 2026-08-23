import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { canChangeHoursBalance } from "./hours-balance-cache-invalidation";

const request = (method: string, path: string): Request =>
  ({ method, path }) as Request;

describe("canChangeHoursBalance", () => {
  it.each([
    ["POST", "/shifts"],
    ["PATCH", "/shifts/42"],
    ["DELETE", "/time-tracking/42"],
    ["POST", "/time-tracking/confirm-batch"],
    ["POST", "/contracts"],
    ["PUT", "/allowance-settings"],
    ["PATCH", "/users/42"],
    ["DELETE", "/teams/42/members/7"],
    ["PATCH", "/shift-models/42"],
    ["PUT", "/koordinatoren/42/teams"],
    ["PATCH", "/koordinatoren/42"],
    ["POST", "/auth/update-profile"],
    ["GET", "/auth/dev-users"],
  ])("erfasst %s %s", (method, path) => {
    expect(canChangeHoursBalance(request(method, path))).toBe(true);
  });

  it.each([
    ["GET", "/shifts"],
    ["GET", "/contracts"],
    ["POST", "/auth/login"],
    ["PATCH", "/month-closings/42"],
  ])("ignoriert %s %s", (method, path) => {
    expect(canChangeHoursBalance(request(method, path))).toBe(false);
  });
});