import type { PetSpecies } from "./petSpecies";

/**
 * Item catalog for the feeding / play loop.
 *
 * - "food" items can be bought with coins, stocked in the inventory, and
 *   consumed via `feed(itemId)` to restore vitals.
 * - "consumable" items are non-food but use-once (e.g. a coupon for a free
 *   mini-game). v1 only ships food; consumable types are reserved.
 *
 * `appliesTo` filters who sees the item. v1 dog-only; future cat content can
 * register `appliesTo: ["cat"]` items (e.g. 小鱼干, 逗猫棒) without touching
 * existing data.
 */

export type ItemKind = "food" | "consumable";

export interface ItemEffect {
  hunger?: number;
  mood?: number;
  energy?: number;
  /** Bond exp granted on consume. */
  bondExp?: number;
}

export interface ItemDefinition {
  id: string;
  kind: ItemKind;
  /** Display label per language. */
  label: { "zh-CN": string; en: string };
  /** Short tagline shown in inventory / shop. */
  tagline: { "zh-CN": string; en: string };
  /** Emoji rendered as the item icon for v1 (no asset pipeline yet). */
  icon: string;
  /** Cost in 🦴 coins. 0 = not for sale (reward-only). */
  price: number;
  /** Stat changes applied on consume. */
  effect: ItemEffect;
  /** Min level to unlock. Defaults to 1. */
  minLevel?: number;
  /** Species filter; missing means all species. */
  appliesTo?: PetSpecies[];
}

/**
 * v1 catalog. Order matters — the shop renders in this order.
 * Cat-specific items are placeholder examples kept commented to make it
 * obvious where future cat content lands; do not enable until species "cat"
 * has matching art.
 */
export const ITEM_CATALOG: ItemDefinition[] = [
  {
    id: "biscuit",
    kind: "food",
    label: { "zh-CN": "小饼干", en: "Biscuit" },
    tagline: { "zh-CN": "随手喂的小零食", en: "A quick snack" },
    icon: "🍪",
    price: 5,
    effect: { hunger: 15, mood: 5, bondExp: 1 },
    appliesTo: ["dog", "cat"]
  },
  {
    id: "kibble",
    kind: "food",
    label: { "zh-CN": "狗粮", en: "Kibble" },
    tagline: { "zh-CN": "正餐管饱", en: "A solid meal" },
    icon: "🥣",
    price: 12,
    effect: { hunger: 35, mood: 5, energy: 5, bondExp: 1 },
    appliesTo: ["dog"]
  },
  {
    id: "roastBone",
    kind: "food",
    label: { "zh-CN": "烤骨头", en: "Roast Bone" },
    tagline: { "zh-CN": "心情快充", en: "Mood booster" },
    icon: "🍖",
    price: 25,
    effect: { hunger: 20, mood: 25, energy: 5, bondExp: 2 },
    minLevel: 2,
    appliesTo: ["dog"]
  },
  {
    id: "milk",
    kind: "food",
    label: { "zh-CN": "牛奶", en: "Milk" },
    tagline: { "zh-CN": "精力快充", en: "Energy boost" },
    icon: "🥛",
    price: 8,
    effect: { hunger: 10, energy: 20, bondExp: 1 },
    appliesTo: ["dog", "cat"]
  },
  {
    id: "deluxeMeal",
    kind: "food",
    label: { "zh-CN": "营养餐", en: "Deluxe Meal" },
    tagline: { "zh-CN": "周末套餐", en: "Weekend treat" },
    icon: "🍱",
    price: 50,
    effect: { hunger: 50, mood: 20, energy: 20, bondExp: 5 },
    minLevel: 3,
    appliesTo: ["dog"]
  }
  // Cat-only roadmap (do NOT enable until cat appearance + art landed):
  // { id: "fishJerky", kind: "food", icon: "🐟", price: 10,
  //   effect: { hunger: 25, mood: 10, bondExp: 1 }, appliesTo: ["cat"] }
];

export function getItemById(id: string): ItemDefinition | undefined {
  return ITEM_CATALOG.find((item) => item.id === id);
}

/** Items the user is allowed to see/buy/use given a species + level. */
export function visibleItemsFor(
  species: PetSpecies,
  level: number
): ItemDefinition[] {
  return ITEM_CATALOG.filter((item) => {
    if (item.appliesTo && !item.appliesTo.includes(species)) return false;
    if ((item.minLevel ?? 1) > level) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Mini-games                                                                  */
/* -------------------------------------------------------------------------- */

export type MiniGameId = "frisbee" | "tailChase" | "teaserWand";

export interface MiniGameDefinition {
  id: MiniGameId;
  label: { "zh-CN": string; en: string };
  /** Emoji shown in the menu. */
  icon: string;
  /** Daily play cap. */
  dailyCap: number;
  /** Reward on completion (also applied as cap-min for 安慰奖). */
  baseReward: { coins: number; mood: number; bondExp: number };
  /** Bonus on perfect score (passed by the game window via "score >= goal"). */
  bonusReward: { coins: number; mood: number; bondExp: number };
  /** Min level to unlock. Defaults to 1. */
  minLevel?: number;
  /** Species filter. */
  appliesTo?: PetSpecies[];
}

export const MINI_GAMES: MiniGameDefinition[] = [
  {
    id: "frisbee",
    label: { "zh-CN": "接飞盘", en: "Frisbee" },
    icon: "🥏",
    dailyCap: 3,
    baseReward: { coins: 5, mood: 20, bondExp: 3 },
    bonusReward: { coins: 10, mood: 10, bondExp: 2 },
    appliesTo: ["dog"]
  },
  {
    id: "tailChase",
    label: { "zh-CN": "抓尾巴", en: "Tail Chase" },
    icon: "🌀",
    dailyCap: 3,
    baseReward: { coins: 5, mood: 20, bondExp: 3 },
    bonusReward: { coins: 10, mood: 10, bondExp: 2 },
    minLevel: 3,
    appliesTo: ["dog", "cat"]
  },
  {
    id: "teaserWand",
    label: { "zh-CN": "逗猫棒", en: "Teaser Wand" },
    icon: "🪶",
    dailyCap: 3,
    baseReward: { coins: 5, mood: 25, bondExp: 3 },
    bonusReward: { coins: 10, mood: 10, bondExp: 2 },
    appliesTo: ["cat"]
  }
];

export function visibleGamesFor(
  species: PetSpecies,
  level: number
): MiniGameDefinition[] {
  return MINI_GAMES.filter((g) => {
    if (g.appliesTo && !g.appliesTo.includes(species)) return false;
    if ((g.minLevel ?? 1) > level) return false;
    return true;
  });
}

export function getGameById(id: string): MiniGameDefinition | undefined {
  return MINI_GAMES.find((g) => g.id === id);
}
