// Items: what exists, what it does, what it costs and how it looks.
//
// Pure data shared by the server (which owns every bag) and the client (which
// draws icons, gear on characters and the shop lists). Item ids are saved in
// the database, so never rename one; retire it instead.

import type { ClassId, MonsterId } from "./rpg";

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

/** What kind of weapon it is decides who can use it and how it attacks. */
export type WeaponType = "dagger" | "sword" | "bow" | "staff";
export const WEAPON_USERS: Record<WeaponType, readonly ClassId[]> = {
  dagger: ["novice", "knight", "mage", "archer"],
  sword: ["novice", "knight"],
  bow: ["archer"],
  staff: ["mage"],
};
export const WEAPON_NAMES: Record<WeaponType, string> = { dagger: "dagger", sword: "sword", bow: "bow", staff: "staff" };

/** One piece of character art (a "gear" item in the LPC manifest) and its colours by material. */
export interface GearArt {
  id: string;
  colors?: Partial<Record<"metal" | "cloth" | "wood", string>>;
}

export interface ItemDef {
  id: string;
  name: string;
  /** equip: worn in `slot`. use: used up (potions). loot: only worth selling. card: goes into equipment. material: the Blacksmith uses it. */
  kind: "equip" | "use" | "loot" | "card" | "material";
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
  /** Share (percent) of the damage you deal that heals you. */
  drain?: number;
  /** Worn: parts of your look it covers (a hood hides the hair). */
  hides?: ("hair" | "beard")[];
  /** Equipment: how many cards it holds. */
  slots?: number;
  /** Weapons: what kind (who can use it, and arrows or magic bolts instead of a swing). */
  weapon?: WeaponType;
  /** Bows and staves: reach in pixels (feet to feet, plus the monster's size). */
  range?: number;
  /** Needs both hands: no shield with it. */
  twoHanded?: boolean;
  /** Only these classes may wear it (on top of what the weapon type allows). */
  classes?: ClassId[];
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
  silk: { name: "Sticky Silk", kind: "loot", rarity: "common", sell: 9, icon: "ingot_01c", desc: "Spun by Grubs. Tailors pay for it." },
  batFang: { name: "Bat Fang", kind: "loot", rarity: "common", sell: 14, icon: "gem_01e", desc: "Small, sharp and a little bit spooky." },
  rockShard: { name: "Rock Shard", kind: "loot", rarity: "common", sell: 22, icon: "gem_01h", desc: "Chipped off a Rock Worm's shell. Heavy for its size." },
  gazerLens: { name: "Gazer Lens", kind: "loot", rarity: "common", sell: 35, icon: "pearl_01b", desc: "It still seems to be watching you." },
  ectoplasm: { name: "Ectoplasm", kind: "loot", rarity: "common", sell: 48, icon: "potion_01c", desc: "Cold, glowing goo a Ghost left behind." },
  kingsCandy: { name: "King's Candy", kind: "loot", rarity: "rare", sell: 600, icon: "candy_02e", desc: "The Pumpking's own sweets. Worth a small fortune." },

  // ------------------------------------------------------------ smithing (one is used up by every upgrade)
  ironIngot: { name: "Iron Ingot", kind: "material", rarity: "common", price: 100, sell: 30, icon: "ingot_01a", desc: "Plain iron. The Blacksmith uses one for each upgrade up to +5." },
  mithril: { name: "Mithril Ingot", kind: "material", rarity: "uncommon", sell: 80, icon: "ingot_01e", desc: "Light, blue and very hard. Upgrades to +6, +7 and +8 need one. Found in Dusk Hollow." },
  starCrystal: { name: "Star Crystal", kind: "material", rarity: "rare", sell: 300, icon: "crystal_01b", desc: "A shard of a fallen star. Only this takes gear to +9 and +10." },

  // ------------------------------------------------------------ potions
  redPotion: { name: "Red Potion", kind: "use", rarity: "common", heal: 40, price: 12, icon: "potion_02a", desc: "Restores 40 HP." },
  orangePotion: { name: "Orange Potion", kind: "use", rarity: "common", heal: 100, price: 40, icon: "potion_02f", desc: "Restores 100 HP." },

  // ------------------------------------------------------------ weapons
  dagger: { name: "Dagger", kind: "equip", slot: "weapon", weapon: "dagger", rarity: "common", lv: 1, slots: 1, atk: 3, price: 50, icon: "sword_01b", art: [{ id: "dagger" }], desc: "Short, light and better than your fists." },
  shortSword: { name: "Short Sword", kind: "equip", slot: "weapon", weapon: "sword", rarity: "common", lv: 3, slots: 1, atk: 6, price: 160, icon: "sword_02b", art: [{ id: "swordIron" }], desc: "A plain iron sword. Every adventurer starts with one." },
  bronzeSword: { name: "Bronze Sword", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 6, slots: 2, atk: 10, sell: 150, icon: "sword_02d", art: [{ id: "swordBronze" }], desc: "Heavier than it looks. Hornets sometimes guard one." },
  saber: { name: "Saber", kind: "equip", slot: "weapon", weapon: "sword", rarity: "rare", lv: 9, slots: 2, atk: 15, sell: 400, icon: "sword_03b", art: [{ id: "saber" }], desc: "A curved blade found tangled in Snapper Flower roots." },
  rapier: { name: "Rapier", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 13, slots: 2, atk: 17, crit: 3, sell: 260, icon: "sword_01c", art: [{ id: "rapier" }], desc: "Thin and quick. Finds the gaps in any shell." },
  knightBlade: { name: "Knight's Blade", kind: "equip", slot: "weapon", weapon: "sword", classes: ["knight"], rarity: "rare", lv: 17, slots: 2, atk: 25, sell: 700, icon: "sword_03a", art: [{ id: "longswordAlt" }], desc: "A broad blade for a knight's arm. Knights only." },
  moonblade: { name: "Moonblade", kind: "equip", slot: "weapon", weapon: "sword", rarity: "epic", lv: 20, slots: 2, atk: 32, crit: 6, sell: 2500, icon: "sword_02c", art: [{ id: "glowsword" }], desc: "Glows a cold blue, even at noon. Only the Pumpking has ever dropped one." },
  // Class weapons: the Job Master gives one with the job; Bram sells them too.
  squireSword: { name: "Squire's Longsword", kind: "equip", slot: "weapon", weapon: "sword", classes: ["knight"], rarity: "common", lv: 10, slots: 1, atk: 12, price: 900, icon: "sword_03c", art: [{ id: "longsword" }], desc: "Long and heavy, balanced for a knight's arm. Knights only." },
  huntingBow: { name: "Hunting Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "common", lv: 10, slots: 1, atk: 9, range: 170, price: 900, icon: "bow_01a", art: [{ id: "bow" }], desc: "Shoots from a safe distance. Needs both hands, so no shield." },
  recurveBow: { name: "Recurve Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 12, slots: 2, atk: 14, range: 190, sell: 300, icon: "bow_02d", art: [{ id: "recurve" }], desc: "Dark wood, bent back on itself. Snapper Flowers sometimes hide one." },
  apprenticeStaff: { name: "Apprentice Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "common", lv: 10, slots: 1, atk: 9, mp: 15, range: 150, price: 900, icon: "staff_01a", art: [{ id: "staff" }], desc: "Plain ash wood that hums when you hold it. Casts bolts of magic from afar." },
  gnarledStaff: { name: "Gnarled Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 12, slots: 2, atk: 14, mp: 25, range: 160, sell: 300, icon: "staff_03a", art: [{ id: "gnarled" }], desc: "A twisted root from the lake shore, still a little green." },
  greatBow: { name: "Great Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "rare", lv: 16, slots: 2, atk: 23, range: 210, sell: 700, icon: "bow_03c", art: [{ id: "greatBow" }], desc: "Taller than you are. Its arrows fly the furthest." },
  emberStaff: { name: "Ember Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 16, slots: 2, atk: 23, mp: 50, range: 180, sell: 700, icon: "staff_02e", art: [{ id: "crystalRed" }], desc: "A red crystal with a fire trapped inside." },
  crystalStaff: { name: "Crystal Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 15, slots: 2, atk: 19, mp: 40, range: 170, sell: 800, icon: "staff_03c", art: [{ id: "crystal" }], desc: "A blue crystal that never stops glowing." },

  // ------------------------------------------------------------ shields
  woodShield: { name: "Wooden Shield", kind: "equip", slot: "offhand", rarity: "common", lv: 1, slots: 1, def: 2, price: 60, icon: "shield_01a", art: [{ id: "shield" }], desc: "Solid maple. Stops a slime, mostly." },
  kiteShield: { name: "Kite Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 14, slots: 1, def: 5, hp: 20, sell: 240, icon: "shield_03b", art: [{ id: "kite" }], desc: "Long and pointed: it covers you from shoulder to knee." },
  crusaderShield: { name: "Crusader Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 18, slots: 1, def: 7, hp: 45, sell: 650, icon: "shield_02d", art: [{ id: "crusader" }], desc: "White, with a red cross. The Pumpking hoards them." },
  guardShield: { name: "Guard Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 5, slots: 1, def: 3, hp: 15, sell: 120, icon: "shield_02a", art: [{ id: "shield", colors: { wood: "walnut" } }], desc: "Dark walnut, made for the town guard." },

  // ------------------------------------------------------------ head
  leatherCap: { name: "Leather Cap", kind: "equip", slot: "head", rarity: "common", lv: 1, def: 1, price: 40, art: [{ id: "capLeather" }], desc: "Keeps the sun and the bees off." },
  chainCoif: { name: "Chain Coif", kind: "equip", slot: "head", rarity: "common", lv: 4, slots: 1, def: 2, hp: 10, price: 180, art: [{ id: "coif", colors: { metal: "iron" } }], desc: "Iron rings, linked by hand." },
  kettleHelm: { name: "Kettle Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 7, slots: 1, def: 2, hp: 20, sell: 160, art: [{ id: "kettle" }], desc: "A wide steel brim. Rain runs right off it." },
  bronzeHelm: { name: "Bronze Helm", kind: "equip", slot: "head", rarity: "rare", lv: 9, slots: 1, def: 3, hp: 30, sell: 350, art: [{ id: "nasal", colors: { metal: "bronze" } }], desc: "Polished bronze with a nose guard." },
  wizardHat: { name: "Wizard Hat", kind: "equip", slot: "head", rarity: "uncommon", lv: 12, slots: 1, def: 1, mp: 40, sell: 220, art: [{ id: "wizardHat" }], desc: "Tall and pointed. Your spells feel bigger already." },
  rangerHood: { name: "Ranger Hood", kind: "equip", slot: "head", rarity: "uncommon", lv: 12, slots: 1, def: 2, atk: 2, sell: 220, art: [{ id: "hood", colors: { cloth: "forest" } }], hides: ["hair"], desc: "Green cloth for hiding in the shadows." },
  hornedHelm: { name: "Horned Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 15, slots: 1, def: 4, hp: 35, sell: 300, art: [{ id: "horned", colors: { metal: "iron" } }], desc: "Two curved horns. Nobody remembers whose." },
  greathelm: { name: "Greathelm", kind: "equip", slot: "head", rarity: "rare", lv: 18, slots: 1, def: 5, hp: 60, sell: 650, art: [{ id: "greathelm" }], desc: "A steel bucket with eye slits. Heavy, and very safe." },
  meadowCrown: { name: "Meadow Crown", kind: "equip", slot: "head", rarity: "legendary", lv: 10, slots: 1, atk: 4, def: 4, hp: 60, sell: 5000, art: [{ id: "crown" }], desc: "Said to belong to the first king of the meadow. Snapper Flowers hide it very, very rarely." },

  // ------------------------------------------------------------ body
  leatherArmor: { name: "Leather Armour", kind: "equip", slot: "body", rarity: "common", lv: 1, slots: 1, def: 2, price: 80, art: [{ id: "leatherArmor" }], desc: "Boiled leather with a brass buckle." },
  legionArmor: { name: "Legion Armour", kind: "equip", slot: "body", rarity: "uncommon", lv: 6, slots: 1, def: 4, hp: 15, sell: 200, art: [{ id: "legion" }], desc: "Overlapping steel bands. Old, but sturdy." },
  guardTabard: { name: "Guard Tabard", kind: "equip", slot: "body", rarity: "uncommon", lv: 14, slots: 1, def: 4, hp: 30, sell: 280, art: [{ id: "tabardMaroon" }], desc: "A padded maroon tabard, like the town guard wears." },
  sageTabard: { name: "Sage Tabard", kind: "equip", slot: "body", rarity: "uncommon", lv: 15, slots: 1, def: 2, mp: 50, atk: 2, sell: 300, art: [{ id: "tabardLavender" }], desc: "Lavender cloth stitched with tiny stars." },
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
  grubCard: { name: "Grub Card", kind: "card", rarity: "epic", monster: "grub", fits: ["legs"], prefix: "Silken", hp: 40, sell: 0, desc: "A Grub curled up asleep." },
  batCard: { name: "Night Bat Card", kind: "card", rarity: "epic", monster: "bat", fits: ["amulet"], prefix: "Vampiric", drain: 5, sell: 0, desc: "Its fangs glint in the dark." },
  rockWormCard: { name: "Rock Worm Card", kind: "card", rarity: "epic", monster: "rockworm", fits: ["ring"], prefix: "Rocky", def: 3, sell: 0, desc: "Tough as the stone it eats." },
  gazerCard: { name: "Gazer Card", kind: "card", rarity: "epic", monster: "gazer", fits: ["head"], prefix: "Gazing", atk: 3, mp: 30, sell: 0, desc: "The eye follows you around the room." },
  ghostCard: { name: "Ghost Card", kind: "card", rarity: "epic", monster: "ghost", fits: ["body"], prefix: "Ghostly", def: 1, flee: 6, sell: 0, desc: "Half there, half not." },
  pumpkingCard: { name: "Pumpking Card", kind: "card", rarity: "legendary", monster: "pumpking", fits: ["weapon"], prefix: "Royal", atk: 10, crit: 6, sell: 0, desc: "The king of Dusk Hollow, grinning on a gold card." },
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
  "squireSword",
  "huntingBow",
  "apprenticeStaff",
  "woodShield",
  "leatherCap",
  "chainCoif",
  "leatherArmor",
  "leatherPants",
  "leatherBoots",
  "copperRing",
  "cloverCharm",
];

/** "a Dagger", "an Apprentice Staff". */
export const withArticle = (name: string) => `${/^[AEIOU]/i.test(name) ? "an" : "a"} ${name}`;

/** Whether a class may wear this. */
export function canWear(cls: ClassId, it: ItemDef): boolean {
  if (it.classes && !it.classes.includes(cls)) return false;
  return !it.weapon || WEAPON_USERS[it.weapon].includes(cls);
}

/** Who may wear it, when not everyone may ("Knights only"). */
export function wearersText(it: ItemDef): string {
  const who = it.classes ?? (it.weapon ? WEAPON_USERS[it.weapon] : undefined);
  if (!who || who.length >= 4) return "";
  const names: Record<ClassId, string> = { novice: "Novices", knight: "Knights", mage: "Mages", archer: "Archers" };
  return `${who.map((c) => names[c]).join(" and ")} only`;
}

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

/** Some of one item in a bag slot or worn. */
export interface ItemStack {
  id: ItemId;
  n: number;
  /** Equipment: the cards in it, in the order they went in. */
  cards?: ItemId[];
  /** Equipment: how far the Blacksmith has upgraded it (+1 to +10). */
  up?: number;
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

/** The name with its upgrade and cards in front, Ragnarok style: "Stinging Saber", "+7 Double Stinging Saber". */
export function itemName(s: ItemStack): string {
  const up = s.up ? `+${s.up} ` : "";
  const name = ITEMS[s.id].name;
  if (!s.cards?.length) return `${up}${name}`;
  const counts = new Map<ItemId, number>();
  for (const c of s.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  const words = [...counts].map(([c, n]) => `${n === 2 ? "Double " : n === 3 ? "Triple " : n >= 4 ? "Quadruple " : ""}${ITEMS[c].prefix ?? ""}`);
  return `${up}${words.join(" ")} ${name}`;
}

// ---------------------------------------------------------------- upgrades (the Blacksmith)

/** The highest upgrade. */
export const MAX_UPGRADE = 10;
/** What the Blacksmith sells. */
export const SMITH_STOCK: ItemId[] = ["ironIngot"];

/** Upgrading to +1 … +10: the chance it works, and the Blacksmith's fee. Up to +4 it always works. */
const UPGRADE_TABLE: [chance: number, gold: number][] = [
  [1, 100], [1, 200], [1, 300], [1, 400], [0.9, 600], [0.75, 900], [0.6, 1200], [0.45, 1600], [0.35, 2000], [0.25, 2500],
];

/** Taking a piece of gear to +`to`: the chance, the fee, and the ingot it uses up. A failure drops it one level; it never breaks. */
export function upgradeCost(to: number): { chance: number; gold: number; ore: ItemId } {
  const [chance, gold] = UPGRADE_TABLE[Math.min(MAX_UPGRADE, Math.max(1, to)) - 1];
  return { chance, gold, ore: to <= 5 ? "ironIngot" : to <= 8 ? "mithril" : "starCrystal" };
}

/** Everything that shows on the character can be upgraded; rings and amulets are too small. */
export const canUpgrade = (it: ItemDef) => it.kind === "equip" && (VISIBLE_SLOTS as readonly (Slot | undefined)[]).includes(it.slot);

/** What each upgrade adds: weapons ATK (more for stronger ones), everything else DEF +1. */
export const upgradeStep = (it: ItemDef): { atk: number; def: number } =>
  it.slot === "weapon" ? { atk: Math.max(1, Math.round((it.atk ?? 0) / 8)), def: 0 } : { atk: 0, def: 1 };

/** A saved or dropped upgrade level, if it makes sense for that item. */
export function cleanUpgrade(id: ItemId, raw: unknown): number | undefined {
  const up = Math.floor(Number(raw));
  return canUpgrade(ITEMS[id]) && up >= 1 ? Math.min(MAX_UPGRADE, up) : undefined;
}

/** "+7 · ATK +14" (what the upgrades add), or "" for +0. */
export function upgradeText(s: ItemStack): string {
  if (!s.up) return "";
  const step = upgradeStep(ITEMS[s.id]);
  return `+${s.up} · ${step.atk ? `ATK +${step.atk * s.up}` : `DEF +${step.def * s.up}`}`;
}

/** Upgrades this high give an aura (the best one worn shows). */
export const AURA_LEVELS = [7, 9, 10] as const;

/** The aura someone has: the highest of AURA_LEVELS their best worn upgrade reaches, or 0. */
export function auraOf(gear: Partial<Record<Slot, ItemStack>>): number {
  const best = Math.max(0, ...Object.values(gear).map((s) => s?.up ?? 0));
  return [...AURA_LEVELS].reverse().find((lv) => best >= lv) ?? 0;
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
  drain: number;
}

/** Bonuses from everything worn, its upgrades, and every card in it. */
export function gearBonus(gear: Partial<Record<Slot, ItemStack>>): Bonus {
  const out: Bonus = { atk: 0, def: 0, hp: 0, mp: 0, crit: 0, flee: 0, reflect: 0, drain: 0 };
  const add = (it: ItemDef) => {
    out.atk += it.atk ?? 0;
    out.def += it.def ?? 0;
    out.hp += it.hp ?? 0;
    out.mp += it.mp ?? 0;
    out.crit += it.crit ?? 0;
    out.flee += it.flee ?? 0;
    out.reflect += it.reflect ?? 0;
    out.drain += it.drain ?? 0;
  };
  for (const s of Object.values(gear)) {
    if (!s) continue;
    add(ITEMS[s.id]);
    if (s.up) {
      const step = upgradeStep(ITEMS[s.id]);
      out.atk += step.atk * s.up;
      out.def += step.def * s.up;
    }
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
  if (it.drain) parts.push(`Heals ${it.drain}% of damage dealt`);
  if (it.heal) parts.push(`Heals ${it.heal} HP`);
  return parts.join(" · ");
}
