import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { randomUUID } from "../randomId";
import { withActiveProfile } from "../../../shared/ai/profileSync";
import type { AiProvider, AiSettings } from "../../../shared/ai/types";

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; reply: string }
  | { kind: "error"; message: string };

/**
 * AI tab inside the Settings window.
 *
 * Loaded lazily — first render fetches settings via IPC. Edits are kept in
 * a draft state and persisted via "保存"; switching profiles auto-flushes
 * the current draft into its profile so unsaved field changes don't get
 * lost when the user picks another provider.
 */
export function AiSettingsSection(): JSX.Element {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    void window.pawpal.ai
      .getSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setDraft(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!settings || !draft) return false;
    return JSON.stringify(settings) !== JSON.stringify(draft);
  }, [settings, draft]);

  const activeProfile = useMemo<AiProvider | null>(() => {
    if (!draft) return null;
    return draft.profiles.find((p) => p.id === draft.activeProfileId) ?? null;
  }, [draft]);

  const updateActiveProfile = useCallback(
    (partial: Partial<AiProvider>): void => {
      setDraft((current) => {
        if (!current) return current;
        const updated: AiSettings = {
          ...current,
          profiles: current.profiles.map((p) =>
            p.id === current.activeProfileId ? { ...p, ...partial } : p
          ),
        };
        return withActiveProfile(updated, updated.activeProfileId);
      });
      setSavingState("idle");
      setTest({ kind: "idle" });
    },
    []
  );

  const switchProfile = useCallback((profileId: string): void => {
    setDraft((current) => {
      if (!current) return current;
      const target = current.profiles.find((p) => p.id === profileId);
      if (!target) return current;
      return withActiveProfile(current, target.id);
    });
    setTest({ kind: "idle" });
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!draft) return;
    setSavingState("saving");
    try {
      const saved = await window.pawpal.ai.saveSettings(draft);
      setSettings(saved);
      setDraft(saved);
      setSavingState("saved");
      window.setTimeout(() => setSavingState("idle"), 1500);
    } catch (err: unknown) {
      setSavingState("error");
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [draft]);

  const handleAddProfile = useCallback((): void => {
    setDraft((current) => {
      if (!current) return current;
      const newProfile: AiProvider = {
        id: randomUUID(),
        name: `自定义 ${current.profiles.length + 1}`,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        temperature: 0.7,
        maxContextMessages: 20,
        systemPrompt: current.systemPrompt,
        requestTimeoutMs: 120_000,
      };
      const next: AiSettings = {
        ...current,
        profiles: [...current.profiles, newProfile],
      };
      return withActiveProfile(next, newProfile.id);
    });
  }, []);

  const handleDeleteProfile = useCallback((): void => {
    setDraft((current) => {
      if (!current) return current;
      if (current.profiles.length <= 1) return current;
      if (!window.confirm(`删除 profile "${activeProfile?.name ?? ""}"？`)) {
        return current;
      }
      const remaining = current.profiles.filter((p) => p.id !== current.activeProfileId);
      const next: AiSettings = { ...current, profiles: remaining };
      return withActiveProfile(next, remaining[0].id);
    });
  }, [activeProfile?.name]);

  const handleTestConnection = useCallback(async (): Promise<void> => {
    if (!draft || !activeProfile) return;
    if (dirty) {
      // Save first so the test uses the values the user just typed.
      await handleSave();
    }
    setTest({ kind: "running" });

    // Re-use the chat pipeline: create an ephemeral session, send "hi", wait
    // for done/error. We listen with one-shot subscriptions tied to the
    // returned requestId.
    try {
      const session = await window.pawpal.ai.newSession("连接测试");
      let resolved = false;
      const cleanup: Array<() => void> = [];
      const finish = (state: TestState): void => {
        if (resolved) return;
        resolved = true;
        cleanup.forEach((fn) => fn());
        setTest(state);
        // Best-effort cleanup of the throwaway session.
        void window.pawpal.ai.deleteSession(session.id).catch(() => {
          /* swallow — non-fatal */
        });
      };

      const timeoutId = window.setTimeout(() => {
        finish({ kind: "error", message: "请求超时（30s）" });
      }, 30_000);
      cleanup.push(() => window.clearTimeout(timeoutId));

      const result = await window.pawpal.ai.send(session.id, "hi");
      cleanup.push(
        window.pawpal.ai.onDone((event) => {
          if (event.requestId !== result.requestId) return;
          finish({
            kind: "ok",
            reply: event.finalMessage.content.trim().slice(0, 80) || "(空回复)",
          });
        })
      );
      cleanup.push(
        window.pawpal.ai.onError((event) => {
          if (event.requestId !== result.requestId) return;
          finish({ kind: "error", message: event.message });
        })
      );
    } catch (err: unknown) {
      setTest({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [draft, activeProfile, dirty, handleSave]);

  if (loadError && !settings) {
    return (
      <section className="prefs__group">
        <h2 className="prefs__group-title">AI</h2>
        <p className="diagnostic-copy">载入 AI 设置失败：{loadError}</p>
      </section>
    );
  }

  if (!draft || !activeProfile) {
    return (
      <section className="prefs__group">
        <h2 className="prefs__group-title">AI</h2>
        <p className="diagnostic-copy">载入中…</p>
      </section>
    );
  }

  return (
    <section className="prefs__group">
      <h2 className="prefs__group-title">AI</h2>

      <div className="ai-settings__profile-row">
        <label className="ai-settings__label">
          <span>Provider</span>
          <select
            className="pref-select"
            value={draft.activeProfileId}
            onChange={(event) => switchProfile(event.target.value)}
          >
            {draft.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="pref-button" onClick={handleAddProfile}>
          + 新建
        </button>
        <button
          type="button"
          className="pref-button"
          disabled={draft.profiles.length <= 1}
          onClick={handleDeleteProfile}
        >
          删除
        </button>
      </div>

      <FieldRow label="名称">
        <input
          type="text"
          className="ai-settings__input"
          value={activeProfile.name}
          onChange={(event) => updateActiveProfile({ name: event.target.value })}
        />
      </FieldRow>

      <FieldRow
        label="Base URL"
        hint="OpenAI 兼容协议的根地址，例如 https://api.deepseek.com/v1"
      >
        <input
          type="text"
          className="ai-settings__input"
          value={activeProfile.baseUrl}
          onChange={(event) => updateActiveProfile({ baseUrl: event.target.value })}
          spellCheck={false}
        />
      </FieldRow>

      <FieldRow label="API Key" hint="本地保存在 electron-store，不上传">
        <input
          type="password"
          className="ai-settings__input"
          value={activeProfile.apiKey}
          onChange={(event) => updateActiveProfile({ apiKey: event.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </FieldRow>

      <FieldRow label="Model">
        <input
          type="text"
          className="ai-settings__input"
          value={activeProfile.model}
          onChange={(event) => updateActiveProfile({ model: event.target.value })}
          spellCheck={false}
        />
      </FieldRow>

      <FieldRow label="Temperature" hint="0–2，越高越发散">
        <input
          type="number"
          className="ai-settings__input ai-settings__input--narrow"
          min={0}
          max={2}
          step={0.1}
          value={activeProfile.temperature}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              updateActiveProfile({ temperature: Math.min(2, Math.max(0, next)) });
            }
          }}
        />
      </FieldRow>

      <FieldRow label="保留上下文" hint="最近多少条消息会随请求一起发送（含 system）">
        <input
          type="number"
          className="ai-settings__input ai-settings__input--narrow"
          min={2}
          max={200}
          step={1}
          value={activeProfile.maxContextMessages}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              updateActiveProfile({
                maxContextMessages: Math.min(200, Math.max(2, Math.round(next))),
              });
            }
          }}
        />
      </FieldRow>

      <FieldRow label="System Prompt" hint="桌宠在每段对话里扮演的角色提示">
        <textarea
          className="ai-settings__textarea"
          rows={4}
          value={activeProfile.systemPrompt}
          onChange={(event) => updateActiveProfile({ systemPrompt: event.target.value })}
        />
      </FieldRow>

      <div className="ai-settings__actions">
        <button
          type="button"
          className="pref-button is-primary"
          disabled={!dirty || savingState === "saving"}
          onClick={() => void handleSave()}
        >
          {savingState === "saving" ? "保存中…" : savingState === "saved" ? "已保存" : "保存"}
        </button>
        <button
          type="button"
          className="pref-button"
          disabled={test.kind === "running" || activeProfile.apiKey.trim().length === 0}
          onClick={() => void handleTestConnection()}
        >
          {test.kind === "running" ? "测试中…" : "测试连接"}
        </button>
        {test.kind === "ok" ? (
          <span className="ai-settings__test-ok">✓ {test.reply}</span>
        ) : null}
        {test.kind === "error" ? (
          <span className="ai-settings__test-error">✗ {test.message}</span>
        ) : null}
      </div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="ai-settings__row">
      <div className="ai-settings__row-label">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="ai-settings__row-control">{children}</div>
    </div>
  );
}
