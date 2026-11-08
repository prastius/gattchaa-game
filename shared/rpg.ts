// Leveling and fighting: classes, the EXP curve, monsters and where they live.
//
// Pure data and formulas, shared by the server (which runs every fight) and
// the client (which draws bars, names and reach). Balance lives here, so
// tuning a monster or raising the level cap is a one-line change.

import { TILE, TOWN_AREA, INTERIOR_ZONE, inRect, type Rect } from "./town";
import type { Bonus, ItemId } from "./items";

/** Highest level for now; raised step by step. The EXP curve already continues past it. */
export const LEVEL_CAP = 100;

/**
 * EXP needed to go from `level` to the next one. Gentle through the Novice
 * levels; from the job change it climbs to three times as much (level 13 on),
 * so the job levels take a while; steeper again past ~30.
 */
export function expToNext(level: number): number {
  const job = 1 + 2 * Math.min(1, Math.max(0, (level - 9) / 4));
  return Math.round(25 * Math.pow(level, 1.8) * (1 + Math.pow(level / 30, 2)) * job);
}

// ---------------------------------------------------------------- classes

export type ClassId = "novice" | "knight" | "mage" | "archer" | "lordKnight" | "wizard" | "hunter";

export interface ClassDef {
  id: ClassId;
  name: string;
  /** Second jobs: the first job they grow out of (they keep its weapons, gear and skills). */
  from?: ClassId;
  /** What the Job Master says about it. */
  blurb: string;
  /** [at level 1, gained per level] */
  hp: [number, number];
  mp: [number, number];
  atk: [number, number];
  def: [number, number];
  /** Reach without a bow or staff, in pixels, feet to feet (plus the monster's size). */
  range: number;
  /** Time between auto-attacks. */
  attackMs: number;
  /** Share of the current level's EXP lost when knocked out. */
  deathExpLoss: number;
}

/** Everyone starts as a Novice; at level 10 the Job Master makes you a Knight, Mage or Archer. */
export const CLASSES: Record<ClassId, ClassDef> = {
  novice: {
    id: "novice", name: "Novice", blurb: "Everyone starts here.",
    hp: [40, 12], mp: [10, 3], atk: [6, 2], def: [1, 0.5], range: 40, attackMs: 1000, deathExpLoss: 0,
  },
  knight: {
    id: "knight", name: "Knight", blurb: "Sword and shield at the front. The most health and defence, and heavy blows up close.",
    hp: [60, 16], mp: [14, 3], atk: [8, 2.3], def: [2, 0.75], range: 40, attackMs: 1000, deathExpLoss: 0.03,
  },
  mage: {
    id: "mage", name: "Mage", blurb: "Fire and frost from a distance. Fragile, but the strongest spells, and heals itself.",
    hp: [34, 9], mp: [30, 8], atk: [7, 2.5], def: [1, 0.3], range: 40, attackMs: 1200, deathExpLoss: 0.03,
  },
  archer: {
    id: "archer", name: "Archer", blurb: "A bow and quick feet. Hits from far away and picks the fight.",
    hp: [44, 11], mp: [18, 4], atk: [7, 2.3], def: [1, 0.45], range: 40, attackMs: 1000, deathExpLoss: 0.03,
  },
  // Second jobs, from level 50. Each grows a little faster than its first job, so the change itself is a step up.
  lordKnight: {
    id: "lordKnight", name: "Lord Knight", from: "knight", blurb: "A Knight who has seen every battlefield. Pierces armour, sweeps crowds aside, and fights harder the longer it lasts.",
    hp: [80, 17], mp: [20, 3.2], atk: [10, 2.45], def: [3, 0.8], range: 40, attackMs: 1000, deathExpLoss: 0.03,
  },
  wizard: {
    id: "wizard", name: "Wizard", from: "mage", blurb: "A Mage who commands the sky: meteors, blizzards and lightning, raining down on whole crowds.",
    hp: [40, 9.6], mp: [40, 8.6], atk: [9, 2.7], def: [2, 0.32], range: 40, attackMs: 1200, deathExpLoss: 0.03,
  },
  hunter: {
    id: "hunter", name: "Hunter", from: "archer", blurb: "An Archer with a falcon on the arm and snares in the pack. Pins the prey down, then never misses.",
    hp: [50, 11.8], mp: [22, 4.4], atk: [9, 2.45], def: [2, 0.48], range: 40, attackMs: 1000, deathExpLoss: 0.03,
  },
};

export const isClassId = (id: unknown): id is ClassId => typeof id === "string" && Object.hasOwn(CLASSES, id);

/** The first job a class belongs to: a Lord Knight is still a Knight (itself for first jobs and Novices). */
export const jobLine = (cls: ClassId): ClassId => CLASSES[cls].from ?? cls;

/** "a Knight", "an Archer". */
export const aClass = (cls: ClassId) => `${/^[AEIOU]/.test(CLASSES[cls].name) ? "an" : "a"} ${CLASSES[cls].name}`;

/** A Novice can choose a job from this level. */
export const JOB_LEVEL = 10;
/** What the Job Master offers, in his order. */
export const JOBS: ClassId[] = ["knight", "mage", "archer"];
/** The weapon each job starts with, a gift from the Job Master. */
export const JOB_WEAPON: Partial<Record<ClassId, ItemId>> = { knight: "squireSword", mage: "apprenticeStaff", archer: "huntingBow" };
/** A first job can become its second job from this level, again with the Job Master. */
export const SECOND_JOB_LEVEL = 50;
/** Each first job's second job. */
export const SECOND_JOBS: Partial<Record<ClassId, ClassId>> = { knight: "lordKnight", mage: "wizard", archer: "hunter" };

/** Skill points earned so far: one at the job change and one more every level after. */
export const skillPoints = (cls: ClassId, level: number) => (cls === "novice" ? 0 : Math.max(0, level - JOB_LEVEL + 1));

export interface Stats {
  maxHp: number;
  maxMp: number;
  atk: number;
  def: number;
  range: number;
  attackMs: number;
  /** Chances, 0..1: landing a critical hit, a monster missing you. */
  crit: number;
  flee: number;
  /** Share of each monster hit sent back at it, 0..1. */
  reflect: number;
  /** Share of the damage you deal that heals you, 0..1. */
  drain: number;
}

/** A class at a level, plus whatever its equipment (and the cards in it) adds; a bow or staff sets the reach. */
export function statsFor(cls: ClassId, level: number, bonus?: Partial<Bonus>, weaponRange?: number): Stats {
  const c = CLASSES[cls];
  const at = ([base, per]: [number, number]) => Math.floor(base + per * (level - 1));
  return {
    maxHp: at(c.hp) + (bonus?.hp ?? 0),
    maxMp: at(c.mp) + (bonus?.mp ?? 0),
    atk: at(c.atk) + (bonus?.atk ?? 0),
    def: at(c.def) + (bonus?.def ?? 0),
    range: weaponRange ?? c.range,
    attackMs: c.attackMs,
    crit: CRIT_CHANCE + (bonus?.crit ?? 0) / 100,
    flee: Math.min(MAX_FLEE, (bonus?.flee ?? 0) / 100),
    reflect: (bonus?.reflect ?? 0) / 100,
    drain: (bonus?.drain ?? 0) / 100,
  };
}

// ---------------------------------------------------------------- monsters

export type MonsterId =
  | "slime"
  | "snake"
  | "hornet"
  | "snapper"
  | "grub"
  | "bat"
  | "rockworm"
  | "gazer"
  | "ghost"
  | "pumpking"
  | "goblin"
  | "orcWarrior"
  | "orcArcher"
  | "orcSkeleton"
  | "orcZombie"
  | "orcWarlord"
  | "boarman"
  | "lizardman"
  | "werewolf"
  | "troll"
  | "vampire"
  | "minotaurKing"
  | "yeti"
  | "ramhorn"
  | "frostShaman"
  | "frostWight"
  | "frostDrake"
  | "frostGiant"
  | "wraith"
  | "gargoyle"
  | "darkKnight"
  | "lich"
  | "fleshGolem"
  | "fallenKing"
  | "moonHare"
  | "foxSpirit"
  | "crowBlade"
  | "phantom"
  | "redOgre"
  | "ogreWarlord"
  | "emberImp"
  | "salamander"
  | "obsidianKnight"
  | "cinderWraith"
  | "magmaGolem"
  | "cinderColossus"
  | "duneStalker"
  | "dustDjinn"
  | "tombWarden"
  | "desertRaider"
  | "sandGolem"
  | "duneKing"
  | "voidBat"
  | "astralSeer"
  | "starKnight"
  | "nightWisp"
  | "crystalGolem"
  | "starTyrant"
  | "crystal"
  | "castleKnight"
  | "castleArcher"
  | "shadeLordKnight"
  | "shadeWizard"
  | "shadeHunter";

export interface MonsterDef {
  id: MonsterId;
  name: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  exp: number;
  gold: [number, number];
  /** Wandering speed in px/s (0 = rooted to the spot). */
  speed: number;
  /** Chasing speed; always slower than a player, so you can run away. */
  chase: number;
  /** Attacks players who come this close (px) without being hit first; 0 = only fights back. */
  aggro: number;
  /** How close (feet to feet) it has to be to bite. */
  range: number;
  attackMs: number;
  /** Body radius: players reach it from this much further away. */
  radius: number;
  respawnMs: number;
  /** What it may leave on the ground: [item, chance 0..1], each rolled on its own. The last one is its card. */
  drops: [ItemId, number][];
  /** A field boss (Ragnarok's MVP): one at a time, a long respawn, and the town hears when it rises and falls. */
  boss?: boolean;
  /** Share of max HP healed per second out of combat (default 5 %). */
  regen?: number;
  /** Extra chance (0..1) that auto-attacks miss it (ghosts). Skills always land. */
  flee?: number;
}

export const MONSTERS: Record<MonsterId, MonsterDef> = {
  slime: {
    id: "slime", name: "Slime", level: 1, hp: 30, atk: 4, def: 0, exp: 8, gold: [1, 3], speed: 38, chase: 70, aggro: 0, range: 36, attackMs: 2000, radius: 10, respawnMs: 12_000,
    drops: [["jelly", 0.7], ["redPotion", 0.05], ["leatherCap", 0.015], ["leatherPants", 0.015], ["leatherBoots", 0.01], ["copperRing", 0.003], ["cloverCharm", 0.003], ["slimeCard", 0.0008]],
  },
  snake: {
    id: "snake", name: "Grass Snake", level: 4, hp: 85, atk: 9, def: 2, exp: 32, gold: [3, 7], speed: 45, chase: 80, aggro: 0, range: 40, attackMs: 1700, radius: 12, respawnMs: 15_000,
    drops: [["scale", 0.6], ["redPotion", 0.06], ["leatherArmor", 0.012], ["leatherBoots", 0.015], ["woodShield", 0.012], ["guardShield", 0.004], ["vigorRing", 0.002], ["snakeCard", 0.0008]],
  },
  hornet: {
    id: "hornet", name: "Hornet", level: 7, hp: 130, atk: 12, def: 4, exp: 80, gold: [6, 12], speed: 70, chase: 95, aggro: 120, range: 36, attackMs: 1400, radius: 8, respawnMs: 18_000,
    drops: [["honey", 0.55], ["orangePotion", 0.03], ["kettleHelm", 0.006], ["legionArmor", 0.005], ["bronzeSword", 0.005], ["ironGreaves", 0.006], ["ironBoots", 0.006], ["stingerPendant", 0.003], ["ironIngot", 0.02], ["hornetCard", 0.001]],
  },
  // Rooted, but it spits seeds at anyone who shoots it from afar.
  snapper: {
    id: "snapper", name: "Snapper Flower", level: 10, hp: 280, atk: 17, def: 5, exp: 240, gold: [18, 30], speed: 0, chase: 0, aggro: 110, range: 190, attackMs: 1600, radius: 22, respawnMs: 30_000,
    drops: [
      ["bloom", 0.6], ["orangePotion", 0.08], ["redPotion", 0.1], ["saber", 0.008], ["bronzeHelm", 0.008], ["guardShield", 0.01], ["plateArmor", 0.004],
      ["recurveBow", 0.006], ["gnarledStaff", 0.006], ["crystalStaff", 0.0015], ["meadowCrown", 0.0005], ["ironIngot", 0.04], ["mithril", 0.004], ["snapperCard", 0.0012],
    ],
  },

  // ---------------------------------------------------------------- Dusk Hollow (Lv 10–20), east of town
  grub: {
    id: "grub", name: "Grub", level: 11, hp: 380, atk: 20, def: 6, exp: 300, gold: [8, 14], speed: 30, chase: 60, aggro: 0, range: 36, attackMs: 1600, radius: 10, respawnMs: 14_000,
    drops: [["silk", 0.65], ["redPotion", 0.06], ["orangePotion", 0.02], ["rangerHood", 0.006], ["wizardHat", 0.006], ["rapier", 0.003], ["ironIngot", 0.04], ["mithril", 0.015], ["grubCard", 0.001]],
  },
  bat: {
    id: "bat", name: "Night Bat", level: 12, hp: 400, atk: 23, def: 7, exp: 330, gold: [10, 18], speed: 80, chase: 115, aggro: 120, range: 34, attackMs: 1200, radius: 10, respawnMs: 15_000,
    drops: [["batFang", 0.6], ["orangePotion", 0.04], ["rangerHood", 0.008], ["vigorRing", 0.005], ["rapier", 0.005], ["ironIngot", 0.04], ["mithril", 0.015], ["batCard", 0.001]],
  },
  // Slow and armoured: only fights back.
  rockworm: {
    id: "rockworm", name: "Rock Worm", level: 14, hp: 950, atk: 30, def: 16, exp: 720, gold: [14, 24], speed: 22, chase: 55, aggro: 0, range: 42, attackMs: 1800, radius: 14, respawnMs: 18_000,
    drops: [["rockShard", 0.6], ["orangePotion", 0.05], ["ironGreaves", 0.012], ["kiteShield", 0.007], ["hornedHelm", 0.006], ["guardTabard", 0.005], ["ironIngot", 0.06], ["mithril", 0.04], ["rockWormCard", 0.001]],
  },
  // Floats about and shoots a beam from afar.
  gazer: {
    id: "gazer", name: "Gazer", level: 16, hp: 800, atk: 34, def: 10, exp: 760, gold: [18, 30], speed: 40, chase: 70, aggro: 150, range: 170, attackMs: 2000, radius: 12, respawnMs: 18_000,
    drops: [["gazerLens", 0.55], ["orangePotion", 0.06], ["sageTabard", 0.006], ["wizardHat", 0.008], ["emberStaff", 0.004], ["greatBow", 0.004], ["mithril", 0.025], ["starCrystal", 0.004], ["gazerCard", 0.001]],
  },
  // Hard to hit with plain attacks: skills always land.
  ghost: {
    id: "ghost", name: "Ghost", level: 18, hp: 1150, atk: 34, def: 12, exp: 1100, gold: [24, 40], speed: 55, chase: 105, aggro: 90, range: 36, attackMs: 1400, radius: 12, respawnMs: 20_000, flee: 0.15,
    drops: [["ectoplasm", 0.55], ["orangePotion", 0.07], ["knightBlade", 0.005], ["greathelm", 0.004], ["crusaderShield", 0.004], ["sageTabard", 0.004], ["mithril", 0.03], ["starCrystal", 0.005], ["ghostCard", 0.001]],
  },
  // Dusk Hollow's boss, at the end of the east road. Breathes fire.
  pumpking: {
    id: "pumpking", name: "Pumpking", level: 22, hp: 12_000, atk: 58, def: 20, exp: 16_000, gold: [400, 800], speed: 30, chase: 75, aggro: 150, range: 150, attackMs: 1800, radius: 24, respawnMs: 600_000,
    boss: true, regen: 0.005,
    drops: [
      ["kingsCandy", 1], ["orangePotion", 0.8], ["crusaderShield", 0.2], ["greathelm", 0.2], ["greatBow", 0.15], ["emberStaff", 0.15], ["knightBlade", 0.15],
      ["mithril", 1], ["mithril", 0.5], ["starCrystal", 0.5], ["moonblade", 0.08], ["pumpkingCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Orc Woods (Lv 20–30), west of town
  // Quick little scouts in the grass north of the road: they jump anyone who comes close.
  goblin: {
    id: "goblin", name: "Goblin", level: 20, hp: 1000, atk: 30, def: 10, exp: 850, gold: [20, 34], speed: 55, chase: 115, aggro: 70, range: 36, attackMs: 1300, radius: 11, respawnMs: 15_000,
    drops: [["goblinCharm", 0.6], ["orangePotion", 0.06], ["scimitar", 0.004], ["ringStaff", 0.004], ["scoutArmor", 0.005], ["tuskNecklace", 0.003], ["mithril", 0.03], ["goblinCard", 0.001]],
  },
  // Big and tough, but only fights back.
  orcWarrior: {
    id: "orcWarrior", name: "Orc Warrior", level: 23, hp: 1400, atk: 42, def: 20, exp: 1300, gold: [30, 50], speed: 40, chase: 85, aggro: 0, range: 40, attackMs: 1600, radius: 13, respawnMs: 18_000,
    drops: [
      ["orcTusk", 0.6], ["orangePotion", 0.07], ["barbarianHelm", 0.006], ["roundShield", 0.006], ["steelGreaves", 0.008], ["scimitar", 0.004], ["halberd", 0.003],
      ["ironIngot", 0.06], ["mithril", 0.04], ["orcWarriorCard", 0.001],
    ],
  },
  // Shoots from afar, at anyone in sight.
  orcArcher: {
    id: "orcArcher", name: "Orc Archer", level: 25, hp: 1300, atk: 40, def: 14, exp: 1500, gold: [32, 52], speed: 45, chase: 80, aggro: 140, range: 180, attackMs: 1900, radius: 12, respawnMs: 18_000,
    drops: [
      ["orcArrowhead", 0.55], ["orangePotion", 0.06], ["compositeBow", 0.005], ["crossbow", 0.0025], ["ringStaff", 0.004], ["steelSabatons", 0.007], ["mightRing", 0.003],
      ["mithril", 0.04], ["orcArcherCard", 0.001],
    ],
  },
  orcSkeleton: {
    id: "orcSkeleton", name: "Orc Skeleton", level: 27, hp: 1700, atk: 48, def: 24, exp: 1800, gold: [34, 56], speed: 50, chase: 95, aggro: 90, range: 38, attackMs: 1500, radius: 12, respawnMs: 20_000,
    drops: [
      ["oldBone", 0.6], ["orangePotion", 0.07], ["katana", 0.003], ["spartanShield", 0.004], ["darkPlate", 0.004], ["guardianRing", 0.002],
      ["mithril", 0.04], ["starCrystal", 0.006], ["orcSkeletonCard", 0.001],
    ],
  },
  // Slow, but hits like a falling tree.
  orcZombie: {
    id: "orcZombie", name: "Orc Zombie", level: 29, hp: 2100, atk: 52, def: 20, exp: 2200, gold: [36, 60], speed: 22, chase: 55, aggro: 70, range: 38, attackMs: 2000, radius: 13, respawnMs: 20_000,
    drops: [
      ["rottenBandage", 0.6], ["orangePotion", 0.08], ["starryCloak", 0.005], ["diamondStaff", 0.003], ["vikingHelm", 0.003], ["darkPlate", 0.004],
      ["mithril", 0.05], ["starCrystal", 0.008], ["orcZombieCard", 0.001],
    ],
  },
  // The Orc Woods' boss, in his camp where the west road ends.
  orcWarlord: {
    id: "orcWarlord", name: "Orc Warlord", level: 33, hp: 24_000, atk: 90, def: 30, exp: 40_000, gold: [1000, 2000], speed: 35, chase: 80, aggro: 150, range: 48, attackMs: 1700, radius: 22, respawnMs: 900_000,
    boss: true, regen: 0.004,
    drops: [
      ["warlordBanner", 1], ["orangePotion", 0.8], ["halberd", 0.2], ["vikingHelm", 0.2], ["spartanShield", 0.2], ["crossbow", 0.15], ["diamondStaff", 0.15], ["katana", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.5], ["warlordMedal", 0.06], ["dragonSpear", 0.02], ["orcWarlordCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Wildlands (Lv 30–40), north of town: open PVP
  // Boarmen roam the grass just past the border and charge anyone who comes near.
  boarman: {
    id: "boarman", name: "Boarman", level: 31, hp: 2100, atk: 46, def: 22, exp: 2500, gold: [38, 62], speed: 50, chase: 110, aggro: 60, range: 38, attackMs: 1600, radius: 13, respawnMs: 18_000,
    drops: [
      ["boarHide", 0.6], ["whitePotion", 0.04], ["orangePotion", 0.06], ["armet", 0.005], ["wolfskinVest", 0.004], ["longSpear", 0.004],
      ["mithril", 0.05], ["boarmanCard", 0.001],
    ],
  },
  // Scaly and stubborn: only fights back, but its spear reaches further than a sword.
  lizardman: {
    id: "lizardman", name: "Lizardman", level: 33, hp: 2500, atk: 58, def: 30, exp: 2900, gold: [40, 66], speed: 40, chase: 85, aggro: 0, range: 48, attackMs: 1700, radius: 13, respawnMs: 20_000,
    drops: [
      ["lizardScale", 0.6], ["whitePotion", 0.05], ["towerShield", 0.005], ["longSpear", 0.005], ["serpentStaff", 0.004], ["goldGreaves", 0.004], ["trident", 0.002],
      ["mithril", 0.05], ["starCrystal", 0.006], ["lizardmanCard", 0.001],
    ],
  },
  // Fast, and quick with its claws. Hunts anyone in the woods.
  werewolf: {
    id: "werewolf", name: "Werewolf", level: 35, hp: 2400, atk: 50, def: 20, exp: 3200, gold: [42, 70], speed: 65, chase: 120, aggro: 60, range: 36, attackMs: 1300, radius: 13, respawnMs: 20_000,
    drops: [
      ["wolfPelt", 0.6], ["whitePotion", 0.05], ["longbow", 0.005], ["wolfskinVest", 0.004], ["goldSabatons", 0.004], ["wolfFang", 0.003],
      ["mithril", 0.05], ["starCrystal", 0.007], ["werewolfCard", 0.001],
    ],
  },
  // Huge and slow. Leave it alone and it leaves you alone.
  troll: {
    id: "troll", name: "Troll", level: 37, hp: 3100, atk: 76, def: 24, exp: 4300, gold: [46, 76], speed: 30, chase: 70, aggro: 0, range: 42, attackMs: 2000, radius: 16, respawnMs: 22_000,
    drops: [
      ["trollTooth", 0.6], ["whitePotion", 0.07], ["closeHelm", 0.004], ["goldPlate", 0.003], ["wildRing", 0.003], ["flameBlade", 0.002],
      ["mithril", 0.06], ["starCrystal", 0.008], ["trollCard", 0.001],
    ],
  },
  // Casts dark bolts from afar at anyone it sees.
  vampire: {
    id: "vampire", name: "Vampire", level: 39, hp: 2500, atk: 52, def: 22, exp: 4300, gold: [48, 80], speed: 45, chase: 90, aggro: 110, range: 170, attackMs: 2000, radius: 12, respawnMs: 22_000,
    drops: [
      ["bloodRuby", 0.55], ["whitePotion", 0.06], ["celestialHat", 0.005], ["mysticRobe", 0.004], ["engrailedShield", 0.003], ["flameBlade", 0.002],
      ["mithril", 0.05], ["starCrystal", 0.01], ["vampireCard", 0.001],
    ],
  },
  // The Wildlands' boss, in his lair on the highest ground.
  minotaurKing: {
    id: "minotaurKing", name: "Minotaur King", level: 44, hp: 45_000, atk: 120, def: 40, exp: 90_000, gold: [2000, 4000], speed: 35, chase: 85, aggro: 150, range: 52, attackMs: 1800, radius: 24, respawnMs: 1_200_000,
    boss: true, regen: 0.004,
    drops: [
      ["minotaurCrown", 1], ["whitePotion", 0.8], ["trident", 0.2], ["closeHelm", 0.2], ["engrailedShield", 0.2], ["goldPlate", 0.15], ["flameBlade", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.6], ["minotaurHorn", 0.06], ["sunfireBow", 0.015], ["archmageStaff", 0.015], ["minotaurKingCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Frostfell (Lv 40–50), the snowy island across the sea
  // Shaggy and short-tempered: they jump anyone who walks into their woods by the pier.
  yeti: {
    id: "yeti", name: "Yeti", level: 41, hp: 2900, atk: 50, def: 26, exp: 5200, gold: [52, 86], speed: 50, chase: 110, aggro: 60, range: 38, attackMs: 1600, radius: 14, respawnMs: 20_000,
    drops: [
      ["yetiFur", 0.6], ["whitePotion", 0.06], ["snowHood", 0.005], ["furCloak", 0.004], ["iceSword", 0.004],
      ["mithril", 0.05], ["starCrystal", 0.008], ["yetiCard", 0.001],
    ],
  },
  // Mountain beastmen with long spears: they only fight back.
  ramhorn: {
    id: "ramhorn", name: "Ramhorn", level: 43, hp: 3300, atk: 66, def: 34, exp: 5900, gold: [54, 90], speed: 45, chase: 90, aggro: 0, range: 48, attackMs: 1700, radius: 13, respawnMs: 20_000,
    drops: [
      ["ramHorn", 0.6], ["whitePotion", 0.06], ["frostShield", 0.004], ["frostGreaves", 0.005], ["frostBow", 0.004], ["glacierLance", 0.002],
      ["mithril", 0.06], ["starCrystal", 0.008], ["ramhornCard", 0.001],
    ],
  },
  // Throws shards of ice from afar at anyone it sees.
  frostShaman: {
    id: "frostShaman", name: "Frost Shaman", level: 45, hp: 2600, atk: 52, def: 24, exp: 6200, gold: [56, 94], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 22_000,
    drops: [
      ["frozenTear", 0.55], ["whitePotion", 0.06], ["moonHat", 0.005], ["winterRobe", 0.004], ["winterStaff", 0.004], ["snowflake", 0.003],
      ["mithril", 0.05], ["starCrystal", 0.01], ["frostShamanCard", 0.001],
    ],
  },
  // Dead knights frozen in their armour, still on patrol. They charge anyone who comes near.
  frostWight: {
    id: "frostWight", name: "Frost Wight", level: 47, hp: 3500, atk: 60, def: 32, exp: 7200, gold: [58, 98], speed: 50, chase: 100, aggro: 60, range: 38, attackMs: 1600, radius: 13, respawnMs: 22_000,
    drops: [
      ["wightChain", 0.55], ["whitePotion", 0.07], ["valkyrieHelm", 0.003], ["frostPlate", 0.003], ["frostSabatons", 0.005], ["glacierBow", 0.002], ["frostRing", 0.003],
      ["mithril", 0.06], ["starCrystal", 0.012], ["frostWightCard", 0.001],
    ],
  },
  // Big, slow and armoured in ice-blue scales. Leave it be and it leaves you be.
  frostDrake: {
    id: "frostDrake", name: "Frost Drake", level: 49, hp: 4200, atk: 84, def: 30, exp: 8600, gold: [62, 104], speed: 40, chase: 80, aggro: 0, range: 44, attackMs: 1900, radius: 15, respawnMs: 24_000,
    drops: [
      ["drakeScale", 0.55], ["whitePotion", 0.08], ["glacierLance", 0.003], ["auroraStaff", 0.003], ["frostPlate", 0.003], ["valkyrieHelm", 0.003],
      ["mithril", 0.06], ["starCrystal", 0.014], ["frostDrakeCard", 0.001],
    ],
  },
  // Frostfell's boss, in his ring of stones on the icy highlands. Throws ice at anyone out of reach.
  frostGiant: {
    id: "frostGiant", name: "Frost Giant", level: 54, hp: 70_000, atk: 150, def: 48, exp: 150_000, gold: [3000, 6000], speed: 35, chase: 85, aggro: 150, range: 140, attackMs: 2000, radius: 26, respawnMs: 1_500_000,
    boss: true, regen: 0.004,
    drops: [
      ["winterHeart", 1], ["whitePotion", 0.8], ["glacierLance", 0.2], ["glacierBow", 0.2], ["auroraStaff", 0.2], ["valkyrieHelm", 0.15], ["frostPlate", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.7], ["giantsTooth", 0.06], ["frostScythe", 0.015], ["frostGiantCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Ravenmoor (Lv 50–60), the autumn island east of Dusk Hollow
  // Restless spirits in the woods by the pier: they drift at anyone who comes near. Hard to hit with plain attacks.
  wraith: {
    id: "wraith", name: "Wraith", level: 51, hp: 4300, atk: 58, def: 28, exp: 9900, gold: [64, 108], speed: 55, chase: 105, aggro: 50, range: 36, attackMs: 1500, radius: 12, respawnMs: 22_000, flee: 0.15,
    drops: [
      ["wraithEssence", 0.55], ["whitePotion", 0.07], ["shadowHood", 0.005], ["shadowCloak", 0.004], ["bloodBow", 0.004],
      ["mithril", 0.06], ["starCrystal", 0.012], ["wraithCard", 0.001],
    ],
  },
  // Stone that walks: they swoop down from the castle walls at anyone close.
  gargoyle: {
    id: "gargoyle", name: "Gargoyle", level: 53, hp: 4600, atk: 62, def: 38, exp: 10_600, gold: [66, 112], speed: 60, chase: 115, aggro: 50, range: 38, attackMs: 1500, radius: 14, respawnMs: 22_000,
    drops: [
      ["gargoyleShard", 0.55], ["whitePotion", 0.07], ["bascinet", 0.005], ["gildedBlade", 0.004], ["boneCharm", 0.003], ["ruinShield", 0.002],
      ["mithril", 0.06], ["starCrystal", 0.012], ["gargoyleCard", 0.001],
    ],
  },
  // The Fallen King's guard, still patrolling outside his walls. They charge anyone who comes near.
  darkKnight: {
    id: "darkKnight", name: "Dark Knight", level: 55, hp: 5400, atk: 72, def: 44, exp: 12_700, gold: [70, 118], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["rustedKey", 0.55], ["whitePotion", 0.08], ["dreadPlate", 0.003], ["darkLance", 0.002], ["ruinShield", 0.003], ["soulRing", 0.003],
      ["mithril", 0.07], ["starCrystal", 0.014], ["darkKnightCard", 0.001],
    ],
  },
  // Casts dark bolts from afar at anyone it sees.
  lich: {
    id: "lich", name: "Lich", level: 57, hp: 4400, atk: 62, def: 30, exp: 14_300, gold: [72, 122], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["boneDust", 0.55], ["whitePotion", 0.07], ["nightHat", 0.005], ["lichRobe", 0.004], ["boneStaff", 0.004], ["soulStaff", 0.002],
      ["mithril", 0.06], ["starCrystal", 0.015], ["lichCard", 0.001],
    ],
  },
  // Huge, slow and stitched together from worse things. Leave it alone and it leaves you alone.
  fleshGolem: {
    id: "fleshGolem", name: "Flesh Golem", level: 59, hp: 6200, atk: 102, def: 40, exp: 17_000, gold: [76, 128], speed: 30, chase: 70, aggro: 0, range: 46, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["golemHeart", 0.55], ["whitePotion", 0.09], ["dreadPlate", 0.003], ["royalBow", 0.003], ["soulStaff", 0.002], ["darkLance", 0.002],
      ["mithril", 0.07], ["starCrystal", 0.016], ["fleshGolemCard", 0.001],
    ],
  },
  // Ravenmoor's boss, on his throne in the ruined castle. Casts dark bolts at anyone out of reach.
  fallenKing: {
    id: "fallenKing", name: "Fallen King", level: 64, hp: 110_000, atk: 180, def: 56, exp: 260_000, gold: [5000, 9000], speed: 35, chase: 85, aggro: 150, range: 150, attackMs: 2000, radius: 26, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    drops: [
      ["royalKey", 1], ["whitePotion", 0.8], ["darkLance", 0.2], ["royalBow", 0.2], ["soulStaff", 0.2], ["dreadPlate", 0.15], ["ruinShield", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.8], ["kingsSeal", 0.06], ["fallenCrown", 0.015], ["fallenKingCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Petalfall (Lv 60–70), the spring island in the south-east sea
  // Quick white hares in the meadows by the pier. They only fight back, but they're hard to hit with plain attacks.
  moonHare: {
    id: "moonHare", name: "Moon Hare", level: 61, hp: 4700, atk: 66, def: 34, exp: 17_500, gold: [80, 134], speed: 65, chase: 120, aggro: 0, range: 36, attackMs: 1300, radius: 11, respawnMs: 22_000, flee: 0.15,
    drops: [
      ["moonstone", 0.55], ["whitePotion", 0.08], ["blossomBlade", 0.004], ["petalBow", 0.004], ["moonRing", 0.002],
      ["mithril", 0.07], ["starCrystal", 0.016], ["moonHareCard", 0.001],
    ],
  },
  // Throw foxfire from the woods in the north-west at anyone they see.
  foxSpirit: {
    id: "foxSpirit", name: "Fox Spirit", level: 63, hp: 5200, atk: 66, def: 30, exp: 19_800, gold: [82, 138], speed: 45, chase: 90, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["foxfireEmber", 0.55], ["whitePotion", 0.08], ["foxfireStaff", 0.004], ["blossomHat", 0.005], ["foxfireCharm", 0.003], ["stormStaff", 0.002],
      ["mithril", 0.07], ["starCrystal", 0.016], ["foxSpiritCard", 0.001],
    ],
  },
  // Masked swordsmen on black wings, in the middle of the island. They come at anyone who comes near.
  crowBlade: {
    id: "crowBlade", name: "Crow Blade", level: 65, hp: 5600, atk: 70, def: 40, exp: 21_800, gold: [86, 142], speed: 60, chase: 115, aggro: 50, range: 40, attackMs: 1500, radius: 13, respawnMs: 24_000,
    drops: [
      ["smokeBomb", 0.55], ["whitePotion", 0.08], ["crowMask", 0.005], ["crowMantle", 0.004], ["blossomBlade", 0.003], ["boneBow", 0.002],
      ["mithril", 0.07], ["starCrystal", 0.017], ["crowBladeCard", 0.001],
    ],
  },
  // The bones of swordsmen who fell to the Ogre Warlord, still fighting in the north-east. Hard to cut through.
  phantom: {
    id: "phantom", name: "Phantom Swordsman", level: 67, hp: 6000, atk: 84, def: 50, exp: 24_200, gold: [88, 148], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["fadedScroll", 0.55], ["whitePotion", 0.08], ["phantomHelm", 0.005], ["jadeShield", 0.003], ["thunderGlaive", 0.002], ["warlordPlate", 0.002],
      ["mithril", 0.08], ["starCrystal", 0.018], ["phantomCard", 0.001],
    ],
  },
  // Huge, slow and red as fire, wandering the south. Leave them alone and they leave you alone; they hit very hard.
  redOgre: {
    id: "redOgre", name: "Red Ogre", level: 69, hp: 7600, atk: 116, def: 46, exp: 29_500, gold: [92, 156], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["ogreBrew", 0.55], ["whitePotion", 0.1], ["blossomRobe", 0.004], ["warlordPlate", 0.003], ["boneBow", 0.003], ["stormStaff", 0.002], ["thunderGlaive", 0.002],
      ["mithril", 0.08], ["starCrystal", 0.018], ["redOgreCard", 0.001],
    ],
  },
  // Petalfall's boss, in his war camp on the high ground. Throws fire at anyone out of reach.
  ogreWarlord: {
    id: "ogreWarlord", name: "Ogre Warlord", level: 74, hp: 170_000, atk: 205, def: 62, exp: 420_000, gold: [8000, 14000], speed: 35, chase: 85, aggro: 150, range: 150, attackMs: 2000, radius: 28, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    drops: [
      ["heartOfSpring", 1], ["whitePotion", 0.8], ["thunderGlaive", 0.2], ["boneBow", 0.2], ["stormStaff", 0.2], ["warlordPlate", 0.15], ["jadeShield", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.8], ["warlordFang", 0.06], ["warlordHelm", 0.015], ["ogreWarlordCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Ashpeak (Lv 70–80), the volcanic island far out in the eastern sea
  // Little red imps with bat wings, all over the rock by the pier. They swarm anyone who comes near.
  emberImp: {
    id: "emberImp", name: "Ember Imp", level: 71, hp: 6000, atk: 74, def: 42, exp: 30_000, gold: [94, 158], speed: 70, chase: 125, aggro: 40, range: 36, attackMs: 1300, radius: 11, respawnMs: 22_000,
    drops: [
      ["impHorn", 0.55], ["whitePotion", 0.08], ["cinderBlade", 0.004], ["emberBow", 0.004], ["emberRing", 0.002],
      ["mithril", 0.08], ["starCrystal", 0.018], ["emberImpCard", 0.001],
    ],
  },
  // Fire lizards on the south-west slopes: they spit fire from afar at anyone they see.
  salamander: {
    id: "salamander", name: "Salamander", level: 73, hp: 5800, atk: 64, def: 36, exp: 33_000, gold: [96, 162], speed: 45, chase: 90, aggro: 100, range: 170, attackMs: 2200, radius: 13, respawnMs: 24_000,
    drops: [
      ["salamanderScale", 0.55], ["whitePotion", 0.08], ["cinderStaff", 0.004], ["emberHood", 0.005], ["salamanderCharm", 0.003], ["magmaStaff", 0.002],
      ["mithril", 0.08], ["starCrystal", 0.019], ["salamanderCard", 0.001],
    ],
  },
  // Knights in black glass armour, on guard along the north of the island. They charge anyone who comes near.
  obsidianKnight: {
    id: "obsidianKnight", name: "Obsidian Knight", level: 75, hp: 6600, atk: 80, def: 50, exp: 36_000, gold: [98, 166], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["obsidianShard", 0.55], ["whitePotion", 0.08], ["obsidianHelm", 0.005], ["obsidianShield", 0.003], ["magmaLance", 0.002], ["obsidianPlate", 0.002],
      ["mithril", 0.09], ["starCrystal", 0.02], ["obsidianKnightCard", 0.001],
    ],
  },
  // Smoke with a face, drifting over the hot rock in the east. Hard to hit with plain attacks.
  cinderWraith: {
    id: "cinderWraith", name: "Cinder Wraith", level: 77, hp: 6800, atk: 74, def: 50, exp: 39_000, gold: [100, 170], speed: 55, chase: 105, aggro: 50, range: 36, attackMs: 1500, radius: 12, respawnMs: 24_000, flee: 0.15,
    drops: [
      ["cinderVeil", 0.55], ["whitePotion", 0.08], ["ashenHood", 0.005], ["ashenLeathers", 0.004], ["cinderRobe", 0.004], ["obsidianBow", 0.002],
      ["mithril", 0.09], ["starCrystal", 0.02], ["cinderWraithCard", 0.001],
    ],
  },
  // Walking lumps of cooling lava in the south. Leave them alone and they leave you alone; they hit harder than anything else here.
  magmaGolem: {
    id: "magmaGolem", name: "Magma Golem", level: 79, hp: 8600, atk: 124, def: 52, exp: 44_000, gold: [104, 176], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["magmaCore", 0.55], ["whitePotion", 0.1], ["obsidianPlate", 0.003], ["cinderBlade", 0.003], ["magmaLance", 0.002], ["magmaStaff", 0.002], ["obsidianBow", 0.002],
      ["mithril", 0.09], ["starCrystal", 0.02], ["magmaGolemCard", 0.001],
    ],
  },
  // Ashpeak's boss, in the crater at the top of the road. Throws fire at anyone out of reach.
  cinderColossus: {
    id: "cinderColossus", name: "Cinder Colossus", level: 84, hp: 230_000, atk: 220, def: 68, exp: 600_000, gold: [12_000, 20_000], speed: 35, chase: 85, aggro: 150, range: 150, attackMs: 2000, radius: 30, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    drops: [
      ["heartOfFlame", 1], ["whitePotion", 0.8], ["magmaLance", 0.2], ["obsidianBow", 0.2], ["magmaStaff", 0.2], ["obsidianPlate", 0.15], ["obsidianShield", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.8], ["colossusHeart", 0.06], ["colossusMantle", 0.015], ["cinderColossusCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Sunscar (Lv 80–90), the desert island north of Ashpeak
  // Sand-coloured lizards in the dunes south-west of the pier. They only fight back, but they're hard to hit with plain attacks.
  duneStalker: {
    id: "duneStalker", name: "Dune Stalker", level: 81, hp: 6700, atk: 80, def: 46, exp: 47_000, gold: [106, 180], speed: 65, chase: 120, aggro: 0, range: 36, attackMs: 1300, radius: 12, respawnMs: 22_000, flee: 0.15,
    drops: [
      ["duneFang", 0.55], ["whitePotion", 0.08], ["sunBlade", 0.004], ["sandBow", 0.004], ["sandRing", 0.002],
      ["mithril", 0.09], ["starCrystal", 0.02], ["duneStalkerCard", 0.001],
    ],
  },
  // Spirits of hot wind in the north-west. They hurl searing bolts from afar at anyone they see.
  dustDjinn: {
    id: "dustDjinn", name: "Dust Djinn", level: 83, hp: 6500, atk: 58, def: 40, exp: 51_000, gold: [108, 184], speed: 50, chase: 95, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["djinnDust", 0.55], ["whitePotion", 0.08], ["djinnStaff", 0.004], ["djinnHat", 0.005], ["scarabCharm", 0.003], ["sunStaff", 0.002],
      ["mithril", 0.09], ["starCrystal", 0.02], ["dustDjinnCard", 0.001],
    ],
  },
  // The bones of the Dune King's guard, still standing watch north of his temple. They charge anyone who comes near.
  tombWarden: {
    id: "tombWarden", name: "Tomb Warden", level: 85, hp: 7400, atk: 74, def: 56, exp: 56_000, gold: [110, 188], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["tombRelic", 0.55], ["whitePotion", 0.08], ["wardenHelm", 0.005], ["sunShield", 0.003], ["sunSpear", 0.002], ["wardenPlate", 0.002],
      ["mithril", 0.1], ["starCrystal", 0.021], ["tombWardenCard", 0.001],
    ],
  },
  // Raiders in sand-coloured hoods, camped in the east. Quick, and they attack anyone who comes near.
  desertRaider: {
    id: "desertRaider", name: "Desert Raider", level: 87, hp: 7600, atk: 80, def: 54, exp: 61_000, gold: [112, 192], speed: 60, chase: 115, aggro: 50, range: 40, attackMs: 1500, radius: 13, respawnMs: 24_000,
    drops: [
      ["raiderCoin", 0.55], ["whitePotion", 0.08], ["desertHood", 0.005], ["desertGarb", 0.004], ["sunRobe", 0.004], ["sunBow", 0.002],
      ["mithril", 0.1], ["starCrystal", 0.021], ["desertRaiderCard", 0.001],
    ],
  },
  // Great slow heaps of living sand in the south. Leave them alone and they leave you alone; they hit harder than anything else here.
  sandGolem: {
    id: "sandGolem", name: "Sand Golem", level: 89, hp: 9600, atk: 136, def: 58, exp: 66_000, gold: [116, 198], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["golemSand", 0.55], ["whitePotion", 0.1], ["wardenPlate", 0.003], ["sunBlade", 0.003], ["sunSpear", 0.002], ["sunStaff", 0.002], ["sunBow", 0.002],
      ["mithril", 0.1], ["starCrystal", 0.021], ["sandGolemCard", 0.001],
    ],
  },
  // Sunscar's boss, on his throne in the sunken temple. Throws fire at anyone out of reach.
  duneKing: {
    id: "duneKing", name: "Dune King", level: 94, hp: 330_000, atk: 245, def: 76, exp: 1_200_000, gold: [16_000, 26_000], speed: 35, chase: 85, aggro: 150, range: 150, attackMs: 2000, radius: 28, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    drops: [
      ["sunDisk", 1], ["whitePotion", 0.8], ["sunSpear", 0.2], ["sunBow", 0.2], ["sunStaff", 0.2], ["wardenPlate", 0.15], ["sunShield", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.8], ["sunMedallion", 0.06], ["sunAegis", 0.015], ["duneKingCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Starfall (Lv 90–100), the island of endless night south of Ashpeak
  // Bats with wings like the night sky, all over the south-west of the island. They swarm anyone who comes near.
  voidBat: {
    id: "voidBat", name: "Void Bat", level: 91, hp: 7400, atk: 76, def: 52, exp: 71_000, gold: [118, 202], speed: 70, chase: 125, aggro: 40, range: 36, attackMs: 1300, radius: 11, respawnMs: 22_000,
    drops: [
      ["voidWing", 0.55], ["whitePotion", 0.08], ["starBlade", 0.004], ["moonBow", 0.004], ["starRing", 0.002],
      ["mithril", 0.1], ["starCrystal", 0.022], ["voidBatCard", 0.001],
    ],
  },
  // Hooded stargazers in the north-west. They cast starlight from afar at anyone they see.
  astralSeer: {
    id: "astralSeer", name: "Astral Seer", level: 93, hp: 7200, atk: 76, def: 46, exp: 77_000, gold: [120, 206], speed: 45, chase: 90, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["seerEye", 0.55], ["whitePotion", 0.08], ["seerStaff", 0.004], ["seerHat", 0.005], ["nightCharm", 0.003], ["astralStaff", 0.002],
      ["mithril", 0.1], ["starCrystal", 0.022], ["astralSeerCard", 0.001],
    ],
  },
  // Knights in armour that shines like starlight, guarding the north of the island. They charge anyone who comes near.
  starKnight: {
    id: "starKnight", name: "Star Knight", level: 95, hp: 8200, atk: 86, def: 64, exp: 83_000, gold: [122, 210], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["starShard", 0.55], ["whitePotion", 0.08], ["starHelm", 0.005], ["starShield", 0.003], ["voidLance", 0.002], ["starPlate", 0.002],
      ["mithril", 0.11], ["starCrystal", 0.023], ["starKnightCard", 0.001],
    ],
  },
  // Cold blue lights drifting along the east shore. Hard to hit with plain attacks.
  nightWisp: {
    id: "nightWisp", name: "Night Wisp", level: 97, hp: 8400, atk: 78, def: 58, exp: 90_000, gold: [124, 214], speed: 55, chase: 105, aggro: 50, range: 36, attackMs: 1500, radius: 12, respawnMs: 24_000, flee: 0.15,
    drops: [
      ["wispLight", 0.55], ["whitePotion", 0.08], ["nightHood", 0.005], ["nightLeathers", 0.004], ["astralRobe", 0.004], ["starBow", 0.002],
      ["mithril", 0.11], ["starCrystal", 0.023], ["nightWispCard", 0.001],
    ],
  },
  // Walking crystal in the south, glowing pale blue. Leave them alone and they leave you alone; they hit harder than anything else here.
  crystalGolem: {
    id: "crystalGolem", name: "Crystal Golem", level: 99, hp: 10_600, atk: 150, def: 64, exp: 97_000, gold: [128, 220], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["crystalHeart", 0.55], ["whitePotion", 0.1], ["starPlate", 0.003], ["starBlade", 0.003], ["voidLance", 0.002], ["astralStaff", 0.002], ["starBow", 0.002],
      ["mithril", 0.11], ["starCrystal", 0.023], ["crystalGolemCard", 0.001],
    ],
  },
  // Starfall's boss, at the altar south of the lake. Casts starlight at anyone out of reach.
  starTyrant: {
    id: "starTyrant", name: "Star Tyrant", level: 104, hp: 450_000, atk: 270, def: 84, exp: 1_800_000, gold: [22_000, 34_000], speed: 35, chase: 85, aggro: 150, range: 150, attackMs: 2000, radius: 30, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    drops: [
      ["fallenStar", 1], ["whitePotion", 0.8], ["voidLance", 0.2], ["starBow", 0.2], ["astralStaff", 0.2], ["starPlate", 0.15], ["starShield", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.8], ["tyrantsStar", 0.06], ["fallenStarRing", 0.015], ["starTyrantCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- Crownhold, the guild castle
  // The crystal at the heart of the keep (see shared/siege.ts): it never moves or fights back, and
  // only guild members can strike it, only during a siege. Breaking it takes the castle; it's whole
  // again moments later. Level 0: nobody misses it.
  crystal: {
    id: "crystal", name: "Crownhold Crystal", level: 0, hp: 60_000, atk: 0, def: 50, exp: 0, gold: [0, 0], speed: 0, chase: 0, aggro: 0, range: 0, attackMs: 60_000, radius: 20, respawnMs: 10_000,
    boss: true, regen: 0.002,
    drops: [],
  },
  // Guardians the castle's guild hires (GUARDIAN_POSTS in shared/siege.ts). They stand at their posts all week,
  // and during a siege attack any other guild's members inside the walls. No EXP and no loot: this is war.
  castleKnight: {
    id: "castleKnight", name: "Castle Knight", level: 68, hp: 20_000, atk: 215, def: 80, exp: 0, gold: [0, 0], speed: 50, chase: 110, aggro: 150, range: 44, attackMs: 1400, radius: 14, respawnMs: 0,
    regen: 0.01,
    drops: [],
  },
  castleArcher: {
    id: "castleArcher", name: "Castle Archer", level: 68, hp: 12_000, atk: 165, def: 50, exp: 0, gold: [0, 0], speed: 35, chase: 70, aggro: 210, range: 190, attackMs: 1800, radius: 12, respawnMs: 0,
    regen: 0.01,
    drops: [],
  },

  // ---------------------------------------------------------------- the Isle of Trials (see shared/trial.ts)
  // Shades: what a Knight, Mage or Archer could become. Each is raised for one player, fights only them,
  // and leaves nothing behind: beating it is the way to a second job. They never heal while the trial is on.
  shadeLordKnight: {
    id: "shadeLordKnight", name: "Shade of a Lord Knight", level: 52, hp: 22_000, atk: 110, def: 40, exp: 0, gold: [0, 0], speed: 55, chase: 110, aggro: 600, range: 44, attackMs: 1500, radius: 14, respawnMs: 0,
    regen: 0,
    drops: [],
  },
  shadeWizard: {
    id: "shadeWizard", name: "Shade of a Wizard", level: 52, hp: 32_000, atk: 115, def: 26, exp: 0, gold: [0, 0], speed: 45, chase: 90, aggro: 600, range: 170, attackMs: 2000, radius: 12, respawnMs: 0,
    regen: 0,
    drops: [],
  },
  shadeHunter: {
    id: "shadeHunter", name: "Shade of a Hunter", level: 52, hp: 22_000, atk: 92, def: 32, exp: 0, gold: [0, 0], speed: 55, chase: 105, aggro: 600, range: 190, attackMs: 1700, radius: 12, respawnMs: 0,
    regen: 0,
    drops: [],
  },
};

export const isMonsterId = (id: unknown): id is MonsterId => typeof id === "string" && Object.hasOwn(MONSTERS, id);

// ---------------------------------------------------------------- fields

export interface SpawnGroup {
  monster: MonsterId;
  /** Where they spawn and roam (tiles). They chase a little way out of it, then go home. */
  rect: Rect;
  count: number;
}

export interface Field {
  id: string;
  name: string;
  /** Shown next to the name, e.g. "Lv 1–10". */
  levels: string;
  /** Tiles. */
  area: Rect;
  /** Left as the land is (trees and rocks stay). Otherwise the world generator thins the trees into open meadow. */
  wild?: boolean;
  /** Open PVP: players may fight each other here (see shared/pvp.ts). */
  pvp?: boolean;
  spawns: SpawnGroup[];
}

/** Hunting grounds outside the walls. The town itself is always safe. */
export const FIELDS: Field[] = [
  {
    id: "south-meadow",
    name: "South Meadow",
    levels: "Lv 1–10",
    area: { x: 100, y: 260, w: 190, h: 52 },
    spawns: [
      // Slimes either side of the road, right outside the gate.
      { monster: "slime", rect: { x: 160, y: 262, w: 66, h: 16 }, count: 14 },
      // Grass snakes in the west grass, hornets in the east field.
      { monster: "snake", rect: { x: 112, y: 272, w: 56, h: 32 }, count: 12 },
      { monster: "hornet", rect: { x: 216, y: 274, w: 62, h: 30 }, count: 8 },
      // Snapper flowers by the lake at the end of the road.
      { monster: "snapper", rect: { x: 172, y: 292, w: 40, h: 12 }, count: 5 },
    ],
  },
  {
    id: "dusk-hollow",
    name: "Dusk Hollow",
    levels: "Lv 10–20",
    area: { x: 265, y: 136, w: 66, h: 120 },
    wild: true,
    spawns: [
      // Grubs along the east road, right outside the gate; bats in the woods north of it.
      { monster: "grub", rect: { x: 268, y: 176, w: 30, h: 22 }, count: 12 },
      { monster: "bat", rect: { x: 270, y: 148, w: 40, h: 24 }, count: 12 },
      // Rock worms south of the road.
      { monster: "rockworm", rect: { x: 270, y: 204, w: 40, h: 22 }, count: 10 },
      // Deeper in: gazers to the north-east, ghosts to the south-east.
      { monster: "gazer", rect: { x: 304, y: 140, w: 24, h: 34 }, count: 8 },
      { monster: "ghost", rect: { x: 304, y: 212, w: 24, h: 38 }, count: 8 },
      // The Pumpking waits where the east road ends.
      { monster: "pumpking", rect: { x: 314, y: 181, w: 10, h: 12 }, count: 1 },
    ],
  },
  {
    id: "orc-woods",
    name: "Orc Woods",
    levels: "Lv 20–30",
    area: { x: 56, y: 104, w: 64, h: 154 },
    wild: true,
    spawns: [
      // Goblins in the grass north of the west road, right outside the gate; orc warriors on the rocky ground south of it.
      { monster: "goblin", rect: { x: 94, y: 158, w: 24, h: 22 }, count: 10 },
      { monster: "orcWarrior", rect: { x: 92, y: 198, w: 28, h: 24 }, count: 12 },
      // Archers up north (out of bowshot of the path to the Wildlands); skeletons west of the inlet; zombies far to the south.
      { monster: "orcArcher", rect: { x: 96, y: 110, w: 18, h: 18 }, count: 7 },
      { monster: "orcSkeleton", rect: { x: 60, y: 138, w: 24, h: 20 }, count: 8 },
      { monster: "orcZombie", rect: { x: 66, y: 228, w: 52, h: 26 }, count: 10 },
      // The Orc Warlord's camp, where the west road ends.
      { monster: "orcWarlord", rect: { x: 70, y: 178, w: 10, h: 10 }, count: 1 },
    ],
  },
  {
    id: "wildlands",
    name: "Wildlands",
    levels: "Lv 30–40",
    area: { x: 120, y: 16, w: 216, h: 120 },
    wild: true,
    pvp: true,
    spawns: [
      // Boarmen in the grass past the west path, lizardmen on the dry ground past the east path.
      { monster: "boarman", rect: { x: 128, y: 112, w: 40, h: 22 }, count: 10 },
      { monster: "lizardman", rect: { x: 222, y: 110, w: 40, h: 24 }, count: 12 },
      // Deeper in: werewolves in the north-west woods, trolls on the highlands, vampires on the high ground to the north-east.
      { monster: "werewolf", rect: { x: 126, y: 58, w: 44, h: 32 }, count: 9 },
      { monster: "troll", rect: { x: 178, y: 86, w: 44, h: 24 }, count: 10 },
      { monster: "vampire", rect: { x: 234, y: 62, w: 34, h: 34 }, count: 8 },
      // The Minotaur King's lair, on the highest ground.
      { monster: "minotaurKing", rect: { x: 194, y: 54, w: 8, h: 6 }, count: 1 },
    ],
  },
  {
    // Across the sea south of the meadow: the ferry at the meadow's south-east point sails here.
    id: "frostfell",
    name: "Frostfell",
    levels: "Lv 40–50",
    area: { x: 116, y: 392, w: 156, h: 108 },
    wild: true,
    spawns: [
      // Yetis in the woods west of the pier, Ramhorns in the woods east of it.
      { monster: "yeti", rect: { x: 140, y: 408, w: 44, h: 24 }, count: 9 },
      { monster: "ramhorn", rect: { x: 200, y: 410, w: 50, h: 22 }, count: 12 },
      // Frost Shamans on the west shore, Frost Drakes in the east.
      { monster: "frostShaman", rect: { x: 124, y: 432, w: 22, h: 44 }, count: 7 },
      { monster: "frostDrake", rect: { x: 214, y: 440, w: 42, h: 28 }, count: 9 },
      // Frost Wights patrol the icy highlands, all round the Frost Giant's stones.
      { monster: "frostWight", rect: { x: 146, y: 432, w: 56, h: 22 }, count: 9 },
      { monster: "frostWight", rect: { x: 146, y: 468, w: 66, h: 16 }, count: 6 },
      { monster: "frostGiant", rect: { x: 174, y: 460, w: 8, h: 6 }, count: 1 },
    ],
  },
  {
    // Across the strait east of Dusk Hollow: the boat at the end of the east road sails here.
    id: "ravenmoor",
    name: "Ravenmoor",
    levels: "Lv 50–60",
    area: { x: 380, y: 130, w: 112, h: 128 },
    wild: true,
    spawns: [
      // Wraiths in the woods by the pier; Gargoyles on the high ground either side of the castle.
      { monster: "wraith", rect: { x: 400, y: 166, w: 30, h: 30 }, count: 8 },
      { monster: "gargoyle", rect: { x: 410, y: 152, w: 14, h: 13 }, count: 5 },
      { monster: "gargoyle", rect: { x: 459, y: 146, w: 11, h: 15 }, count: 4 },
      // The Fallen King's guard on the slopes below his gate; Liches in the east, past the lake; Flesh Golems in the south.
      { monster: "darkKnight", rect: { x: 426, y: 165, w: 34, h: 14 }, count: 8 },
      { monster: "lich", rect: { x: 456, y: 198, w: 26, h: 28 }, count: 7 },
      { monster: "fleshGolem", rect: { x: 400, y: 212, w: 20, h: 32 }, count: 8 },
      { monster: "fallenKing", rect: { x: 439, y: 149, w: 8, h: 2 }, count: 1 },
    ],
  },
  {
    // Out in the south-east sea: the boat at the end of the meadow's east path sails here.
    id: "petalfall",
    name: "Petalfall",
    levels: "Lv 60–70",
    area: { x: 324, y: 344, w: 162, h: 130 },
    wild: true,
    spawns: [
      // Moon Hares in the meadows by the pier, Fox Spirits in the north-west woods, Crow Blades in the middle.
      { monster: "moonHare", rect: { x: 340, y: 378, w: 28, h: 40 }, count: 10 },
      { monster: "foxSpirit", rect: { x: 362, y: 356, w: 34, h: 16 }, count: 8 },
      { monster: "crowBlade", rect: { x: 378, y: 405, w: 38, h: 26 }, count: 8 },
      // Phantom Swordsmen in the north-east, Red Ogres wandering the south; the Ogre Warlord in his camp.
      { monster: "phantom", rect: { x: 410, y: 360, w: 40, h: 12 }, count: 8 },
      { monster: "redOgre", rect: { x: 370, y: 432, w: 56, h: 22 }, count: 8 },
      { monster: "ogreWarlord", rect: { x: 447, y: 399, w: 6, h: 5 }, count: 1 },
    ],
  },
  {
    // Far out in the eastern sea: a ship from the meadow's east shore sails here.
    id: "ashpeak",
    name: "Ashpeak",
    levels: "Lv 70–80",
    area: { x: 528, y: 186, w: 96, h: 130 },
    wild: true,
    spawns: [
      // Ember Imps on the rock north of the pier, Salamanders on the south-west slopes, Obsidian Knights along the north.
      { monster: "emberImp", rect: { x: 540, y: 222, w: 20, h: 24 }, count: 10 },
      { monster: "salamander", rect: { x: 538, y: 258, w: 22, h: 24 }, count: 9 },
      { monster: "obsidianKnight", rect: { x: 552, y: 200, w: 40, h: 16 }, count: 9 },
      // Cinder Wraiths over the hot rock in the east, Magma Golems in the south; the Cinder Colossus in his crater.
      { monster: "cinderWraith", rect: { x: 596, y: 222, w: 18, h: 44 }, count: 8 },
      { monster: "magmaGolem", rect: { x: 552, y: 270, w: 48, h: 18 }, count: 8 },
      { monster: "cinderColossus", rect: { x: 573, y: 247, w: 6, h: 5 }, count: 1 },
    ],
  },
  {
    // North of Ashpeak: a ship from the meadow's east shore sails here.
    id: "sunscar",
    name: "Sunscar",
    levels: "Lv 80–90",
    area: { x: 526, y: 28, w: 90, h: 92 },
    wild: true,
    spawns: [
      // Dune Stalkers in the dunes south-west of the pier, Dust Djinn in the north-west, Tomb Wardens north of the temple.
      { monster: "duneStalker", rect: { x: 536, y: 82, w: 22, h: 24 }, count: 10 },
      { monster: "dustDjinn", rect: { x: 538, y: 40, w: 24, h: 20 }, count: 7 },
      { monster: "tombWarden", rect: { x: 566, y: 38, w: 30, h: 16 }, count: 8 },
      // Desert Raiders camped in the east, Sand Golems in the south; the Dune King in his temple.
      { monster: "desertRaider", rect: { x: 592, y: 56, w: 16, h: 40 }, count: 9 },
      { monster: "sandGolem", rect: { x: 560, y: 90, w: 38, h: 18 }, count: 8 },
      { monster: "duneKing", rect: { x: 573, y: 71, w: 6, h: 5 }, count: 1 },
    ],
  },
  {
    // South of Ashpeak: a ship from the meadow's east shore sails here.
    id: "starfall",
    name: "Starfall",
    levels: "Lv 90–100",
    area: { x: 544, y: 390, w: 74, h: 92 },
    wild: true,
    spawns: [
      // Void Bats in the south-west, Astral Seers in the north-west, Star Knights in the north, north of the lake.
      { monster: "voidBat", rect: { x: 550, y: 454, w: 28, h: 18 }, count: 8 },
      { monster: "astralSeer", rect: { x: 552, y: 410, w: 22, h: 16 }, count: 7 },
      { monster: "starKnight", rect: { x: 576, y: 404, w: 20, h: 18 }, count: 7 },
      // Night Wisps along the east shore, Crystal Golems in the south; the Star Tyrant at his altar.
      { monster: "nightWisp", rect: { x: 594, y: 430, w: 16, h: 30 }, count: 6 },
      { monster: "crystalGolem", rect: { x: 580, y: 456, w: 26, h: 14 }, count: 8 },
      { monster: "starTyrant", rect: { x: 569, y: 445, w: 6, h: 5 }, count: 1 },
    ],
  },
  {
    // The guild castle's island, over the long bridge from the Wildlands. No monsters: only the crystal.
    id: "crownhold",
    name: "Crownhold",
    levels: "Guild castle",
    area: { x: 340, y: 40, w: 92, h: 62 },
    spawns: [{ monster: "crystal", rect: { x: 397, y: 76, w: 1, h: 1 }, count: 1 }],
  },
];

/** The field at a pixel position, if any. */
export function fieldAt(px: number, py: number): Field | undefined {
  const tx = px / TILE;
  const ty = py / TILE;
  return FIELDS.find((f) => inRect(f.area, tx, ty));
}

/** Inside the town (and the palace) nobody fights: monsters stay out, players can't attack. */
export function inSafeZone(px: number, py: number): boolean {
  const tx = px / TILE;
  const ty = py / TILE;
  return inRect(TOWN_AREA, tx, ty) || inRect(INTERIOR_ZONE, tx, ty);
}

// ---------------------------------------------------------------- fighting

/** How far apart (feet to feet) a player can be and still hit this monster. */
export const reach = (range: number, monster: MonsterDef) => range + monster.radius;

/** Chance to land a hit: lower against anything above your level. */
export function hitChance(attackerLevel: number, defenderLevel: number): number {
  return Math.min(0.95, Math.max(0.6, 0.95 - 0.04 * Math.max(0, defenderLevel - attackerLevel)));
}

/** Everyone's chance to land a critical hit; Hornet Cards add to it. */
export const CRIT_CHANCE = 0.05;
/** Evading never gets better than this, however many Grass Snake Cards you stack. */
export const MAX_FLEE = 0.5;

/**
 * One hit: attack spread ±15 %, softened by defence (defence equal to the
 * attack halves it, so armour always helps but never makes you untouchable).
 * Crits ignore defence and hit 1.5x. At least 1.
 */
export function rollDamage(atk: number, def: number, critChance = CRIT_CHANCE, rand: () => number = Math.random): { damage: number; crit: boolean } {
  const base = atk * (0.85 + rand() * 0.3);
  const crit = rand() < critChance;
  const soft = atk + Math.max(0, def) > 0 ? atk / (atk + Math.max(0, def)) : 1;
  return { damage: Math.max(1, Math.round(crit ? base * 1.5 : base * soft)), crit };
}

/** Share of max HP/MP regained per second out of combat, standing in the field (a full heal in a minute). */
export const REGEN_RATE = 1 / 60;
/** Sitting heals this many times faster (Ragnarok style)… */
export const SIT_REGEN = 3;
/** …and resting inside the town walls doubles that again. */
export const TOWN_REGEN = 2;

/** Monsters far below your level give less EXP (down to 10 %), so the meadow can't carry you forever. */
export function expFactor(playerLevel: number, monsterLevel: number): number {
  const over = playerLevel - monsterLevel - 5;
  return over <= 0 ? 1 : Math.max(0.1, 1 - 0.15 * over);
}
