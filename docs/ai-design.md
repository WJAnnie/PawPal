# AI-WorkPet · AI 模块设计

> v0.2.0-aiwp-alpha 引入。本文记录 AI 对话模块在 PawPal 现有架构上的扩展方式与各模块边界。

## 设计目标

1. **不动 PawPal 既有功能**：休息/喝水/专注/动画 全部保留，AI 是 additive layer
2. **流式输出 + 多轮上下文**：与 OpenAI 兼容协议（DeepSeek、OpenAI、通义、Moonshot 等任意供应商）
3. **多 Provider Profile**：用户可同时配 DeepSeek + OpenAI + …，运行时一键切换
4. **A+B 双入口**：A = 点小狗弹气泡聊（快聊）；B = 完整聊天窗口（长对话/历史）
5. **Pure-func 优先**：所有可测逻辑（cache reload、profile sync、SSE 解析）抽出来单测，UI/网络 IO 不测
6. **隐私**：API key 本地保存（electron-store），不上报；只对用户配置的 endpoint 发请求

## 模块边界

```
src/
├── shared/
│   ├── ai/
│   │   ├── types.ts            ← AiSettings / AiProvider / ChatMessage 类型 (zod schema + infer)
│   │   ├── chatCacheReloader.ts ← pure func: 重建 system prompt + trim history (从 VPet-WorkPet 移植)
│   │   └── profileSync.ts      ← pure func: WithActiveProfile / SyncTopLevelToActiveProfile
│   └── ai-defaults.ts          ← 默认 provider preset (DeepSeek / OpenAI / Moonshot / Qwen)
├── main/
│   ├── ai/
│   │   ├── settingsStore.ts    ← electron-store 适配层 (load + save + migration)
│   │   ├── openAiClient.ts     ← fetch + SSE 解析 (流式 chat completion)
│   │   ├── sseParser.ts        ← pure func: SSE event 流 → ChatMessageDelta 流
│   │   └── chatService.ts      ← 业务编排：拼 messages、调 client、push deltas 给 renderer
│   └── main.ts                 ← 加 IPC handlers (ai:send, ai:stop, ai:get-settings, ai:save-settings)
├── preload/
│   └── index.ts                ← window.pawpal.ai.* 子命名空间
└── renderer/src/
    ├── components/
    │   ├── ChatBubble.tsx      ← A 形态: 跟随宠物的小气泡
    │   ├── ChatWindow.tsx      ← B 形态: 完整聊天窗口
    │   └── AiSettingsTab.tsx   ← 设置面板里加的 AI 配置 tab
    └── hooks/
        └── useChat.ts          ← React hook: 订阅 ai:delta + ai:done + ai:error，管 message state
```

**为什么不直接放 `src/ai/`**：Electron 项目惯例是按进程分（main/preload/renderer），AI 模块跨进程，不能放一个目录。`shared/ai/` 是两端共用的纯类型 + 纯函数。

## 数据模型

### AiSettings（持久化主体）

```typescript
interface AiSettings {
  // 顶层 == 当前 active profile 的副本（向后兼容；未来扩展时 caller 不需改）
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;        // default 0.7
  maxContextMessages: number; // default 20, clamp >= 2
  systemPrompt: string;
  requestTimeoutMs: number;   // default 120_000

  // 多 profile 支持
  profiles: AiProvider[];     // 不能为空（migration 兜底）
  activeProfileId: string;    // 必须 ∈ profiles[].id
}

interface AiProvider {
  id: string;          // "deepseek" / "openai" / 用户自定义
  name: string;        // 显示名 "DeepSeek"
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxContextMessages: number;
  systemPrompt: string;
  requestTimeoutMs: number;
}
```

### ChatMessage（运行时缓存 + 持久化）

```typescript
interface ChatMessage {
  id: string;             // ulid / uuid
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;      // epoch ms
  // 流式中的 partial assistant 消息可没有 id；落库前补
}

interface ChatSession {
  id: string;
  title: string;          // 自动取首条 user 消息前 20 字
  createdAt: number;
  messages: ChatMessage[];
}
```

## 持久化策略

| 数据 | 存储 | 路径 | 决定理由 |
|---|---|---|---|
| `AiSettings`（含 profiles + apiKey） | electron-store | `~/.../pawpal/config.json` (合并到现有 store) | 复用现有 store；apiKey 跟其他 settings 一起；electron-store 已有原子写 |
| 聊天历史 | **JSON 文件**（v1）/ SQLite（v2） | `~/.../ai-workpet/chat-history.json` | v1 用 JSON 简单可调试；后续真有性能问题再上 SQLite |

**APIKey 安全**：electron-store 默认明文 JSON，不加密。OK for v0.2 alpha — 如果用户机器被入侵，APIKey 不是首要泄露目标。v0.3 考虑上 keytar (OS keychain)。

## IPC 协议

renderer 通过 `window.pawpal.ai.*` 调用：

```typescript
// preload exposes:
window.pawpal.ai = {
  // 配置
  getSettings: () => Promise<AiSettings>,
  saveSettings: (settings: AiSettings) => Promise<void>,

  // 对话
  send: (sessionId: string, userText: string) => Promise<{ requestId: string }>,
  stop: (requestId: string) => void,

  // 历史
  listSessions: () => Promise<ChatSession[]>,
  getSession: (id: string) => Promise<ChatSession>,
  newSession: () => Promise<ChatSession>,
  deleteSession: (id: string) => Promise<void>,

  // 流式事件订阅
  onDelta: (cb: (e: { requestId: string; delta: string }) => void) => Unsubscribe,
  onDone: (cb: (e: { requestId: string; finalMessage: ChatMessage }) => void) => Unsubscribe,
  onError: (cb: (e: { requestId: string; message: string }) => void) => Unsubscribe,
};
```

主进程对应的 IPC 频道：
- `invoke`: `ai:get-settings` / `ai:save-settings` / `ai:send` / `ai:list-sessions` / `ai:get-session` / `ai:new-session` / `ai:delete-session`
- `send` (renderer→main): `ai:stop`
- `send` (main→renderer): `ai:delta` / `ai:done` / `ai:error`

## 流式实现

OpenAI 兼容协议：POST `{baseUrl}/chat/completions` with `stream: true` → 返回 SSE。

```typescript
// main/ai/openAiClient.ts
async function streamChatCompletion(
  settings: AiSettings,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: settings.temperature,
      stream: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // sseParser.ts: pure func 解析 buffer → events，未完成的 chunk 留在 buffer
    const { events, remainder } = parseSseChunk(buffer);
    buffer = remainder;
    for (const ev of events) {
      if (ev.data === '[DONE]') return full;
      const json = JSON.parse(ev.data);
      const delta = json.choices?.[0]?.delta?.content ?? '';
      if (delta) { full += delta; onDelta(delta); }
    }
  }
  return full;
}
```

**sseParser.ts** 是纯函数：拿一段可能不完整的 SSE 文本，返回完整事件数组 + 剩余未完成的 buffer。可单测。

## ChatCacheReloader

从 VPet-WorkPet 的 `ChatCacheReloader.Apply` 移植。当 settings 变（system prompt 改、maxContextMessages 改）时，重建会话的 message cache：

```typescript
// shared/ai/chatCacheReloader.ts
export function applySettingsToCache(
  cache: ReadonlyArray<ChatMessage>,
  settings: AiSettings,
): ChatMessage[] {
  const max = Math.max(2, settings.maxContextMessages);

  // 删旧 system 行
  const withoutSystem = cache.filter(m => m.role !== 'system');

  // 加新 system（如果有）
  const next: ChatMessage[] = [];
  if (settings.systemPrompt.trim()) {
    next.push({
      id: 'system',
      role: 'system',
      content: settings.systemPrompt,
      createdAt: Date.now(),
    });
  }
  next.push(...withoutSystem);

  // trim 到 max（保留 system + 最近 max-1 条非 system）
  if (next.length <= max) return next;
  const systems = next.filter(m => m.role === 'system');
  const others = next.filter(m => m.role !== 'system');
  return [...systems, ...others.slice(-(max - systems.length))];
}
```

## UI 入口（A+B）

### A. ChatBubble（点小狗弹气泡）

PawPal 已有 `SpeechBubble` 类型与 `pet:show-bubble` IPC（PetView.tsx 已订阅）。复用这个机制：

- 点小狗 → 现有 `pet:clicked` IPC 触发
- 主进程检测有 AI 配置 → 弹"开始对话"小气泡 + 输入框（扩展现有 `SpeechBubble` 结构加 `chatMode` 标志）
- 用户输入 → renderer 发 `ai:send` → 流式 delta 渲染到气泡
- 气泡上有"展开 →"按钮切到 B 形态

### B. ChatWindow（完整窗口）

新建独立 BrowserWindow（类似现有 settings window 模式）：
- 托盘菜单加"打开 AI 对话" → main 创建 / 显示 ChatWindow
- 左侧 session 列表 + 右侧 message 流
- 顶部 profile 切换器 + "新对话"按钮
- 底部输入框 + 流式响应 + 停止按钮

### 设置面板 AI tab

extend `SettingsView.tsx`：
- 在现有 tabs 旁加"AI 设置"
- Profile 下拉 + 新建/删除（参考 VPet-WorkPet `AiSettingsWindow` 设计）
- BaseUrl / ApiKey / Model / Temperature / MaxContext / SystemPrompt 表单
- Test 按钮：发个 "hi" 验证连通性

## 单测覆盖

引入 **vitest**（电子项目惯例，比 jest 快）。先测纯函数：

| 模块 | 测试覆盖 |
|---|---|
| `sseParser.ts` | 完整事件 / 跨 chunk 拆分 / `[DONE]` / `data:` 行 / 注释行 / 多事件批 |
| `chatCacheReloader.ts` | 增/删/改 system / trim / clamp max<2 / 不变性 |
| `profileSync.ts` | WithActiveProfile / 未知 id 抛 / SyncTopLevelToActiveProfile / 自愈 / migration |
| `settingsStore.ts` | legacy load → 默认 default profile / round-trip / save sync |

期待：v0.2.0-aiwp-alpha 至少 30+ 单测通过。

## 默认 Provider Preset

首次启动时如果没有 profiles，自动创建 4 个：

```typescript
[
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "" },
  { id: "openai",   name: "OpenAI",   baseUrl: "https://api.openai.com/v1",   model: "gpt-4o-mini",   apiKey: "" },
  { id: "qwen",     name: "通义千问",  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", apiKey: "" },
  { id: "moonshot", name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1",  model: "kimi-latest",   apiKey: "" },
]
// activeProfileId = "deepseek"
```

apiKey 留空，用户自己填。

## 实施顺序（Step 3）

1. `shared/ai/types.ts` + zod schema（5 min）
2. `shared/ai-defaults.ts`（5 min）
3. `shared/ai/chatCacheReloader.ts` + tests（20 min）
4. `shared/ai/profileSync.ts` + tests（20 min）
5. `main/ai/sseParser.ts` + tests（25 min）
6. `main/ai/settingsStore.ts` + tests（30 min）
7. `main/ai/openAiClient.ts`（无单测，集成测）（25 min）
8. `main/ai/chatService.ts` + IPC handlers in `main.ts`（35 min）
9. `preload/index.ts`：扩展 `window.pawpal.ai`（10 min）

合计：~3 小时直到 backend 完整 + 测试绿。然后 Step 4 做 UI。

## 不在本次实施中

- SQLite 聊天历史（v1 用 JSON 文件足够）
- API key 加密（v1 明文 store）
- 速率限制 / token usage 统计（后续）
- 函数调用 / tool use（后续）
- 图片/语音输入（后续）

---

下一步：开 Step 3，按上面顺序写代码。
