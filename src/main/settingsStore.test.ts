import { describe, it, expect, beforeEach } from "vitest";
import { SettingsStore } from "./settingsStore";
import { DEFAULT_SETTINGS } from "../shared/constants";
import type { Settings } from "../shared/types";

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

describe("SettingsStore.get", () => {
  let fake: FakeStore;
  let store: SettingsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new SettingsStore(fake as any);
  });

  it("returns DEFAULT_SETTINGS when storage is empty", () => {
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges stored partial over defaults", () => {
    fake.set("settings", {
      ...DEFAULT_SETTINGS,
      breakIntervalMinutes: 60
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new SettingsStore(fake as any);
    const got = fresh.get();
    expect(got.breakIntervalMinutes).toBe(60);
    expect(got.language).toBe(DEFAULT_SETTINGS.language);
  });

  it("normalises bogus language to default", () => {
    fake.set("settings", { ...DEFAULT_SETTINGS, language: "klingon" as unknown as Settings["language"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new SettingsStore(fake as any);
    expect(fresh.get().language).toBe("zh-CN");
  });

  it("normalises unknown petAppearanceId to lovartPuppy", () => {
    fake.set("settings", {
      ...DEFAULT_SETTINGS,
      petAppearanceId: "ghost-pet" as unknown as Settings["petAppearanceId"]
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new SettingsStore(fake as any);
    expect(fresh.get().petAppearanceId).toBe("lovartPuppy");
  });

  it("preserves a known petAppearanceId verbatim", () => {
    fake.set("settings", { ...DEFAULT_SETTINGS, petAppearanceId: "lineDog" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new SettingsStore(fake as any);
    expect(fresh.get().petAppearanceId).toBe("lineDog");
  });
});

describe("SettingsStore.set", () => {
  let fake: FakeStore;
  let store: SettingsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new SettingsStore(fake as any);
  });

  it("persists to storage and returns the normalised value", () => {
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      focusDurationMinutes: 50
    };
    const returned = store.set(next);
    expect(returned.focusDurationMinutes).toBe(50);
    expect(fake.get("settings")).toEqual(returned);
  });

  it("normalises language and petAppearanceId on write", () => {
    const dirty = {
      ...DEFAULT_SETTINGS,
      language: "fr" as unknown as Settings["language"],
      petAppearanceId: "no-such-pet" as unknown as Settings["petAppearanceId"]
    };
    const saved = store.set(dirty);
    expect(saved.language).toBe("zh-CN");
    expect(saved.petAppearanceId).toBe("lovartPuppy");
  });

  it("round-trips: set then get returns equivalent value", () => {
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      hydrationIntervalMinutes: 120,
      onboardingDismissed: true
    };
    store.set(next);
    expect(store.get()).toEqual(next);
  });
});

describe("SettingsStore.patch", () => {
  let fake: FakeStore;
  let store: SettingsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new SettingsStore(fake as any);
  });

  it("merges partial with current and persists", () => {
    const before = store.get();
    const after = store.patch({ breakIntervalMinutes: 30 });
    expect(after.breakIntervalMinutes).toBe(30);
    expect(after.language).toBe(before.language);
    expect(store.get().breakIntervalMinutes).toBe(30);
  });

  it("normalises bad fields in the patch", () => {
    const after = store.patch({
      petAppearanceId: "ghost" as unknown as Settings["petAppearanceId"]
    });
    expect(after.petAppearanceId).toBe("lovartPuppy");
  });
});

describe("SettingsStore petPosition", () => {
  let fake: FakeStore;
  let store: SettingsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new SettingsStore(fake as any);
  });

  it("returns undefined when never written", () => {
    expect(store.getPetPosition()).toBeUndefined();
  });

  it("round-trips a position", () => {
    store.setPetPosition({ x: 200, y: 300 });
    expect(store.getPetPosition()).toEqual({ x: 200, y: 300 });
    expect(fake.get("petPosition")).toEqual({ x: 200, y: 300 });
  });

  it("overwrites on second write", () => {
    store.setPetPosition({ x: 1, y: 2 });
    store.setPetPosition({ x: 9, y: 9 });
    expect(store.getPetPosition()).toEqual({ x: 9, y: 9 });
  });

  it("round-trips a position with displayId", () => {
    store.setPetPosition({ x: 100, y: 200, displayId: 12345 });
    expect(store.getPetPosition()).toEqual({ x: 100, y: 200, displayId: 12345 });
  });

  it("reads a legacy position without displayId as undefined displayId", () => {
    fake.set("petPosition", { x: 50, y: 60 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new SettingsStore(fake as any);
    const pos = fresh.getPetPosition();
    expect(pos).toEqual({ x: 50, y: 60 });
    expect(pos?.displayId).toBeUndefined();
  });

  it("dropping displayId on second write replaces previous", () => {
    store.setPetPosition({ x: 1, y: 2, displayId: 99 });
    store.setPetPosition({ x: 3, y: 4 });
    const got = store.getPetPosition();
    expect(got).toEqual({ x: 3, y: 4 });
    expect(got?.displayId).toBeUndefined();
  });
});
