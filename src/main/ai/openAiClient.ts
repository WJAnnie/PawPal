import type { AiSettings, ChatMessage } from "../../shared/ai/types";
import { parseSseChunk } from "./sseParser";

/**
 * Streaming chat completion against an OpenAI-compatible endpoint.
 *
 * Caller flow:
 *   const ctrl = new AbortController();
 *   const full = await streamChatCompletion(settings, messages, onDelta, ctrl.signal);
 *
 * `onDelta` is invoked with each non-empty content chunk as it arrives.
 * Returns the concatenated final assistant text. Throws on HTTP error,
 * abort, or upstream protocol violation.
 */
export interface StreamCallbacks {
  onDelta: (delta: string) => void;
}

export async function streamChatCompletion(
  settings: AiSettings,
  messages: ReadonlyArray<ChatMessage>,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<string> {
  if (!settings.apiKey || settings.apiKey.trim().length === 0) {
    throw new Error("API key not configured. Open AI settings to add one.");
  }

  const endpoint = `${trimTrailingSlash(settings.baseUrl)}/chat/completions`;
  const requestBody = {
    model: settings.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: settings.temperature,
    stream: true,
  };

  // Wire up timeout in addition to caller's abort.
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), settings.requestTimeoutMs);
  const onCallerAbort = () => timeoutCtrl.abort();
  signal.addEventListener("abort", onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: timeoutCtrl.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCallerAbort);
    if (signal.aborted) throw new Error("Request aborted by user.");
    if (timeoutCtrl.signal.aborted) {
      throw new Error(`Request timed out after ${settings.requestTimeoutMs}ms.`);
    }
    throw new Error(`Network error: ${describeError(error)}`);
  }

  if (!response.ok) {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCallerAbort);
    const text = await safeReadText(response);
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }
  if (!response.body) {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCallerAbort);
    throw new Error("Response has no body — server may not support streaming.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSseChunk(buffer);
      buffer = remainder;
      for (const ev of events) {
        if (ev.data === "[DONE]") {
          return full;
        }
        // Tolerate non-JSON / partial events instead of failing the whole stream.
        let json: unknown;
        try {
          json = JSON.parse(ev.data);
        } catch {
          continue;
        }
        const delta = extractDelta(json);
        if (delta) {
          full += delta;
          callbacks.onDelta(delta);
        }
      }
    }
    // Flush any trailing fragment without a terminator.
    if (buffer.length > 0) {
      const final = parseSseChunk(buffer + "\n\n");
      for (const ev of final.events) {
        if (ev.data === "[DONE]") return full;
        try {
          const json = JSON.parse(ev.data);
          const delta = extractDelta(json);
          if (delta) {
            full += delta;
            callbacks.onDelta(delta);
          }
        } catch {
          // ignore
        }
      }
    }
    return full;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCallerAbort);
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

function extractDelta(json: unknown): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "choices" in json &&
    Array.isArray((json as { choices: unknown[] }).choices)
  ) {
    const first = (json as { choices: Array<{ delta?: { content?: unknown } }> }).choices[0];
    const content = first?.delta?.content;
    if (typeof content === "string") return content;
  }
  return "";
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
