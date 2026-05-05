import { describe, it, expect } from "vitest";
import { applySettingsToCache } from "./chatCacheReloader";
import type { AiSettings, ChatMessage } from "./types";

const baseSettings: AiSettings = {
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

function msg(role: ChatMessage["role"], content: string, id = `${role}-${content}`): ChatMessage {
  return { id, role, content, createdAt: 0 };
}

describe("applySettingsToCache", () => {
  it("returns empty array when both cache and prompt are empty", () => {
    const result = applySettingsToCache([], { ...baseSettings, systemPrompt: "" });
    expect(result).toEqual([]);
  });

  it("prepends system message when systemPrompt is non-empty", () => {
    const result = applySettingsToCache(
      [msg("user", "hi")],
      { ...baseSettings, systemPrompt: "you are a pet" }
    );
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("you are a pet");
    expect(result[1].role).toBe("user");
  });

  it("does NOT prepend system when systemPrompt is empty or whitespace", () => {
    const result1 = applySettingsToCache([msg("user", "hi")], { ...baseSettings, systemPrompt: "" });
    const result2 = applySettingsToCache([msg("user", "hi")], { ...baseSettings, systemPrompt: "   " });
    expect(result1.find((m) => m.role === "system")).toBeUndefined();
    expect(result2.find((m) => m.role === "system")).toBeUndefined();
  });

  it("removes old system messages before adding new one", () => {
    const result = applySettingsToCache(
      [msg("system", "OLD"), msg("user", "hi"), msg("assistant", "yo")],
      { ...baseSettings, systemPrompt: "NEW" }
    );
    const systems = result.filter((m) => m.role === "system");
    expect(systems.length).toBe(1);
    expect(systems[0].content).toBe("NEW");
  });

  it("removes system entirely when prompt becomes empty", () => {
    const result = applySettingsToCache(
      [msg("system", "OLD"), msg("user", "hi")],
      { ...baseSettings, systemPrompt: "" }
    );
    expect(result.find((m) => m.role === "system")).toBeUndefined();
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
  });

  it("trims to maxContextMessages keeping system + most recent others", () => {
    const cache: ChatMessage[] = [
      msg("user", "u1"),
      msg("assistant", "a1"),
      msg("user", "u2"),
      msg("assistant", "a2"),
      msg("user", "u3"),
    ];
    const result = applySettingsToCache(cache, {
      ...baseSettings,
      systemPrompt: "S",
      maxContextMessages: 3,
    });
    expect(result.length).toBe(3);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toBe("a2");
    expect(result[2].content).toBe("u3");
  });

  it("clamps maxContextMessages < 2 up to 2", () => {
    const cache: ChatMessage[] = [
      msg("user", "u1"),
      msg("assistant", "a1"),
      msg("user", "u2"),
    ];
    const result = applySettingsToCache(cache, {
      ...baseSettings,
      systemPrompt: "",
      maxContextMessages: 0,
    });
    expect(result.length).toBe(2);
    expect(result[0].content).toBe("a1");
    expect(result[1].content).toBe("u2");
  });

  it("clamps maxContextMessages = 1 up to 2", () => {
    const cache: ChatMessage[] = [
      msg("user", "u1"),
      msg("assistant", "a1"),
      msg("user", "u2"),
    ];
    const result = applySettingsToCache(cache, {
      ...baseSettings,
      systemPrompt: "",
      maxContextMessages: 1,
    });
    expect(result.length).toBe(2);
  });

  it("does not mutate input cache", () => {
    const cache: ChatMessage[] = [msg("user", "u1")];
    const before = JSON.stringify(cache);
    applySettingsToCache(cache, { ...baseSettings, systemPrompt: "S", maxContextMessages: 5 });
    expect(JSON.stringify(cache)).toBe(before);
  });

  it("returns same content when cache size already <= max", () => {
    const cache: ChatMessage[] = [msg("user", "u1"), msg("assistant", "a1")];
    const result = applySettingsToCache(cache, {
      ...baseSettings,
      systemPrompt: "",
      maxContextMessages: 10,
    });
    expect(result).toEqual(cache);
    expect(result).not.toBe(cache); // new array though
  });

  it("system message budget reduces room for others", () => {
    const cache: ChatMessage[] = Array.from({ length: 10 }, (_, i) => msg("user", `u${i}`));
    const result = applySettingsToCache(cache, {
      ...baseSettings,
      systemPrompt: "S",
      maxContextMessages: 5, // budget = 5; system takes 1; 4 user msgs survive
    });
    expect(result.length).toBe(5);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toBe("u6");
    expect(result[4].content).toBe("u9");
  });

  it("max=2 with system keeps only 1 non-system", () => {
    const cache: ChatMessage[] = [
      msg("user", "u1"),
      msg("assistant", "a1"),
      msg("user", "u2"),
    ];
    const result = applySettingsToCache(cache, {
      ...baseSettings,
      systemPrompt: "S",
      maxContextMessages: 2,
    });
    expect(result.length).toBe(2);
    expect(result[0].role).toBe("system");
    expect(result[1].content).toBe("u2");
  });
});
