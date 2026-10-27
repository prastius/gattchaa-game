// Items: what exists, what it does, what it costs and how it looks.
//
// Pure data shared by the server (which owns every bag) and the client (which
// draws icons, gear on characters and the shop lists). Item ids are saved in
// the database, so never rename one; retire it instead.

import type { MonsterId } from "./rpg";

/** Equipment slots, in the order the bag window shows them. */
export const SLOTS = ["weapon", "offhand", "head", "body", "legs", "feet", "ring", "amulet"] as const;
export type Slot = (typeof SLOTS)[number];
export const isSlot = (s: unknown): s is Slot => typeof s === "string" && (SLOTS as readonly string[]).includes(s);

/** Slots that show on the character, in the order of the synced gear string. */
export const VISIBLE_SLOTS = ["weapon", "offhand", "head", "body", "legs", "feet"] as const satisfies readonly Slot[];

export const SLOT_NAMES: Record<Slot, string> = {
  weapon: "Weapon",
  offhand: "Shield",
  head: "Head",
  body: "Armour",
  legs: "Legs",
  feet: "Feet",
  ring: "Ring",
  amulet: "Amulet",
};

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITY: Record<Rarity, { name: string; color: string }> = {
  common: { name: "Common", color: "#e9e4da" },
  uncommon: { name: "Uncommon", color: "#7ddb6e" },
  rare: { name: "Rare", color: "#5cb2ff" },
  epic: { name: "Epic", color: "#c88bff" },
  legendary: { name: "Legendary", color: "#ffad42" },
};

/** One piece of character art (a "gear" item in the LPC manifest) and its colours by material. */
export interface GearArt {
  id: string;
  colors?: Partial<Record<"metal" | "cloth" | "wood", string>>;
}

export interface ItemDef {
  id: string;
  name: string;
  /** equip: worn in `slot`. use: used up (potions). loot: only worth selling. card: goes into equipment. */
  kind: "equip" | "use" | "loot" | "card";
  slot?: Slot;
  rarity: Rarity;
  /** Level needed to wear it. */
  lv?: number;
  /** Bonuses while worn (for a card: while it's in something worn). */
  atk?: number;
  def?: number;
  hp?: number;
  mp?: number;
  /** Extra chance (percentage points) to land a critical hit. */
  crit?: number;
  /** Chance (percent) that a monster's attack misses you. */
  flee?: number;
  /** Share (percent) of every monster hit that bounces back at it. */
  reflect?: number;
  /** Equipment: how many cards it holds. */
  slots?: number;
  /** Cards: the equipment slots it goes into... */
  fits?: Slot[];
  /** ...the word it puts in front of that equipment's name ("Stinging Saber")... */
  prefix?: string;
  /** ...and the monster on the card. */
  monster?: MonsterId;
  /** Potions: HP restored. */
  heal?: number;
  /** The Outfitter sells it for this much (only the items in OUTFITTER_STOCK). */
  price?: number;
  /** Merchants pay this much; defaults to half the price. 0 = can't be sold. */
  sell?: number;
  /** An icon from assets/items (Kyrise's pack); without one, the icon is cut from the gear art. */
  icon?: string;
  /** How it looks when worn (visible slots only). */
  art?: GearArt[];
  desc: string;
}

const def = <T extends Record<string, Omit<ItemDef, "id">>>(items: T) =>
  Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { id, ...item }])) as { [K in keyof T]: ItemDef & { id: K } };

export const ITEMS = def({
  // ------------------------------------------------------------ monster loot
  jelly: { name: "Slime Jelly", kind: "loot", rarity: "common", sell: 2, icon: "pearl_01d", desc: "Wobbly, sticky and oddly warm. Merchants buy it." },
  scale: { name: "Snake Scale", kind: "loot", rarity: "common", sell: 6, icon: "gem_01a", desc: "A shiny green scale from a Grass Snake." },
  honey: { name: "Wild Honey", kind: "loot", rarity: "common", sell: 12, icon: "pearl_01e", desc: "Hornets guard it fiercely. Merchants love it." },
  bloom: { name: "Bloom Crystal", kind: "loot", rarity: "common", sell: 30, icon: "crystal_01f", desc: "Grows inside a Snapper Flower. Pretty, and worth a fair bit." },

  // ------------------------------------------------------------ potions
  redPotion: { name: "Red Potion", kind: "use", rarity: "common", heal: 40, price: 12, icon: "potion_02a", desc: "Restores 40 HP." },
  orangePotion: { name: "Orange Potion", kind: "use", rarity: "common", heal: 100, price: 40, icon: "potion_02f", desc: "Restores 100 HP." },

  // ------------------------------------------------------------ weapons
  dagger: { name: "Dagger", kind: "equip", slot: "weapon", rarity: "common", lv: 1, slots: 1, atk: 3, price: 50, icon: "sword_01b", art: [{ id: "dagger" }], desc: "Short, light and better than your fists." },
  shortSword: { name: "Short Sword", kind: "equip", slot: "weapon", rarity: "common", lv: 3, slots: 1, atk: 6, price: 160, icon: "sword_02b", art: [{ id: "swordIron" }], desc: "A plain iron sword. Every adventurer starts with one." },
  bronzeSword: { name: "Bronze Sword", kind: "equip", slot: "weapon", rarity: "uncommon", lv: 6, slots: 2, atk: 10, sell: 150, icon: "sword_02d", art: [{ id: "swordBronze" }], desc: "Heavier than it looks. Hornets sometimes guard one." },
  saber: { name: "Saber", kind: "equip", slot: "weapon", rarity: "rare", lv: 9, slots: 2, atk: 15, sell: 400, icon: "sword_03b", art: [{ id: "saber" }], desc: "A curved blade found tangled in Snapper Flower roots." },

  // ------------------------------------------------------------ shields
  woodShield: { name: "Wooden Shield", kind: "equip", slot: "offhand", rarity: "common", lv: 1, slots: 1, def: 2, price: 60, icon: "shield_01a", art: [{ id: "shield" }], desc: "Solid maple. Stops a slime, mostly." },
  guardShield: { name: "Guard Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 5, slots: 1, def: 3, hp: 15, sell: 120, icon: "shield_02a", art: [{ id: "shield", colors: { wood: "walnut" } }], desc: "Dark walnut, made for the town guard." },

  // ------------------------------------------------------------ head
  leatherCap: { name: "Leather Cap", kind: "equip", slot: "head", rarity: "common", lv: 1, def: 1, price: 40, art: [{ id: "capLeather" }], desc: "Keeps the sun and the bees off." },
  chainCoif: { name: "Chain Coif", kind: "equip", slot: "head", rarity: "common", lv: 4, slots: 1, def: 2, hp: 10, price: 180, art: [{ id: "coif", colors: { metal: "iron" } }], desc: "Iron rings, linked by hand." },
  kettleHelm: { name: "Kettle Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 7, slots: 1, def: 2, hp: 20, sell: 160, art: [{ id: "kettle" }], desc: "A wide steel brim. Rain runs right off it." },
  bronzeHelm: { name: "Bronze Helm", kind: "equip", slot: "head", rarity: "rare", lv: 9, slots: 1, def: 3, hp: 30, sell: 350, art: [{ id: "nasal", colors: { metal: "bronze" } }], desc: "Polished bronze with a nose guard." },
  meadowCrown: { name: "Meadow Crown", kind: "equip", slot: "head", rarity: "legendary", lv: 10, slots: 1, atk: 4, def: 4, hp: 60, sell: 5000, art: [{ id: "crown" }], desc: "Said to belong to the first king of the meadow. Snapper Flowers hide it very, very rarely." },

  // ------------------------------------------------------------ body
  leatherArmor: { name: "Leather Armour", kind: "equip", slot: "body", rarity: "common", lv: 1, slots: 1, def: 2, price: 80, art: [{ id: "leatherArmor" }], desc: "Boiled leather with a brass buckle." },
  legionArmor: { name: "Legion Armour", kind: "equip", slot: "body", rarity: "uncommon", lv: 6, slots: 1, def: 4, hp: 15, sell: 200, art: [{ id: "legion" }], desc: "Overlapping steel bands. Old, but sturdy." },
  plateArmor: { name: "Plate Armour", kind: "equip", slot: "body", rarity: "rare", lv: 10, slots: 1, def: 6, hp: 40, sell: 600, art: [{ id: "plate" }, { id: "plateArms" }], desc: "Full steel plate. You clank, but you live." },

  // ------------------------------------------------------------ legs
  leatherPants: { name: "Leather Pants", kind: "equip", slot: "legs", rarity: "common", lv: 1, def: 1, price: 40, art: [{ id: "pants", colors: { cloth: "leather" } }], desc: "Tough trousers for rough grass." },
  ironGreaves: { name: "Iron Greaves", kind: "equip", slot: "legs", rarity: "uncommon", lv: 6, slots: 1, def: 2, hp: 10, sell: 140, art: [{ id: "greaves", colors: { metal: "iron" } }], desc: "Iron plates strapped over the legs." },

  // ------------------------------------------------------------ feet
  leatherBoots: { name: "Leather Boots", kind: "equip", slot: "feet", rarity: "common", lv: 1, slots: 1, def: 1, price: 40, art: [{ id: "boots", colors: { cloth: "leather" } }], desc: "Snake-proof, mostly." },
  ironBoots: { name: "Iron Boots", kind: "equip", slot: "feet", rarity: "uncommon", lv: 6, slots: 1, def: 2, hp: 10, sell: 130, art: [{ id: "ironBoots", colors: { metal: "iron" } }], desc: "Heavy, loud and very hard to bite through." },

  // ------------------------------------------------------------ rings and amulets
  copperRing: { name: "Copper Ring", kind: "equip", slot: "ring", rarity: "common", lv: 1, atk: 1, price: 120, icon: "ring_01a", desc: "A simple band that makes you feel a little braver." },
  vigorRing: { name: "Ring of Vigor", kind: "equip", slot: "ring", rarity: "uncommon", lv: 5, slots: 1, hp: 30, sell: 200, icon: "ring_02e", desc: "A red stone that beats like a heart." },
  cloverCharm: { name: "Clover Charm", kind: "equip", slot: "amulet", rarity: "common", lv: 1, hp: 15, price: 120, icon: "necklace_01a", desc: "A four-leaf clover on a cord." },
  stingerPendant: { name: "Stinger Pendant", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 7, slots: 1, atk: 3, sell: 220, icon: "necklace_03d", desc: "A hornet's stinger set in gold. Sharp in more ways than one." },

  // ------------------------------------------------------------ monster cards
  // Every monster carries its own card, very rarely (Ragnarok style). A card
  // goes into a free card slot of the right kind of equipment, for good.
  slimeCard: { name: "Slime Card", kind: "card", rarity: "epic", monster: "slime", fits: ["body"], prefix: "Bouncy", hp: 30, sell: 0, desc: "A slime grins up from the card, wobbling slightly." },
  snakeCard: { name: "Grass Snake Card", kind: "card", rarity: "epic", monster: "snake", fits: ["feet"], prefix: "Slithering", flee: 8, sell: 0, desc: "Quick as a snake in the grass." },
  hornetCard: { name: "Hornet Card", kind: "card", rarity: "epic", monster: "hornet", fits: ["weapon"], prefix: "Stinging", atk: 2, crit: 8, sell: 0, desc: "Every hit might sting." },
  snapperCard: { name: "Snapper Flower Card", kind: "card", rarity: "epic", monster: "snapper", fits: ["offhand"], prefix: "Thorny", def: 1, reflect: 15, sell: 0, desc: "Bite it and it bites back." },
});

export type ItemId = keyof typeof ITEMS;
export const isItemId = (id: unknown): id is ItemId => typeof id === "string" && Object.hasOwn(ITEMS, id);
export const item = (id: ItemId): ItemDef => ITEMS[id];

/** What the Outfitter by the south gate sells, in shop order. */
export const OUTFITTER_STOCK: ItemId[] = [
  "redPotion",
  "orangePotion",
  "dagger",
  "shortSword",
  "woodShield",
  "leatherCap",
  "chainCoif",
  "leatherArmor",
  "leatherPants",
  "leatherBoots",
  "copperRing",
  "cloverCharm",
];

/** What a merchant pays for one. */
export const sellPrice = (it: ItemDef) => it.sell ?? Math.floor((it.price ?? 0) / 2);

// ---------------------------------------------------------------- bags

/** Slots in a bag. */
export const BAG_SIZE = 30;
/** How close (px, feet to item) you must stand to pick something up. */
export const PICKUP_RANGE = 48;
/** Time between potions. */
export const POTION_MS = 800;
/** Potions, loot and cards stack up to this many per slot; equipment never stacks. */
export const MAX_STACK = 99;
export const stackLimit = (it: ItemDef) => (it.kind === "equip" ? 1 : MAX_STACK);

/** Some of one item in a bag slot or worn. Room for upgrades later. */
export interface ItemStack {
  id: ItemId;
  n: number;
  /** Equipment: the cards in it, in the order they went in. */
  cards?: ItemId[];
}

/** server -> client: your bag and what you're wearing (sent whole whenever it changes). */
export interface BagMessage {
  bag: (ItemStack | null)[];
  gear: Partial<Record<Slot, ItemStack>>;
}

// ---------------------------------------------------------------- cards

/** Whether this card can ever go into this piece of equipment. */
export const cardFits = (card: ItemDef, gear: ItemDef) => card.kind === "card" && gear.kind === "equip" && Boolean(gear.slot && card.fits?.includes(gear.slot));

/** Whether this card fits and there's a free slot for it. */
export const canInsert = (card: ItemDef, gear: ItemStack) => cardFits(card, ITEMS[gear.id]) && (gear.cards?.length ?? 0) < (ITEMS[gear.id].slots ?? 0);

/** Only cards that belong in this equipment, no more than it has slots for (for saved or dropped stacks). */
export function cleanCards(gear: ItemId, raw: unknown): ItemId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const g = ITEMS[gear];
  const cards = raw.filter((c): c is ItemId => isItemId(c) && cardFits(ITEMS[c], g)).slice(0, g.slots ?? 0);
  return cards.length ? cards : undefined;
}

/** Cards on the ground travel as "hornetCard.hornetCard". */
export const cardString = (cards?: ItemId[]) => cards?.join(".") ?? "";
export const parseCards = (gear: ItemId, s: string) => (s ? cleanCards(gear, s.split(".")) : undefined);

/** The name with its cards in front, Ragnarok style: "Stinging Saber", "Double Stinging Saber". */
export function itemName(s: ItemStack): string {
  const name = ITEMS[s.id].name;
  if (!s.cards?.length) return name;
  const counts = new Map<ItemId, number>();
  for (const c of s.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  const words = [...counts].map(([c, n]) => `${n === 2 ? "Double " : n === 3 ? "Triple " : n >= 4 ? "Quadruple " : ""}${ITEMS[c].prefix ?? ""}`);
  return `${words.join(" ")} ${name}`;
}

// ---------------------------------------------------------------- bonuses

/** Everything worn adds up to this (cards included). */
export interface Bonus {
  atk: number;
  def: number;
  hp: number;
  mp: number;
  crit: number;
  flee: number;
  reflect: number;
}

/** Bonuses from everything worn, and every card in it. */
export function gearBonus(gear: Partial<Record<Slot, ItemStack>>): Bonus {
  const out: Bonus = { atk: 0, def: 0, hp: 0, mp: 0, crit: 0, flee: 0, reflect: 0 };
  const add = (it: ItemDef) => {
    out.atk += it.atk ?? 0;
    out.def += it.def ?? 0;
    out.hp += it.hp ?? 0;
    out.mp += it.mp ?? 0;
    out.crit += it.crit ?? 0;
    out.flee += it.flee ?? 0;
    out.reflect += it.reflect ?? 0;
  };
  for (const s of Object.values(gear)) {
    if (!s) continue;
    add(ITEMS[s.id]);
    for (const c of s.cards ?? []) add(ITEMS[c]);
  }
  return out;
}

/** The synced gear string: visible item ids in VISIBLE_SLOTS order, "" for empty ("dagger..leatherArmor..."). */
export function gearString(gear: Partial<Record<Slot, ItemStack>>): string {
  const parts = VISIBLE_SLOTS.map((s) => gear[s]?.id ?? "");
  return parts.some(Boolean) ? parts.join(".") : "";
}

/** Items in a gear string (unknown ids are skipped, so old clients survive new items). */
export function parseGear(gear: string): ItemDef[] {
  if (!gear) return [];
  return gear.split(".").flatMap((id) => (isItemId(id) ? [ITEMS[id]] : []));
}

/** Character art key: the look, plus "|gear" when something is worn. One texture per distinct key. */
export const appearanceKey = (look: string, gear?: string) => (gear ? `${look}|${gear}` : look);
export function splitAppearance(key: string): { look: string; gear: string } {
  const i = key.indexOf("|");
  return i < 0 ? { look: key, gear: "" } : { look: key.slice(0, i), gear: key.slice(i + 1) };
}

/** One line of bonuses for tooltips: "ATK +6 · DEF +2 · HP +10". */
export function bonusText(it: Partial<ItemDef>): string {
  const parts: string[] = [];
  if (it.atk) parts.push(`ATK +${it.atk}`);
  if (it.def) parts.push(`DEF +${it.def}`);
  if (it.hp) parts.push(`HP +${it.hp}`);
  if (it.mp) parts.push(`MP +${it.mp}`);
  if (it.crit) parts.push(`Critical +${it.crit}%`);
  if (it.flee) parts.push(`Evade +${it.flee}%`);
  if (it.reflect) parts.push(`Reflects ${it.reflect}% of damage`);
  if (it.heal) parts.push(`Heals ${it.heal} HP`);
  return parts.join(" · ");
}
