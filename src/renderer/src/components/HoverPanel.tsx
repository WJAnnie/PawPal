import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent, ReactNode } from "react";
import { useSnapshot } from "../hooks";
import { useChat } from "../hooks/useChat";
import {
  ITEM_CATALOG,
  visibleGamesFor,
  visibleItemsFor,
  type ItemDefinition,
  type MiniGameDefinition
} from "../../../shared/items";
import { computeLevelInLanguage } from "../../../shared/vitals";
import { resolveLanguage } from "../../../shared/i18n";
import { getPetSpecies, resolvePetAppearanceId } from "../../../shared/petAppearances";
import type { Language } from "../../../shared/types";
import type { ChatSession } from "../../../shared/ai/types";

type TabKey = "feed" | "play" | "today" | "chat";

interface HoverPanelProps {
  onRequestClose: () => void;
}

/**
 * Click-to-open hover panel that surfaces vitals, feeding, play, and today
 * counters in one place. Replaces the right-click submenu and the Settings
 * "状态" section. All mutations route through window.pawpal.vitals.* — same
 * IPC the threshold bubbles use, so the underlying store is the single source
 * of truth.
 */
export function HoverPanel({ onRequestClose }: HoverPanelProps): JSX.Element {
  const snapshot = useSnapshot();
  const lang: Language = resolveLanguage(snapshot.settings.language);
  const v = snapshot.vitals;
  const species = getPetSpecies(resolvePetAppearanceId(snapshot.settings.petAppearanceId));
  const levelInfo = computeLevelInLanguage(v.exp, lang);
  const items = visibleItemsFor(species, levelInfo.level);
  const games = visibleGamesFor(species, levelInfo.level);

  const [tab, setTab] = useState<TabKey>("feed");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const inventoryItems = useMemo(
    () =>
      items
        .map((item) => ({ item, count: v.inventory[item.id] ?? 0 }))
        .filter((entry) => entry.count > 0),
    [items, v.inventory]
  );

  const showFeedback = useCallback((msg: string, ms = 1800): void => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(null), ms);
  }, []);

  const handleFeed = useCallback(
    async (itemId: string): Promise<void> => {
      setBusy(`feed:${itemId}`);
      try {
        const result = await window.pawpal.vitals.feed(itemId);
        if (!result.ok) {
          showFeedback(reasonText(result.reason, lang));
        } else {
          showFeedback(`${result.item.icon} ${lang === "zh-CN" ? "投喂成功" : "Fed"}！`);
        }
      } finally {
        setBusy(null);
      }
    },
    [lang, showFeedback]
  );

  const handleBuy = useCallback(
    async (itemId: string): Promise<void> => {
      setBusy(`buy:${itemId}`);
      try {
        const result = await window.pawpal.vitals.buy(itemId, 1);
        if (!result.ok) {
          showFeedback(reasonText(result.reason, lang));
        } else {
          showFeedback(lang === "zh-CN" ? "已加入背包" : "Added");
        }
      } finally {
        setBusy(null);
      }
    },
    [lang, showFeedback]
  );

  const handleStroke = useCallback(async (): Promise<void> => {
    setBusy("stroke");
    try {
      const result = await window.pawpal.vitals.petStroke();
      if (!result.ok) {
        showFeedback(reasonText(result.reason ?? "cooldown", lang));
      } else {
        showFeedback(lang === "zh-CN" ? "🐾 摸摸头～" : "🐾 Pet pet");
      }
    } finally {
      setBusy(null);
    }
  }, [lang, showFeedback]);

  const handlePlay = useCallback(
    (game: MiniGameDefinition, exhausted: boolean): void => {
      if (exhausted) {
        showFeedback(lang === "zh-CN" ? "今天玩够啦" : "Played enough today");
        return;
      }
      // Frisbee opens its own window — main process handles this through the
      // bubble-action route. We reuse that routing by sending the same id.
      window.pawpal.bubbleAction(`vitals:play:${game.id}`);
      onRequestClose();
    },
    [lang, onRequestClose, showFeedback]
  );

  const handleCompanion = useCallback(
    async (minutes: number): Promise<void> => {
      setBusy(`companion:${minutes}`);
      try {
        await window.pawpal.vitals.startCompanion(minutes);
        showFeedback(
          lang === "zh-CN" ? `开始陪伴 ${minutes}min` : `Companion ${minutes}min`
        );
      } finally {
        setBusy(null);
      }
    },
    [lang, showFeedback]
  );

  const handleStopCompanion = useCallback(async (): Promise<void> => {
    setBusy("companion:stop");
    try {
      await window.pawpal.vitals.stopCompanion();
      showFeedback(lang === "zh-CN" ? "陪伴结束" : "Companion ended");
    } finally {
      setBusy(null);
    }
  }, [lang, showFeedback]);

  const handleClaimGift = useCallback(async (): Promise<void> => {
    setBusy("gift");
    try {
      const result = await window.pawpal.vitals.claimGift();
      if (result.gift) {
        const parts: string[] = [];
        if (result.gift.coins) parts.push(`+${result.gift.coins} 🦴`);
        if (result.gift.itemId) parts.push("+1 🎁");
        showFeedback(parts.join(" · "));
      }
    } finally {
      setBusy(null);
    }
  }, [showFeedback]);

  const companionRemainingMs = v.companionUntil
    ? Math.max(0, v.companionUntil - Date.now())
    : 0;
  const companionActive = companionRemainingMs > 0;

  return (
    <section className="hover-panel" role="dialog" aria-label="状态面板">
      <header className="hover-panel__header">
        <div className="hover-panel__title">
          <span className="hover-panel__level">
            Lv{levelInfo.level} · {levelInfo.label}
          </span>
          <span className="hover-panel__coins">🦴 {v.coins}</span>
        </div>
        <button
          type="button"
          className="hover-panel__close"
          aria-label={lang === "zh-CN" ? "关闭" : "Close"}
          onClick={onRequestClose}
        >
          ×
        </button>
      </header>

      <div className="hover-panel__bond">
        <div className="vitals-bar">
          <div
            className="vitals-bar__fill vitals-bar__fill--exp"
            style={{ width: `${levelInfo.progressPct}%` }}
          />
        </div>
        <span className="hover-panel__bond-text">
          {lang === "zh-CN" ? "羁绊" : "Bond"} {levelInfo.progressPct}%
        </span>
      </div>

      <div className="hover-panel__vitals">
        <VitalRow label={lang === "zh-CN" ? "🍖 饱腹" : "🍖 Hunger"} value={v.hunger} hue="amber" />
        <VitalRow label={lang === "zh-CN" ? "❤️ 心情" : "❤️ Mood"} value={v.mood} hue="rose" />
        <VitalRow label={lang === "zh-CN" ? "⚡ 精力" : "⚡ Energy"} value={v.energy} hue="teal" />
      </div>

      {companionActive ? (
        <div className="hover-panel__companion">
          <span>
            {lang === "zh-CN" ? "陪伴中" : "Companion"} ·{" "}
            {Math.ceil(companionRemainingMs / 60_000)}min
          </span>
          <button
            type="button"
            className="hover-panel__link"
            disabled={busy === "companion:stop"}
            onClick={() => void handleStopCompanion()}
          >
            {lang === "zh-CN" ? "结束" : "Stop"}
          </button>
        </div>
      ) : null}

      {v.pendingGift ? (
        <div className="hover-panel__gift" role="status">
          <span>🎁 {lang === "zh-CN" ? "看我捡到了什么！" : "Look what I found!"}</span>
          <button
            type="button"
            className="hover-panel__gift-btn"
            disabled={busy === "gift"}
            onClick={() => void handleClaimGift()}
          >
            {lang === "zh-CN" ? "领取" : "Claim"}
          </button>
        </div>
      ) : null}

      {feedback ? <p className="hover-panel__toast">{feedback}</p> : null}

      <nav className="hover-panel__tabs" role="tablist">
        <TabBtn active={tab === "feed"} onClick={() => setTab("feed")}>
          🍖 {lang === "zh-CN" ? "投喂" : "Feed"}
        </TabBtn>
        <TabBtn active={tab === "play"} onClick={() => setTab("play")}>
          🥏 {lang === "zh-CN" ? "玩耍" : "Play"}
        </TabBtn>
        <TabBtn active={tab === "today"} onClick={() => setTab("today")}>
          📊 {lang === "zh-CN" ? "今日" : "Today"}
        </TabBtn>
        <TabBtn active={tab === "chat"} onClick={() => setTab("chat")}>
          💬 {lang === "zh-CN" ? "聊天" : "Chat"}
        </TabBtn>
      </nav>

      <div className="hover-panel__body" role="tabpanel">
        {tab === "feed" ? (
          <FeedTab
            inventoryItems={inventoryItems}
            shopItems={ITEM_CATALOG}
            level={levelInfo.level}
            species={species}
            coins={v.coins}
            lang={lang}
            busy={busy}
            onFeed={handleFeed}
            onBuy={handleBuy}
          />
        ) : null}

        {tab === "play" ? (
          <PlayTab
            games={games}
            playCount={v.today.playCount}
            level={levelInfo.level}
            companionActive={companionActive}
            lang={lang}
            busy={busy}
            onPlay={handlePlay}
            onStroke={handleStroke}
            onCompanion={handleCompanion}
          />
        ) : null}

        {tab === "today" ? (
          <TodayTab
            fed={v.today.fedCount}
            played={Object.values(v.today.playCount).reduce((s, n) => s + n, 0)}
            gifts={v.today.giftClaimed}
            pomodoros={v.today.pomodorosCompleted}
            lifetime={v.lifetime}
            lang={lang}
          />
        ) : null}

        {tab === "chat" ? <ChatTab lang={lang} /> : null}
      </div>

      <footer className="hover-panel__footer">
        <button
          type="button"
          className="hover-panel__link"
          onClick={() => {
            window.pawpal.openChatWindow();
            onRequestClose();
          }}
        >
          {lang === "zh-CN" ? "↗ 独立窗口" : "↗ Standalone"}
        </button>
        <button
          type="button"
          className="hover-panel__link"
          onClick={() => window.pawpal.openSettings()}
        >
          {lang === "zh-CN" ? "完整设置 →" : "Full settings →"}
        </button>
      </footer>
    </section>
  );
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`hover-panel__tab${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function VitalRow({
  label,
  value,
  hue
}: {
  label: string;
  value: number;
  hue: "amber" | "rose" | "teal";
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="hover-panel__vital-row">
      <div className="hover-panel__vital-head">
        <span>{label}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <div className="vitals-bar">
        <div
          className={`vitals-bar__fill vitals-bar__fill--${hue}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FeedTab({
  inventoryItems,
  shopItems,
  level,
  species,
  coins,
  lang,
  busy,
  onFeed,
  onBuy
}: {
  inventoryItems: Array<{ item: ItemDefinition; count: number }>;
  shopItems: ItemDefinition[];
  level: number;
  species: ReturnType<typeof getPetSpecies>;
  coins: number;
  lang: Language;
  busy: string | null;
  onFeed: (id: string) => void;
  onBuy: (id: string) => void;
}): JSX.Element {
  return (
    <>
      <h4 className="hover-panel__subtitle">
        {lang === "zh-CN" ? "背包" : "Inventory"}
      </h4>
      {inventoryItems.length === 0 ? (
        <p className="hover-panel__empty">
          {lang === "zh-CN" ? "背包空空，先去下面买点～" : "Empty — buy below."}
        </p>
      ) : (
        <ul className="hover-panel__list">
          {inventoryItems.map((entry) => (
            <li key={entry.item.id} className="hover-panel__row">
              <span className="hover-panel__row-icon">{entry.item.icon}</span>
              <span className="hover-panel__row-label">
                {entry.item.label[lang]}
                <small>
                  {effectSummary(entry.item, lang)} · ×{entry.count}
                </small>
              </span>
              <button
                type="button"
                className="hover-panel__row-cta is-primary"
                disabled={busy === `feed:${entry.item.id}`}
                onClick={() => onFeed(entry.item.id)}
              >
                {lang === "zh-CN" ? "投喂" : "Feed"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4 className="hover-panel__subtitle">
        {lang === "zh-CN" ? "商店" : "Shop"}
      </h4>
      <ul className="hover-panel__list">
        {shopItems
          .filter((item) => !item.appliesTo || item.appliesTo.includes(species))
          .map((item) => {
            const locked = (item.minLevel ?? 1) > level;
            const unaffordable = coins < item.price;
            return (
              <li
                key={item.id}
                className={`hover-panel__row${locked ? " is-locked" : ""}`}
              >
                <span className="hover-panel__row-icon">{item.icon}</span>
                <span className="hover-panel__row-label">
                  {item.label[lang]}
                  <small>
                    {effectSummary(item, lang)}
                    {locked ? ` · 🔒 Lv${item.minLevel}` : ""}
                  </small>
                </span>
                <span className="hover-panel__row-price">🦴 {item.price}</span>
                <button
                  type="button"
                  className="hover-panel__row-cta"
                  disabled={locked || unaffordable || busy === `buy:${item.id}`}
                  onClick={() => onBuy(item.id)}
                >
                  {lang === "zh-CN" ? "购买" : "Buy"}
                </button>
              </li>
            );
          })}
      </ul>
    </>
  );
}

function PlayTab({
  games,
  playCount,
  level,
  companionActive,
  lang,
  busy,
  onPlay,
  onStroke,
  onCompanion
}: {
  games: MiniGameDefinition[];
  playCount: Record<string, number>;
  level: number;
  companionActive: boolean;
  lang: Language;
  busy: string | null;
  onPlay: (game: MiniGameDefinition, exhausted: boolean) => void;
  onStroke: () => void;
  onCompanion: (minutes: number) => void;
}): JSX.Element {
  return (
    <>
      <h4 className="hover-panel__subtitle">
        {lang === "zh-CN" ? "迷你游戏" : "Mini-games"}
      </h4>
      <ul className="hover-panel__list">
        {games.map((game) => {
          const playedToday = playCount[game.id] ?? 0;
          const exhausted = playedToday >= game.dailyCap;
          return (
            <li key={game.id} className={`hover-panel__row${exhausted ? " is-locked" : ""}`}>
              <span className="hover-panel__row-icon">{game.icon}</span>
              <span className="hover-panel__row-label">
                {game.label[lang]}
                <small>
                  {playedToday}/{game.dailyCap} ·{" "}
                  {lang === "zh-CN" ? "心情+" : "mood+"}
                  {game.baseReward.mood + game.bonusReward.mood} ·{" "}
                  +{game.baseReward.coins + game.bonusReward.coins} 🦴
                </small>
              </span>
              <button
                type="button"
                className="hover-panel__row-cta is-primary"
                disabled={exhausted}
                onClick={() => onPlay(game, exhausted)}
              >
                {lang === "zh-CN" ? "开始" : "Play"}
              </button>
            </li>
          );
        })}
        <li className="hover-panel__row">
          <span className="hover-panel__row-icon">🐾</span>
          <span className="hover-panel__row-label">
            {lang === "zh-CN" ? "摸摸头" : "Pet"}
            <small>{lang === "zh-CN" ? "心情+5 · 60s 冷却" : "mood+5 · 60s cooldown"}</small>
          </span>
          <button
            type="button"
            className="hover-panel__row-cta"
            disabled={busy === "stroke"}
            onClick={onStroke}
          >
            {lang === "zh-CN" ? "摸一下" : "Stroke"}
          </button>
        </li>
      </ul>

      <h4 className="hover-panel__subtitle">
        {lang === "zh-CN" ? "陪伴模式" : "Companion"}
      </h4>
      <div className="hover-panel__companion-grid">
        <CompanionBtn
          minutes={5}
          locked={false}
          busy={busy === "companion:5"}
          disabled={companionActive}
          onClick={() => onCompanion(5)}
        />
        <CompanionBtn
          minutes={15}
          locked={level < 2}
          busy={busy === "companion:15"}
          disabled={companionActive}
          onClick={() => onCompanion(15)}
        />
        <CompanionBtn
          minutes={30}
          locked={level < 4}
          busy={busy === "companion:30"}
          disabled={companionActive}
          onClick={() => onCompanion(30)}
        />
      </div>
    </>
  );
}

function CompanionBtn({
  minutes,
  locked,
  busy,
  disabled,
  onClick
}: {
  minutes: number;
  locked: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`hover-panel__companion-btn${locked ? " is-locked" : ""}`}
      disabled={locked || disabled || busy}
      onClick={onClick}
    >
      <strong>{minutes}min</strong>
      {locked ? <small>🔒 Lv{minutes === 15 ? 2 : 4}</small> : null}
    </button>
  );
}

function TodayTab({
  fed,
  played,
  gifts,
  pomodoros,
  lifetime,
  lang
}: {
  fed: number;
  played: number;
  gifts: number;
  pomodoros: number;
  lifetime: { fed: number; played: number; gifts: number };
  lang: Language;
}): JSX.Element {
  return (
    <>
      <h4 className="hover-panel__subtitle">
        {lang === "zh-CN" ? "今日数据" : "Today"}
      </h4>
      <div className="hover-panel__today-grid">
        <Counter label={lang === "zh-CN" ? "投喂" : "Fed"} value={fed} />
        <Counter label={lang === "zh-CN" ? "玩耍" : "Play"} value={played} />
        <Counter label={lang === "zh-CN" ? "礼物" : "Gifts"} value={gifts} />
        <Counter label={lang === "zh-CN" ? "番茄" : "Pomodoros"} value={pomodoros} />
      </div>

      <h4 className="hover-panel__subtitle">
        {lang === "zh-CN" ? "成就" : "Achievements"}
      </h4>
      <ul className="hover-panel__achievements">
        <Achievement
          unlocked={lifetime.fed >= 1}
          label={lang === "zh-CN" ? "首次投喂" : "First feed"}
        />
        <Achievement
          unlocked={lifetime.played >= 1}
          label={lang === "zh-CN" ? "首次玩耍" : "First play"}
        />
        <Achievement
          unlocked={lifetime.gifts >= 1}
          label={lang === "zh-CN" ? "收到礼物" : "First gift"}
        />
        <Achievement
          unlocked={lifetime.fed >= 30}
          label={lang === "zh-CN" ? "投喂达人 30+" : "Feeder 30+"}
        />
      </ul>
    </>
  );
}

function Counter({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="hover-panel__counter">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Achievement({
  unlocked,
  label
}: {
  unlocked: boolean;
  label: string;
}): JSX.Element {
  return (
    <li className={`hover-panel__achievement${unlocked ? " is-on" : ""}`}>
      <span className="hover-panel__achievement-dot">{unlocked ? "✓" : "◌"}</span>
      <span>{label}</span>
    </li>
  );
}

function effectSummary(item: ItemDefinition, lang: Language): string {
  const parts: string[] = [];
  const map: Array<[keyof ItemDefinition["effect"], string]> = [
    ["hunger", lang === "zh-CN" ? "饱" : "hng"],
    ["mood", lang === "zh-CN" ? "心" : "mood"],
    ["energy", lang === "zh-CN" ? "力" : "ene"]
  ];
  for (const [key, label] of map) {
    const v = item.effect[key];
    if (v) parts.push(`${label}+${v}`);
  }
  return parts.join(" ");
}

function reasonText(reason: string, lang: Language): string {
  if (lang !== "zh-CN") {
    switch (reason) {
      case "no_inventory":
        return "Out of stock";
      case "cooldown":
        return "On cooldown";
      case "no_coins":
        return "Not enough coins";
      case "level_locked":
        return "Locked by level";
      case "unknown_item":
      case "unknown_game":
      default:
        return "Action failed";
    }
  }
  switch (reason) {
    case "no_inventory":
      return "背包里没有这个食物";
    case "cooldown":
      return "刚操作过，等会儿再来";
    case "no_coins":
      return "骨头币不够呢";
    case "level_locked":
      return "等级还没解锁";
    case "unknown_item":
    case "unknown_game":
    default:
      return "操作失败";
  }
}

function ChatTab({ lang }: { lang: Language }): JSX.Element {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const streamRef = useRef<HTMLDivElement | null>(null);
  const chat = useChat(session);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const list = await window.pawpal.ai.listSessions();
        const next = list.length > 0 ? list[0] : await window.pawpal.ai.newSession();
        if (!cancelled) setSession(next);
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (loadError) {
    return <p className="hover-panel__empty">{loadError}</p>;
  }
  if (!session) {
    return (
      <p className="hover-panel__empty">{lang === "zh-CN" ? "载入中…" : "Loading…"}</p>
    );
  }

  return (
    <div className="hover-panel__chat">
      <div
        className="bubble-chat__stream"
        ref={streamRef}
        role="log"
        aria-live="polite"
      >
        {renderable.length === 0 && !chat.streaming ? (
          <p className="bubble-chat__empty">
            {lang === "zh-CN" ? "说点什么吧～" : "Say hi…"}
          </p>
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
              {lang === "zh-CN" ? "关闭" : "Dismiss"}
            </button>
          </div>
        ) : null}
      </div>
      <div className="bubble-chat__input-row">
        <textarea
          className="bubble-chat__input"
          placeholder={
            lang === "zh-CN" ? "Enter 发送 · Shift+Enter 换行" : "Enter to send"
          }
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKey}
          rows={1}
        />
        {chat.streaming || chat.isSending ? (
          <button
            type="button"
            className="bubble-chat__send is-danger"
            onClick={() => chat.stop()}
          >
            {lang === "zh-CN" ? "停止" : "Stop"}
          </button>
        ) : (
          <button
            type="button"
            className="bubble-chat__send"
            disabled={!input.trim()}
            onClick={() => void handleSend()}
          >
            {lang === "zh-CN" ? "发送" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}
