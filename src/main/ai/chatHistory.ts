import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { chatSessionSchema, type ChatMessage, type ChatSession } from "../../shared/ai/types";

/**
 * Simple JSON-on-disk store for chat sessions.
 *
 * v1: single JSON file at <userData>/ai-workpet/chat-history.json
 * v2 (future): SQLite when sessions cross ~1000 messages and JSON blows up.
 *
 * All writes are atomic via tmp file + rename. Loads tolerate corruption by
 * returning an empty list — never crashes the app over bad history JSON.
 */

const fileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(chatSessionSchema),
});

type FileShape = z.infer<typeof fileSchema>;

export class ChatHistoryStore {
  private readonly filePath: string;
  private cache: ChatSession[] | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultPath();
  }

  async list(): Promise<ChatSession[]> {
    return [...(await this.load())];
  }

  async get(id: string): Promise<ChatSession | null> {
    const all = await this.load();
    return all.find((s) => s.id === id) ?? null;
  }

  async upsert(session: ChatSession): Promise<void> {
    const all = await this.load();
    const idx = all.findIndex((s) => s.id === session.id);
    const next = idx >= 0 ? [...all.slice(0, idx), session, ...all.slice(idx + 1)] : [...all, session];
    await this.persist(next);
  }

  async appendMessage(sessionId: string, message: ChatMessage): Promise<ChatSession> {
    const all = await this.load();
    const idx = all.findIndex((s) => s.id === sessionId);
    if (idx < 0) {
      throw new Error(`Chat session '${sessionId}' not found.`);
    }
    const updated: ChatSession = {
      ...all[idx],
      updatedAt: Date.now(),
      messages: [...all[idx].messages, message],
    };
    const next = [...all.slice(0, idx), updated, ...all.slice(idx + 1)];
    await this.persist(next);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const all = await this.load();
    const next = all.filter((s) => s.id !== id);
    if (next.length === all.length) return;
    await this.persist(next);
  }

  async clear(): Promise<void> {
    await this.persist([]);
  }

  // --------------- internals ---------------

  private async load(): Promise<ChatSession[]> {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = [];
      return this.cache;
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: FileShape = fileSchema.parse(JSON.parse(raw));
      this.cache = parsed.sessions;
      return this.cache;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[chat-history] failed to read, ignoring: ${message}\n`);
      this.cache = [];
      return this.cache;
    }
  }

  private async persist(sessions: ChatSession[]): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const payload: FileShape = { version: 1, sessions };
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, this.filePath);
    this.cache = sessions;
  }
}

function defaultPath(): string {
  return join(app.getPath("userData"), "ai-workpet", "chat-history.json");
}
