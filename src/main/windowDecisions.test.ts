import { describe, it, expect } from "vitest";
import {
  resolvePassthrough,
  resolveStoredDisplayId,
  type DisplayLike
} from "./windowDecisions";

describe("resolvePassthrough", () => {
  it("returns true when compact and renderer wants passthrough", () => {
    expect(resolvePassthrough("compact", true)).toBe(true);
  });

  it("returns false when compact but renderer wants events", () => {
    expect(resolvePassthrough("compact", false)).toBe(false);
  });

  it("returns false in panel mode regardless of renderer intent", () => {
    expect(resolvePassthrough("panel", true)).toBe(false);
    expect(resolvePassthrough("panel", false)).toBe(false);
  });

  it("returns false in chat mode regardless of renderer intent", () => {
    expect(resolvePassthrough("chat", true)).toBe(false);
    expect(resolvePassthrough("chat", false)).toBe(false);
  });
});

describe("resolveStoredDisplayId", () => {
  const primary: DisplayLike = { id: 1 };
  const second: DisplayLike = { id: 2 };
  const third: DisplayLike = { id: 3 };
  const all = [primary, second, third];

  it("returns the matched display when displayId hits", () => {
    expect(resolveStoredDisplayId(2, all, primary)).toBe(second);
    expect(resolveStoredDisplayId(3, all, primary)).toBe(third);
  });

  it("falls back to primary when displayId is missing", () => {
    expect(resolveStoredDisplayId(99, all, primary)).toBe(primary);
  });

  it("falls back to primary when displayId is undefined", () => {
    expect(resolveStoredDisplayId(undefined, all, primary)).toBe(primary);
  });

  it("falls back to primary when displays list is empty", () => {
    expect(resolveStoredDisplayId(1, [], primary)).toBe(primary);
  });

  it("works with extra fields on Display-like objects", () => {
    interface RichDisplay extends DisplayLike {
      label: string;
    }
    const rich: RichDisplay[] = [
      { id: 100, label: "left" },
      { id: 200, label: "right" }
    ];
    expect(resolveStoredDisplayId(200, rich, rich[0])).toEqual({
      id: 200,
      label: "right"
    });
  });
});
