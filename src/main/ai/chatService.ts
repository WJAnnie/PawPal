import { randomUUID } from "node:crypto";
import { applySettingsToCache } from "../../shared/ai/chatCacheReloader";
import type {
  AiSettings,
  ChatMessage,
  ChatSession,
} from "../../shared/ai/types";
import type { AiSettingsStore } from "./settingsStore";
import type { ChatHistoryStore } from "./chatHistory";
import { streamChatCompletion } from "./openAiClient";

/**
 * Per-request streaming context emitted from chatService.send().
 * UI subscribes via IPC; main forwards onDelta / onDone / onError to renderer.
 */
export interface StreamHandlers {
  onDelta: (delta: string) => void;
  onDone: (finalMessage: ChatMessage) => void;
  onError: (message: string) => void;
}

/**
 * Business orchestration layer between IPC handlers and the low-level
 * streaming client. Owns:
 *   - composing the messages array (system prompt + trimmed history + user input)
 *   - persisting the user message before the request, the assistant message after
 *   - tracking abortable requests by requestId
 */
export class ChatService {
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly settingsStore: AiSettingsStore,
    private readonly historyStore: ChatHistoryStore
  ) {}

  /**
   * Send a user message in the given session and stream the assistant reply.
   * Caller passes a pre-generated requestId so IPC delta/done/error events
   * can reference it before send() returns. Returns the same requestId.
   */
  async send(
    sessionId: string,
    userText: string,
    handlers: StreamHandlers,
    requestId: string = randomUUID()
  ): Promise<string> {
    const trimmed = userText.trim();
    if (!trimmed) {
      throw new Error("Message cannot be empty.");
    }

    const settings = this.settingsStore.load();
    const session = await this.historyStore.get(sessionId);
    if (!session) {
      throw new Error(`Chat session '${sessionId}' not found.`);
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    await this.historyStore.appendMessage(sessionId, userMessage);

    // Build the message list to send to the API.
    const updated = await this.historyStore.get(sessionId);
    const cacheInput = updated ? updated.messages : [userMessage];
    const composed = applySettingsToCache(cacheInput, settings);

    const controller = new AbortController();
    this.inflight.set(requestId, controller);

    let assembled = "";
    streamChatCompletion(
      settings,
      composed,
      {
        onDelta: (delta) => {
          assembled += delta;
          handlers.onDelta(delta);
        },
      },
      controller.signal
    )
      .then(async (full) => {
        const finalText = full.length > 0 ? full : assembled;
        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          content: finalText,
          createdAt: Date.now(),
        };
        await this.historyStore.appendMessage(sessionId, assistantMessage);
        handlers.onDone(assistantMessage);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        handlers.onError(message);
      })
      .finally(() => {
        this.inflight.delete(requestId);
      });

    return requestId;
  }

  stop(requestId: string): void {
    const ctrl = this.inflight.get(requestId);
    if (ctrl) {
      ctrl.abort();
      this.inflight.delete(requestId);
    }
  }

  async newSession(title?: string): Promise<ChatSession> {
    const now = Date.now();
    const session: ChatSession = {
      id: randomUUID(),
      title: title?.trim() || defaultSessionTitle(now),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.historyStore.upsert(session);
    return session;
  }

  async listSessions(): Promise<ChatSession[]> {
    const sessions = await this.historyStore.list();
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getSession(id: string): Promise<ChatSession | null> {
    return this.historyStore.get(id);
  }

  async deleteSession(id: string): Promise<void> {
    return this.historyStore.delete(id);
  }

  // Settings facade so renderer doesn't have to know about settingsStore directly.
  loadSettings(): AiSettings {
    return this.settingsStore.load();
  }

  saveSettings(settings: AiSettings): AiSettings {
    return this.settingsStore.save(settings);
  }
}

function defaultSessionTitle(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `对话 ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
