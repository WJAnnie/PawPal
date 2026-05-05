import { z } from "zod";

/**
 * AI module shared types & validation schemas.
 *
 * Design notes:
 * - Top-level fields on AiSettings mirror the active profile so existing
 *   callers can keep reading `settings.baseUrl` / `settings.apiKey` etc.
 *   See docs/ai-design.md for full rationale.
 * - All persisted shapes go through these schemas before reaching code,
 *   so legacy / corrupted JSON cannot crash the app.
 */

// ---------- AiProvider ----------

export const aiProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  maxContextMessages: z.number().int().min(2).default(20),
  systemPrompt: z.string().default(""),
  requestTimeoutMs: z.number().int().positive().default(120_000),
});

export type AiProvider = z.infer<typeof aiProviderSchema>;

// ---------- AiSettings ----------

export const aiSettingsSchema = z.object({
  // Mirror of the active profile; see profileSync.ts for invariants.
  baseUrl: z.string().min(1),
  apiKey: z.string(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  maxContextMessages: z.number().int().min(2).default(20),
  systemPrompt: z.string().default(""),
  requestTimeoutMs: z.number().int().positive().default(120_000),

  // Multi-profile support.
  profiles: z.array(aiProviderSchema),
  activeProfileId: z.string(),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

// ---------- ChatMessage / ChatSession ----------

export const chatRoleSchema = z.union([
  z.literal("system"),
  z.literal("user"),
  z.literal("assistant"),
]);

export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  createdAt: z.number().int().nonnegative(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  messages: z.array(chatMessageSchema),
});

export type ChatSession = z.infer<typeof chatSessionSchema>;

// ---------- IPC payload types ----------

export interface AiSendRequest {
  sessionId: string;
  userText: string;
}

export interface AiSendResult {
  requestId: string;
}

export interface AiDeltaEvent {
  requestId: string;
  delta: string;
}

export interface AiDoneEvent {
  requestId: string;
  finalMessage: ChatMessage;
}

export interface AiErrorEvent {
  requestId: string;
  message: string;
}
