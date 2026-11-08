// Items: what exists, what it does, what it costs and how it looks.
//
// Pure data shared by the server (which owns every bag) and the client (which
// draws icons, gear on characters and the shop lists). Item ids are saved in
// the database, so never rename one; retire it instead.

import { jobLine, type ClassId, type MonsterId } from "./rpg";

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
export type WeaponType = "dagger" | "sword" | "spear" | "bow" | "staff";
export const WEAPON_USERS: Record<WeaponType, readonly ClassId[]> = {
  dagger: ["novice", "knight", "mage", "archer"],
  sword: ["novice", "knight"],
  // Ragnarok's Knights carry spears.
  spear: ["knight"],
  bow: ["archer"],
  staff: ["mage"],
};
export const WEAPON_NAMES: Record<WeaponType, string> = { dagger: "dagger", sword: "sword", spear: "spear", bow: "bow", staff: "staff" };

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
  goblinCharm: { name: "Goblin Charm", kind: "loot", rarity: "common", sell: 55, icon: "necklace_01c", desc: "Bits of string, teeth and a bottle cap. Goblins think it's lucky." },
  orcTusk: { name: "Orc Tusk", kind: "loot", rarity: "common", sell: 70, icon: "gem_01b", desc: "Yellowed and chipped. Carvers in town pay well for it." },
  orcArrowhead: { name: "Orcish Arrowhead", kind: "loot", rarity: "common", sell: 75, icon: "arrow_01a", desc: "Crude black iron, filed sharp." },
  oldBone: { name: "Old Bone", kind: "loot", rarity: "common", sell: 85, icon: "gem_01g", desc: "Very old, very large, and still rattling a little." },
  rottenBandage: { name: "Rotten Bandage", kind: "loot", rarity: "common", sell: 95, icon: "scroll_01a", desc: "Don't ask what it was wrapped around." },
  warlordBanner: { name: "Warlord's Banner", kind: "loot", rarity: "rare", sell: 1500, icon: "scroll_01e", desc: "The Orc Warlord's own war banner. Collectors pay a fortune for it." },
  boarHide: { name: "Boar Hide", kind: "loot", rarity: "common", sell: 110, icon: "scroll_01h", desc: "Thick and bristly. Leatherworkers in town pay well for it." },
  lizardScale: { name: "Lizard Scale", kind: "loot", rarity: "common", sell: 120, icon: "gem_01c", desc: "A hard blue scale, as big as your hand." },
  wolfPelt: { name: "Wolf Pelt", kind: "loot", rarity: "common", sell: 130, icon: "scroll_01b", desc: "Thick grey fur. It smells faintly of wet dog." },
  trollTooth: { name: "Troll Tooth", kind: "loot", rarity: "common", sell: 150, icon: "crystal_01e", desc: "As big as your fist, and never once brushed." },
  bloodRuby: { name: "Blood Ruby", kind: "loot", rarity: "common", sell: 170, icon: "crystal_01d", desc: "A dark red stone. Vampires say it's still warm." },
  minotaurCrown: { name: "Minotaur's Crown", kind: "loot", rarity: "rare", sell: 3000, icon: "helmet_02d", desc: "The Minotaur King's golden crown, with holes for the horns. Worth a fortune." },
  yetiFur: { name: "Yeti Fur", kind: "loot", rarity: "common", sell: 190, icon: "scroll_01d", desc: "A thick white bundle, still full of snow. Furriers in town pay well for it." },
  ramHorn: { name: "Ram Horn", kind: "loot", rarity: "common", sell: 200, icon: "gem_01i", desc: "A great curled horn, grey and ridged." },
  frozenTear: { name: "Frozen Tear", kind: "loot", rarity: "common", sell: 215, icon: "crystal_01i", desc: "A drop of ice a Frost Shaman wept. It never melts." },
  wightChain: { name: "Wight's Chain", kind: "loot", rarity: "common", sell: 230, icon: "ring_01c", desc: "A link of old mail, rimed with frost. Cold enough to burn." },
  drakeScale: { name: "Drake Scale", kind: "loot", rarity: "common", sell: 250, icon: "gem_01j", desc: "An ice-blue scale as big as a plate." },
  wraithEssence: { name: "Wraith Essence", kind: "loot", rarity: "common", sell: 280, icon: "potion_01e", desc: "A wisp of cold purple mist, corked in a bottle. It whispers." },
  gargoyleShard: { name: "Gargoyle Shard", kind: "loot", rarity: "common", sell: 300, icon: "pearl_01a", desc: "A chip of living stone. It's still warm, and sometimes it twitches." },
  rustedKey: { name: "Rusted Key", kind: "loot", rarity: "common", sell: 320, icon: "key_01c", desc: "A key to some long-lost door in the Fallen King's castle." },
  boneDust: { name: "Bone Dust", kind: "loot", rarity: "common", sell: 340, icon: "potion_01d", desc: "What's left of a Lich's last victim. Alchemists pay well for it." },
  golemHeart: { name: "Golem's Heart", kind: "loot", rarity: "common", sell: 360, icon: "potion_03a", desc: "A heart in a jar. It's still beating." },
  royalKey: { name: "Royal Key", kind: "loot", rarity: "rare", sell: 6000, icon: "key_01d", desc: "The golden key to the Fallen King's treasury. Collectors pay a fortune for it." },
  moonstone: { name: "Moonstone", kind: "loot", rarity: "common", sell: 380, icon: "crystal_01j", desc: "A pale stone that glows like the moon. Moon Hares carry them, nobody knows why." },
  foxfireEmber: { name: "Foxfire Ember", kind: "loot", rarity: "common", sell: 400, icon: "pearl_01c", desc: "A little flame that burns without wood, and isn't hot. Fox Spirits leave them behind." },
  smokeBomb: { name: "Smoke Bomb", kind: "loot", rarity: "common", sell: 420, icon: "potion_02d", desc: "A clay ball full of black smoke: a Crow Blade's favourite trick." },
  fadedScroll: { name: "Faded Scroll", kind: "loot", rarity: "common", sell: 440, icon: "scroll_01f", desc: "A swordsman's training scroll, too faded to read. Collectors pay well for it." },
  ogreBrew: { name: "Ogre Brew", kind: "loot", rarity: "common", sell: 460, icon: "potion_03c", desc: "A jug of the Red Ogres' fiery drink. Don't." },
  heartOfSpring: { name: "Heart of Spring", kind: "loot", rarity: "rare", sell: 9000, icon: "gem_01f", desc: "The pink gem that keeps Petalfall in bloom, taken by the Ogre Warlord. Collectors pay a fortune for it." },
  impHorn: { name: "Imp Horn", kind: "loot", rarity: "common", sell: 480, icon: "gem_01d", desc: "A little curled horn, still warm. Ember Imps lose them when they fall." },
  salamanderScale: { name: "Salamander Scale", kind: "loot", rarity: "common", sell: 500, icon: "gem_01c", desc: "An orange scale that never cools down. Smiths love them." },
  obsidianShard: { name: "Obsidian Shard", kind: "loot", rarity: "common", sell: 520, icon: "crystal_01j", desc: "A splinter of black glass from an Obsidian Knight's armour. Sharp!" },
  cinderVeil: { name: "Cinder Veil", kind: "loot", rarity: "common", sell: 540, icon: "scroll_01e", desc: "A scrap of smoke that somehow holds together. Cinder Wraiths leave them behind." },
  magmaCore: { name: "Magma Core", kind: "loot", rarity: "common", sell: 560, icon: "pearl_01a", desc: "The glowing heart of a Magma Golem, cooled to a stone. Heavy, and worth it." },
  heartOfFlame: { name: "Heart of Flame", kind: "loot", rarity: "rare", sell: 12_000, icon: "gem_01g", desc: "The fire that burns at the heart of Ashpeak, carried by the Cinder Colossus. Collectors pay a fortune for it." },
  winterHeart: { name: "Heart of Winter", kind: "loot", rarity: "rare", sell: 4500, icon: "crystal_01h", desc: "A lump of ice from the Frost Giant's chest. It never melts, and collectors pay a fortune for it." },

  // ------------------------------------------------------------ smithing (one is used up by every upgrade)
  ironIngot: { name: "Iron Ingot", kind: "material", rarity: "common", price: 100, sell: 30, icon: "ingot_01a", desc: "Plain iron. The Blacksmith uses one for each upgrade up to +5." },
  mithril: { name: "Mithril Ingot", kind: "material", rarity: "uncommon", sell: 80, icon: "ingot_01e", desc: "Light, blue and very hard. Upgrades to +6, +7 and +8 need one. Found in Dusk Hollow." },
  starCrystal: { name: "Star Crystal", kind: "material", rarity: "rare", sell: 300, icon: "crystal_01b", desc: "A shard of a fallen star. Only this takes gear to +9 and +10." },

  // ------------------------------------------------------------ potions
  redPotion: { name: "Red Potion", kind: "use", rarity: "common", heal: 40, price: 12, icon: "potion_02a", desc: "Restores 40 HP." },
  orangePotion: { name: "Orange Potion", kind: "use", rarity: "common", heal: 100, price: 40, icon: "potion_02f", desc: "Restores 100 HP." },
  whitePotion: { name: "White Potion", kind: "use", rarity: "common", heal: 250, price: 120, icon: "potion_02h", desc: "Restores 250 HP." },

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
  // The Orc Woods.
  scimitar: { name: "Scimitar", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 22, slots: 2, atk: 30, crit: 3, sell: 900, icon: "sword_02a", art: [{ id: "scimitar" }], desc: "A wide curved blade, taken from a goblin who couldn't lift it." },
  katana: { name: "Katana", kind: "equip", slot: "weapon", weapon: "sword", rarity: "rare", lv: 27, slots: 2, atk: 40, crit: 6, sell: 1800, icon: "sword_01e", art: [{ id: "katana" }], desc: "A single perfect edge. Nobody knows how the orcs came by it." },
  halberd: { name: "Halberd", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "rare", lv: 25, slots: 2, atk: 50, sell: 1500, art: [{ id: "halberd" }], desc: "An axe, a spike and a hook on a long pole. Needs both hands. Knights only." },
  dragonSpear: { name: "Dragon Spear", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "legendary", lv: 30, slots: 2, atk: 66, crit: 8, sell: 12_000, art: [{ id: "dragonspear" }], desc: "Gold, with a dragon coiled round the shaft. The Orc Warlord guards it with his life. Knights only." },
  compositeBow: { name: "Composite Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 22, slots: 2, atk: 30, range: 210, sell: 900, icon: "bow_02a", art: [{ id: "recurveLight" }], desc: "Horn, wood and sinew glued together. Small, but it pulls hard." },
  crossbow: { name: "Crossbow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "rare", lv: 27, slots: 2, atk: 40, crit: 4, range: 220, sell: 1800, icon: "bow_03a", art: [{ id: "crossbow" }], desc: "Its bolts punch through orc armour. Archers only." },
  ringStaff: { name: "Ring Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 22, slots: 2, atk: 30, mp: 65, range: 190, sell: 900, icon: "staff_01c", art: [{ id: "loop" }], desc: "A bronze hoop on a staff. Magic swirls round and round inside it." },
  diamondStaff: { name: "Diamond Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 27, slots: 2, atk: 40, mp: 90, range: 200, sell: 1800, icon: "staff_03e", art: [{ id: "diamond" }], desc: "A silver staff crowned with a clear stone that drinks in the light." },
  // The Wildlands.
  longSpear: { name: "Long Spear", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "uncommon", lv: 32, slots: 2, atk: 62, sell: 2200, art: [{ id: "longspear" }], desc: "Twice as tall as you, with a steel point. Needs both hands. Knights only." },
  trident: { name: "Trident", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "rare", lv: 37, slots: 2, atk: 74, crit: 4, sell: 4200, art: [{ id: "trident" }], desc: "Three steel prongs. Lizardmen guard them like treasure. Needs both hands. Knights only." },
  flameBlade: { name: "Flame Blade", kind: "equip", slot: "weapon", weapon: "sword", rarity: "rare", lv: 36, slots: 2, atk: 54, crit: 6, sell: 4000, icon: "sword_03e", art: [{ id: "glowswordRed" }], desc: "A blade of living fire. It never cools, even in the rain." },
  longbow: { name: "Longbow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 32, slots: 2, atk: 46, range: 230, sell: 2200, icon: "bow_01e", art: [{ id: "greatBowDark" }], desc: "Dark yew, taller than a werewolf. Its arrows fly far and hit hard." },
  sunfireBow: { name: "Sunfire Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "legendary", lv: 38, slots: 2, atk: 64, crit: 8, range: 240, sell: 15_000, icon: "bow_02b", art: [{ id: "greatBowGold" }], desc: "Gold from tip to tip; its arrows burn like sunlight. Only the Minotaur King has ever dropped one." },
  serpentStaff: { name: "Serpent Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 32, slots: 2, atk: 46, mp: 120, range: 210, sell: 2200, icon: "staff_02c", art: [{ id: "serpent" }], desc: "Bent like a snake about to strike." },
  // Frostfell.
  iceSword: { name: "Ice Sword", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 42, slots: 2, atk: 60, crit: 3, sell: 3200, art: [{ id: "swordSilver" }], desc: "A pale blade so cold it smokes in warm air." },
  glacierLance: { name: "Glacier Lance", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "rare", lv: 46, slots: 2, atk: 88, crit: 4, sell: 6000, art: [{ id: "longspearSilver" }], desc: "A long white lance, its point as clear as ice. Needs both hands. Knights only." },
  frostScythe: { name: "Frost Scythe", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "legendary", lv: 48, slots: 2, atk: 102, crit: 8, sell: 20_000, art: [{ id: "scythe" }], desc: "The Frost Giant reaps with it, and frost creeps along the blade wherever it swings. Needs both hands. Knights only." },
  frostBow: { name: "Frost Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 42, slots: 2, atk: 54, range: 235, sell: 3200, icon: "bow_01b", art: [{ id: "bowSilver" }], desc: "Pale silver wood that bends without breaking, even in the deepest cold." },
  glacierBow: { name: "Glacier Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "rare", lv: 46, slots: 2, atk: 66, crit: 4, range: 245, sell: 6000, icon: "bow_03b", art: [{ id: "greatBowSilver" }], desc: "Silver from tip to tip. Its arrows fly further than any other." },
  winterStaff: { name: "Winter Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 42, slots: 2, atk: 54, mp: 160, range: 220, sell: 3200, icon: "staff_01b", art: [{ id: "gnarledSilver" }], desc: "A twisted branch, silver with frost. It's always cold to the touch." },
  auroraStaff: { name: "Aurora Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 46, slots: 2, atk: 66, mp: 220, range: 235, sell: 6000, art: [{ id: "crystalGreen" }], desc: "A green crystal that shimmers like the northern lights." },
  // Ravenmoor.
  gildedBlade: { name: "Gilded Blade", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 52, slots: 2, atk: 70, crit: 4, sell: 4500, art: [{ id: "swordGold" }], desc: "A royal guard's sword, its gold still bright under the grime." },
  darkLance: { name: "Dark Lance", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "rare", lv: 56, slots: 2, atk: 104, crit: 4, sell: 8500, art: [{ id: "longspearDark" }], desc: "Black wood and a blackened point. The Dark Knights carried them. Needs both hands. Knights only." },
  bloodBow: { name: "Blood Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 52, slots: 2, atk: 62, range: 245, sell: 4500, icon: "bow_02e", art: [{ id: "recurveRed" }], desc: "Red wood bent back on itself. It pulls harder than it looks." },
  royalBow: { name: "Royal Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "rare", lv: 56, slots: 2, atk: 76, crit: 4, range: 250, sell: 8500, icon: "bow_01d", art: [{ id: "bowGold" }], desc: "Gold from tip to tip: the Fallen King's own hunting bow." },
  boneStaff: { name: "Bone Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 52, slots: 2, atk: 62, mp: 200, range: 230, sell: 4500, art: [{ id: "gnarledLight" }], desc: "Pale and knotted, like an old bone. Liches lean on them." },
  soulStaff: { name: "Soul Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 56, slots: 2, atk: 76, mp: 260, range: 240, sell: 8500, art: [{ id: "crystalPurple" }], desc: "A violet crystal with something moving inside it." },
  // Petalfall.
  blossomBlade: { name: "Blossom Blade", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 62, slots: 2, atk: 84, crit: 5, sell: 5500, art: [{ id: "swordCeramic" }], desc: "Pale steel with pink silk round the hilt. It never seems to dull." },
  thunderGlaive: { name: "Thunder Glaive", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "rare", lv: 66, slots: 2, atk: 124, crit: 4, sell: 10_000, art: [{ id: "dragonspearRed" }], desc: "A red dragon-headed spear that crackles before a storm. Needs both hands. Knights only." },
  petalBow: { name: "Petal Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 62, slots: 2, atk: 74, range: 250, sell: 5500, icon: "bow_02cc", art: [{ id: "bowCopper" }], desc: "Rosy wood, light as a petal, with a string of spun silk." },
  boneBow: { name: "Ogre-Bone Longbow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "rare", lv: 66, slots: 2, atk: 90, crit: 4, range: 255, sell: 10_000, icon: "bow_03d", art: [{ id: "greatBowCeramic" }], desc: "A tall white bow carved from a Red Ogre's thigh bone. It takes an ogre's arm to draw it, or a hunter's." },
  foxfireStaff: { name: "Foxfire Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 62, slots: 2, atk: 74, mp: 240, range: 240, sell: 5500, art: [{ id: "crystalOrange" }], desc: "An orange crystal with a foxfire flame dancing inside it." },
  stormStaff: { name: "Storm Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 66, slots: 2, atk: 90, mp: 300, range: 245, sell: 10_000, art: [{ id: "crystalYellow" }], desc: "A yellow crystal that hums with thunder. Your hair stands on end when you hold it." },
  // Ashpeak.
  cinderBlade: { name: "Cinder Blade", kind: "equip", slot: "weapon", weapon: "sword", rarity: "uncommon", lv: 72, slots: 2, atk: 96, crit: 5, sell: 7000, art: [{ id: "glowswordRed" }], desc: "A sword that glows like a coal from the fire, and never cools." },
  magmaLance: { name: "Magma Lance", kind: "equip", slot: "weapon", weapon: "spear", twoHanded: true, rarity: "rare", lv: 76, slots: 2, atk: 140, crit: 4, sell: 13_000, art: [{ id: "longspearDark" }], desc: "A long black spear with a red-hot tip. Needs both hands. Knights only." },
  emberBow: { name: "Ember Bow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "uncommon", lv: 72, slots: 2, atk: 84, range: 255, sell: 7000, icon: "bow_01d", art: [{ id: "bowCopper" }], desc: "Copper-bound wood, scorched black. Its arrows leave a trail of sparks." },
  obsidianBow: { name: "Obsidian Longbow", kind: "equip", slot: "weapon", weapon: "bow", twoHanded: true, rarity: "rare", lv: 76, slots: 2, atk: 102, crit: 4, range: 260, sell: 13_000, icon: "bow_03e", art: [{ id: "greatBowDark" }], desc: "A tall black bow, polished like glass. Nothing shoots further." },
  cinderStaff: { name: "Cinder Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "uncommon", lv: 72, slots: 2, atk: 84, mp: 280, range: 245, sell: 7000, art: [{ id: "crystalRed" }], desc: "A red crystal that smoulders when you hold it." },
  magmaStaff: { name: "Magma Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "rare", lv: 76, slots: 2, atk: 102, mp: 340, range: 250, sell: 13_000, art: [{ id: "diamondGold" }], desc: "Gold, crowned with a stone that glows like lava. Hot to the touch." },
  archmageStaff: { name: "Archmage Staff", kind: "equip", slot: "weapon", weapon: "staff", rarity: "legendary", lv: 38, slots: 2, atk: 64, mp: 200, range: 230, sell: 15_000, icon: "staff_03b", art: [{ id: "diamondGold" }], desc: "Gold, crowned with a stone full of light. A great mage carried it once; now the Minotaur King keeps it." },

  // ------------------------------------------------------------ shields
  woodShield: { name: "Wooden Shield", kind: "equip", slot: "offhand", rarity: "common", lv: 1, slots: 1, def: 2, price: 60, icon: "shield_01a", art: [{ id: "shield" }], desc: "Solid maple. Stops a slime, mostly." },
  kiteShield: { name: "Kite Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 14, slots: 1, def: 5, hp: 20, sell: 240, icon: "shield_03b", art: [{ id: "kite" }], desc: "Long and pointed: it covers you from shoulder to knee." },
  crusaderShield: { name: "Crusader Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 18, slots: 1, def: 7, hp: 45, sell: 650, icon: "shield_02d", art: [{ id: "crusader" }], desc: "White, with a red cross. The Pumpking hoards them." },
  guardShield: { name: "Guard Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 5, slots: 1, def: 3, hp: 15, sell: 120, icon: "shield_02a", art: [{ id: "shield", colors: { wood: "walnut" } }], desc: "Dark walnut, made for the town guard." },
  roundShield: { name: "Round Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 22, slots: 1, def: 8, hp: 50, sell: 450, icon: "shield_01c", art: [{ id: "roundShield" }], desc: "Black iron, round and dented. Orc warriors carry them into battle." },
  spartanShield: { name: "Spartan Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 27, slots: 1, def: 10, hp: 90, sell: 1200, icon: "shield_03e", art: [{ id: "spartan" }], desc: "A great bronze disc that covers you from chin to knee." },
  towerShield: { name: "Tower Shield", kind: "equip", slot: "offhand", rarity: "uncommon", lv: 33, slots: 1, def: 12, hp: 120, sell: 2000, art: [{ id: "scutum" }], desc: "Tall and curved, like a wall you can carry." },
  frostShield: { name: "Frost Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 45, slots: 1, def: 16, hp: 220, sell: 5000, art: [{ id: "kiteBlue" }], desc: "An ice-blue kite shield, rimed with frost that never thaws." },
  ruinShield: { name: "Ruin Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 55, slots: 1, def: 18, hp: 270, sell: 7000, art: [{ id: "kiteRed" }], desc: "A red and grey kite shield with the Fallen King's crest, scratched half away." },
  jadeShield: { name: "Jade Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 65, slots: 1, def: 20, hp: 320, sell: 8000, art: [{ id: "kiteGreen" }], desc: "A green and grey kite shield, cool to the touch and very hard to dent." },
  obsidianShield: { name: "Obsidian Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 75, slots: 1, def: 22, hp: 360, sell: 10_000, art: [{ id: "kiteRed" }], desc: "A kite shield faced with black glass and edged in red. Swords skid off it." },
  engrailedShield: { name: "Engrailed Shield", kind: "equip", slot: "offhand", rarity: "rare", lv: 38, slots: 1, def: 14, hp: 170, sell: 4000, art: [{ id: "engrailed" }], desc: "Gold and red, with a scalloped edge. Vampires keep them as trophies." },

  // ------------------------------------------------------------ head
  leatherCap: { name: "Leather Cap", kind: "equip", slot: "head", rarity: "common", lv: 1, def: 1, price: 40, art: [{ id: "capLeather" }], desc: "Keeps the sun and the bees off." },
  chainCoif: { name: "Chain Coif", kind: "equip", slot: "head", rarity: "common", lv: 4, slots: 1, def: 2, hp: 10, price: 180, art: [{ id: "coif", colors: { metal: "iron" } }], desc: "Iron rings, linked by hand." },
  kettleHelm: { name: "Kettle Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 7, slots: 1, def: 2, hp: 20, sell: 160, art: [{ id: "kettle" }], desc: "A wide steel brim. Rain runs right off it." },
  bronzeHelm: { name: "Bronze Helm", kind: "equip", slot: "head", rarity: "rare", lv: 9, slots: 1, def: 3, hp: 30, sell: 350, art: [{ id: "nasal", colors: { metal: "bronze" } }], desc: "Polished bronze with a nose guard." },
  wizardHat: { name: "Wizard Hat", kind: "equip", slot: "head", rarity: "uncommon", lv: 12, slots: 1, def: 1, mp: 40, sell: 220, art: [{ id: "wizardHat" }], desc: "Tall and pointed. Your spells feel bigger already." },
  rangerHood: { name: "Ranger Hood", kind: "equip", slot: "head", rarity: "uncommon", lv: 12, slots: 1, def: 2, atk: 2, sell: 220, art: [{ id: "hood", colors: { cloth: "forest" } }], hides: ["hair"], desc: "Green cloth for hiding in the shadows." },
  hornedHelm: { name: "Horned Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 15, slots: 1, def: 4, hp: 35, sell: 300, art: [{ id: "horned", colors: { metal: "iron" } }], desc: "Two curved horns. Nobody remembers whose." },
  greathelm: { name: "Greathelm", kind: "equip", slot: "head", rarity: "rare", lv: 18, slots: 1, def: 5, hp: 60, sell: 650, art: [{ id: "greathelm" }], desc: "A steel bucket with eye slits. Heavy, and very safe." },
  barbarianHelm: { name: "Barbarian Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 22, slots: 1, def: 6, hp: 60, sell: 450, art: [{ id: "barbarian", colors: { metal: "iron" } }], desc: "Thick iron with cheek guards. Smells faintly of orc." },
  vikingHelm: { name: "Viking Helm", kind: "equip", slot: "head", rarity: "rare", lv: 27, slots: 1, atk: 2, def: 8, hp: 100, sell: 1200, art: [{ id: "viking" }], desc: "A steel cap with two great horns. You feel braver just wearing it." },
  armet: { name: "Armet", kind: "equip", slot: "head", rarity: "uncommon", lv: 32, slots: 1, def: 9, hp: 120, sell: 1800, art: [{ id: "armet", colors: { metal: "steel" } }], desc: "A rounded steel helm that closes snugly round the face." },
  celestialHat: { name: "Celestial Hat", kind: "equip", slot: "head", rarity: "uncommon", lv: 33, slots: 1, atk: 3, def: 3, mp: 130, sell: 1800, art: [{ id: "celestial" }], desc: "Deep blue, stitched with silver stars and a crescent moon." },
  closeHelm: { name: "Close Helm", kind: "equip", slot: "head", rarity: "rare", lv: 37, slots: 1, def: 11, hp: 160, sell: 3800, art: [{ id: "closeHelm", colors: { metal: "gold" } }], desc: "Gilded steel, closed all round. Trolls wear them as hats." },
  snowHood: { name: "Snow Hood", kind: "equip", slot: "head", rarity: "uncommon", lv: 42, slots: 1, atk: 5, def: 7, hp: 60, sell: 3000, art: [{ id: "hood", colors: { cloth: "sky" } }], hides: ["hair"], desc: "Pale blue wool for hiding in the snow." },
  moonHat: { name: "Moon Hat", kind: "equip", slot: "head", rarity: "uncommon", lv: 43, slots: 1, atk: 4, def: 4, mp: 170, sell: 3000, art: [{ id: "celestialMoon", colors: { cloth: "sky" } }], desc: "Frost-blue, with a silver crescent moon. Frost Shamans wear them." },
  valkyrieHelm: { name: "Valkyrie Helm", kind: "equip", slot: "head", rarity: "rare", lv: 46, slots: 1, atk: 3, def: 13, hp: 220, sell: 6000, art: [{ id: "norman", colors: { metal: "silver" } }, { id: "helmWings", colors: { metal: "silver" } }], desc: "Silver, with a wing on either side. Old heroes of the north wore them." },
  bascinet: { name: "Bascinet", kind: "equip", slot: "head", rarity: "uncommon", lv: 53, slots: 1, def: 15, hp: 260, sell: 4200, art: [{ id: "bascinet", colors: { metal: "iron" } }], desc: "A pointed iron helm, black with age." },
  shadowHood: { name: "Shadow Hood", kind: "equip", slot: "head", rarity: "uncommon", lv: 53, slots: 1, atk: 7, def: 9, hp: 90, sell: 4200, art: [{ id: "hood", colors: { cloth: "black" } }], hides: ["hair"], desc: "Black cloth that drinks the light." },
  nightHat: { name: "Night Hat", kind: "equip", slot: "head", rarity: "uncommon", lv: 53, slots: 1, atk: 5, def: 5, mp: 210, sell: 4200, art: [{ id: "celestialMoon", colors: { cloth: "black" } }], desc: "Black as midnight, with a silver crescent moon." },
  fallenCrown: { name: "Fallen Crown", kind: "equip", slot: "head", rarity: "legendary", lv: 58, slots: 1, atk: 8, def: 12, hp: 260, mp: 120, sell: 25_000, art: [{ id: "crownGray" }], desc: "The Fallen King's tarnished crown. Anyone may wear it, if they dare." },
  phantomHelm: { name: "Phantom Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 63, slots: 1, def: 17, hp: 300, sell: 5000, art: [{ id: "horned", colors: { metal: "gold" } }], desc: "A gilded helm with two horns, still worn by the Phantom Swordsmen." },
  crowMask: { name: "Crow Mask", kind: "equip", slot: "head", rarity: "uncommon", lv: 63, slots: 1, atk: 8, def: 10, hp: 110, crit: 3, sell: 5000, art: [{ id: "maskBlack" }], desc: "A plain black mask. Crow Blades never show their faces." },
  blossomHat: { name: "Blossom Hat", kind: "equip", slot: "head", rarity: "uncommon", lv: 63, slots: 1, atk: 6, def: 6, mp: 250, sell: 5000, art: [{ id: "wizardHatPink" }], desc: "A tall pink hat. Petals collect in the brim." },
  warlordHelm: { name: "Warlord's Helm", kind: "equip", slot: "head", rarity: "legendary", lv: 68, slots: 1, atk: 10, def: 14, hp: 300, mp: 140, sell: 30_000, art: [{ id: "maximus", colors: { metal: "gold" } }], desc: "The Ogre Warlord's golden helm, crested like a king's. Anyone may wear it, if they can lift it." },
  obsidianHelm: { name: "Obsidian Helm", kind: "equip", slot: "head", rarity: "uncommon", lv: 73, slots: 1, def: 19, hp: 340, sell: 6500, art: [{ id: "greathelm", colors: { metal: "iron" } }], desc: "A black great helm, as heavy as it looks, taken from an Obsidian Knight." },
  emberHood: { name: "Ember Hood", kind: "equip", slot: "head", rarity: "uncommon", lv: 73, slots: 1, atk: 7, def: 7, mp: 290, sell: 6500, hides: ["hair"], art: [{ id: "hood", colors: { cloth: "red" } }], desc: "A deep red hood. The smoke never seems to bother whoever wears it." },
  ashenHood: { name: "Ashen Hood", kind: "equip", slot: "head", rarity: "uncommon", lv: 73, slots: 1, atk: 9, def: 11, hp: 130, crit: 3, sell: 6500, hides: ["hair"], art: [{ id: "hood", colors: { cloth: "charcoal" } }], desc: "A hood the colour of ash. On Ashpeak, nobody sees you coming." },
  meadowCrown: { name: "Meadow Crown", kind: "equip", slot: "head", rarity: "legendary", lv: 10, slots: 1, atk: 4, def: 4, hp: 60, sell: 5000, art: [{ id: "crown" }], desc: "Said to belong to the first king of the meadow. Snapper Flowers hide it very, very rarely." },

  // ------------------------------------------------------------ body
  leatherArmor: { name: "Leather Armour", kind: "equip", slot: "body", rarity: "common", lv: 1, slots: 1, def: 2, price: 80, art: [{ id: "leatherArmor" }], desc: "Boiled leather with a brass buckle." },
  legionArmor: { name: "Legion Armour", kind: "equip", slot: "body", rarity: "uncommon", lv: 6, slots: 1, def: 4, hp: 15, sell: 200, art: [{ id: "legion" }], desc: "Overlapping steel bands. Old, but sturdy." },
  guardTabard: { name: "Guard Tabard", kind: "equip", slot: "body", rarity: "uncommon", lv: 14, slots: 1, def: 4, hp: 30, sell: 280, art: [{ id: "tabardMaroon" }], desc: "A padded maroon tabard, like the town guard wears." },
  sageTabard: { name: "Sage Tabard", kind: "equip", slot: "body", rarity: "uncommon", lv: 15, slots: 1, def: 2, mp: 50, atk: 2, sell: 300, art: [{ id: "tabardLavender" }], desc: "Lavender cloth stitched with tiny stars." },
  scoutArmor: { name: "Scout Armour", kind: "equip", slot: "body", rarity: "uncommon", lv: 22, slots: 1, atk: 3, def: 5, hp: 40, sell: 450, art: [{ id: "leatherArmor" }, { id: "capeTattered", colors: { cloth: "forest" } }], desc: "Light leather and a ragged green cape, for moving quietly through the woods." },
  starryCloak: { name: "Starry Cloak", kind: "equip", slot: "body", rarity: "rare", lv: 25, slots: 1, atk: 4, def: 3, mp: 90, sell: 900, art: [{ id: "tabardLavender" }, { id: "cape", colors: { cloth: "navy" } }], desc: "A deep blue cloak that sparkles like the night sky." },
  darkPlate: { name: "Dark Plate", kind: "equip", slot: "body", rarity: "rare", lv: 26, slots: 1, def: 10, hp: 90, sell: 1500, art: [{ id: "plate", colors: { metal: "iron" } }, { id: "plateArms", colors: { metal: "iron" } }], desc: "Blackened steel plate, cold to the touch. Old orc dead still wear it." },
  wolfskinVest: { name: "Wolfskin Vest", kind: "equip", slot: "body", rarity: "uncommon", lv: 33, slots: 1, atk: 6, def: 8, hp: 80, sell: 1800, art: [{ id: "leatherArmor" }, { id: "capeTattered", colors: { cloth: "gray" } }], desc: "Leather under a grey wolf pelt. Warm, light and quiet." },
  mysticRobe: { name: "Mystic Robe", kind: "equip", slot: "body", rarity: "uncommon", lv: 34, slots: 1, atk: 6, def: 4, mp: 150, sell: 1800, art: [{ id: "tabardPurple" }, { id: "cape", colors: { cloth: "black" } }], desc: "Purple silk and a black cloak. Spells come easier wearing it." },
  goldPlate: { name: "Golden Plate", kind: "equip", slot: "body", rarity: "rare", lv: 38, slots: 1, def: 15, hp: 170, sell: 4500, art: [{ id: "plate", colors: { metal: "gold" } }, { id: "plateArms", colors: { metal: "gold" } }], desc: "Full plate, gilded from collar to knee. The Minotaur King wears the same." },
  furCloak: { name: "Fur Cloak", kind: "equip", slot: "body", rarity: "uncommon", lv: 43, slots: 1, atk: 8, def: 9, hp: 100, sell: 3000, art: [{ id: "leatherArmor" }, { id: "capeTattered", colors: { cloth: "white" } }], desc: "Leather under a shaggy white yeti fur. Warm, light and quiet." },
  winterRobe: { name: "Winter Robe", kind: "equip", slot: "body", rarity: "uncommon", lv: 44, slots: 1, atk: 8, def: 5, mp: 190, sell: 3000, art: [{ id: "tabardWhite", colors: { cloth: "sky" } }, { id: "cape", colors: { cloth: "navy" } }], desc: "Frost-blue wool under a deep blue cloak. Spells come easier in the cold." },
  frostPlate: { name: "Frost Plate", kind: "equip", slot: "body", rarity: "rare", lv: 47, slots: 1, def: 19, hp: 240, sell: 6500, art: [{ id: "plate", colors: { metal: "silver" } }, { id: "plateArms", colors: { metal: "silver" } }, { id: "cape", colors: { cloth: "sky" } }], desc: "Silver plate and an ice-blue cape. Frost Wights still wear it, long after they died." },
  shadowCloak: { name: "Shadow Cloak", kind: "equip", slot: "body", rarity: "uncommon", lv: 54, slots: 1, atk: 10, def: 11, hp: 130, sell: 4200, art: [{ id: "leatherArmor" }, { id: "capeTattered", colors: { cloth: "black" } }], desc: "Dark leather under a ragged black cloak. Wraiths wear them, after a fashion." },
  lichRobe: { name: "Lich Robe", kind: "equip", slot: "body", rarity: "uncommon", lv: 54, slots: 1, atk: 10, def: 6, mp: 230, sell: 4200, art: [{ id: "tabardBlack" }, { id: "cape", colors: { cloth: "purple" } }], desc: "Black silk and a purple cloak, cold as the grave." },
  dreadPlate: { name: "Dread Plate", kind: "equip", slot: "body", rarity: "rare", lv: 57, slots: 1, def: 22, hp: 290, sell: 9000, art: [{ id: "plate", colors: { metal: "iron" } }, { id: "plateArms", colors: { metal: "iron" } }, { id: "cape", colors: { cloth: "maroon" } }], desc: "Black plate and a dark red cape: a Dark Knight's armour, emptied at last." },
  crowMantle: { name: "Crow Mantle", kind: "equip", slot: "body", rarity: "uncommon", lv: 64, slots: 1, atk: 11, def: 12, hp: 150, crit: 2, sell: 5000, art: [{ id: "leatherArmor" }, { id: "crowWings" }], desc: "Black leather and a pair of crow's wings. They don't fly, but they look the part." },
  blossomRobe: { name: "Blossom Robe", kind: "equip", slot: "body", rarity: "uncommon", lv: 64, slots: 1, atk: 11, def: 7, mp: 270, sell: 5000, art: [{ id: "tabardPink" }, { id: "cape", colors: { cloth: "rose" } }], desc: "Pink silk under a rose-red cloak, light as spring." },
  warlordPlate: { name: "Warlord Plate", kind: "equip", slot: "body", rarity: "rare", lv: 67, slots: 1, def: 25, hp: 330, sell: 10_000, art: [{ id: "legion", colors: { metal: "gold" } }, { id: "plateArms", colors: { metal: "gold" } }, { id: "cape", colors: { cloth: "black" } }], desc: "Gold plates on red leather and a black cloak: armour from the Ogre Warlord's own guard." },
  obsidianPlate: { name: "Obsidian Plate", kind: "equip", slot: "body", rarity: "rare", lv: 77, slots: 1, def: 28, hp: 370, sell: 13_000, art: [{ id: "plate", colors: { metal: "iron" } }, { id: "plateArms", colors: { metal: "iron" } }, { id: "cape", colors: { cloth: "maroon" } }], desc: "Black plate armour and a dark red cloak: an Obsidian Knight's whole suit." },
  cinderRobe: { name: "Cinder Robe", kind: "equip", slot: "body", rarity: "uncommon", lv: 74, slots: 1, atk: 12, def: 8, mp: 310, sell: 6500, art: [{ id: "tabardBlack" }, { id: "cape", colors: { cloth: "red" } }], desc: "Black cloth under a cloak the colour of flame." },
  ashenLeathers: { name: "Ashen Leathers", kind: "equip", slot: "body", rarity: "uncommon", lv: 74, slots: 1, atk: 12, def: 13, hp: 170, crit: 2, sell: 6500, art: [{ id: "leatherArmor" }, { id: "capeTattered", colors: { cloth: "charcoal" } }], desc: "Leather and a ragged grey cloak, both smelling of smoke." },
  colossusMantle: { name: "Colossus Mantle", kind: "equip", slot: "body", rarity: "legendary", lv: 78, slots: 1, atk: 12, def: 22, hp: 360, mp: 160, sell: 36_000, art: [{ id: "plate", colors: { metal: "gold" } }, { id: "plateArms", colors: { metal: "gold" } }, { id: "cape", colors: { cloth: "red" } }], desc: "Gold plates still warm from the Cinder Colossus's fire, and a cloak of flame red. Anyone may wear it." },
  plateArmor: { name: "Plate Armour", kind: "equip", slot: "body", rarity: "rare", lv: 10, slots: 1, def: 6, hp: 40, sell: 600, art: [{ id: "plate" }, { id: "plateArms" }], desc: "Full steel plate. You clank, but you live." },

  // ------------------------------------------------------------ legs
  leatherPants: { name: "Leather Pants", kind: "equip", slot: "legs", rarity: "common", lv: 1, def: 1, price: 40, art: [{ id: "pants", colors: { cloth: "leather" } }], desc: "Tough trousers for rough grass." },
  ironGreaves: { name: "Iron Greaves", kind: "equip", slot: "legs", rarity: "uncommon", lv: 6, slots: 1, def: 2, hp: 10, sell: 140, art: [{ id: "greaves", colors: { metal: "iron" } }], desc: "Iron plates strapped over the legs." },
  steelGreaves: { name: "Steel Greaves", kind: "equip", slot: "legs", rarity: "uncommon", lv: 22, slots: 1, def: 4, hp: 30, sell: 400, art: [{ id: "greaves", colors: { metal: "silver" } }], desc: "Polished steel from knee to ankle." },
  frostGreaves: { name: "Frost Greaves", kind: "equip", slot: "legs", rarity: "uncommon", lv: 44, slots: 1, def: 8, hp: 70, sell: 2600, art: [{ id: "greaves", colors: { metal: "silver" } }], desc: "Bright silver plates from knee to ankle, cold as ice." },
  goldGreaves: { name: "Golden Greaves", kind: "equip", slot: "legs", rarity: "uncommon", lv: 35, slots: 1, def: 6, hp: 50, sell: 1600, art: [{ id: "greaves", colors: { metal: "gold" } }], desc: "Gilded steel plates from knee to ankle." },

  // ------------------------------------------------------------ feet
  leatherBoots: { name: "Leather Boots", kind: "equip", slot: "feet", rarity: "common", lv: 1, slots: 1, def: 1, price: 40, art: [{ id: "boots", colors: { cloth: "leather" } }], desc: "Snake-proof, mostly." },
  ironBoots: { name: "Iron Boots", kind: "equip", slot: "feet", rarity: "uncommon", lv: 6, slots: 1, def: 2, hp: 10, sell: 130, art: [{ id: "ironBoots", colors: { metal: "iron" } }], desc: "Heavy, loud and very hard to bite through." },
  steelSabatons: { name: "Steel Sabatons", kind: "equip", slot: "feet", rarity: "uncommon", lv: 22, slots: 1, def: 4, hp: 25, sell: 400, art: [{ id: "ironBoots", colors: { metal: "silver" } }], desc: "Steel boots with pointed toes. Orc archers prize them." },
  frostSabatons: { name: "Frost Sabatons", kind: "equip", slot: "feet", rarity: "uncommon", lv: 45, slots: 1, def: 8, hp: 60, sell: 2600, art: [{ id: "ironBoots", colors: { metal: "silver" } }], desc: "Bright silver boots that never slip on ice." },
  goldSabatons: { name: "Golden Sabatons", kind: "equip", slot: "feet", rarity: "uncommon", lv: 35, slots: 1, def: 6, hp: 45, sell: 1600, art: [{ id: "ironBoots", colors: { metal: "gold" } }], desc: "Gilded steel boots. They ring on the rocks." },

  // ------------------------------------------------------------ rings and amulets
  copperRing: { name: "Copper Ring", kind: "equip", slot: "ring", rarity: "common", lv: 1, atk: 1, price: 120, icon: "ring_01a", desc: "A simple band that makes you feel a little braver." },
  vigorRing: { name: "Ring of Vigor", kind: "equip", slot: "ring", rarity: "uncommon", lv: 5, slots: 1, hp: 30, sell: 200, icon: "ring_02e", desc: "A red stone that beats like a heart." },
  cloverCharm: { name: "Clover Charm", kind: "equip", slot: "amulet", rarity: "common", lv: 1, hp: 15, price: 120, icon: "necklace_01a", desc: "A four-leaf clover on a cord." },
  mightRing: { name: "Ring of Might", kind: "equip", slot: "ring", rarity: "uncommon", lv: 24, slots: 1, atk: 5, sell: 600, icon: "ring_03c", desc: "A heavy iron ring. Your arm feels stronger with it on." },
  guardianRing: { name: "Guardian Ring", kind: "equip", slot: "ring", rarity: "rare", lv: 28, slots: 1, def: 4, hp: 60, sell: 1500, icon: "ring_02b", desc: "A blue stone set in silver. It hums when danger is near." },
  tuskNecklace: { name: "Tusk Necklace", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 22, slots: 1, atk: 4, crit: 4, sell: 600, icon: "necklace_02c", desc: "Orc tusks on a leather cord. Wear it and orcs think twice." },
  warlordMedal: { name: "Warlord's Medal", kind: "equip", slot: "amulet", rarity: "epic", lv: 30, slots: 1, atk: 8, hp: 120, sell: 5000, icon: "necklace_03b", desc: "A heavy gold medal from the Orc Warlord's own chest." },
  wolfFang: { name: "Wolf Fang Necklace", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 34, slots: 1, atk: 6, crit: 5, sell: 1800, icon: "necklace_03e", desc: "A werewolf's fang on a red cord. You hear howling when you wear it." },
  wildRing: { name: "Ring of the Wild", kind: "equip", slot: "ring", rarity: "rare", lv: 36, slots: 1, atk: 7, hp: 60, sell: 3000, icon: "ring_03a", desc: "Carved from a troll's knuckle bone, with a green stone." },
  minotaurHorn: { name: "Minotaur Horn", kind: "equip", slot: "amulet", rarity: "epic", lv: 40, slots: 1, atk: 12, hp: 180, sell: 9000, icon: "necklace_01d", desc: "A tip of the Minotaur King's horn, on a gold chain." },
  snowflake: { name: "Snowflake Pendant", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 44, slots: 1, atk: 7, mp: 80, crit: 4, sell: 3000, icon: "necklace_01b", desc: "A silver snowflake on a fine chain. No two are alike." },
  frostRing: { name: "Frost Ring", kind: "equip", slot: "ring", rarity: "rare", lv: 46, slots: 1, atk: 3, def: 5, hp: 100, sell: 4500, icon: "ring_01b", desc: "A band of clear ice that never melts on your finger." },
  giantsTooth: { name: "Frost Giant's Tooth", kind: "equip", slot: "amulet", rarity: "epic", lv: 48, slots: 1, atk: 14, def: 4, hp: 220, sell: 12_000, icon: "necklace_03c", desc: "One of the Frost Giant's teeth, as big as your hand, on a silver chain." },
  boneCharm: { name: "Bone Charm", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 53, slots: 1, atk: 9, crit: 5, sell: 4000, icon: "necklace_02e", desc: "A small carved bone on a red cord. It rattles before a fight." },
  soulRing: { name: "Ring of Souls", kind: "equip", slot: "ring", rarity: "rare", lv: 55, slots: 1, atk: 4, def: 6, hp: 130, sell: 6000, icon: "ring_02c", desc: "A dark stone that glows faintly whenever something dies nearby." },
  kingsSeal: { name: "King's Seal", kind: "equip", slot: "amulet", rarity: "epic", lv: 58, slots: 1, atk: 16, def: 5, hp: 260, sell: 15_000, icon: "necklace_02d", desc: "The Fallen King's seal ring, hung on a gold chain. It still commands respect." },
  foxfireCharm: { name: "Foxfire Charm", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 63, slots: 1, atk: 10, mp: 120, crit: 5, sell: 5000, icon: "necklace_02b", desc: "A red stone on a cord, warm with foxfire." },
  moonRing: { name: "Moonstone Ring", kind: "equip", slot: "ring", rarity: "rare", lv: 65, slots: 1, atk: 5, def: 7, hp: 150, flee: 3, sell: 7000, icon: "ring_03b", desc: "A silver ring set with a moonstone. Light on your feet, light on your hand." },
  warlordFang: { name: "Warlord's Fang", kind: "equip", slot: "amulet", rarity: "epic", lv: 68, slots: 1, atk: 18, def: 6, hp: 300, sell: 18_000, icon: "necklace_01e", desc: "One of the Ogre Warlord's tusks, on a red cord. Even ogres step aside for it." },
  emberRing: { name: "Ember Ring", kind: "equip", slot: "ring", rarity: "rare", lv: 75, slots: 1, atk: 6, def: 8, hp: 170, flee: 3, sell: 9000, icon: "ring_02e", desc: "A gold ring with a tiny flame trapped in its stone." },
  salamanderCharm: { name: "Salamander Charm", kind: "equip", slot: "amulet", rarity: "uncommon", lv: 73, slots: 1, atk: 11, mp: 140, crit: 5, sell: 6500, icon: "necklace_03d", desc: "A salamander's scale on a cord. It keeps you warm, and quick." },
  colossusHeart: { name: "Colossus Heart", kind: "equip", slot: "amulet", rarity: "epic", lv: 78, slots: 1, atk: 20, def: 7, hp: 340, sell: 22_000, icon: "necklace_03e", desc: "A chip of the Cinder Colossus's burning heart, set in black iron. It beats." },
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
  goblinCard: { name: "Goblin Card", kind: "card", rarity: "epic", monster: "goblin", fits: ["feet"], prefix: "Swift", atk: 2, flee: 5, sell: 0, desc: "Here one moment, behind you the next." },
  orcWarriorCard: { name: "Orc Warrior Card", kind: "card", rarity: "epic", monster: "orcWarrior", fits: ["body"], prefix: "Orcish", def: 2, hp: 60, sell: 0, desc: "Thick-skinned and stubborn." },
  orcArcherCard: { name: "Orc Archer Card", kind: "card", rarity: "epic", monster: "orcArcher", fits: ["head"], prefix: "Keen", crit: 10, sell: 0, desc: "Never misses a weak spot." },
  orcSkeletonCard: { name: "Orc Skeleton Card", kind: "card", rarity: "epic", monster: "orcSkeleton", fits: ["offhand"], prefix: "Bony", def: 4, sell: 0, desc: "Nothing but bone, and very hard to break." },
  orcZombieCard: { name: "Orc Zombie Card", kind: "card", rarity: "epic", monster: "orcZombie", fits: ["legs"], prefix: "Undying", hp: 100, sell: 0, desc: "It just keeps walking." },
  orcWarlordCard: { name: "Orc Warlord Card", kind: "card", rarity: "legendary", monster: "orcWarlord", fits: ["head"], prefix: "Heroic", atk: 5, def: 3, hp: 100, sell: 0, desc: "The Orc Warlord himself, roaring on a gold card." },
  boarmanCard: { name: "Boarman Card", kind: "card", rarity: "epic", monster: "boarman", fits: ["amulet"], prefix: "Charging", atk: 5, sell: 0, desc: "Head down, tusks first." },
  lizardmanCard: { name: "Lizardman Card", kind: "card", rarity: "epic", monster: "lizardman", fits: ["offhand"], prefix: "Scaled", def: 3, hp: 80, sell: 0, desc: "Scales as hard as steel." },
  werewolfCard: { name: "Werewolf Card", kind: "card", rarity: "epic", monster: "werewolf", fits: ["weapon"], prefix: "Feral", atk: 4, crit: 5, sell: 0, desc: "It howls when the moon comes out." },
  trollCard: { name: "Troll Card", kind: "card", rarity: "epic", monster: "troll", fits: ["body"], prefix: "Trollish", hp: 150, sell: 0, desc: "Big, green and very hard to knock down." },
  vampireCard: { name: "Vampire Card", kind: "card", rarity: "epic", monster: "vampire", fits: ["ring"], prefix: "Bloodthirsty", drain: 4, sell: 0, desc: "A pale face with a thin smile." },
  minotaurKingCard: { name: "Minotaur King Card", kind: "card", rarity: "legendary", monster: "minotaurKing", fits: ["body"], prefix: "Mighty", atk: 6, def: 4, hp: 200, sell: 0, desc: "The Minotaur King, horns lowered, on a gold card." },
  yetiCard: { name: "Yeti Card", kind: "card", rarity: "epic", monster: "yeti", fits: ["legs"], prefix: "Shaggy", def: 2, hp: 120, sell: 0, desc: "Big, white and very warm." },
  ramhornCard: { name: "Ramhorn Card", kind: "card", rarity: "epic", monster: "ramhorn", fits: ["feet"], prefix: "Nimble", atk: 3, flee: 6, sell: 0, desc: "Sure-footed on the steepest ice." },
  frostShamanCard: { name: "Frost Shaman Card", kind: "card", rarity: "epic", monster: "frostShaman", fits: ["head"], prefix: "Wintry", atk: 4, mp: 60, sell: 0, desc: "Its breath frosts the card over." },
  frostWightCard: { name: "Frost Wight Card", kind: "card", rarity: "epic", monster: "frostWight", fits: ["ring"], prefix: "Frozen", def: 3, hp: 80, sell: 0, desc: "Still standing guard, long after death." },
  frostDrakeCard: { name: "Frost Drake Card", kind: "card", rarity: "epic", monster: "frostDrake", fits: ["weapon"], prefix: "Draconic", atk: 6, crit: 3, sell: 0, desc: "Ice-blue scales and a cold, hungry eye." },
  frostGiantCard: { name: "Frost Giant Card", kind: "card", rarity: "legendary", monster: "frostGiant", fits: ["amulet"], prefix: "Titanic", atk: 8, def: 4, hp: 250, sell: 0, desc: "The Frost Giant, axe raised, on a gold card." },
  wraithCard: { name: "Wraith Card", kind: "card", rarity: "epic", monster: "wraith", fits: ["feet"], prefix: "Spectral", flee: 8, hp: 60, sell: 0, desc: "Now you see it, now you don't." },
  gargoyleCard: { name: "Gargoyle Card", kind: "card", rarity: "epic", monster: "gargoyle", fits: ["legs"], prefix: "Stony", def: 4, hp: 100, sell: 0, desc: "Heavy as a statue, and just as hard." },
  darkKnightCard: { name: "Dark Knight Card", kind: "card", rarity: "epic", monster: "darkKnight", fits: ["offhand"], prefix: "Dread", def: 5, hp: 100, sell: 0, desc: "A black helm with nothing inside it." },
  lichCard: { name: "Lich Card", kind: "card", rarity: "epic", monster: "lich", fits: ["amulet"], prefix: "Arcane", atk: 6, mp: 120, sell: 0, desc: "A skull that smiles back." },
  fleshGolemCard: { name: "Flesh Golem Card", kind: "card", rarity: "epic", monster: "fleshGolem", fits: ["body"], prefix: "Stitched", hp: 250, sell: 0, desc: "Mostly stitches, and very hard to stop." },
  fallenKingCard: { name: "Fallen King Card", kind: "card", rarity: "legendary", monster: "fallenKing", fits: ["weapon"], prefix: "Kingly", atk: 12, crit: 8, sell: 0, desc: "The Fallen King on his throne, on a gold card gone dark." },
  moonHareCard: { name: "Moon Hare Card", kind: "card", rarity: "epic", monster: "moonHare", fits: ["feet"], prefix: "Leaping", atk: 3, flee: 9, sell: 0, desc: "Quick as a hare in the moonlight." },
  foxSpiritCard: { name: "Fox Spirit Card", kind: "card", rarity: "epic", monster: "foxSpirit", fits: ["head"], prefix: "Foxfire", atk: 6, mp: 100, sell: 0, desc: "A fox with a flame on its tail, and a sly smile." },
  crowBladeCard: { name: "Crow Blade Card", kind: "card", rarity: "epic", monster: "crowBlade", fits: ["weapon"], prefix: "Razor", atk: 6, crit: 6, sell: 0, desc: "Black wings, a black mask, and a very sharp sword." },
  phantomCard: { name: "Phantom Swordsman Card", kind: "card", rarity: "epic", monster: "phantom", fits: ["ring"], prefix: "Phantom", atk: 5, flee: 5, sell: 0, desc: "An old swordsman who never stopped fighting." },
  redOgreCard: { name: "Red Ogre Card", kind: "card", rarity: "epic", monster: "redOgre", fits: ["body"], prefix: "Ogrish", atk: 5, hp: 280, sell: 0, desc: "Big, red and very angry." },
  ogreWarlordCard: { name: "Ogre Warlord Card", kind: "card", rarity: "legendary", monster: "ogreWarlord", fits: ["legs"], prefix: "Conquering", atk: 10, def: 6, hp: 300, sell: 0, desc: "The Ogre Warlord in his war camp, on a gold card under falling petals." },
  emberImpCard: { name: "Ember Imp Card", kind: "card", rarity: "epic", monster: "emberImp", fits: ["feet"], prefix: "Scorching", atk: 5, flee: 6, sell: 0, desc: "A grinning red imp, wings spread." },
  salamanderCard: { name: "Salamander Card", kind: "card", rarity: "epic", monster: "salamander", fits: ["head"], prefix: "Kindled", atk: 7, mp: 110, sell: 0, desc: "A fire lizard curled round a flame." },
  obsidianKnightCard: { name: "Obsidian Knight Card", kind: "card", rarity: "epic", monster: "obsidianKnight", fits: ["offhand"], prefix: "Obsidian", def: 3, reflect: 18, sell: 0, desc: "A knight in black glass. Hit him, and you'll feel it too." },
  cinderWraithCard: { name: "Cinder Wraith Card", kind: "card", rarity: "epic", monster: "cinderWraith", fits: ["ring"], prefix: "Smouldering", atk: 4, flee: 6, sell: 0, desc: "A face in the smoke, and nothing else." },
  magmaGolemCard: { name: "Magma Golem Card", kind: "card", rarity: "epic", monster: "magmaGolem", fits: ["body"], prefix: "Molten", atk: 6, hp: 320, sell: 0, desc: "A slow, glowing giant made of lava." },
  cinderColossusCard: { name: "Cinder Colossus Card", kind: "card", rarity: "legendary", monster: "cinderColossus", fits: ["weapon"], prefix: "Colossal", atk: 12, crit: 6, hp: 200, sell: 0, desc: "The Cinder Colossus in his crater, on a gold card edged in fire." },
  snapperCard: { name: "Snapper Flower Card", kind: "card", rarity: "epic", monster: "snapper", fits: ["offhand"], prefix: "Thorny", def: 1, reflect: 15, sell: 0, desc: "Bite it and it bites back." },
});

export type ItemId = keyof typeof ITEMS;
export const isItemId = (id: unknown): id is ItemId => typeof id === "string" && Object.hasOwn(ITEMS, id);
export const item = (id: ItemId): ItemDef => ITEMS[id];

/** What the Outfitter by the south gate sells, in shop order. */
export const OUTFITTER_STOCK: ItemId[] = [
  "redPotion",
  "orangePotion",
  "whitePotion",
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

/** Whether a class may wear this (second jobs wear whatever their first job does). */
export function canWear(cls: ClassId, it: ItemDef): boolean {
  const line = jobLine(cls);
  if (it.classes && !it.classes.includes(line)) return false;
  return !it.weapon || WEAPON_USERS[it.weapon].includes(line);
}

/** Who may wear it, when not everyone may ("Knights only"). */
export function wearersText(it: ItemDef): string {
  const who = it.classes ?? (it.weapon ? WEAPON_USERS[it.weapon] : undefined);
  if (!who || who.length >= 4) return "";
  const names: Partial<Record<ClassId, string>> = { novice: "Novices", knight: "Knights", mage: "Mages", archer: "Archers" };
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

/** A saved stack (bag, shop or mail), if it still makes sense: the item exists, the count fits, the cards and upgrade belong. */
export function cleanStack(raw: unknown): ItemStack | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, n, cards, up } = raw as { id?: unknown; n?: unknown; cards?: unknown; up?: unknown };
  if (!isItemId(id)) return null;
  const count = Math.min(stackLimit(ITEMS[id]), Math.floor(Number(n)));
  if (!(count >= 1)) return null;
  const s: ItemStack = { id, n: count };
  const c = cleanCards(id, cards);
  const u = cleanUpgrade(id, up);
  if (c) s.cards = c;
  if (u) s.up = u;
  return s;
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
/** The aura of legendary gear, or gear with a legendary card in it. */
export const AURA_LEGENDARY = 20;
/** Gear auras from weakest to best. Titles have their own (see titles.ts). */
const GEAR_AURAS = [7, 9, AURA_LEGENDARY, 10];

/** The aura someone's gear gives them: the best of GEAR_AURAS they qualify for, or 0. */
export function auraOf(gear: Partial<Record<Slot, ItemStack>>): number {
  const worn = Object.values(gear).filter((s): s is ItemStack => Boolean(s));
  const best = Math.max(0, ...worn.map((s) => s.up ?? 0));
  const legendary = worn.some((s) => ITEMS[s.id].rarity === "legendary" || s.cards?.some((c) => ITEMS[c].rarity === "legendary"));
  return [...GEAR_AURAS].reverse().find((a) => (a === AURA_LEGENDARY ? legendary : best >= a)) ?? 0;
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
