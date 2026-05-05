import { describe, it, expect } from "vitest";
import {
  ensureValidProfileState,
  syncTopLevelToActiveProfile,
  withActiveProfile,
} from "./profileSync";
import type { AiProvider, AiSettings } from "./types";

function profile(id: string, overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id,
    name: id,
    baseUrl: `https://api.${id}.test/v1`,
    apiKey: `sk-${id}`,
    model: `${id}-model`,
    temperature: 0.7,
    maxContextMessages: 20,
    systemPrompt: `prompt-${id}`,
    requestTimeoutMs: 120_000,
    ...overrides,
  };
}

function settingsFrom(active: AiProvider, profiles: AiProvider[]): AiSettings {
  return {
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    temperature: active.temperature,
    maxContextMessages: active.maxContextMessages,
    systemPrompt: active.systemPrompt,
    requestTimeoutMs: active.requestTimeoutMs,
    profiles,
    activeProfileId: active.id,
  };
}

// ---------- withActiveProfile ----------

describe("withActiveProfile", () => {
  it("copies target profile fields onto top-level", () => {
    const ds = profile("deepseek");
    const oa = profile("openai", { temperature: 0.33, model: "gpt-4o-mini" });
    const settings = settingsFrom(ds, [ds, oa]);

    const next = withActiveProfile(settings, "openai");

    expect(next.activeProfileId).toBe("openai");
    expect(next.baseUrl).toBe(oa.baseUrl);
    expect(next.apiKey).toBe(oa.apiKey);
    expect(next.model).toBe("gpt-4o-mini");
    expect(next.temperature).toBe(0.33);
    expect(next.systemPrompt).toBe(oa.systemPrompt);
  });

  it("does not mutate input settings", () => {
    const ds = profile("deepseek");
    const oa = profile("openai");
    const settings = settingsFrom(ds, [ds, oa]);
    const before = JSON.stringify(settings);

    withActiveProfile(settings, "openai");

    expect(JSON.stringify(settings)).toBe(before);
  });

  it("throws on unknown id", () => {
    const ds = profile("deepseek");
    const settings = settingsFrom(ds, [ds]);
    expect(() => withActiveProfile(settings, "ghost")).toThrow(/ghost/);
  });

  it("throws on empty id", () => {
    const ds = profile("deepseek");
    const settings = settingsFrom(ds, [ds]);
    expect(() => withActiveProfile(settings, "")).toThrow();
  });

  it("throws on empty profiles list", () => {
    const ds = profile("deepseek");
    const settings = { ...settingsFrom(ds, []), activeProfileId: "" };
    expect(() => withActiveProfile(settings, "anything")).toThrow();
  });
});

// ---------- syncTopLevelToActiveProfile ----------

describe("syncTopLevelToActiveProfile", () => {
  it("writes top-level fields back into profiles[activeProfileId]", () => {
    const ds = profile("deepseek");
    const oa = profile("openai");
    const settings: AiSettings = {
      ...settingsFrom(ds, [ds, oa]),
      // Simulate the user editing the form (top-level differs from profiles[ds].
      baseUrl: "https://edited.test/v2",
      apiKey: "sk-edited",
      model: "edited-model",
      temperature: 0.91,
      maxContextMessages: 42,
      systemPrompt: "edited prompt",
      requestTimeoutMs: 75_000,
    };

    const next = syncTopLevelToActiveProfile(settings);

    const active = next.profiles.find((p) => p.id === "deepseek")!;
    expect(active.baseUrl).toBe("https://edited.test/v2");
    expect(active.apiKey).toBe("sk-edited");
    expect(active.model).toBe("edited-model");
    expect(active.temperature).toBe(0.91);
    expect(active.maxContextMessages).toBe(42);
    expect(active.systemPrompt).toBe("edited prompt");
    expect(active.requestTimeoutMs).toBe(75_000);
    // Inactive profile unchanged.
    const inactive = next.profiles.find((p) => p.id === "openai")!;
    expect(inactive).toEqual(oa);
  });

  it("returns same settings (reference may differ) when profiles empty", () => {
    const ds = profile("deepseek");
    const settings: AiSettings = { ...settingsFrom(ds, []), activeProfileId: "" };
    const next = syncTopLevelToActiveProfile(settings);
    expect(next).toBe(settings); // exact same ref because we early-return
  });

  it("returns input when activeProfileId not in list", () => {
    const ds = profile("deepseek");
    const settings: AiSettings = { ...settingsFrom(ds, [ds]), activeProfileId: "ghost" };
    const next = syncTopLevelToActiveProfile(settings);
    expect(next).toBe(settings);
  });

  it("does not mutate input", () => {
    const ds = profile("deepseek");
    const oa = profile("openai");
    const settings: AiSettings = {
      ...settingsFrom(ds, [ds, oa]),
      apiKey: "sk-new",
    };
    const before = JSON.stringify(settings);
    syncTopLevelToActiveProfile(settings);
    expect(JSON.stringify(settings)).toBe(before);
  });
});

// ---------- ensureValidProfileState ----------

describe("ensureValidProfileState", () => {
  it("seeds default profile when profiles is empty", () => {
    const settings: AiSettings = {
      baseUrl: "https://x",
      apiKey: "sk",
      model: "m",
      temperature: 0.5,
      maxContextMessages: 10,
      systemPrompt: "hi",
      requestTimeoutMs: 60_000,
      profiles: [],
      activeProfileId: "",
    };
    const next = ensureValidProfileState(settings);
    expect(next.profiles.length).toBe(1);
    expect(next.profiles[0].id).toBe("default");
    expect(next.profiles[0].name).toBe("Default");
    expect(next.profiles[0].baseUrl).toBe("https://x");
    expect(next.profiles[0].apiKey).toBe("sk");
    expect(next.profiles[0].systemPrompt).toBe("hi");
    expect(next.activeProfileId).toBe("default");
  });

  it("self-heals unknown activeProfileId to first profile", () => {
    const ds = profile("deepseek");
    const oa = profile("openai");
    const settings: AiSettings = { ...settingsFrom(ds, [ds, oa]), activeProfileId: "ghost" };
    const next = ensureValidProfileState(settings);
    expect(next.activeProfileId).toBe("deepseek");
    expect(next.baseUrl).toBe(ds.baseUrl);
  });

  it("self-heals empty activeProfileId to first profile", () => {
    const ds = profile("deepseek");
    const settings: AiSettings = { ...settingsFrom(ds, [ds]), activeProfileId: "" };
    const next = ensureValidProfileState(settings);
    expect(next.activeProfileId).toBe("deepseek");
  });

  it("returns input unchanged when state already valid", () => {
    const ds = profile("deepseek");
    const settings: AiSettings = settingsFrom(ds, [ds]);
    const next = ensureValidProfileState(settings);
    expect(next).toBe(settings);
  });

  it("is idempotent", () => {
    const settings: AiSettings = {
      baseUrl: "https://x",
      apiKey: "",
      model: "m",
      temperature: 0.7,
      maxContextMessages: 20,
      systemPrompt: "",
      requestTimeoutMs: 120_000,
      profiles: [],
      activeProfileId: "",
    };
    const a = ensureValidProfileState(settings);
    const b = ensureValidProfileState(a);
    expect(b).toEqual(a);
  });
});
