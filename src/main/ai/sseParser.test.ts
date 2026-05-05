import { describe, it, expect } from "vitest";
import { parseSseChunk } from "./sseParser";

describe("parseSseChunk", () => {
  it("returns no events when buffer has no terminator", () => {
    const result = parseSseChunk("data: hello");
    expect(result.events).toEqual([]);
    expect(result.remainder).toBe("data: hello");
  });

  it("parses a single complete event", () => {
    const result = parseSseChunk("data: hello\n\n");
    expect(result.events).toEqual([{ data: "hello" }]);
    expect(result.remainder).toBe("");
  });

  it("parses multiple events in one chunk", () => {
    const result = parseSseChunk("data: a\n\ndata: b\n\ndata: c\n\n");
    expect(result.events.map((e) => e.data)).toEqual(["a", "b", "c"]);
    expect(result.remainder).toBe("");
  });

  it("returns incomplete trailing fragment as remainder", () => {
    const result = parseSseChunk("data: a\n\ndata: par");
    expect(result.events).toEqual([{ data: "a" }]);
    expect(result.remainder).toBe("data: par");
  });

  it("handles [DONE] terminator as a normal data event", () => {
    const result = parseSseChunk("data: [DONE]\n\n");
    expect(result.events).toEqual([{ data: "[DONE]" }]);
  });

  it("ignores SSE comments (lines starting with :)", () => {
    const result = parseSseChunk(": ping\ndata: real\n\n");
    expect(result.events).toEqual([{ data: "real" }]);
  });

  it("ignores non-data fields (event:, id:, retry:)", () => {
    const result = parseSseChunk("event: foo\nid: 123\nretry: 5000\ndata: actual\n\n");
    expect(result.events).toEqual([{ data: "actual" }]);
  });

  it("joins multiple data: lines with newline", () => {
    const result = parseSseChunk("data: line1\ndata: line2\n\n");
    expect(result.events).toEqual([{ data: "line1\nline2" }]);
  });

  it("strips exactly one leading space after data:", () => {
    const result = parseSseChunk("data:   3spaces\n\n");
    // First leading space stripped; "  3spaces" remains.
    expect(result.events).toEqual([{ data: "  3spaces" }]);
  });

  it("preserves data: with no space (data:foo)", () => {
    const result = parseSseChunk("data:foo\n\n");
    expect(result.events).toEqual([{ data: "foo" }]);
  });

  it("normalizes CRLF to LF", () => {
    const result = parseSseChunk("data: a\r\n\r\ndata: b\r\n\r\n");
    expect(result.events.map((e) => e.data)).toEqual(["a", "b"]);
    expect(result.remainder).toBe("");
  });

  it("supports cross-chunk reassembly via remainder", () => {
    // Simulate stream split mid-event.
    const chunk1 = "data: hel";
    const chunk2 = "lo\n\ndata: world\n\n";
    const r1 = parseSseChunk(chunk1);
    expect(r1.events).toEqual([]);
    expect(r1.remainder).toBe("data: hel");

    const r2 = parseSseChunk(r1.remainder + chunk2);
    expect(r2.events.map((e) => e.data)).toEqual(["hello", "world"]);
    expect(r2.remainder).toBe("");
  });

  it("skips events that have no data: lines", () => {
    // Only comment + newline = no data lines, event dropped.
    const result = parseSseChunk(": heartbeat\n\ndata: real\n\n");
    expect(result.events).toEqual([{ data: "real" }]);
  });

  it("handles empty data line as empty string", () => {
    const result = parseSseChunk("data:\n\n");
    expect(result.events).toEqual([{ data: "" }]);
  });

  it("does not mutate input buffer", () => {
    const buf = "data: hi\n\n";
    parseSseChunk(buf);
    expect(buf).toBe("data: hi\n\n");
  });
});
