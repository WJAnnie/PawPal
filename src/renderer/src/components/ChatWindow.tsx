import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import type {
  AiProvider,
  AiSettings,
  ChatMessage,
  ChatSession,
} from "../../../shared/ai/types";
import { useChat } from "../hooks/useChat";

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function previewText(session: ChatSession): string {
  const last = [...session.messages].reverse().find((m) => m.role !== "system");
  if (!last) return "（空对话）";
  const trimmed = last.content.trim().replace(/\s+/g, " ");
  return trimmed.length > 38 ? `${trimmed.slice(0, 38)}…` : trimmed;
}

export function ChatWindow(): JSX.Element {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [bootError, setBootError] = useState<string | null>(null);
  const [profileSwitching, setProfileSwitching] = useState(false);

  const chat = useChat(activeSession);

  const refreshSessions = useCallback(async (): Promise<ChatSession[]> => {
    const list = await window.pawpal.ai.listSessions();
    setSessions(list);
    return list;
  }, []);

  const ensureSession = useCallback(async (): Promise<ChatSession> => {
    const list = await refreshSessions();
    if (list.length > 0) return list[0];
    return window.pawpal.ai.newSession();
  }, [refreshSessions]);

  // Initial load: settings + sessions + pick active.
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const loaded = await window.pawpal.ai.getSettings();
        if (cancelled) return;
        setSettings(loaded);
        const session = await ensureSession();
        if (cancelled) return;
        setActiveSessionId(session.id);
        setActiveSession(session);
        const list = await window.pawpal.ai.listSessions();
        if (!cancelled) setSessions(list);
      } catch (err: unknown) {
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession]);

  // Refetch the active session whenever the id changes (e.g. user clicks
  // another session in the sidebar).
  useEffect(() => {
    if (!activeSessionId) {
      setActiveSession(null);
      return;
    }
    let cancelled = false;
    void window.pawpal.ai.getSession(activeSessionId).then((session) => {
      if (!cancelled) setActiveSession(session);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  // After the assistant finishes streaming, refresh the sidebar so that the
  // `updatedAt` ordering and message preview reflect the new exchange.
  const lastFinalIdRef = useRef<string | null>(null);
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === "assistant" && last.id !== lastFinalIdRef.current) {
      lastFinalIdRef.current = last.id;
      void refreshSessions();
    }
  }, [chat.messages, refreshSessions]);

  // Pin the stream to the latest message / streaming chunk so the user never
  // has to scroll manually to see new output. useLayoutEffect runs after the
  // DOM mutation but before paint, so scrollHeight already reflects the new
  // content. Depending on primitives (lengths) keeps this resilient regardless
  // of how the hook batches updates.
  const streamRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.streaming?.partial.length, chat.error, activeSessionId]);

  const handleSend = useCallback(async (): Promise<void> => {
    if (!input.trim() || chat.isSending) return;
    const text = input;
    setInput("");
    await chat.send(text);
  }, [input, chat]);

  const handleInputKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleNewSession = useCallback(async (): Promise<void> => {
    const session = await window.pawpal.ai.newSession();
    setActiveSessionId(session.id);
    setActiveSession(session);
    await refreshSessions();
  }, [refreshSessions]);

  const handleDeleteSession = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm("确认删除此会话？")) return;
      await window.pawpal.ai.deleteSession(id);
      const remaining = await refreshSessions();
      if (id === activeSessionId) {
        const next = remaining[0] ?? (await window.pawpal.ai.newSession());
        setActiveSessionId(next.id);
        setActiveSession(next);
        await refreshSessions();
      }
    },
    [activeSessionId, refreshSessions]
  );

  const handleProfileChange = useCallback(
    async (profileId: string): Promise<void> => {
      if (!settings || profileId === settings.activeProfileId) return;
      const target = settings.profiles.find((p) => p.id === profileId);
      if (!target) return;
      setProfileSwitching(true);
      try {
        const next: AiSettings = {
          ...settings,
          activeProfileId: target.id,
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          model: target.model,
          temperature: target.temperature,
          maxContextMessages: target.maxContextMessages,
          systemPrompt: target.systemPrompt,
          requestTimeoutMs: target.requestTimeoutMs,
        };
        const saved = await window.pawpal.ai.saveSettings(next);
        setSettings(saved);
      } finally {
        setProfileSwitching(false);
      }
    },
    [settings]
  );

  const apiKeyMissing = useMemo(
    () => Boolean(settings && settings.apiKey.trim().length === 0),
    [settings]
  );

  const renderableMessages = useMemo(
    () => chat.messages.filter((m) => m.role !== "system"),
    [chat.messages]
  );

  if (bootError) {
    return (
      <main className="chat-shell">
        <div className="chat-error">
          <h2>无法加载 AI 设置</h2>
          <p>{bootError}</p>
        </div>
      </main>
    );
  }

  if (!settings || !activeSession) {
    return (
      <main className="chat-shell">
        <div className="chat-loading">载入中…</div>
      </main>
    );
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <div className="chat-sidebar__head">
          <h2>对话</h2>
          <button
            type="button"
            className="chat-button is-primary"
            onClick={() => void handleNewSession()}
          >
            + 新对话
          </button>
        </div>
        <ul className="chat-session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className={`chat-session${
                  session.id === activeSessionId ? " is-active" : ""
                }`}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="chat-session__title">{session.title}</span>
                <span className="chat-session__preview">{previewText(session)}</span>
                <span className="chat-session__time">
                  {formatTimestamp(session.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="chat-session__delete"
                aria-label={`删除 ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDeleteSession(session.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-main">
        <header className="chat-main__head">
          <ProfilePicker
            settings={settings}
            disabled={profileSwitching || chat.isSending}
            onChange={(id) => void handleProfileChange(id)}
          />
          <span className="chat-main__model">{settings.model}</span>
        </header>

        {apiKeyMissing ? (
          <div className="chat-warning">
            未配置 API Key。请在「设置 → AI」里给当前 profile 填入 key 后再发送消息。
          </div>
        ) : null}

        <div className="chat-stream" role="log" aria-live="polite" ref={streamRef}>
          {renderableMessages.length === 0 && !chat.streaming ? (
            <div className="chat-empty">
              <p>开始一段新对话吧。</p>
              <p className="chat-empty__hint">Enter 发送 · Shift+Enter 换行</p>
            </div>
          ) : null}

          {renderableMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {chat.streaming ? (
            <article className="chat-msg chat-msg--assistant chat-msg--streaming">
              <div className="chat-msg__role">AI</div>
              <div className="chat-msg__body">
                {chat.streaming.partial}
                <span className="chat-cursor" aria-hidden>
                  ▍
                </span>
              </div>
            </article>
          ) : null}

          {chat.error ? (
            <article className="chat-msg chat-msg--error">
              <div className="chat-msg__role">错误</div>
              <div className="chat-msg__body">
                {chat.error}{" "}
                <button
                  type="button"
                  className="chat-link"
                  onClick={() => chat.clearError()}
                >
                  关闭
                </button>
              </div>
            </article>
          ) : null}
        </div>

        <footer className="chat-input-bar">
          <textarea
            className="chat-input"
            placeholder={
              apiKeyMissing
                ? "请先到设置中填入 API Key…"
                : "和 AI-WorkPet 说点什么…"
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKey}
            rows={2}
            disabled={apiKeyMissing}
          />
          <div className="chat-input-bar__actions">
            {chat.streaming || chat.isSending ? (
              <button
                type="button"
                className="chat-button is-danger"
                onClick={() => chat.stop()}
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                className="chat-button is-primary"
                disabled={!input.trim() || apiKeyMissing}
                onClick={() => void handleSend()}
              >
                发送
              </button>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const variant = message.role === "user" ? "user" : "assistant";
  const roleLabel = message.role === "user" ? "你" : "AI";
  return (
    <article className={`chat-msg chat-msg--${variant}`}>
      <div className="chat-msg__role">{roleLabel}</div>
      <div className="chat-msg__body">{message.content}</div>
    </article>
  );
}

function ProfilePicker({
  settings,
  disabled,
  onChange,
}: {
  settings: AiSettings;
  disabled: boolean;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <label className="chat-profile">
      <span className="chat-profile__label">Provider</span>
      <select
        className="chat-profile__select"
        disabled={disabled}
        value={settings.activeProfileId}
        onChange={(event) => onChange(event.target.value)}
      >
        {settings.profiles.map((profile: AiProvider) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </label>
  );
}
