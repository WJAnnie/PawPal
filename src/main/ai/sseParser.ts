/**
 * Pure-function SSE chunk parser for OpenAI-compatible streaming responses.
 *
 * The HTTP response body arrives as Uint8Array chunks of arbitrary boundaries.
 * Caller decodes those chunks to UTF-8 and feeds the accumulated string here.
 * We extract complete SSE events and return any incomplete trailing fragment
 * as `remainder` so the caller can prepend it to the next chunk.
 *
 * SSE event format (subset OpenAI uses):
 *   data: {...}\n
 *   data: {...}\n
 *   \n                  ← blank line ends the event
 *
 * We also handle the special terminator:
 *   data: [DONE]\n\n
 */

export interface SseEvent {
  data: string;
}

export interface SseParseResult {
  events: SseEvent[];
  remainder: string;
}

/**
 * Parse a buffer that may contain zero or more complete SSE events plus an
 * incomplete tail. Never throws; events with malformed (non-`data:`) lines
 * are still returned with `data: ""` so the caller can decide whether to skip.
 */
export function parseSseChunk(buffer: string): SseParseResult {
  const events: SseEvent[] = [];

  // Normalize CRLF to LF so we only split on \n\n.
  const normalized = buffer.replace(/\r\n/g, "\n");

  let cursor = 0;
  while (cursor < normalized.length) {
    const sepIdx = normalized.indexOf("\n\n", cursor);
    if (sepIdx === -1) break;

    const rawEvent = normalized.slice(cursor, sepIdx);
    cursor = sepIdx + 2;

    // Concatenate all `data:` lines per spec; ignore comments (lines starting with ':')
    // and any other field names (event:, id:, retry:) which OpenAI does not use.
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith(":")) continue; // SSE comment
      if (line.startsWith("data:")) {
        // Per spec: strip ONE leading space after the colon if present.
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
      // Any other line (event:/id:/retry:/blank) is ignored for our use.
    }

    if (dataLines.length > 0) {
      events.push({ data: dataLines.join("\n") });
    }
  }

  return { events, remainder: normalized.slice(cursor) };
}
