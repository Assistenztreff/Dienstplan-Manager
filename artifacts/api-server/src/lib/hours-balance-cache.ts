import type { HoursBalanceRow } from "./dashboard-hours-balance";

export interface HoursBalanceCacheKey {
  callerUserId: number;
  month: number;
  year: number;
  requestedTeamId?: number;
}

type CachedBalance = Promise<HoursBalanceRow[] | null>;

interface CacheEntry {
  promise: CachedBalance;
}

const cloneRows = (rows: HoursBalanceRow[] | null): HoursBalanceRow[] | null =>
  rows?.map((row) => ({ ...row })) ?? null;

const serializeKey = ({
  callerUserId,
  month,
  year,
  requestedTeamId,
}: HoursBalanceCacheKey): string =>
  `${callerUserId}:${year}-${month}:${requestedTeamId ?? "all"}`;

/**
 * Prozesslokaler Promise-Cache, dessen Inhalt an eine gemeinsame PostgreSQL-
 * Generation gebunden ist.
 *
 * Nach relevanten Schreibzugriffen wird die Generation vor der HTTP-Antwort
 * hochgezählt. Dadurch verwerfen auch andere API-Instanzen ihre lokalen
 * Ergebnisse vor dem nächsten Read, ohne ein zeitbasiertes Stale-Fenster.
 */
export class HoursBalanceCache {
  private readonly entries = new Map<string, CacheEntry>();
  private databaseVersion: string | null = null;

  constructor(private readonly maxEntries = 100) {}

  async get(
    key: HoursBalanceCacheKey,
    databaseVersion: string,
    load: () => CachedBalance,
  ): Promise<HoursBalanceRow[] | null> {
    if (databaseVersion !== this.databaseVersion) {
      this.entries.clear();
      this.databaseVersion = databaseVersion;
    }

    const serializedKey = serializeKey(key);
    let entry = this.entries.get(serializedKey);
    if (!entry) {
      if (this.entries.size >= this.maxEntries) {
        const oldestKey = this.entries.keys().next().value as string | undefined;
        if (oldestKey !== undefined) this.entries.delete(oldestKey);
      }

      const promise = load();
      entry = { promise };
      this.entries.set(serializedKey, entry);

      void promise
        .then((rows) => {
          // Fehlende/unerlaubte Scopes nie cachen. Mitgliedschaften können sich
          // ändern; eine spätere Anfrage soll dann den Scope frisch auflösen.
          if (rows === null && this.entries.get(serializedKey) === entry) {
            this.entries.delete(serializedKey);
          }
        })
        .catch(() => {
          // Ein transient fehlgeschlagener Read darf den Schlüssel nicht bis
          // zur nächsten DB-Schreibtransaktion vergiften.
          if (this.entries.get(serializedKey) === entry) {
            this.entries.delete(serializedKey);
          }
        });
    }

    // dashboard/my-hours-balance blendet Lohnfelder durch Mutation aus.
    // Deshalb erhält jeder Verbraucher eine eigene flache Kopie des reinen,
    // ausschließlich aus primitiven Feldern bestehenden DTOs.
    return cloneRows(await entry.promise);
  }

  clear(): void {
    this.entries.clear();
    this.databaseVersion = null;
  }
}