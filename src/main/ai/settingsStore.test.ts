import { describe, it, expect, beforeEach } from "vitest";
import { AiSettingsStore } from "./settingsStore";
import type { AiSettings } from "../../shared/ai/types";
import { DEFAULT_AI_SETTINGS } from "../../shared/ai-defaults";

/**
 * In-memory fake of electron-store's tiny surface. We only use
 * `get(key)` / `set(key, value)` / `delete(key)` so a Map is enough.
 */
function makeFakeStore(): {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
} {
  const map = new Map<string, unknown>();
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: unknown) => {
      map.set(key, value);
    },
    delete: (key: string) => {
      map.delete(key);
    },
    has: (key: string) => map.has(key),
  };
}

describe("AiSettingsStore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fake: any;
  let store: AiSettingsStore;

  beforeEach(() => {
    fake = makeFakeStore();
    store = new AiSettingsStore(fake);
  });

  it("load returns defaults when storage is empty", () => {
    const settings = store.load();
    expect(settings.profiles.length).toBeGreaterThan(0);
    expect(settings.activeProfileId).toBe(settings.profiles[0].id);
    expect(settings.profiles.map((p) => p.id)).toContain("deepseek");
  });

  it("save then load round-trips", () => {
    const next: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      apiKey: "sk-roundtrip",
      systemPrompt: "test prompt",
    };
    store.save(next);
    const loaded = store.load();
    expect(loaded.apiKey).toBe("sk-roundtrip");
    expect(loaded.systemPrompt).toBe("test prompt");
  });

  it("save syncs top-level fields back into profiles[activeProfileId]", () => {
    const initial = store.load(); // seeded defaults
    const edited: AiSettings = {
      ...initial,
      apiKey: "sk-EDITED",
      model: "edited-model",
    };
    store.save(edited);

    const loaded = store.load();
    const active = loaded.profiles.find((p) => p.id === loaded.activeProfileId)!;
    expect(active.apiKey).toBe("sk-EDITED");
    expect(active.model).toBe("edited-model");
  });

  it("load self-heals empty profiles by seeding a default", () => {
    fake.set("ai", {
      baseUrl: "https://x",
      apiKey: "sk",
      model: "m",
      temperature: 0.5,
      maxContextMessages: 10,
      systemPrompt: "hi",
      requestTimeoutMs: 60_000,
      profiles: [],
      activeProfileId: "",
    });
    const loaded = store.load();
    expect(loaded.profiles.length).toBe(1);
    expect(loaded.profiles[0].id).toBe("default");
    expect(loaded.activeProfileId).toBe("default");
    expect(loaded.profiles[0].apiKey).toBe("sk");
  });

  it("load self-heals unknown activeProfileId to first profile", () => {
    fake.set("ai", {
      ...DEFAULT_AI_SETTINGS,
      activeProfileId: "ghost",
    });
    const loaded = store.load();
    expect(loaded.activeProfileId).toBe(DEFAULT_AI_SETTINGS.profiles[0].id);
  });

  it("load returns defaults on corrupt JSON / schema violation", () => {
    fake.set("ai", { not: "valid", at: ["all"] });
    const loaded = store.load();
    expect(loaded.profiles.length).toBeGreaterThan(0);
    expect(loaded.profiles.map((p) => p.id)).toContain("deepseek");
  });

  it("load returns defaults when ai key is missing entirely", () => {
    // fake is fresh in beforeEach => no "ai" key at all
    const loaded = store.load();
    expect(loaded.activeProfileId).toBe(DEFAULT_AI_SETTINGS.activeProfileId);
  });

  it("save throws on schema violation (e.g. negative temperature)", () => {
    const bad = {
      ...DEFAULT_AI_SETTINGS,
      temperature: -1,
    } as unknown as AiSettings;
    expect(() => store.save(bad)).toThrow();
  });

  it("clear removes the ai key from storage", () => {
    store.save(DEFAULT_AI_SETTINGS);
    expect(fake.has("ai")).toBe(true);
    store.clear();
    expect(fake.has("ai")).toBe(false);
  });

  it("load → save → load is idempotent", () => {
    const a = store.load();
    store.save(a);
    const b = store.load();
    expect(b).toEqual(a);
  });
});
