import type { Language } from "./types";

/**
 * Pet vitals — the persistent care/feed/play state.
 *
 * Decay model: a 1-minute tick subtracts a small amount from each stat. The
 * rate depends on the runtime context (idle vs focus vs companion mode vs
 * sleep window). The store applies the rate it's told; this module only
 * declares the shape and the constants.
 */

export interface PetVitals {
  hunger: number; // 0-100, 100 = 饱
  mood: number; // 0-100, 100 = 开心
  energy: number; // 0-100, 100 = 精力充沛

  /** 🦴 currency. */
  coins: number;
  /** Cumulative bond exp. Level is derived. */
  exp: number;

  /** Inventory: { itemId: count }. */
  inventory: Record<string, number>;

  /**
   * Per-item / global cooldowns expressed as epoch-ms timestamps.
   * - `feed:<itemId>`: per-food cooldown
   * - `feed:any`: global feed cooldown (60s)
   * - `pet`: stroke cooldown (60s)
   * - `play:<gameId>`: per-game cooldown
   */
  cooldowns: Record<string, number>;

  /** Today-scoped counters (date string used to detect rollover). */
  today: {
    date: string; // YYYY-MM-DD
    fedCount: number;
    playCount: Record<string, number>; // gameId → count
    proactivePlayShown: number; // pet 主动找玩 today
    giftClaimed: number;
    checkinClaimed: boolean;
    pomodorosCompleted: number;
  };

  /** Lifetime counters used by achievements. */
  lifetime: {
    fed: number;
    played: number;
    gifts: number;
  };

  /** Companion-mode end timestamp (epoch ms). null = not active. */
  companionUntil: number | null;
  /** Companion mode total duration (ms) — used to compute progress bar. */
  companionTotalMs: number;

  /** Pending unclaimed gift, displayed as a clickable bubble. */
  pendingGift: PendingGift | null;
}

export interface PendingGift {
  /** Discriminator: where the gift came from (so we can theme the bubble). */
  source: "pomodoro" | "checkin" | "achievement";
  /** Coin amount. */
  coins?: number;
  /** Item id from ITEM_CATALOG. */
  itemId?: string;
  /** Optional flavour text, language-keyed. */
  message?: { "zh-CN": string; en: string };
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createDefaultVitals(date = todayKey()): PetVitals {
  return {
    hunger: 80,
    mood: 80,
    energy: 80,
    coins: 30,
    exp: 0,
    inventory: { biscuit: 2, kibble: 1 },
    cooldowns: {},
    today: {
      date,
      fedCount: 0,
      playCount: {},
      proactivePlayShown: 0,
      giftClaimed: 0,
      checkinClaimed: false,
      pomodorosCompleted: 0
    },
    lifetime: { fed: 0, played: 0, gifts: 0 },
    companionUntil: null,
    companionTotalMs: 0,
    pendingGift: null
  };
}

/* -------------------------------------------------------------------------- */
/* Level table                                                                 */
/* -------------------------------------------------------------------------- */

export interface LevelTier {
  level: number;
  expRequired: number; // cumulative exp to reach this level
  label: { "zh-CN": string; en: string };
}

export const LEVEL_TIERS: readonly LevelTier[] = [
  { level: 1, expRequired: 0, label: { "zh-CN": "新朋友", en: "New friend" } },
  { level: 2, expRequired: 30, label: { "zh-CN": "熟人", en: "Familiar" } },
  { level: 3, expRequired: 90, label: { "zh-CN": "亲密", en: "Close" } },
  { level: 4, expRequired: 200, label: { "zh-CN": "最佳搭档", en: "Best buddy" } }
] as const;

export function computeLevel(exp: number): { level: number; label: string; progressPct: number } {
  return computeLevelInLanguage(exp, "zh-CN");
}

export function computeLevelInLanguage(
  exp: number,
  lang: Language
): { level: number; label: string; progressPct: number } {
  let current = LEVEL_TIERS[0];
  let next: LevelTier | null = null;
  for (let i = 0; i < LEVEL_TIERS.length; i += 1) {
    if (exp >= LEVEL_TIERS[i].expRequired) current = LEVEL_TIERS[i];
    if (exp < LEVEL_TIERS[i].expRequired && !next) next = LEVEL_TIERS[i];
  }
  const progressPct = next
    ? Math.min(
        100,
        Math.round(
          ((exp - current.expRequired) / (next.expRequired - current.expRequired)) * 100
        )
      )
    : 100;
  return { level: current.level, label: current.label[lang], progressPct };
}

/* -------------------------------------------------------------------------- */
/* Decay rates (per-minute deltas applied each tick)                           */
/* -------------------------------------------------------------------------- */

export interface DecayProfile {
  hunger: number;
  mood: number;
  energy: number;
}

/** Idle (no focus/break/companion). */
export const DECAY_IDLE: DecayProfile = { hunger: -0.4, mood: -0.4, energy: -0.2 };
/** Focus running — energy drains faster, mood neutral (concentration zen). */
export const DECAY_FOCUS: DecayProfile = { hunger: -0.4, mood: 0, energy: -0.6 };
/** Break (running) — mood actively recovers. */
export const DECAY_BREAK: DecayProfile = { hunger: -0.2, mood: 1, energy: 0 };
/** Companion mode — vitals frozen + slow recovery. */
export const DECAY_COMPANION: DecayProfile = { hunger: 0, mood: 0.5, energy: 0 };
/** Sleep window (23:00-07:00) — half drain. */
export const DECAY_SLEEP: DecayProfile = { hunger: -0.2, mood: -0.1, energy: 0.4 };

export const VITALS_TICK_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Coin earning rules                                                          */
/* -------------------------------------------------------------------------- */

export const COIN_REWARDS = {
  pomodoroComplete: 10,
  breakLogged: 5,
  hydrationLogged: 2,
  dailyCheckin: 15,
  giftMin: 5,
  giftMax: 30
} as const;

/* -------------------------------------------------------------------------- */
/* Threshold rules                                                             */
/* -------------------------------------------------------------------------- */

export const THRESHOLDS = {
  hungerLow: 30,
  moodLow: 30,
  energyLow: 20,
  hungerFull: 90,
  allHigh: 70
} as const;

/* -------------------------------------------------------------------------- */
/* Cooldowns (ms)                                                              */
/* -------------------------------------------------------------------------- */

export const COOLDOWNS = {
  feedAny: 60_000,
  petStroke: 60_000,
  miniGame: 30_000
} as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function clampVital(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 10) / 10;
}

export function applyDecay(vitals: PetVitals, profile: DecayProfile): PetVitals {
  return {
    ...vitals,
    hunger: clampVital(vitals.hunger + profile.hunger),
    mood: clampVital(vitals.mood + profile.mood),
    energy: clampVital(vitals.energy + profile.energy)
  };
}

export function isSleepWindow(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 23 || h < 7;
}
