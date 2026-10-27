// Titles: earned by doing things (levels, hunting, cards, the forge…), and
// one at a time shown under your name. Some come with their own aura.
//
// Pure data shared by the server (which keeps count and hands titles out) and
// the client (the titles window and name tags). Title ids are saved in the
// database, so never rename one; retire it instead.

import { ITEMS, type ItemId, type Rarity } from "./items";
import { LEVEL_CAP, isMonsterId, type MonsterId } from "./rpg";

/** What a character has done so far, saved with them. */
export interface Deeds {
  /** Monsters they helped defeat, by kind. */
  kills: Partial<Record<MonsterId, number>>;
  /** Each kind of monster card they found fresh from a monster. */
  cards: ItemId[];
  /** Legendary items found fresh from a monster. */
  legendary: number;
  /** Their best upgrade ever (even if it later failed back down). */
  bestUp: number;
  /** Upgrades that failed. */
  upFails: number;
  /** Opened a shop in the Market Square. */
  shop: boolean;
}

export const noDeeds = (): Deeds => ({ kills: {}, cards: [], legendary: 0, bestUp: 0, upFails: 0, shop: false });

const count = (raw: unknown) => (Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0);

/** Saved deeds, with anything broken or unknown dropped. */
export function cleanDeeds(raw: unknown): Deeds {
  const d = noDeeds();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  if (r.kills && typeof r.kills === "object") {
    for (const [k, v] of Object.entries(r.kills)) if (isMonsterId(k) && count(v) > 0) d.kills[k] = count(v);
  }
  if (Array.isArray(r.cards)) d.cards = [...new Set(r.cards.filter((c): c is ItemId => typeof c === "string" && ITEMS[c as ItemId]?.kind === "card"))];
  d.legendary = count(r.legendary);
  d.bestUp = Math.min(10, count(r.bestUp));
  d.upFails = count(r.upFails);
  d.shop = r.shop === true;
  return d;
}

/** How a title is earned. */
export type TitleGoal =
  | { kind: "level"; n: number }
  /** Help defeat `n` monsters (of one kind, or any). */
  | { kind: "kills"; n: number; monster?: MonsterId }
  /** Find `n` different monster cards. */
  | { kind: "cards"; n: number }
  | { kind: "legendary" }
  | { kind: "upgrade"; n: number }
  | { kind: "upFails"; n: number }
  | { kind: "shop" }
  /** One of the first PIONEERS players to reach the level cap. */
  | { kind: "pioneer" };

export type TitleGroup = "Levels" | "Hunting" | "Collecting" | "The forge" | "Town";
export const TITLE_GROUPS: TitleGroup[] = ["Levels", "Hunting", "Collecting", "The forge", "Town"];

export interface TitleDef {
  id: string;
  name: string;
  /** How rare it is: colours the name tag. Epic and legendary titles are town news. */
  tier: Rarity;
  group: TitleGroup;
  goal: TitleGoal;
  /** How to earn it, in one line. */
  how: string;
  /** Showing it gives this aura instead of your gear's (see AURA_* in items.ts). */
  aura?: number;
}

/** How many players become Pioneers at each level cap. */
export const PIONEERS = 10;
/** Every kind of monster card there is. */
export const ALL_CARDS = Object.values(ITEMS).filter((it) => it.kind === "card").length;

/** Title auras (gear auras are 7, 9, 10 and 20; see auraOf in items.ts). */
export const AURA_KINGSLAYER = 30;
export const AURA_CARD_MASTER = 31;
export const AURA_PIONEER = 32;

const def = <T extends Record<string, Omit<TitleDef, "id">>>(titles: T) =>
  Object.fromEntries(Object.entries(titles).map(([id, t]) => [id, { id, ...t }])) as { [K in keyof T]: TitleDef & { id: K } };

export const TITLES = def({
  // ------------------------------------------------------------ levels
  adventurer: { name: "Adventurer", tier: "uncommon", group: "Levels", goal: { kind: "level", n: 10 }, how: "Reach level 10." },
  veteran: { name: "Veteran", tier: "uncommon", group: "Levels", goal: { kind: "level", n: 20 }, how: "Reach level 20." },
  champion: { name: "Champion", tier: "rare", group: "Levels", goal: { kind: "level", n: 30 }, how: "Reach level 30." },
  hero: { name: "Hero", tier: "epic", group: "Levels", goal: { kind: "level", n: 40 }, how: "Reach level 40." },
  legend: { name: "Legend", tier: "legendary", group: "Levels", goal: { kind: "level", n: 50 }, how: "Reach level 50." },
  pioneer: {
    name: "Pioneer", tier: "legendary", group: "Levels", goal: { kind: "pioneer" }, aura: AURA_PIONEER,
    how: `Be one of the first ${PIONEERS} players to reach the level cap (now ${LEVEL_CAP}). Signed-in players only.`,
  },

  // ------------------------------------------------------------ hunting
  slimeSquasher: { name: "Slime Squasher", tier: "common", group: "Hunting", goal: { kind: "kills", n: 100, monster: "slime" }, how: "Help defeat 100 Slimes." },
  monsterHunter: { name: "Monster Hunter", tier: "uncommon", group: "Hunting", goal: { kind: "kills", n: 1000 }, how: "Help defeat 1,000 monsters." },
  ghostHunter: { name: "Ghost Hunter", tier: "rare", group: "Hunting", goal: { kind: "kills", n: 300, monster: "ghost" }, how: "Help defeat 300 Ghosts." },
  kingslayer: { name: "Kingslayer", tier: "epic", group: "Hunting", goal: { kind: "kills", n: 10, monster: "pumpking" }, aura: AURA_KINGSLAYER, how: "Help defeat the Pumpking 10 times." },
  monsterSlayer: { name: "Monster Slayer", tier: "epic", group: "Hunting", goal: { kind: "kills", n: 10_000 }, how: "Help defeat 10,000 monsters." },

  // ------------------------------------------------------------ collecting
  cardFinder: { name: "Card Finder", tier: "rare", group: "Collecting", goal: { kind: "cards", n: 1 }, how: "Find a monster card." },
  cardCollector: { name: "Card Collector", tier: "epic", group: "Collecting", goal: { kind: "cards", n: 5 }, how: "Find 5 different monster cards." },
  cardMaster: {
    name: "Card Master", tier: "legendary", group: "Collecting", goal: { kind: "cards", n: ALL_CARDS }, aura: AURA_CARD_MASTER,
    how: `Find every kind of monster card (${ALL_CARDS} so far).`,
  },
  lucky: { name: "Lucky", tier: "epic", group: "Collecting", goal: { kind: "legendary" }, how: "Find a legendary item." },

  // ------------------------------------------------------------ the forge
  shiny: { name: "Shiny", tier: "rare", group: "The forge", goal: { kind: "upgrade", n: 7 }, how: "Upgrade any gear to +7." },
  forgeMaster: { name: "Forge Master", tier: "epic", group: "The forge", goal: { kind: "upgrade", n: 10 }, how: "Upgrade any gear to +10." },
  neverGiveUp: { name: "Never Give Up", tier: "rare", group: "The forge", goal: { kind: "upFails", n: 30 }, how: "Fail 30 upgrades, and keep going." },

  // ------------------------------------------------------------ town
  shopkeeper: { name: "Shopkeeper", tier: "uncommon", group: "Town", goal: { kind: "shop" }, how: "Open your own shop in the Market Square." },
});

export type TitleId = keyof typeof TITLES;
export const isTitleId = (id: unknown): id is TitleId => typeof id === "string" && Object.hasOwn(TITLES, id);

const kills = (d: Deeds, monster?: MonsterId) =>
  monster ? (d.kills[monster] ?? 0) : Object.values(d.kills).reduce((a, n) => a + (n ?? 0), 0);

/** How far along a title is: [done, needed]. Pioneer can't be counted, only given. */
export function titleProgress(t: TitleDef, d: Deeds, level: number): [number, number] {
  const g = t.goal;
  switch (g.kind) {
    case "level":
      return [Math.min(level, g.n), g.n];
    case "kills":
      return [Math.min(kills(d, g.monster), g.n), g.n];
    case "cards":
      return [Math.min(d.cards.length, g.n), g.n];
    case "legendary":
      return [Math.min(d.legendary, 1), 1];
    case "upgrade":
      return [Math.min(d.bestUp, g.n), g.n];
    case "upFails":
      return [Math.min(d.upFails, g.n), g.n];
    case "shop":
      return [d.shop ? 1 : 0, 1];
    case "pioneer":
      return [0, 1];
  }
}

/** Titles whose goal is met but that aren't in `earned` yet (never Pioneer, which is handed out separately). */
export function newTitles(d: Deeds, level: number, earned: readonly TitleId[]): TitleId[] {
  return (Object.values(TITLES) as (TitleDef & { id: TitleId })[])
    .filter((t) => t.goal.kind !== "pioneer" && !earned.includes(t.id))
    .filter((t) => {
      const [done, need] = titleProgress(t, d, level);
      return done >= need;
    })
    .map((t) => t.id);
}

/** server -> client: your titles, which one you show, and how far along the rest are. */
export interface TitlesMessage {
  earned: TitleId[];
  shown: TitleId | "";
  progress: Partial<Record<TitleId, [number, number]>>;
}

/** client -> server: show this title under your name ("" for none). */
export interface TitleShowMessage {
  id: string;
}
