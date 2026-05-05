import type { AiProvider, AiSettings } from "./ai/types";

/**
 * Default seed profiles created on first launch only. Once written to disk,
 * the user can rename / delete / re-add freely; we never overwrite their
 * profiles list once it's non-empty.
 */
export const DEFAULT_AI_PROVIDERS: AiProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.7,
    maxContextMessages: 20,
    systemPrompt: "",
    requestTimeoutMs: 120_000,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxContextMessages: 20,
    systemPrompt: "",
    requestTimeoutMs: 120_000,
  },
  {
    id: "qwen",
    name: "通义千问 (Qwen)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    model: "qwen-plus",
    temperature: 0.7,
    maxContextMessages: 20,
    systemPrompt: "",
    requestTimeoutMs: 120_000,
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "",
    model: "kimi-latest",
    temperature: 0.7,
    maxContextMessages: 20,
    systemPrompt: "",
    requestTimeoutMs: 120_000,
  },
];

export const DEFAULT_SYSTEM_PROMPT =
  "你是一只温柔可爱的桌面宠物 AI-WorkPet，正在陪伴用户工作。" +
  "请用简短、自然、口语化的中文回应，不要说太长，每次回复尽量在 1-3 句之间。" +
  "在用户休息时鼓励他们，在用户专注时安静陪伴。";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: DEFAULT_AI_PROVIDERS[0].baseUrl,
  apiKey: "",
  model: DEFAULT_AI_PROVIDERS[0].model,
  temperature: 0.7,
  maxContextMessages: 20,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  requestTimeoutMs: 120_000,
  profiles: DEFAULT_AI_PROVIDERS.map((p) => ({ ...p, systemPrompt: DEFAULT_SYSTEM_PROMPT })),
  activeProfileId: DEFAULT_AI_PROVIDERS[0].id,
};
