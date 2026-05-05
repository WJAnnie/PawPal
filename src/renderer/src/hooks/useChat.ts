import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  ChatMessage,
  ChatSession,
} from "../../../shared/ai/types";

export interface StreamingState {
  requestId: string;
  partial: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  streaming: StreamingState | null;
  error: string | null;
  isSending: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

/**
 * Renderer-side state machine for one chat session.
 *
 * Subscribes to ai:delta / ai:done / ai:error and projects them onto a
 * `messages` array + `streaming` partial. Optimistic user-message append
 * keeps the UI responsive while the network round-trip resolves.
 *
 * Race window: ai:delta events can arrive before window.pawpal.ai.send()
 * resolves with the requestId. We buffer any events whose requestId we have
 * not yet identified by carrying them on a pending list keyed by requestId.
 */
export function useChat(session: ChatSession | null): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>(session?.messages ?? []);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const activeRequestRef = useRef<string | null>(null);
  const pendingDeltasRef = useRef<Map<string, string>>(new Map());
  const sessionIdRef = useRef<string | null>(session?.id ?? null);

  // Re-hydrate when session changes.
  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
    setMessages(session?.messages ?? []);
    setStreaming(null);
    setError(null);
    setIsSending(false);
    activeRequestRef.current = null;
    pendingDeltasRef.current.clear();
  }, [session?.id]);

  // Subscribe to streaming events for the lifetime of the hook.
  useEffect(() => {
    const offDelta = window.pawpal.ai.onDelta((event: AiDeltaEvent) => {
      if (event.requestId !== activeRequestRef.current) {
        const buffered = pendingDeltasRef.current.get(event.requestId) ?? "";
        pendingDeltasRef.current.set(event.requestId, buffered + event.delta);
        return;
      }
      setStreaming((current) => {
        if (!current || current.requestId !== event.requestId) {
          return { requestId: event.requestId, partial: event.delta };
        }
        return { ...current, partial: current.partial + event.delta };
      });
    });

    const offDone = window.pawpal.ai.onDone((event: AiDoneEvent) => {
      if (event.requestId !== activeRequestRef.current) {
        pendingDeltasRef.current.delete(event.requestId);
        return;
      }
      setMessages((current) => [...current, event.finalMessage]);
      setStreaming(null);
      setIsSending(false);
      activeRequestRef.current = null;
      pendingDeltasRef.current.delete(event.requestId);
    });

    const offError = window.pawpal.ai.onError((event: AiErrorEvent) => {
      if (event.requestId !== activeRequestRef.current) {
        pendingDeltasRef.current.delete(event.requestId);
        return;
      }
      setError(event.message);
      setStreaming(null);
      setIsSending(false);
      activeRequestRef.current = null;
      pendingDeltasRef.current.delete(event.requestId);
    });

    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, []);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        setError("没有活动会话");
        return;
      }
      if (isSending) return;

      setError(null);
      setIsSending(true);

      const optimisticUser: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      setMessages((current) => [...current, optimisticUser]);

      try {
        const result = await window.pawpal.ai.send(sessionId, trimmed);
        activeRequestRef.current = result.requestId;
        const buffered = pendingDeltasRef.current.get(result.requestId) ?? "";
        pendingDeltasRef.current.delete(result.requestId);
        setStreaming({ requestId: result.requestId, partial: buffered });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsSending(false);
        // Roll back the optimistic user message so the user can retry without
        // a phantom send sitting in the transcript.
        setMessages((current) =>
          current.filter((msg) => msg.id !== optimisticUser.id)
        );
      }
    },
    [isSending]
  );

  const stop = useCallback((): void => {
    const id = activeRequestRef.current;
    if (!id) return;
    window.pawpal.ai.stop(id);
    setStreaming(null);
    setIsSending(false);
    activeRequestRef.current = null;
    pendingDeltasRef.current.delete(id);
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return { messages, streaming, error, isSending, send, stop, clearError };
}
