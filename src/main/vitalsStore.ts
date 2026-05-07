import Store from "electron-store";
import {
  COIN_REWARDS,
  COOLDOWNS,
  DECAY_BREAK,
  DECAY_COMPANION,
  DECAY_FOCUS,
  DECAY_IDLE,
  DECAY_SLEEP,
  applyDecay,
  clampVital,
  computeLevel,
  createDefaultVitals,
  isSleepWindow,
  todayKey,
  type PendingGift,
  type PetVitals
} from "../shared/vitals";
import { getItemById, type ItemDefinition } from "../shared/items";

/**
 * Persistence + mutation layer for PetVitals.
 *
 * Owns:
 * - Disk read/write via electron-store
 * - Day rollover (reset today.*  counters when crossing midnight)
 * - Per-tick decay application (caller passes runtime context)
 * - Inventory + coin operations (feed/buyItem/etc.)
 * - Gift queueing
 *
 * Does NOT own:
 * - Tick scheduling — main.ts decides when to call tick().
 * - Bubble UI — main.ts reads vitals, decides which bubble to push.
 */

interface RootStoreSchema {
  vitals?: PetVitals;
}

const STORAGE_KEY = "vitals";

export type RuntimeContext =
  | "idle"
  | "focus"
  | "break"
  | "companion"
  | "sleep";

export interface FeedResult {
  ok: true;
  item: ItemDefinition;
  vitals: PetVitals;
}

export interface FeedError {
  ok: false;
  reason: "no_inventory" | "cooldown" | "unknown_item";
}

export interface BuyResult {
  ok: true;
  vitals: PetVitals;
}

export interface BuyError {
  ok: false;
  reason: "no_coins" | "unknown_item" | "level_locked";
}

export class VitalsStore {
  private readonly store: Store<RootStoreSchema>;
  private cache: PetVitals;

  constructor(store?: Store<RootStoreSchema>) {
    this.store =
      store ??
      (new Store<RootStoreSchema>({ name: "pawpal" }) as Store<RootStoreSchema>);
    this.cache = this.loadFromDisk();
  }

  /** Returns a deep-frozen-ish snapshot. Callers MUST treat as read-only. */
  get(): PetVitals {
    return this.cache;
  }

  /** Replace cache (e.g. for tests) and persist. */
  setForTest(vitals: PetVitals): void {
    this.cache = vitals;
    this.persist();
  }

  /**
   * Apply one tick of decay based on runtime context. Also handles companion
   * mode auto-expiry and day rollover. Returns the new vitals.
   */
  tick(context: RuntimeContext, now = Date.now()): PetVitals {
    const next = this.maybeRolloverDay(this.cache, now);
    const afterCompanion = this.maybeExpireCompanion(next, now);
    const profile = this.profileFor(afterCompanion, context, now);
    const decayed = applyDecay(afterCompanion, profile);
    this.cache = decayed;
    this.persist();
    return decayed;
  }

  /** Award coins (e.g. on Pomodoro complete). Idempotent enough for callers. */
  earn(amount: number): PetVitals {
    if (!Number.isFinite(amount) || amount <= 0) return this.cache;
    this.cache = { ...this.cache, coins: this.cache.coins + Math.round(amount) };
    this.persist();
    return this.cache;
  }

  /** Mark a pomodoro completion — used by gift trigger logic. */
  recordPomodoro(): PetVitals {
    const now = Date.now();
    const rolled = this.maybeRolloverDay(this.cache, now);
    const updated: PetVitals = {
      ...rolled,
      today: { ...rolled.today, pomodorosCompleted: rolled.today.pomodorosCompleted + 1 }
    };
    this.cache = updated;
    this.persist();
    return updated;
  }

  /** Daily check-in. Returns updated vitals + whether the bonus was claimed. */
  claimCheckin(now = Date.now()): { vitals: PetVitals; awarded: boolean } {
    const rolled = this.maybeRolloverDay(this.cache, now);
    if (rolled.today.checkinClaimed) {
      this.cache = rolled;
      this.persist();
      return { vitals: rolled, awarded: false };
    }
    const updated: PetVitals = {
      ...rolled,
      coins: rolled.coins + COIN_REWARDS.dailyCheckin,
      today: { ...rolled.today, checkinClaimed: true }
    };
    this.cache = updated;
    this.persist();
    return { vitals: updated, awarded: true };
  }

  /**
   * Feed the pet with an item from inventory. Validates cooldown + stock.
   */
  feed(itemId: string, now = Date.now()): FeedResult | FeedError {
    const item = getItemById(itemId);
    if (!item) return { ok: false, reason: "unknown_item" };
    const stock = this.cache.inventory[itemId] ?? 0;
    if (stock <= 0) return { ok: false, reason: "no_inventory" };
    const cooldownEnd = this.cache.cooldowns["feed:any"] ?? 0;
    if (cooldownEnd > now) return { ok: false, reason: "cooldown" };

    const newInventory = { ...this.cache.inventory };
    newInventory[itemId] = stock - 1;
    if (newInventory[itemId] <= 0) delete newInventory[itemId];

    const updated: PetVitals = {
      ...this.cache,
      hunger: clampVital(this.cache.hunger + (item.effect.hunger ?? 0)),
      mood: clampVital(this.cache.mood + (item.effect.mood ?? 0)),
      energy: clampVital(this.cache.energy + (item.effect.energy ?? 0)),
      exp: this.cache.exp + (item.effect.bondExp ?? 0),
      inventory: newInventory,
      cooldowns: { ...this.cache.cooldowns, "feed:any": now + COOLDOWNS.feedAny },
      today: { ...this.cache.today, fedCount: this.cache.today.fedCount + 1 },
      lifetime: { ...this.cache.lifetime, fed: this.cache.lifetime.fed + 1 }
    };
    this.cache = updated;
    this.persist();
    return { ok: true, item, vitals: updated };
  }

  /**
   * Buy `qty` of an item. Validates coins + level.
   */
  buy(itemId: string, qty = 1): BuyResult | BuyError {
    const item = getItemById(itemId);
    if (!item) return { ok: false, reason: "unknown_item" };
    const level = computeLevel(this.cache.exp).level;
    if ((item.minLevel ?? 1) > level) return { ok: false, reason: "level_locked" };
    const totalCost = item.price * qty;
    if (totalCost > this.cache.coins) return { ok: false, reason: "no_coins" };

    const newInventory = { ...this.cache.inventory };
    newInventory[itemId] = (newInventory[itemId] ?? 0) + qty;

    const updated: PetVitals = {
      ...this.cache,
      coins: this.cache.coins - totalCost,
      inventory: newInventory
    };
    this.cache = updated;
    this.persist();
    return { ok: true, vitals: updated };
  }

  /** Quick stroke (摸摸头). Cooldown + small mood bump. */
  petStroke(now = Date.now()): { ok: boolean; vitals: PetVitals; reason?: "cooldown" } {
    const cooldownEnd = this.cache.cooldowns["pet"] ?? 0;
    if (cooldownEnd > now) return { ok: false, vitals: this.cache, reason: "cooldown" };
    const updated: PetVitals = {
      ...this.cache,
      mood: clampVital(this.cache.mood + 5),
      exp: this.cache.exp + 1,
      cooldowns: { ...this.cache.cooldowns, pet: now + COOLDOWNS.petStroke }
    };
    this.cache = updated;
    this.persist();
    return { ok: true, vitals: updated };
  }

  /**
   * Award mini-game completion. Caller passes whether the score hit the
   * bonus threshold.
   */
  recordGamePlay(
    gameId: string,
    bonus: boolean,
    base: { coins: number; mood: number; bondExp: number },
    bonusReward: { coins: number; mood: number; bondExp: number },
    now = Date.now()
  ): PetVitals {
    const rolled = this.maybeRolloverDay(this.cache, now);
    const todayCount = rolled.today.playCount[gameId] ?? 0;
    const updated: PetVitals = {
      ...rolled,
      coins: rolled.coins + base.coins + (bonus ? bonusReward.coins : 0),
      mood: clampVital(rolled.mood + base.mood + (bonus ? bonusReward.mood : 0)),
      energy: clampVital(rolled.energy - 10),
      exp: rolled.exp + base.bondExp + (bonus ? bonusReward.bondExp : 0),
      cooldowns: { ...rolled.cooldowns, [`play:${gameId}`]: now + COOLDOWNS.miniGame },
      today: {
        ...rolled.today,
        playCount: { ...rolled.today.playCount, [gameId]: todayCount + 1 }
      },
      lifetime: { ...rolled.lifetime, played: rolled.lifetime.played + 1 }
    };
    this.cache = updated;
    this.persist();
    return updated;
  }

  /** Companion mode start. */
  startCompanion(durationMs: number, now = Date.now()): PetVitals {
    const updated: PetVitals = {
      ...this.cache,
      companionUntil: now + durationMs,
      companionTotalMs: durationMs
    };
    this.cache = updated;
    this.persist();
    return updated;
  }

  stopCompanion(): PetVitals {
    if (this.cache.companionUntil === null) return this.cache;
    const updated: PetVitals = {
      ...this.cache,
      companionUntil: null,
      companionTotalMs: 0
    };
    this.cache = updated;
    this.persist();
    return updated;
  }

  /** Queue a gift for the user to claim via bubble. No-op if one already pending. */
  queueGift(gift: PendingGift): PetVitals {
    if (this.cache.pendingGift) return this.cache;
    this.cache = { ...this.cache, pendingGift: gift };
    this.persist();
    return this.cache;
  }

  /** Claim and apply pending gift. */
  claimGift(now = Date.now()): { vitals: PetVitals; gift: PendingGift | null } {
    const gift = this.cache.pendingGift;
    if (!gift) return { vitals: this.cache, gift: null };
    const rolled = this.maybeRolloverDay(this.cache, now);
    const inventory = { ...rolled.inventory };
    if (gift.itemId) {
      inventory[gift.itemId] = (inventory[gift.itemId] ?? 0) + 1;
    }
    const updated: PetVitals = {
      ...rolled,
      coins: rolled.coins + (gift.coins ?? 0),
      inventory,
      pendingGift: null,
      today: { ...rolled.today, giftClaimed: rolled.today.giftClaimed + 1 },
      lifetime: { ...rolled.lifetime, gifts: rolled.lifetime.gifts + 1 }
    };
    this.cache = updated;
    this.persist();
    return { vitals: updated, gift };
  }

  /** Increment proactive-play counter (rate-limited bubble trigger). */
  incrementProactivePlayShown(): PetVitals {
    const rolled = this.maybeRolloverDay(this.cache, Date.now());
    const updated: PetVitals = {
      ...rolled,
      today: { ...rolled.today, proactivePlayShown: rolled.today.proactivePlayShown + 1 }
    };
    this.cache = updated;
    this.persist();
    return updated;
  }

  /* ------------------------------------------------------------------------ */
  /* Internals                                                                 */
  /* ------------------------------------------------------------------------ */

  private profileFor(
    vitals: PetVitals,
    context: RuntimeContext,
    now: number
  ): { hunger: number; mood: number; energy: number } {
    if (context === "companion") return DECAY_COMPANION;
    if (context === "focus") return DECAY_FOCUS;
    if (context === "break") return DECAY_BREAK;
    if (context === "sleep" || isSleepWindow(new Date(now))) return DECAY_SLEEP;
    if (vitals.companionUntil && vitals.companionUntil > now) return DECAY_COMPANION;
    return DECAY_IDLE;
  }

  private maybeExpireCompanion(vitals: PetVitals, now: number): PetVitals {
    if (vitals.companionUntil && vitals.companionUntil <= now) {
      return { ...vitals, companionUntil: null, companionTotalMs: 0 };
    }
    return vitals;
  }

  private maybeRolloverDay(vitals: PetVitals, now: number): PetVitals {
    const today = todayKey(new Date(now));
    if (vitals.today.date === today) return vitals;
    return {
      ...vitals,
      today: {
        date: today,
        fedCount: 0,
        playCount: {},
        proactivePlayShown: 0,
        giftClaimed: 0,
        checkinClaimed: false,
        pomodorosCompleted: 0
      }
    };
  }

  private loadFromDisk(): PetVitals {
    const raw = this.store.get(STORAGE_KEY);
    if (!raw || typeof raw !== "object") return createDefaultVitals();
    // Best-effort merge: missing fields fall back to defaults so old installs
    // don't crash after a schema bump.
    const defaults = createDefaultVitals();
    return {
      ...defaults,
      ...raw,
      today: { ...defaults.today, ...(raw as PetVitals).today },
      lifetime: { ...defaults.lifetime, ...(raw as PetVitals).lifetime },
      inventory: { ...((raw as PetVitals).inventory ?? defaults.inventory) },
      cooldowns: { ...((raw as PetVitals).cooldowns ?? {}) },
      pendingGift: (raw as PetVitals).pendingGift ?? null,
      companionUntil: (raw as PetVitals).companionUntil ?? null,
      companionTotalMs: (raw as PetVitals).companionTotalMs ?? 0
    };
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, this.cache);
  }
}
