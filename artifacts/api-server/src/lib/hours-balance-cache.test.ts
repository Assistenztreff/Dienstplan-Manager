import { describe, expect, it, vi } from "vitest";
import type { HoursBalanceRow } from "./dashboard-hours-balance";
import { HoursBalanceCache, type HoursBalanceCacheKey } from "./hours-balance-cache";

const key: HoursBalanceCacheKey = {
  callerUserId: 7,
  month: 8,
  year: 2026,
  requestedTeamId: 11,
};

const row = (balance = 3): HoursBalanceRow =>
  ({
    userId: 23,
    userName: "Test Assistenzkraft",
    balance,
  }) as HoursBalanceRow;

describe("HoursBalanceCache", () => {
  it("bündelt parallele identische Berechnungen und gibt getrennte Kopien zurück", async () => {
    const cache = new HoursBalanceCache();
    let resolveLoad!: (rows: HoursBalanceRow[]) => void;
    const load = vi.fn(
      () =>
        new Promise<HoursBalanceRow[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const first = cache.get(key, "100", load);
    const second = cache.get(key, "100", load);
    resolveLoad([row()]);

    const [firstRows, secondRows] = await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(firstRows).toEqual(secondRows);
    expect(firstRows).not.toBe(secondRows);
    expect(firstRows?.[0]).not.toBe(secondRows?.[0]);
  });

  it("schützt den Cache vor nachträglicher Redaktions-Mutation", async () => {
    const cache = new HoursBalanceCache();
    const load = vi.fn(async () => [row()]);

    const first = await cache.get(key, "100", load);
    first![0]!.balance = 99;

    const second = await cache.get(key, "100", load);
    expect(second?.[0]?.balance).toBe(3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("berechnet nach einer neuen Datenbankversion erneut", async () => {
    const cache = new HoursBalanceCache();
    const load = vi
      .fn<() => Promise<HoursBalanceRow[]>>()
      .mockResolvedValueOnce([row(1)])
      .mockResolvedValueOnce([row(2)]);

    expect((await cache.get(key, "100", load))?.[0]?.balance).toBe(1);
    expect((await cache.get(key, "101", load))?.[0]?.balance).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("entfernt fehlgeschlagene und null-Ergebnisse sofort", async () => {
    const cache = new HoursBalanceCache();
    const error = new Error("DB vorübergehend nicht erreichbar");
    const load = vi
      .fn<() => Promise<HoursBalanceRow[] | null>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([row()]);

    await expect(cache.get(key, "100", load)).rejects.toThrow(error);
    await expect(cache.get(key, "100", load)).resolves.toBeNull();
    await expect(cache.get(key, "100", load)).resolves.toEqual([row()]);
    expect(load).toHaveBeenCalledTimes(3);
  });
});