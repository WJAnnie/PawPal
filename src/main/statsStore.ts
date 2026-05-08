import Store from "electron-store";
import { createEmptyStats, todayKey } from "../shared/constants";
import type { StatsHistory, TodayStats } from "../shared/types";

interface RootStoreSchema {
  stats?: TodayStats;
  statsHistory?: StatsHistory;
}

const STATS_KEY = "stats";
const HISTORY_KEY = "statsHistory";

/**
 * Persists daily activity stats with automatic day rollover.
 *
 * On every read of today's stats:
 * - If stored.date == today: return as-is (cached + persisted to history idempotently).
 * - If stored.date != today: archive stored into statsHistory, seed today
 *   from history (or create empty), persist both.
 *
 * Owns:
 * - cache + persist of TodayStats
 * - day rollover detection
 * - statsHistory deduping (only writes when content differs)
 *
 * Does NOT own:
 * - "muted today" runtime flags (caller's concern)
 * - stats:updated IPC broadcast (caller wires it)
 */
export class StatsStore {
  private readonly store: Store<RootStoreSchema>;
  private todayCache: TodayStats;

  constructor(store?: Store<RootStoreSchema>) {
    this.store =
      store ??
      (new Store<RootStoreSchema>({ name: "pawpal" }) as Store<RootStoreSchema>);
    this.todayCache = this.loadTodayWithRollover();
  }

  getToday(): TodayStats {
    // Re-check rollover lazily; the cache may have been set on a previous day
    // for long-running sessions.
    if (this.todayCache.date !== todayKey()) {
      this.todayCache = this.loadTodayWithRollover();
    } else {
      this.saveToHistory(this.todayCache);
    }
    return this.todayCache;
  }

  updateToday(mutator: (current: TodayStats) => TodayStats): TodayStats {
    const next = mutator(this.getToday());
    this.todayCache = next;
    this.store.set(STATS_KEY, next);
    this.saveToHistory(next);
    return next;
  }

  resetToday(): TodayStats {
    const reset = createEmptyStats();
    this.todayCache = reset;
    this.store.set(STATS_KEY, reset);
    this.saveToHistory(reset);
    return reset;
  }

  getHistory(): StatsHistory {
    return (this.store.get(HISTORY_KEY) as StatsHistory | undefined) ?? {};
  }

  private loadTodayWithRollover(): TodayStats {
    const today = todayKey();
    const stored = this.store.get(STATS_KEY) as TodayStats | undefined;
    if (stored && stored.date === today) {
      this.saveToHistory(stored);
      return stored;
    }

    if (stored) {
      this.saveToHistory(stored); // archive yesterday's last value
    }
    const fromHistory = this.getHistory()[today];
    const current = fromHistory ?? createEmptyStats(today);
    this.store.set(STATS_KEY, current);
    this.saveToHistory(current);
    return current;
  }

  private saveToHistory(stats: TodayStats): void {
    if (!stats.date) return;
    const history = this.getHistory();
    if (isSameStats(history[stats.date], stats)) return;
    this.store.set(HISTORY_KEY, {
      ...history,
      [stats.date]: stats
    });
  }
}

function isSameStats(left: TodayStats | undefined, right: TodayStats): boolean {
  return Boolean(
    left &&
      left.date === right.date &&
      left.breaksTaken === right.breaksTaken &&
      left.watersLogged === right.watersLogged &&
      left.focusMinutes === right.focusMinutes &&
      left.focusWarnings === right.focusWarnings
  );
}
