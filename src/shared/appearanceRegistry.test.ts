import { describe, it, expect } from "vitest";
import { createAppearanceRegistry } from "./appearanceRegistry";
import { BUILTIN_APPEARANCES } from "./petAppearances";
import type { CustomAppearanceManifest } from "./customAppearance";

const customs: Record<string, CustomAppearanceManifest> = {
  "my-cat": {
    id: "my-cat",
    name: "My Cat",
    createdAt: 1,
    updatedAt: 1,
    assets: {
      idle: "idle.gif",
      happy: "happy.gif",
      sad: "sad.gif",
    },
    version: 1,
  },
  "empty-pet": {
    id: "empty-pet",
    name: "Empty",
    createdAt: 2,
    updatedAt: 2,
    assets: {},
    version: 1,
  },
};

describe("AppearanceRegistry.resolve", () => {
  it("routes builtin id to BUILTIN_APPEARANCES", () => {
    const registry = createAppearanceRegistry(customs);
    const def = registry.resolve("lineDog", "idle");
    const expected = BUILTIN_APPEARANCES.lineDog.states.idle;
    expect(def).toEqual(expected);
  });

  it("returns custom asset when state is set", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.resolve("custom:my-cat", "happy")).toEqual({
      path: "pet-assets://custom/my-cat/happy.gif",
    });
  });

  it("falls back via STATE_FALLBACKS when state missing", () => {
    const registry = createAppearanceRegistry(customs);
    // breakDone -> happy via STATE_FALLBACKS
    expect(registry.resolve("custom:my-cat", "breakDone")).toEqual({
      path: "pet-assets://custom/my-cat/happy.gif",
    });
  });

  it("falls back to idle when no STATE_FALLBACKS hit", () => {
    const registry = createAppearanceRegistry(customs);
    // sitting has no fallback in STATE_FALLBACKS, falls back to idle
    expect(registry.resolve("custom:my-cat", "sitting")).toEqual({
      path: "pet-assets://custom/my-cat/idle.gif",
    });
  });

  it("falls back to lineDog idle when custom manifest is empty", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.resolve("custom:empty-pet", "happy")).toEqual(
      BUILTIN_APPEARANCES.lineDog.states.idle
    );
  });

  it("falls back to lineDog idle when custom id does not exist", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.resolve("custom:does-not-exist", "happy")).toEqual(
      BUILTIN_APPEARANCES.lineDog.states.idle
    );
  });

  it("falls back to lineDog idle when registry has no customs at all", () => {
    const registry = createAppearanceRegistry({});
    expect(registry.resolve("custom:any", "idle")).toEqual(
      BUILTIN_APPEARANCES.lineDog.states.idle
    );
  });
});

describe("AppearanceRegistry.listAll", () => {
  it("returns builtin + custom ids in zh-CN", () => {
    const registry = createAppearanceRegistry(customs);
    const list = registry.listAll("zh-CN");
    expect(list).toContainEqual({ value: "lovartPuppy", label: "金毛 puppy (beta)" });
    expect(list).toContainEqual({ value: "lineDog", label: "线条小狗" });
    expect(list).toContainEqual({ value: "custom:my-cat", label: "My Cat" });
    expect(list).toContainEqual({ value: "custom:empty-pet", label: "Empty" });
  });

  it("uses English labels in en", () => {
    const registry = createAppearanceRegistry(customs);
    const list = registry.listAll("en");
    expect(list).toContainEqual({ value: "lineDog", label: "Line Dog" });
  });
});

describe("AppearanceRegistry.getSpecies", () => {
  it("returns species from BUILTIN_APPEARANCES for builtin ids", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.getSpecies("lineDog")).toBe("dog");
    expect(registry.getSpecies("lovartPuppy")).toBe("dog");
  });

  it("returns dog for custom ids in v1", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.getSpecies("custom:my-cat")).toBe("dog");
  });
});

describe("AppearanceRegistry.hasAppearance", () => {
  it("returns true for known builtin and known custom", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.hasAppearance("lineDog")).toBe(true);
    expect(registry.hasAppearance("custom:my-cat")).toBe(true);
  });

  it("returns false for unknown custom", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.hasAppearance("custom:nope")).toBe(false);
  });
});