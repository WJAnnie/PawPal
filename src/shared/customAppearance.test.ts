import { describe, it, expect } from "vitest";
import {
  isCustomAppearanceId,
  isBuiltinAppearanceId,
  customIdToBareId,
  bareIdToCustomId,
  validateCustomAppearanceName,
  isValidCustomAppearanceManifest,
  type CustomAppearanceManifest,
} from "./customAppearance";

describe("isCustomAppearanceId", () => {
  it("returns true for ids with custom: prefix", () => {
    expect(isCustomAppearanceId("custom:abc")).toBe(true);
    expect(isCustomAppearanceId("custom:")).toBe(true);
  });

  it("returns false for builtin ids", () => {
    expect(isCustomAppearanceId("lovartPuppy")).toBe(false);
    expect(isCustomAppearanceId("lineDog")).toBe(false);
  });
});

describe("isBuiltinAppearanceId", () => {
  it("returns true for the two builtin ids", () => {
    expect(isBuiltinAppearanceId("lovartPuppy")).toBe(true);
    expect(isBuiltinAppearanceId("lineDog")).toBe(true);
  });

  it("returns false for custom ids", () => {
    expect(isBuiltinAppearanceId("custom:abc")).toBe(false);
  });
});

describe("customIdToBareId / bareIdToCustomId", () => {
  it("strips and re-adds the custom: prefix", () => {
    expect(customIdToBareId("custom:abc")).toBe("abc");
    expect(bareIdToCustomId("abc")).toBe("custom:abc");
  });

  it("round-trips correctly", () => {
    const id = "custom:my-cat-2026" as const;
    expect(bareIdToCustomId(customIdToBareId(id))).toBe(id);
  });
});

describe("validateCustomAppearanceName", () => {
  it("rejects empty / whitespace-only names", () => {
    expect(validateCustomAppearanceName("")).toEqual({ ok: false, reason: "empty" });
    expect(validateCustomAppearanceName("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects names longer than 30 characters", () => {
    const long = "a".repeat(31);
    expect(validateCustomAppearanceName(long)).toEqual({ ok: false, reason: "too-long" });
  });

  it("accepts normal names", () => {
    expect(validateCustomAppearanceName("My Cat")).toEqual({ ok: true });
    expect(validateCustomAppearanceName("a")).toEqual({ ok: true });
    expect(validateCustomAppearanceName("a".repeat(30))).toEqual({ ok: true });
  });
});

describe("isValidCustomAppearanceManifest", () => {
  const valid: CustomAppearanceManifest = {
    id: "abc",
    name: "Test",
    createdAt: 1,
    updatedAt: 1,
    assets: { idle: "idle.gif" },
    version: 1,
  };

  it("accepts a valid manifest", () => {
    expect(isValidCustomAppearanceManifest(valid)).toBe(true);
  });

  it("rejects null / non-object", () => {
    expect(isValidCustomAppearanceManifest(null)).toBe(false);
    expect(isValidCustomAppearanceManifest("string")).toBe(false);
    expect(isValidCustomAppearanceManifest(42)).toBe(false);
  });

  it("rejects manifests missing required fields", () => {
    expect(isValidCustomAppearanceManifest({ ...valid, id: "" })).toBe(false);
    expect(isValidCustomAppearanceManifest({ ...valid, name: "" })).toBe(false);
    expect(isValidCustomAppearanceManifest({ ...valid, version: 2 })).toBe(false);
    const noAssets = { ...valid } as Record<string, unknown>;
    delete noAssets.assets;
    expect(isValidCustomAppearanceManifest(noAssets)).toBe(false);
  });
});