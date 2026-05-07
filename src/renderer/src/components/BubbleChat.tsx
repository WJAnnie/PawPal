import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import type { BubbleAction } from "../../../shared/types";
import type { ChatSession } from "../../../shared/ai/types";
import { useChat } from "../hooks/useChat";

interface BubbleChatProps {
  sessionId: string;
  actions: BubbleAction[] | undefined;
}

/**
 * Compact chat panel rendered inside the speech bubble when the bubble is in
 * "chat" mode. Reuses the same useChat hook as the full ChatWindow so streaming
 * deltas, error handling, and stop semantics are identical.
 *
 * Displays the most recent few messages plus the live streaming response, with
 * a single-row textarea pinned to the bottom. The bubble owner (PetView) keeps
 * passing through `actions` so the operator can escalate to the full chat
 * window or dismiss the bubble.
 */
export function BubbleChat({ sessionId, actions }: BubbleChatProps): JSX.Element {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const streamRef = useRef<HTMLDivElement | null>(null);

  const chat = useChat(session);

  useEffect(() => {
    let cancelled = false;
    void window.pawpal.ai
      .getSession(sessionId)
      .then((next) => {
        if (cancelled) return;
        if (!next) {
          setLoadError("会话不存在");
          return;
        }
        setSession(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Pin the stream to the latest message / streaming chunk. useLayoutEffect
  // runs after DOM mutation but before paint, so scrollHeight already reflects
  // the new content — avoids the "scroll lags one frame" flash. Depending on
  // primitives (lengths) instead of object refs keeps this resilient if the
  // hook ever batches updates differently.
  useLayoutEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.streaming?.partial.length, chat.error]);

  const renderable = useMemo(
    () => chat.messages.filter((m) => m.role !== "system"),
    [chat.messages]
  );

  const handleSend = useCallback(async (): Promise<void> => {
    const text = input;
    if (!text.trim() || chat.isSending) return;
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

  return (
    <section className="speech-bubble speech-bubble--chat">
      <div className="bubble-chat__stream" ref={streamRef} role="log" aria-live="polite">
        {loadError ? (
          <div className="bubble-chat__error">{loadError}</div>
        ) : null}
        {!loadError && renderable.length === 0 && !chat.streaming ? (
          <p className="bubble-chat__empty">说点什么吧～</p>
        ) : null}
        {renderable.map((message) => (
          <article
            key={message.id}
            className={`bubble-chat__msg bubble-chat__msg--${
              message.role === "user" ? "user" : "assistant"
            }`}
          >
            {message.content}
          </article>
        ))}
        {chat.streaming ? (
          <article className="bubble-chat__msg bubble-chat__msg--assistant bubble-chat__msg--streaming">
            {chat.streaming.partial}
            <span className="bubble-chat__cursor" aria-hidden>
              ▍
            </span>
          </article>
        ) : null}
        {chat.error ? (
          <div className="bubble-chat__error">
            {chat.error}{" "}
            <button
              type="button"
              className="bubble-chat__link"
              onClick={() => chat.clearError()}
            >
              关闭
            </button>
          </div>
        ) : null}
      </div>

      <div className="bubble-chat__input-row">
        <textarea
          className="bubble-chat__input"
          placeholder="按 Enter 发送 · Shift+Enter 换行"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKey}
          rows={1}
          disabled={Boolean(loadError) || !session}
        />
        {chat.streaming || chat.isSending ? (
          <button
            type="button"
            className="bubble-chat__send is-danger"
            onClick={() => chat.stop()}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="bubble-chat__send"
            disabled={!input.trim() || !session || Boolean(loadError)}
            onClick={() => void handleSend()}
          >
            发送
          </button>
        )}
      </div>

      {actions?.length ? (
        <div className="bubble-actions">
          {actions.map((action) => (
            <button
              type="button"
              key={action.id}
              className={`bubble-button ${action.kind ?? "secondary"}`}
              onClick={() => window.pawpal.bubbleAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
