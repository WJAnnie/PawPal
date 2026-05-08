import { describe, it, expect, beforeEach } from "vitest";
import { StatsStore } from "./statsStore";
import { createEmptyStats, todayKey } from "../shared/constants";
import type { TodayStats } from "../shared/types";

interface FakeStore {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
}

function makeFakeStore(): FakeStore {
  const map = new Map<string, unknown>();
  return {
    get: (key, defaultValue) => (map.has(key) ? map.get(key) : defaultValue),
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    has: (key) => map.has(key)
  };
}

describe("StatsStore.getToday", () => {
  let fake: FakeStore;
  let store: StatsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new StatsStore(fake as any);
  });

  it("returns empty stats when storage is empty", () => {
    const got = store.getToday();
    expect(got.date).toBe(todayKey());
    expect(got.breaksTaken).toBe(0);
    expect(got.watersLogged).toBe(0);
    expect(got.focusMinutes).toBe(0);
    expect(got.focusWarnings).toBe(0);
  });

  it("returns same-day cached stats verbatim", () => {
    const today = todayKey();
    const seeded: TodayStats = {
      date: today,
      breaksTaken: 3,
      watersLogged: 2,
      focusMinutes: 50,
      focusWarnings: 1
    };
    fake.set("stats", seeded);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new StatsStore(fake as any);
    expect(fresh.getToday()).toEqual(seeded);
  });

  it("rolls over when stored date is yesterday: archives old + emits empty new", () => {
    const yesterday: TodayStats = {
      date: "2020-01-01",
      breaksTaken: 5,
      watersLogged: 4,
      focusMinutes: 100,
      focusWarnings: 2
    };
    fake.set("stats", yesterday);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new StatsStore(fake as any);

    const today = fresh.getToday();
    expect(today.date).toBe(todayKey());
    expect(today.breaksTaken).toBe(0);

    const history = fresh.getHistory();
    expect(history["2020-01-01"]).toEqual(yesterday);
    expect(history[todayKey()]).toEqual(today);
  });
});

describe("StatsStore.updateToday", () => {
  let fake: FakeStore;
  let store: StatsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new StatsStore(fake as any);
  });

  it("applies mutator and persists result", () => {
    const next = store.updateToday((s) => ({ ...s, breaksTaken: s.breaksTaken + 1 }));
    expect(next.breaksTaken).toBe(1);
    expect(store.getToday().breaksTaken).toBe(1);
    expect((fake.get("stats") as TodayStats).breaksTaken).toBe(1);
  });

  it("syncs to history on update", () => {
    store.updateToday((s) => ({ ...s, focusMinutes: 25 }));
    const history = store.getHistory();
    expect(history[todayKey()].focusMinutes).toBe(25);
  });

  it("supports chained increments", () => {
    store.updateToday((s) => ({ ...s, watersLogged: s.watersLogged + 1 }));
    store.updateToday((s) => ({ ...s, watersLogged: s.watersLogged + 1 }));
    store.updateToday((s) => ({ ...s, focusWarnings: s.focusWarnings + 1 }));
    const got = store.getToday();
    expect(got.watersLogged).toBe(2);
    expect(got.focusWarnings).toBe(1);
  });
});

describe("StatsStore.resetToday", () => {
  let fake: FakeStore;
  let store: StatsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new StatsStore(fake as any);
  });

  it("replaces today with empty stats", () => {
    store.updateToday((s) => ({ ...s, breaksTaken: 9 }));
    const reset = store.resetToday();
    expect(reset.breaksTaken).toBe(0);
    expect(reset.date).toBe(todayKey());
    expect(store.getToday().breaksTaken).toBe(0);
  });

  it("persists the reset value to history", () => {
    store.updateToday((s) => ({ ...s, breaksTaken: 9 }));
    store.resetToday();
    expect(store.getHistory()[todayKey()].breaksTaken).toBe(0);
  });
});

describe("StatsStore history dedup", () => {
  let fake: FakeStore;
  let store: StatsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new StatsStore(fake as any);
  });

  it("does not rewrite history when no field changed", () => {
    store.updateToday((s) => ({ ...s, breaksTaken: 1 }));
    const beforeHistory = store.getHistory();
    store.getToday();
    expect(store.getHistory()).toEqual(beforeHistory);
  });
});

describe("StatsStore preserves existing history on rollover", () => {
  it("does not lose existing history when constructing with stale stored stats", () => {
    const fake = makeFakeStore();
    const oldHistory = {
      "2020-01-01": createEmptyStats("2020-01-01"),
      "2020-01-02": createEmptyStats("2020-01-02")
    };
    fake.set("statsHistory", oldHistory);
    fake.set("stats", { ...createEmptyStats("2020-01-01"), breaksTaken: 7 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new StatsStore(fake as any);
    store.getToday();

    const history = store.getHistory();
    expect(history["2020-01-01"].breaksTaken).toBe(7);
    expect(history["2020-01-02"]).toBeDefined();
    expect(history[todayKey()]).toBeDefined();
  });
});
