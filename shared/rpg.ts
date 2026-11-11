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

export type ClassId = "novice" | "knight" | "mage" | "archer" | "lordKnight" | "wizard" | "hunter" | "paladin" | "archmage" | "ranger";

export interface ClassDef {
  id: ClassId;
  name: string;
  /** Second and third jobs: the job they grow out of (they keep its weapons, gear and skills, all the way down). */
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
  // Third jobs, from level 80. Again each grows a little faster than the job before it.
  paladin: {
    id: "paladin", name: "Paladin", from: "lordKnight", blurb: "A Lord Knight sworn to the light. Calls holy fire down on the enemy, shields itself, and passes judgement on everything around it.",
    hp: [100, 18], mp: [26, 3.4], atk: [12, 2.6], def: [4, 0.86], range: 40, attackMs: 1000, deathExpLoss: 0.03,
  },
  archmage: {
    id: "archmage", name: "Archmage", from: "wizard", blurb: "A Wizard who has mastered the stars themselves: arcane blasts, falling comets, and a focus nothing can break.",
    hp: [48, 10.2], mp: [52, 9.2], atk: [11, 2.9], def: [3, 0.35], range: 40, attackMs: 1200, deathExpLoss: 0.03,
  },
  ranger: {
    id: "ranger", name: "Ranger", from: "hunter", blurb: "A Hunter who never misses twice. Volleys of arrows, a barrage that pins whole packs down, and a hawk's eye.",
    hp: [60, 12.6], mp: [28, 4.8], atk: [11, 2.6], def: [3, 0.52], range: 40, attackMs: 1000, deathExpLoss: 0.03,
  },
};

export const isClassId = (id: unknown): id is ClassId => typeof id === "string" && Object.hasOwn(CLASSES, id);

/** The first job a class belongs to: a Lord Knight and a Paladin are still Knights (itself for first jobs and Novices). */
export const jobLine = (cls: ClassId): ClassId => {
  let c = cls;
  while (CLASSES[c].from) c = CLASSES[c].from!;
  return c;
};

/** A class and the jobs it grew out of, first job first: Paladin -> [knight, lordKnight, paladin]. */
export const jobChain = (cls: ClassId): ClassId[] => (CLASSES[cls].from ? [...jobChain(CLASSES[cls].from!), cls] : [cls]);

/** 0 for Novices, 1 for first jobs, 2 for second jobs, 3 for third jobs. */
export const jobTier = (cls: ClassId): number => (cls === "novice" ? 0 : jobChain(cls).length);

/** "a Knight", "an Archer". */
export const aClass = (cls: ClassId) => `${/^[AEIOU]/.test(CLASSES[cls].name) ? "an" : "a"} ${CLASSES[cls].name}`;

/** A Novice can choose a job from this level. */
export const JOB_LEVEL = 10;
/** What the Job Master offers, in his order. */
export const JOBS: ClassId[] = ["knight", "mage", "archer"];
/** The weapon each job starts with, a gift from the Job Master. */
export const JOB_WEAPON: Partial<Record<ClassId, ItemId>> = { knight: "squireSword", mage: "apprenticeStaff", archer: "huntingBow" };
/** A first job can become its second job from this level, and a second job its third, again with the Job Master. */
export const SECOND_JOB_LEVEL = 50;
export const THIRD_JOB_LEVEL = 80;
/** What each job grows into next: first jobs into second jobs, second jobs into third jobs. */
export const NEXT_JOBS: Partial<Record<ClassId, ClassId>> = {
  knight: "lordKnight",
  mage: "wizard",
  archer: "hunter",
  lordKnight: "paladin",
  wizard: "archmage",
  hunter: "ranger",
};
/** The level a job needs: 50 for second jobs, 80 for third jobs. */
export const jobLevel = (cls: ClassId): number => (jobTier(cls) >= 3 ? THIRD_JOB_LEVEL : jobTier(cls) === 2 ? SECOND_JOB_LEVEL : JOB_LEVEL);

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
  | "tunnelBat"
  | "burrowWorm"
  | "moleGoblin"
  | "fungusEye"
  | "burrowBrute"
  | "burrowQueen"
  | "iceBat"
  | "frozenKnight"
  | "cryptWraith"
  | "iceSeer"
  | "iceGolem"
  | "cryptLord"
  | "lavaBat"
  | "magmaCrawler"
  | "flamePriest"
  | "moltenKnight"
  | "obsidianGolem"
  | "moltenDrake"
  | "cellarBat"
  | "blueJelly"
  | "cellarViper"
  | "goblinThief"
  | "greatSlime"
  | "slimeKing"
  | "shadowBat"
  | "boneCrawler"
  | "vaultKnight"
  | "shadowPriest"
  | "boneColossus"
  | "shadowCount"
  | "blossomWasp"
  | "rootCrawler"
  | "foxGuard"
  | "lanternGhost"
  | "stoneOni"
  | "jadeSerpent"
  | "tombScarab"
  | "sandWorm"
  | "tombMummy"
  | "jackalPriest"
  | "sandstoneColossus"
  | "tombPharaoh"
  | "riftBat"
  | "voidWorm"
  | "riftKnight"
  | "voidEye"
  | "voidGolem"
  | "voidWyrm"
  | "goblinScout"
  | "mudWorm"
  | "goblinPikeman"
  | "goblinFirecaller"
  | "hobgoblin"
  | "goblinKing"
  | "denStalker"
  | "denGnawer"
  | "denRaider"
  | "moonShaman"
  | "caveTroll"
  | "moonfang"
  | "caveBat"
  | "caveCrawler"
  | "orcMiner"
  | "orcShaman"
  | "orcGuard"
  | "orcChieftain"
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
  | "shadeHunter"
  | "shadePaladin"
  | "shadeArchmage"
  | "shadeRanger";

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
  /** Field bosses' special attacks (see BossAttack): a slam all round them, and a blast where the furthest attacker stands. */
  slam?: BossAttack;
  blast?: BossAttack & { reach: number };
}

/**
 * A field boss's area attack. A red circle on the ground gives BOSS_WINDUP_MS of warning;
 * then everyone inside it is hit for `power` times the boss's ATK. Step out and it misses you.
 */
export interface BossAttack {
  radius: number;
  power: number;
  everyMs: number;
}

/** How long the warning circle shows before a boss's slam or blast lands. */
export const BOSS_WINDUP_MS = 1300;
/** A field boss's plain attack reaches at least this far (px), so nobody can hit one from where it can't hit back. */
export const BOSS_REACH = 300;

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
    id: "pumpking", name: "Pumpking", level: 22, hp: 12_000, atk: 58, def: 20, exp: 16_000, gold: [400, 800], speed: 30, chase: 75, aggro: 150, range: BOSS_REACH, attackMs: 1800, radius: 24, respawnMs: 600_000,
    boss: true, regen: 0.005,
    slam: { radius: 90, power: 1.4, everyMs: 10_000 }, blast: { radius: 70, power: 1.2, everyMs: 12_000, reach: 380 },
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
    slam: { radius: 100, power: 1.5, everyMs: 9_000 }, blast: { radius: 75, power: 1.3, everyMs: 11_000, reach: 400 },
    drops: [
      ["warlordBanner", 1], ["orangePotion", 0.8], ["halberd", 0.2], ["vikingHelm", 0.2], ["spartanShield", 0.2], ["crossbow", 0.15], ["diamondStaff", 0.15], ["katana", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.5], ["warlordMedal", 0.06], ["dragonSpear", 0.02], ["orcWarlordCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Wildlands (Lv 30–40), north of town
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
    slam: { radius: 105, power: 1.5, everyMs: 9_000 }, blast: { radius: 75, power: 1.3, everyMs: 11_000, reach: 400 },
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
    id: "frostGiant", name: "Frost Giant", level: 54, hp: 70_000, atk: 150, def: 48, exp: 150_000, gold: [3000, 6000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 26, respawnMs: 1_500_000,
    boss: true, regen: 0.004,
    slam: { radius: 110, power: 1.6, everyMs: 9_000 }, blast: { radius: 80, power: 1.4, everyMs: 11_000, reach: 420 },
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
    id: "fallenKing", name: "Fallen King", level: 64, hp: 110_000, atk: 180, def: 56, exp: 260_000, gold: [5000, 9000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 26, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 110, power: 1.6, everyMs: 9_000 }, blast: { radius: 80, power: 1.4, everyMs: 11_000, reach: 420 },
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
    id: "ogreWarlord", name: "Ogre Warlord", level: 74, hp: 170_000, atk: 205, def: 62, exp: 420_000, gold: [8000, 14000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 28, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 115, power: 1.6, everyMs: 8_500 }, blast: { radius: 85, power: 1.4, everyMs: 10_500, reach: 420 },
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
    id: "cinderColossus", name: "Cinder Colossus", level: 84, hp: 230_000, atk: 220, def: 68, exp: 600_000, gold: [12_000, 20_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 30, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 120, power: 1.7, everyMs: 8_500 }, blast: { radius: 85, power: 1.5, everyMs: 10_500, reach: 440 },
    drops: [
      ["heartOfFlame", 1], ["whitePotion", 0.8], ["magmaLance", 0.2], ["obsidianBow", 0.2], ["magmaStaff", 0.2], ["obsidianPlate", 0.15], ["obsidianShield", 0.15],
      ["mithril", 1], ["starCrystal", 1], ["starCrystal", 0.8], ["colossusHeart", 0.06], ["colossusMantle", 0.015], ["cinderColossusCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Hollow Burrows (Lv 14–22), a dungeon
  // Purple bats in the first cavern. They swoop at anyone who comes near, and they're quick to dodge.
  tunnelBat: {
    id: "tunnelBat", name: "Tunnel Bat", level: 14, hp: 700, atk: 15, def: 8, exp: 560, gold: [16, 26], speed: 70, chase: 115, aggro: 45, range: 36, attackMs: 1300, radius: 10, respawnMs: 15_000, flee: 0.1,
    drops: [
      ["tunnelWing", 0.55], ["orangePotion", 0.06], ["burrowBlade", 0.004], ["burrowRing", 0.001], ["mithril", 0.04], ["starCrystal", 0.004], ["tunnelBatCard", 0.001],
    ],
  },
  // Fat worms in the dug-out cavern below. They only fight back, and their hides are thick.
  burrowWorm: {
    id: "burrowWorm", name: "Burrow Worm", level: 16, hp: 1_250, atk: 24, def: 18, exp: 820, gold: [18, 30], speed: 30, chase: 70, aggro: 0, range: 40, attackMs: 1900, radius: 15, respawnMs: 16_000,
    drops: [
      ["wormHide", 0.55], ["orangePotion", 0.06], ["fungusStaff", 0.004], ["mithril", 0.04], ["starCrystal", 0.004], ["burrowWormCard", 0.001],
    ],
  },
  // Goblins who dig for the Burrow Queen. They go for anyone who comes near.
  moleGoblin: {
    id: "moleGoblin", name: "Mole Goblin", level: 17, hp: 900, atk: 21, def: 12, exp: 860, gold: [20, 32], speed: 45, chase: 95, aggro: 40, range: 38, attackMs: 1500, radius: 11, respawnMs: 16_000,
    drops: [
      ["goblinShovel", 0.55], ["orangePotion", 0.06], ["tunnelBow", 0.004], ["mithril", 0.04], ["starCrystal", 0.004], ["moleGoblinCard", 0.001],
    ],
  },
  // Eyes on stalks, grown out of the second floor's mould. They stare beams at anyone they see.
  fungusEye: {
    id: "fungusEye", name: "Fungus Eye", level: 19, hp: 900, atk: 22, def: 10, exp: 980, gold: [22, 36], speed: 40, chase: 80, aggro: 100, range: 160, attackMs: 2100, radius: 12, respawnMs: 18_000,
    drops: [
      ["fungusSpores", 0.55], ["orangePotion", 0.06], ["burrowBlade", 0.004], ["burrowRing", 0.001], ["mithril", 0.04], ["starCrystal", 0.004], ["fungusEyeCard", 0.001],
    ],
  },
  // Big goblins in the Queen's hall. Tough, and they charge anyone who comes near.
  burrowBrute: {
    id: "burrowBrute", name: "Burrow Brute", level: 21, hp: 1_700, atk: 25, def: 20, exp: 1_250, gold: [26, 42], speed: 40, chase: 90, aggro: 40, range: 42, attackMs: 1700, radius: 14, respawnMs: 18_000,
    drops: [
      ["bruteTooth", 0.55], ["orangePotion", 0.06], ["fungusStaff", 0.004], ["mithril", 0.04], ["starCrystal", 0.004], ["burrowBruteCard", 0.001],
    ],
  },
  // The Hollow Burrows' boss: a vast worm in the deepest hall, queen of everything that digs.
  burrowQueen: {
    id: "burrowQueen", name: "Burrow Queen", level: 24, hp: 16_000, atk: 64, def: 22, exp: 22_000, gold: [500, 900], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 32, respawnMs: 1_200_000,
    boss: true, regen: 0.004,
    slam: { radius: 90, power: 1.4, everyMs: 10_000 }, blast: { radius: 70, power: 1.2, everyMs: 12_000, reach: 380 },
    drops: [
      ["queenJelly", 1], ["orangePotion", 0.8], ["burrowBlade", 0.2], ["fungusStaff", 0.2], ["tunnelBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["queenCharm", 0.06], ["burrowRing", 0.02], ["burrowQueenCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Frozen Crypt (Lv 46–54), a dungeon
  // Pale bats in the first hall, cold to the touch. They swoop at anyone who comes near.
  iceBat: {
    id: "iceBat", name: "Ice Bat", level: 46, hp: 3_000, atk: 42, def: 26, exp: 7_000, gold: [56, 92], speed: 70, chase: 120, aggro: 60, range: 36, attackMs: 1300, radius: 10, respawnMs: 20_000, flee: 0.1,
    drops: [
      ["frostWing", 0.55], ["whitePotion", 0.06], ["cryptBlade", 0.004], ["cryptRing", 0.001], ["mithril", 0.07], ["starCrystal", 0.013], ["iceBatCard", 0.001],
    ],
  },
  // Knights frozen in their armour long ago, still on guard. They charge anyone who comes near.
  frozenKnight: {
    id: "frozenKnight", name: "Frozen Knight", level: 48, hp: 3_800, atk: 58, def: 34, exp: 7_800, gold: [58, 98], speed: 45, chase: 95, aggro: 50, range: 42, attackMs: 1600, radius: 13, respawnMs: 22_000,
    drops: [
      ["frozenCrest", 0.55], ["whitePotion", 0.06], ["frostGlaive", 0.004], ["mithril", 0.07], ["starCrystal", 0.013], ["frozenKnightCard", 0.001],
    ],
  },
  // Cold spirits drifting through the second floor. Hard to hit with plain attacks.
  cryptWraith: {
    id: "cryptWraith", name: "Crypt Wraith", level: 50, hp: 3_900, atk: 50, def: 28, exp: 8_600, gold: [60, 102], speed: 55, chase: 105, aggro: 50, range: 36, attackMs: 1500, radius: 12, respawnMs: 22_000, flee: 0.15,
    drops: [
      ["wraithFrost", 0.55], ["whitePotion", 0.06], ["seerStaffIce", 0.004], ["mithril", 0.07], ["starCrystal", 0.013], ["cryptWraithCard", 0.001],
    ],
  },
  // Robed skeletons that throw shards of ice from afar at anyone they see.
  iceSeer: {
    id: "iceSeer", name: "Ice Seer", level: 52, hp: 3_600, atk: 56, def: 26, exp: 9_400, gold: [62, 106], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 22_000,
    drops: [
      ["seerShard", 0.55], ["whitePotion", 0.06], ["cryptBow", 0.004], ["cryptRing", 0.001], ["mithril", 0.07], ["starCrystal", 0.013], ["iceSeerCard", 0.001],
    ],
  },
  // Walking blocks of ice. Leave them alone and they leave you alone; they hit very hard.
  iceGolem: {
    id: "iceGolem", name: "Ice Golem", level: 53, hp: 5_600, atk: 92, def: 40, exp: 10_400, gold: [66, 110], speed: 30, chase: 70, aggro: 0, range: 46, attackMs: 2100, radius: 18, respawnMs: 24_000,
    drops: [
      ["golemIce", 0.55], ["whitePotion", 0.06], ["cryptBlade", 0.004], ["mithril", 0.07], ["starCrystal", 0.013], ["iceGolemCard", 0.001],
    ],
  },
  // The Frozen Crypt's boss: a frozen king of old, on his throne at the bottom. Throws ice at anyone out of reach.
  cryptLord: {
    id: "cryptLord", name: "Crypt Lord", level: 57, hp: 90_000, atk: 165, def: 50, exp: 200_000, gold: [4_000, 7_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 24, respawnMs: 1_500_000,
    boss: true, regen: 0.004,
    slam: { radius: 110, power: 1.6, everyMs: 9_000 }, blast: { radius: 80, power: 1.4, everyMs: 11_000, reach: 420 },
    drops: [
      ["cryptCrown", 1], ["whitePotion", 0.8], ["cryptBlade", 0.2], ["frostGlaive", 0.2], ["seerStaffIce", 0.2], ["cryptBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["cryptAmulet", 0.06], ["cryptRing", 0.02], ["cryptLordCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Magma Depths (Lv 76–84), a dungeon
  // Red-hot bats in the first cavern. They swoop at anyone who comes near.
  lavaBat: {
    id: "lavaBat", name: "Lava Bat", level: 76, hp: 6_600, atk: 70, def: 46, exp: 37_000, gold: [100, 168], speed: 70, chase: 125, aggro: 50, range: 36, attackMs: 1300, radius: 11, respawnMs: 22_000, flee: 0.1,
    drops: [
      ["lavaWing", 0.55], ["goldenPotion", 0.06], ["moltenBlade", 0.004], ["depthsRing", 0.001], ["mithril", 0.09], ["starCrystal", 0.02], ["lavaBatCard", 0.001],
    ],
  },
  // Armoured worms that swim through lava. They only fight back, and they hit hard.
  magmaCrawler: {
    id: "magmaCrawler", name: "Magma Crawler", level: 78, hp: 9_200, atk: 96, def: 56, exp: 41_000, gold: [102, 172], speed: 30, chase: 70, aggro: 0, range: 44, attackMs: 1900, radius: 16, respawnMs: 24_000,
    drops: [
      ["crawlerPlate", 0.55], ["goldenPotion", 0.06], ["drakeLance", 0.004], ["mithril", 0.09], ["starCrystal", 0.02], ["magmaCrawlerCard", 0.001],
    ],
  },
  // Robed skeletons who worship the Molten Drake. They throw fire from afar at anyone they see.
  flamePriest: {
    id: "flamePriest", name: "Flame Priest", level: 80, hp: 6_800, atk: 72, def: 42, exp: 45_000, gold: [104, 176], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["priestCinder", 0.55], ["goldenPotion", 0.06], ["flameStaff", 0.004], ["mithril", 0.09], ["starCrystal", 0.02], ["flamePriestCard", 0.001],
    ],
  },
  // Knights in armour that never cooled. They charge anyone who comes near.
  moltenKnight: {
    id: "moltenKnight", name: "Molten Knight", level: 81, hp: 8_200, atk: 84, def: 58, exp: 47_000, gold: [106, 180], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["moltenCrest", 0.55], ["goldenPotion", 0.06], ["magmaBow", 0.004], ["depthsRing", 0.001], ["mithril", 0.09], ["starCrystal", 0.02], ["moltenKnightCard", 0.001],
    ],
  },
  // Black glass giants in the deepest hall. Leave them alone and they leave you alone; they hit very hard.
  obsidianGolem: {
    id: "obsidianGolem", name: "Obsidian Golem", level: 83, hp: 10_800, atk: 140, def: 62, exp: 54_000, gold: [110, 186], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["obsidianCore", 0.55], ["goldenPotion", 0.06], ["moltenBlade", 0.004], ["mithril", 0.09], ["starCrystal", 0.02], ["obsidianGolemCard", 0.001],
    ],
  },
  // The Magma Depths' boss: a drake of living fire, coiled in the deepest chamber. Breathes fire at anyone out of reach.
  moltenDrake: {
    id: "moltenDrake", name: "Molten Drake", level: 87, hp: 280_000, atk: 250, def: 78, exp: 800_000, gold: [14_000, 24_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 30, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 120, power: 1.7, everyMs: 8_500 }, blast: { radius: 90, power: 1.5, everyMs: 10_500, reach: 440 },
    drops: [
      ["drakeHeart", 1], ["goldenPotion", 0.8], ["moltenBlade", 0.2], ["drakeLance", 0.2], ["flameStaff", 0.2], ["magmaBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["drakeAmulet", 0.06], ["depthsRing", 0.02], ["moltenDrakeCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Slime Cellar (Lv 6–12), a dungeon
  // Small brown bats in the first cellar. They flap at anyone who comes near.
  cellarBat: {
    id: "cellarBat", name: "Cellar Bat", level: 6, hp: 110, atk: 8, def: 2, exp: 55, gold: [4, 8], speed: 70, chase: 110, aggro: 40, range: 34, attackMs: 1300, radius: 10, respawnMs: 12_000, flee: 0.08,
    drops: [
      ["dustyWing", 0.55], ["redPotion", 0.06], ["cellarCleaver", 0.004], ["jellyRing", 0.001], ["ironIngot", 0.05], ["starCrystal", 0.001], ["cellarBatCard", 0.001],
    ],
  },
  // Wobbly blue slimes in the wine cellar. They only fight back.
  blueJelly: {
    id: "blueJelly", name: "Blue Jelly", level: 7, hp: 210, atk: 10, def: 4, exp: 85, gold: [5, 10], speed: 30, chase: 70, aggro: 0, range: 36, attackMs: 1900, radius: 12, respawnMs: 14_000,
    drops: [
      ["jellyBlob", 0.55], ["redPotion", 0.06], ["slimeStaff", 0.004], ["ironIngot", 0.05], ["starCrystal", 0.001], ["blueJellyCard", 0.001],
    ],
  },
  // Dark snakes coiled among the barrels. They bite anyone who comes near.
  cellarViper: {
    id: "cellarViper", name: "Cellar Viper", level: 8, hp: 190, atk: 12, def: 3, exp: 105, gold: [6, 12], speed: 45, chase: 95, aggro: 40, range: 38, attackMs: 1500, radius: 11, respawnMs: 14_000,
    drops: [
      ["viperSkin", 0.55], ["redPotion", 0.06], ["cellarBow", 0.004], ["ironIngot", 0.05], ["starCrystal", 0.001], ["cellarViperCard", 0.001],
    ],
  },
  // Goblins raiding the cellar for the Slime King. They shoot little bolts at anyone they see.
  goblinThief: {
    id: "goblinThief", name: "Goblin Thief", level: 10, hp: 240, atk: 13, def: 4, exp: 170, gold: [8, 15], speed: 40, chase: 85, aggro: 90, range: 150, attackMs: 2100, radius: 12, respawnMs: 15_000,
    drops: [
      ["stolenSpoon", 0.55], ["redPotion", 0.06], ["cellarCleaver", 0.004], ["jellyRing", 0.001], ["ironIngot", 0.05], ["starCrystal", 0.001], ["goblinThiefCard", 0.001],
    ],
  },
  // Big green slimes in the King's cellar. Leave them alone and they leave you alone; they hit hard for their size.
  greatSlime: {
    id: "greatSlime", name: "Great Slime", level: 11, hp: 460, atk: 18, def: 7, exp: 270, gold: [10, 18], speed: 30, chase: 70, aggro: 0, range: 40, attackMs: 2000, radius: 15, respawnMs: 16_000,
    drops: [
      ["slimeCore", 0.55], ["redPotion", 0.06], ["slimeStaff", 0.004], ["ironIngot", 0.05], ["starCrystal", 0.001], ["greatSlimeCard", 0.001],
    ],
  },
  // The Slime Cellar's boss: a slime as big as a cart, the oldest and greediest in the cellar. Spits slime at anyone out of reach.
  slimeKing: {
    id: "slimeKing", name: "Slime King", level: 14, hp: 5_000, atk: 34, def: 10, exp: 5_000, gold: [120, 240], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 30, respawnMs: 900_000,
    boss: true, regen: 0.004,
    slam: { radius: 70, power: 1.3, everyMs: 11_000 }, blast: { radius: 60, power: 1.1, everyMs: 13_000, reach: 320 },
    drops: [
      ["royalGel", 1], ["redPotion", 0.8], ["cellarCleaver", 0.2], ["slimeStaff", 0.2], ["cellarBow", 0.2], ["ironIngot", 1], ["starCrystal", 1], ["slimeDrop", 0.06], ["jellyRing", 0.02], ["slimeKingCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Shadow Vault (Lv 56–64), a dungeon
  // Black bats in the first hall, hard to see in the dark. They swoop at anyone who comes near.
  shadowBat: {
    id: "shadowBat", name: "Shadow Bat", level: 56, hp: 4_100, atk: 54, def: 34, exp: 12_500, gold: [68, 114], speed: 70, chase: 120, aggro: 50, range: 36, attackMs: 1300, radius: 10, respawnMs: 20_000, flee: 0.1,
    drops: [
      ["shadowWing", 0.55], ["whitePotion", 0.06], ["vaultBlade", 0.004], ["shadowRing", 0.001], ["mithril", 0.08], ["starCrystal", 0.015], ["shadowBatCard", 0.001],
    ],
  },
  // Pale worms that live in the vault's old bones. They only fight back, and they hit hard.
  boneCrawler: {
    id: "boneCrawler", name: "Bone Crawler", level: 58, hp: 5_600, atk: 82, def: 46, exp: 14_000, gold: [70, 118], speed: 30, chase: 70, aggro: 0, range: 44, attackMs: 1900, radius: 16, respawnMs: 22_000,
    drops: [
      ["boneShard", 0.55], ["whitePotion", 0.06], ["shadowScythe", 0.004], ["mithril", 0.08], ["starCrystal", 0.015], ["boneCrawlerCard", 0.001],
    ],
  },
  // Dead knights still guarding the Count's treasure. They charge anyone who comes near.
  vaultKnight: {
    id: "vaultKnight", name: "Vault Knight", level: 59, hp: 5_200, atk: 66, def: 44, exp: 15_000, gold: [72, 120], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 22_000,
    drops: [
      ["vaultCrest", 0.55], ["whitePotion", 0.06], ["shadowStaff", 0.004], ["mithril", 0.08], ["starCrystal", 0.015], ["vaultKnightCard", 0.001],
    ],
  },
  // Pale priests of the Shadow Count. They throw dark bolts from afar at anyone they see.
  shadowPriest: {
    id: "shadowPriest", name: "Shadow Priest", level: 61, hp: 4_500, atk: 60, def: 32, exp: 16_500, gold: [74, 124], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 22_000,
    drops: [
      ["darkRosary", 0.55], ["whitePotion", 0.06], ["vaultBow", 0.004], ["shadowRing", 0.001], ["mithril", 0.08], ["starCrystal", 0.015], ["shadowPriestCard", 0.001],
    ],
  },
  // Giants stitched together from a hundred skeletons. Leave them alone and they leave you alone; they hit very hard.
  boneColossus: {
    id: "boneColossus", name: "Bone Colossus", level: 63, hp: 7_000, atk: 110, def: 48, exp: 19_000, gold: [78, 130], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 24_000,
    drops: [
      ["colossusBone", 0.55], ["whitePotion", 0.06], ["vaultBlade", 0.004], ["mithril", 0.08], ["starCrystal", 0.015], ["boneColossusCard", 0.001],
    ],
  },
  // The Shadow Vault's boss: the Count who built the vault, a vampire in his treasure hall. Throws dark bolts at anyone out of reach.
  shadowCount: {
    id: "shadowCount", name: "Shadow Count", level: 67, hp: 130_000, atk: 190, def: 58, exp: 300_000, gold: [5_500, 9_500], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 26, respawnMs: 1_500_000,
    boss: true, regen: 0.004,
    slam: { radius: 110, power: 1.6, everyMs: 9_000 }, blast: { radius: 80, power: 1.4, everyMs: 11_000, reach: 420 },
    drops: [
      ["countsSignet", 1], ["whitePotion", 0.8], ["vaultBlade", 0.2], ["shadowScythe", 0.2], ["shadowStaff", 0.2], ["vaultBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["countsBrooch", 0.06], ["shadowRing", 0.02], ["shadowCountCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Blossom Grotto (Lv 66–74), a dungeon
  // Pink wasps as big as cats, nesting in the first cave. They sting anyone who comes near.
  blossomWasp: {
    id: "blossomWasp", name: "Blossom Wasp", level: 66, hp: 5_000, atk: 62, def: 36, exp: 22_000, gold: [86, 144], speed: 75, chase: 120, aggro: 50, range: 36, attackMs: 1300, radius: 10, respawnMs: 20_000, flee: 0.12,
    drops: [
      ["blossomStinger", 0.55], ["whitePotion", 0.06], ["jadeKatana", 0.004], ["lotusRing", 0.001], ["mithril", 0.085], ["starCrystal", 0.017], ["blossomWaspCard", 0.001],
    ],
  },
  // Mossy worms that tunnel through the cherry roots. They only fight back, and they hit hard.
  rootCrawler: {
    id: "rootCrawler", name: "Root Crawler", level: 68, hp: 7_400, atk: 92, def: 50, exp: 25_000, gold: [88, 148], speed: 30, chase: 70, aggro: 0, range: 44, attackMs: 1900, radius: 16, respawnMs: 22_000,
    drops: [
      ["twistedRoot", 0.55], ["whitePotion", 0.06], ["jadeGlaive", 0.004], ["mithril", 0.085], ["starCrystal", 0.017], ["rootCrawlerCard", 0.001],
    ],
  },
  // Fox spirits in armour who guard the Jade Serpent's spring. They charge anyone who comes near.
  foxGuard: {
    id: "foxGuard", name: "Fox Guard", level: 69, hp: 6_400, atk: 74, def: 48, exp: 26_500, gold: [90, 150], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 22_000,
    drops: [
      ["foxMask", 0.55], ["whitePotion", 0.06], ["lanternStaff", 0.004], ["mithril", 0.085], ["starCrystal", 0.017], ["foxGuardCard", 0.001],
    ],
  },
  // Spirits that glow like paper lanterns. They throw fire from afar at anyone they see.
  lanternGhost: {
    id: "lanternGhost", name: "Lantern Ghost", level: 71, hp: 5_600, atk: 66, def: 38, exp: 29_000, gold: [92, 154], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 22_000,
    drops: [
      ["paperLantern", 0.55], ["whitePotion", 0.06], ["blossomBow", 0.004], ["lotusRing", 0.001], ["mithril", 0.085], ["starCrystal", 0.017], ["lanternGhostCard", 0.001],
    ],
  },
  // Horned giants of grey stone, asleep on their feet. Leave them alone and they leave you alone; they hit very hard.
  stoneOni: {
    id: "stoneOni", name: "Stone Oni", level: 73, hp: 8_600, atk: 124, def: 54, exp: 33_000, gold: [96, 160], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 24_000,
    drops: [
      ["oniHorn", 0.55], ["whitePotion", 0.06], ["jadeKatana", 0.004], ["mithril", 0.085], ["starCrystal", 0.017], ["stoneOniCard", 0.001],
    ],
  },
  // The Blossom Grotto's boss: a winged serpent of green jade, coiled round the spring at the bottom. Breathes light at anyone out of reach.
  jadeSerpent: {
    id: "jadeSerpent", name: "Jade Serpent", level: 77, hp: 200_000, atk: 205, def: 66, exp: 500_000, gold: [9_000, 16_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 30, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 115, power: 1.6, everyMs: 8_800 }, blast: { radius: 85, power: 1.45, everyMs: 10_800, reach: 430 },
    drops: [
      ["jadePearl", 1], ["whitePotion", 0.8], ["jadeKatana", 0.2], ["jadeGlaive", 0.2], ["lanternStaff", 0.2], ["blossomBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["jadeScale", 0.06], ["lotusRing", 0.02], ["jadeSerpentCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Sunken Tomb (Lv 86–94), a dungeon
  // Blue-gold beetles that swarm the first hall. They bite anyone who comes near.
  tombScarab: {
    id: "tombScarab", name: "Tomb Scarab", level: 86, hp: 7_000, atk: 74, def: 50, exp: 58_000, gold: [110, 190], speed: 75, chase: 125, aggro: 50, range: 36, attackMs: 1300, radius: 10, respawnMs: 22_000, flee: 0.1,
    drops: [
      ["scarabShell", 0.55], ["goldenPotion", 0.06], ["khopesh", 0.004], ["sandsRing", 0.001], ["mithril", 0.095], ["starCrystal", 0.022], ["tombScarabCard", 0.001],
    ],
  },
  // Huge worms that swim through the tomb's sand. They only fight back, and they hit hard.
  sandWorm: {
    id: "sandWorm", name: "Sand Worm", level: 88, hp: 10_000, atk: 104, def: 60, exp: 63_000, gold: [112, 194], speed: 30, chase: 70, aggro: 0, range: 46, attackMs: 1900, radius: 16, respawnMs: 24_000,
    drops: [
      ["sandwormTooth", 0.55], ["goldenPotion", 0.06], ["tombSpear", 0.004], ["mithril", 0.095], ["starCrystal", 0.022], ["sandWormCard", 0.001],
    ],
  },
  // The Pharaoh's servants, wrapped and walking. They shuffle after anyone who comes near.
  tombMummy: {
    id: "tombMummy", name: "Tomb Mummy", level: 89, hp: 8_600, atk: 86, def: 58, exp: 66_000, gold: [114, 196], speed: 40, chase: 90, aggro: 50, range: 42, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["mummyWrap", 0.55], ["goldenPotion", 0.06], ["jackalStaff", 0.004], ["mithril", 0.095], ["starCrystal", 0.022], ["tombMummyCard", 0.001],
    ],
  },
  // Jackal-headed priests of the tomb. They throw golden bolts from afar at anyone they see.
  jackalPriest: {
    id: "jackalPriest", name: "Jackal Priest", level: 91, hp: 7_400, atk: 78, def: 46, exp: 71_000, gold: [116, 200], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["jackalIdol", 0.55], ["goldenPotion", 0.06], ["tombBow", 0.004], ["sandsRing", 0.001], ["mithril", 0.095], ["starCrystal", 0.022], ["jackalPriestCard", 0.001],
    ],
  },
  // Statues of the Pharaoh's guard that walk. Leave them alone and they leave you alone; they hit very hard.
  sandstoneColossus: {
    id: "sandstoneColossus", name: "Sandstone Colossus", level: 93, hp: 11_400, atk: 148, def: 64, exp: 78_000, gold: [120, 206], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["sandstoneEye", 0.55], ["goldenPotion", 0.06], ["khopesh", 0.004], ["mithril", 0.095], ["starCrystal", 0.022], ["sandstoneColossusCard", 0.001],
    ],
  },
  // The Sunken Tomb's boss: a king who would not stay dead, on his golden throne at the bottom. Throws fire at anyone out of reach.
  tombPharaoh: {
    id: "tombPharaoh", name: "Tomb Pharaoh", level: 97, hp: 320_000, atk: 260, def: 80, exp: 1_400_000, gold: [18_000, 30_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 28, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 120, power: 1.7, everyMs: 8_500 }, blast: { radius: 90, power: 1.5, everyMs: 10_500, reach: 440 },
    drops: [
      ["pharaohsMask", 1], ["goldenPotion", 0.8], ["khopesh", 0.2], ["tombSpear", 0.2], ["jackalStaff", 0.2], ["tombBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["pharaohsAnkh", 0.06], ["sandsRing", 0.02], ["tombPharaohCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Void Rift (Lv 94–100), a dungeon
  // Bats from beyond the stars, with violet light in their wings. They swoop at anyone who comes near.
  riftBat: {
    id: "riftBat", name: "Rift Bat", level: 94, hp: 7_800, atk: 78, def: 56, exp: 80_000, gold: [122, 210], speed: 70, chase: 125, aggro: 50, range: 36, attackMs: 1300, radius: 11, respawnMs: 22_000, flee: 0.1,
    drops: [
      ["riftWing", 0.55], ["goldenPotion", 0.06], ["riftBlade", 0.004], ["riftRing", 0.001], ["mithril", 0.1], ["starCrystal", 0.025], ["riftBatCard", 0.001],
    ],
  },
  // Worms of living darkness. They only fight back, and they hit hard.
  voidWorm: {
    id: "voidWorm", name: "Void Worm", level: 95, hp: 11_000, atk: 112, def: 64, exp: 84_000, gold: [124, 212], speed: 30, chase: 70, aggro: 0, range: 46, attackMs: 1900, radius: 16, respawnMs: 24_000,
    drops: [
      ["voidOoze", 0.55], ["goldenPotion", 0.06], ["voidScythe", 0.004], ["mithril", 0.1], ["starCrystal", 0.025], ["voidWormCard", 0.001],
    ],
  },
  // Knights who stepped through the rift and never came back. They charge anyone who comes near.
  riftKnight: {
    id: "riftKnight", name: "Rift Knight", level: 97, hp: 9_000, atk: 90, def: 66, exp: 90_000, gold: [126, 216], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 13, respawnMs: 24_000,
    drops: [
      ["riftCrest", 0.55], ["goldenPotion", 0.06], ["riftStaff", 0.004], ["mithril", 0.1], ["starCrystal", 0.025], ["riftKnightCard", 0.001],
    ],
  },
  // Great violet eyes floating in the dark. They stare beams from afar at anyone they see.
  voidEye: {
    id: "voidEye", name: "Void Eye", level: 98, hp: 8_000, atk: 82, def: 52, exp: 93_000, gold: [128, 218], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 24_000,
    drops: [
      ["voidLens", 0.55], ["goldenPotion", 0.06], ["riftBow", 0.004], ["riftRing", 0.001], ["mithril", 0.1], ["starCrystal", 0.025], ["voidEyeCard", 0.001],
    ],
  },
  // Golems of black star-stone. Leave them alone and they leave you alone; they hit very hard.
  voidGolem: {
    id: "voidGolem", name: "Void Golem", level: 99, hp: 12_000, atk: 158, def: 68, exp: 99_000, gold: [130, 222], speed: 30, chase: 70, aggro: 0, range: 48, attackMs: 2100, radius: 18, respawnMs: 26_000,
    drops: [
      ["voidCore", 0.55], ["goldenPotion", 0.06], ["riftBlade", 0.004], ["mithril", 0.1], ["starCrystal", 0.025], ["voidGolemCard", 0.001],
    ],
  },
  // The Void Rift's boss: a dragon of darkness that crawled out of the rift. Throws violet bolts at anyone out of reach.
  voidWyrm: {
    id: "voidWyrm", name: "Void Wyrm", level: 106, hp: 340_000, atk: 285, def: 86, exp: 2_200_000, gold: [26_000, 40_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 32, respawnMs: 2_100_000,
    boss: true, regen: 0.004,
    slam: { radius: 125, power: 1.75, everyMs: 8_200 }, blast: { radius: 95, power: 1.55, everyMs: 10_200, reach: 450 },
    drops: [
      ["wyrmHeart", 1], ["goldenPotion", 0.8], ["riftBlade", 0.2], ["voidScythe", 0.2], ["riftStaff", 0.2], ["riftBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["wyrmsEye", 0.06], ["riftRing", 0.02], ["voidWyrmCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Goblin Warren (Lv 22–28), a dungeon
  // Quick goblins on lookout in the first tunnels. They dart at anyone who comes near.
  goblinScout: {
    id: "goblinScout", name: "Goblin Scout", level: 22, hp: 1_000, atk: 22, def: 10, exp: 1_050, gold: [28, 46], speed: 70, chase: 115, aggro: 45, range: 36, attackMs: 1300, radius: 10, respawnMs: 15_000, flee: 0.1,
    drops: [
      ["scoutWhistle", 0.55], ["orangePotion", 0.06], ["warrenCutlass", 0.004], ["warrenRing", 0.001], ["mithril", 0.05], ["starCrystal", 0.006], ["goblinScoutCard", 0.001],
    ],
  },
  // Fat brown worms the goblins keep for digging. They only fight back, and their hides are thick.
  mudWorm: {
    id: "mudWorm", name: "Mud Worm", level: 23, hp: 1_600, atk: 36, def: 22, exp: 1_250, gold: [30, 48], speed: 30, chase: 70, aggro: 0, range: 40, attackMs: 1900, radius: 15, respawnMs: 16_000,
    drops: [
      ["mudClump", 0.55], ["orangePotion", 0.06], ["goblinPike", 0.004], ["mithril", 0.05], ["starCrystal", 0.006], ["mudWormCard", 0.001],
    ],
  },
  // Goblins with long pikes, guarding the dig. They charge anyone who comes near.
  goblinPikeman: {
    id: "goblinPikeman", name: "Goblin Pikeman", level: 24, hp: 1_400, atk: 28, def: 18, exp: 1_300, gold: [32, 52], speed: 45, chase: 95, aggro: 45, range: 42, attackMs: 1600, radius: 12, respawnMs: 16_000,
    drops: [
      ["brokenPike", 0.55], ["orangePotion", 0.06], ["firecallerStaff", 0.004], ["mithril", 0.05], ["starCrystal", 0.006], ["goblinPikemanCard", 0.001],
    ],
  },
  // Goblin shamans who throw fire from afar at anyone they see.
  goblinFirecaller: {
    id: "goblinFirecaller", name: "Goblin Firecaller", level: 26, hp: 1_250, atk: 32, def: 12, exp: 1_450, gold: [34, 56], speed: 40, chase: 85, aggro: 100, range: 160, attackMs: 2100, radius: 12, respawnMs: 17_000,
    drops: [
      ["goblinTinder", 0.55], ["orangePotion", 0.06], ["warrenBow", 0.004], ["warrenRing", 0.001], ["mithril", 0.05], ["starCrystal", 0.006], ["goblinFirecallerCard", 0.001],
    ],
  },
  // Big goblins who guard the King's hall. Leave them alone and they leave you alone; they hit hard.
  hobgoblin: {
    id: "hobgoblin", name: "Hobgoblin", level: 27, hp: 2_400, atk: 52, def: 24, exp: 1_800, gold: [36, 60], speed: 30, chase: 70, aggro: 0, range: 44, attackMs: 2000, radius: 16, respawnMs: 18_000,
    drops: [
      ["hobgoblinTusk", 0.55], ["orangePotion", 0.06], ["warrenCutlass", 0.004], ["mithril", 0.05], ["starCrystal", 0.006], ["hobgoblinCard", 0.001],
    ],
  },
  // The Goblin Warren's boss: a fat goblin on a throne of stolen junk, crown and all. Throws fire at anyone out of reach.
  goblinKing: {
    id: "goblinKing", name: "Goblin King", level: 30, hp: 30_000, atk: 80, def: 28, exp: 40_000, gold: [800, 1_500], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 26, respawnMs: 1_200_000,
    boss: true, regen: 0.004,
    slam: { radius: 95, power: 1.45, everyMs: 10_000 }, blast: { radius: 70, power: 1.25, everyMs: 12_000, reach: 390 },
    drops: [
      ["goblinCrown", 1], ["orangePotion", 0.8], ["warrenCutlass", 0.2], ["goblinPike", 0.2], ["firecallerStaff", 0.2], ["warrenBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["kingsTooth", 0.06], ["warrenRing", 0.02], ["goblinKingCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Moonfang Den (Lv 37–45), a dungeon
  // Black werewolves that hunt in the first caves. They pounce on anyone who comes near.
  denStalker: {
    id: "denStalker", name: "Den Stalker", level: 37, hp: 2_500, atk: 40, def: 20, exp: 4_200, gold: [46, 76], speed: 70, chase: 120, aggro: 55, range: 36, attackMs: 1300, radius: 11, respawnMs: 18_000, flee: 0.1,
    drops: [
      ["greyPelt", 0.55], ["whitePotion", 0.06], ["moonCleaver", 0.004], ["fullMoonRing", 0.001], ["mithril", 0.06], ["starCrystal", 0.01], ["denStalkerCard", 0.001],
    ],
  },
  // Grey worms that gnaw the bones the pack leaves. They only fight back, and they bite hard.
  denGnawer: {
    id: "denGnawer", name: "Den Gnawer", level: 38, hp: 3_200, atk: 60, def: 30, exp: 4_600, gold: [48, 80], speed: 30, chase: 70, aggro: 0, range: 42, attackMs: 1900, radius: 15, respawnMs: 20_000,
    drops: [
      ["gnawedBone", 0.55], ["whitePotion", 0.06], ["moonfangGlaive", 0.004], ["mithril", 0.06], ["starCrystal", 0.01], ["denGnawerCard", 0.001],
    ],
  },
  // Werewolves in stolen armour, back from raiding the Wildlands. They charge anyone who comes near.
  denRaider: {
    id: "denRaider", name: "Den Raider", level: 40, hp: 3_000, atk: 50, def: 28, exp: 5_000, gold: [50, 84], speed: 45, chase: 95, aggro: 50, range: 42, attackMs: 1600, radius: 13, respawnMs: 20_000,
    drops: [
      ["raiderTotem", 0.55], ["whitePotion", 0.06], ["moonlitStaff", 0.004], ["mithril", 0.06], ["starCrystal", 0.01], ["denRaiderCard", 0.001],
    ],
  },
  // White-furred werewolves who pray to the moon. They throw moonlight from afar at anyone they see.
  moonShaman: {
    id: "moonShaman", name: "Moon Shaman", level: 42, hp: 2_700, atk: 48, def: 20, exp: 5_600, gold: [52, 86], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 20_000,
    drops: [
      ["moonShard", 0.55], ["whitePotion", 0.06], ["denBow", 0.004], ["fullMoonRing", 0.001], ["mithril", 0.06], ["starCrystal", 0.01], ["moonShamanCard", 0.001],
    ],
  },
  // Grey trolls the pack keeps as guards. Leave them alone and they leave you alone; they hit very hard.
  caveTroll: {
    id: "caveTroll", name: "Cave Troll", level: 44, hp: 4_400, atk: 84, def: 32, exp: 6_600, gold: [56, 92], speed: 30, chase: 70, aggro: 0, range: 46, attackMs: 2100, radius: 18, respawnMs: 22_000,
    drops: [
      ["trollHide", 0.55], ["whitePotion", 0.06], ["moonCleaver", 0.004], ["mithril", 0.06], ["starCrystal", 0.01], ["caveTrollCard", 0.001],
    ],
  },
  // The Moonfang Den's boss: the great white werewolf who leads the pack, in the deepest cave. Throws moonlight at anyone out of reach.
  moonfang: {
    id: "moonfang", name: "Moonfang Alpha", level: 47, hp: 55_000, atk: 135, def: 42, exp: 120_000, gold: [2_500, 4_500], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 28, respawnMs: 1_200_000,
    boss: true, regen: 0.004,
    slam: { radius: 100, power: 1.5, everyMs: 9_500 }, blast: { radius: 75, power: 1.3, everyMs: 11_500, reach: 400 },
    drops: [
      ["moonfangFang", 1], ["whitePotion", 0.8], ["moonCleaver", 0.2], ["moonfangGlaive", 0.2], ["moonlitStaff", 0.2], ["denBow", 0.2], ["mithril", 1], ["starCrystal", 1], ["moonfangCharm", 0.06], ["fullMoonRing", 0.02], ["moonfangCard", 0.02],
    ],
  },

  // ---------------------------------------------------------------- the Orc Caves (Lv 28–36), a dungeon under the Orc Woods
  // Big grey bats in the first cavern. They swoop at anyone who comes near, and they're quick to dodge.
  caveBat: {
    id: "caveBat", name: "Cave Bat", level: 28, hp: 1500, atk: 34, def: 14, exp: 2300, gold: [34, 56], speed: 70, chase: 115, aggro: 60, range: 36, attackMs: 1300, radius: 10, respawnMs: 16_000, flee: 0.1,
    drops: [
      ["batWing", 0.55], ["orangePotion", 0.06], ["caveBow", 0.004], ["deepRing", 0.001],
      ["mithril", 0.05], ["starCrystal", 0.006], ["caveBatCard", 0.001],
    ],
  },
  // Armoured worms that burrow through the first floor's rock. They only fight back, and their shells are hard.
  caveCrawler: {
    id: "caveCrawler", name: "Cave Crawler", level: 30, hp: 2100, atk: 50, def: 30, exp: 2800, gold: [36, 60], speed: 30, chase: 70, aggro: 0, range: 40, attackMs: 1900, radius: 15, respawnMs: 18_000,
    drops: [
      ["crawlerShell", 0.55], ["orangePotion", 0.06], ["orcGuardShield", 0.003],
      ["mithril", 0.07], ["starCrystal", 0.007], ["caveCrawlerCard", 0.001],
    ],
  },
  // Orcs digging for the Chieftain in the miners' cavern. They go for anyone who comes near.
  orcMiner: {
    id: "orcMiner", name: "Orc Miner", level: 31, hp: 2300, atk: 44, def: 24, exp: 3000, gold: [40, 66], speed: 45, chase: 95, aggro: 50, range: 40, attackMs: 1600, radius: 13, respawnMs: 18_000,
    drops: [
      ["minersLamp", 0.55], ["orangePotion", 0.06], ["caveBlade", 0.004], ["chieftainsGlaive", 0.001],
      ["ironIngot", 0.08], ["mithril", 0.06], ["starCrystal", 0.007], ["orcMinerCard", 0.001],
    ],
  },
  // The Chieftain's fire-priests in the second floor's first hall. They throw fire from afar at anyone they see.
  orcShaman: {
    id: "orcShaman", name: "Orc Shaman", level: 33, hp: 2000, atk: 46, def: 18, exp: 2900, gold: [42, 70], speed: 40, chase: 85, aggro: 100, range: 170, attackMs: 2200, radius: 12, respawnMs: 20_000,
    drops: [
      ["shamanBeads", 0.55], ["whitePotion", 0.05], ["shamanStaff", 0.004], ["deepRing", 0.001],
      ["mithril", 0.06], ["starCrystal", 0.008], ["orcShamanCard", 0.001],
    ],
  },
  // The Chieftain's own guard, in iron, in the hall before his chamber. They charge anyone who comes near.
  orcGuard: {
    id: "orcGuard", name: "Orc Guard", level: 35, hp: 3200, atk: 48, def: 32, exp: 3900, gold: [46, 76], speed: 45, chase: 95, aggro: 50, range: 44, attackMs: 1700, radius: 14, respawnMs: 20_000,
    drops: [
      ["guardBadge", 0.55], ["whitePotion", 0.06], ["orcGuardShield", 0.004], ["chieftainsGlaive", 0.002],
      ["mithril", 0.07], ["starCrystal", 0.009], ["orcGuardCard", 0.001],
    ],
  },
  // The Orc Caves' boss, on his throne in the deepest chamber. Every orc in the woods answers to him.
  orcChieftain: {
    id: "orcChieftain", name: "Orc Chieftain", level: 38, hp: 60_000, atk: 110, def: 36, exp: 90_000, gold: [2500, 4500], speed: 35, chase: 85, aggro: 150, range: 48, attackMs: 1700, radius: 24, respawnMs: 1_200_000,
    boss: true, regen: 0.004,
    slam: { radius: 105, power: 1.5, everyMs: 9_000 }, blast: { radius: 75, power: 1.3, everyMs: 11_000, reach: 400 },
    drops: [
      ["chieftainsTusk", 1], ["whitePotion", 0.8], ["chieftainsGlaive", 0.2], ["caveBlade", 0.2], ["shamanStaff", 0.2], ["caveBow", 0.2], ["orcGuardShield", 0.2],
      ["mithril", 1], ["starCrystal", 1], ["tuskNecklace", 0.15], ["chieftainsFang", 0.06], ["deepRing", 0.02], ["orcChieftainCard", 0.02],
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
    id: "duneKing", name: "Dune King", level: 94, hp: 330_000, atk: 245, def: 76, exp: 1_200_000, gold: [16_000, 26_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 28, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 120, power: 1.7, everyMs: 8_000 }, blast: { radius: 90, power: 1.5, everyMs: 10_000, reach: 440 },
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
    id: "starTyrant", name: "Star Tyrant", level: 104, hp: 450_000, atk: 270, def: 84, exp: 1_800_000, gold: [22_000, 34_000], speed: 35, chase: 85, aggro: 150, range: BOSS_REACH, attackMs: 2000, radius: 30, respawnMs: 1_800_000,
    boss: true, regen: 0.004,
    slam: { radius: 125, power: 1.8, everyMs: 8_000 }, blast: { radius: 90, power: 1.6, everyMs: 10_000, reach: 460 },
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
  // The third-job Shades, for level-80 second jobs.
  shadePaladin: {
    id: "shadePaladin", name: "Shade of a Paladin", level: 82, hp: 58_000, atk: 200, def: 70, exp: 0, gold: [0, 0], speed: 55, chase: 110, aggro: 600, range: 44, attackMs: 1500, radius: 14, respawnMs: 0,
    regen: 0,
    drops: [],
  },
  shadeArchmage: {
    id: "shadeArchmage", name: "Shade of an Archmage", level: 82, hp: 85_000, atk: 190, def: 50, exp: 0, gold: [0, 0], speed: 45, chase: 90, aggro: 600, range: 170, attackMs: 2000, radius: 12, respawnMs: 0,
    regen: 0,
    drops: [],
  },
  shadeRanger: {
    id: "shadeRanger", name: "Shade of a Ranger", level: 82, hp: 62_000, atk: 170, def: 60, exp: 0, gold: [0, 0], speed: 55, chase: 105, aggro: 600, range: 190, attackMs: 1700, radius: 12, respawnMs: 0,
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
  /** Players may fight each other here: only the Battle Pit (see shared/pvp.ts). */
  pvp?: boolean;
  spawns: SpawnGroup[];
}

/** Hunting grounds outside the walls. The town itself is always safe. */
export const FIELDS: Field[] = [
  {
    // The Battle Pit (BATTLE_PIT in shared/town.ts), through the portal by the Arena: no monsters, only players.
    id: "pit",
    name: "Battle Pit",
    levels: "Lv 20+",
    area: { x: 19, y: 470, w: 26, h: 36 },
    wild: true,
    pvp: true,
    spawns: [],
  },
  {
    // Its gate hall, where nobody fights.
    id: "pit-gate",
    name: "Battle Pit gate",
    levels: "safe",
    area: { x: 0, y: 464, w: 19, h: 48 },
    wild: true,
    spawns: [],
  },
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
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "burrows",
    name: "Hollow Burrows",
    levels: "Lv 14–22",
    area: { x: 0, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "tunnelBat", rect: { x: 32, y: 534, w: 18, h: 14 }, count: 7 },
      { monster: "burrowWorm", rect: { x: 40, y: 564, w: 12, h: 12 }, count: 4 },
      { monster: "moleGoblin", rect: { x: 52, y: 564, w: 12, h: 12 }, count: 5 },
      { monster: "fungusEye", rect: { x: 26, y: 590, w: 22, h: 14 }, count: 7 },
      { monster: "burrowBrute", rect: { x: 6, y: 620, w: 22, h: 12 }, count: 5 },
      { monster: "burrowQueen", rect: { x: 52, y: 622, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "crypt",
    name: "Frozen Crypt",
    levels: "Lv 46–54",
    area: { x: 80, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "iceBat", rect: { x: 114, y: 564, w: 18, h: 16 }, count: 7 },
      { monster: "frozenKnight", rect: { x: 110, y: 532, w: 11, h: 10 }, count: 4 },
      { monster: "cryptWraith", rect: { x: 121, y: 532, w: 11, h: 10 }, count: 5 },
      { monster: "iceSeer", rect: { x: 106, y: 616, w: 21, h: 16 }, count: 7 },
      { monster: "iceGolem", rect: { x: 92, y: 588, w: 30, h: 8 }, count: 7 },
      { monster: "cryptLord", rect: { x: 141, y: 594, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "depths",
    name: "Magma Depths",
    levels: "Lv 76–84",
    area: { x: 160, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "lavaBat", rect: { x: 192, y: 534, w: 16, h: 18 }, count: 7 },
      { monster: "magmaCrawler", rect: { x: 186, y: 566, w: 12, h: 11 }, count: 4 },
      { monster: "flamePriest", rect: { x: 198, y: 566, w: 12, h: 11 }, count: 5 },
      { monster: "moltenKnight", rect: { x: 192, y: 590, w: 20, h: 14 }, count: 7 },
      { monster: "obsidianGolem", rect: { x: 202, y: 618, w: 26, h: 10 }, count: 7 },
      { monster: "moltenDrake", rect: { x: 176, y: 620, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "cellar",
    name: "Slime Cellar",
    levels: "Lv 6–12",
    area: { x: 240, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "cellarBat", rect: { x: 270, y: 534, w: 18, h: 14 }, count: 7 },
      { monster: "blueJelly", rect: { x: 256, y: 564, w: 12, h: 12 }, count: 4 },
      { monster: "cellarViper", rect: { x: 268, y: 564, w: 12, h: 12 }, count: 5 },
      { monster: "goblinThief", rect: { x: 272, y: 590, w: 22, h: 14 }, count: 7 },
      { monster: "greatSlime", rect: { x: 292, y: 620, w: 22, h: 12 }, count: 7 },
      { monster: "slimeKing", rect: { x: 262, y: 622, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "vault",
    name: "Shadow Vault",
    levels: "Lv 56–64",
    area: { x: 320, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "shadowBat", rect: { x: 348, y: 564, w: 18, h: 16 }, count: 7 },
      { monster: "boneCrawler", rect: { x: 348, y: 532, w: 11, h: 10 }, count: 4 },
      { monster: "vaultKnight", rect: { x: 359, y: 532, w: 11, h: 10 }, count: 5 },
      { monster: "shadowPriest", rect: { x: 353, y: 616, w: 21, h: 16 }, count: 7 },
      { monster: "boneColossus", rect: { x: 358, y: 588, w: 30, h: 8 }, count: 7 },
      { monster: "shadowCount", rect: { x: 333, y: 594, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "grotto",
    name: "Blossom Grotto",
    levels: "Lv 66–74",
    area: { x: 400, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "blossomWasp", rect: { x: 432, y: 560, w: 16, h: 18 }, count: 7 },
      { monster: "rootCrawler", rect: { x: 430, y: 535, w: 12, h: 11 }, count: 4 },
      { monster: "foxGuard", rect: { x: 442, y: 535, w: 12, h: 11 }, count: 5 },
      { monster: "lanternGhost", rect: { x: 428, y: 620, w: 20, h: 14 }, count: 7 },
      { monster: "stoneOni", rect: { x: 412, y: 596, w: 26, h: 10 }, count: 7 },
      { monster: "jadeSerpent", rect: { x: 458, y: 598, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "tomb",
    name: "Sunken Tomb",
    levels: "Lv 86–94",
    area: { x: 480, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "tombScarab", rect: { x: 512, y: 564, w: 18, h: 14 }, count: 7 },
      { monster: "sandWorm", rect: { x: 520, y: 536, w: 12, h: 12 }, count: 4 },
      { monster: "tombMummy", rect: { x: 532, y: 536, w: 12, h: 12 }, count: 5 },
      { monster: "jackalPriest", rect: { x: 506, y: 620, w: 22, h: 14 }, count: 7 },
      { monster: "sandstoneColossus", rect: { x: 486, y: 592, w: 22, h: 12 }, count: 7 },
      { monster: "tombPharaoh", rect: { x: 532, y: 596, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "rift",
    name: "Void Rift",
    levels: "Lv 94–100",
    area: { x: 560, y: 528, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "riftBat", rect: { x: 594, y: 532, w: 18, h: 16 }, count: 7 },
      { monster: "voidWorm", rect: { x: 590, y: 570, w: 11, h: 10 }, count: 4 },
      { monster: "riftKnight", rect: { x: 601, y: 570, w: 11, h: 10 }, count: 5 },
      { monster: "voidEye", rect: { x: 586, y: 592, w: 21, h: 16 }, count: 7 },
      { monster: "voidGolem", rect: { x: 572, y: 628, w: 30, h: 8 }, count: 7 },
      { monster: "voidWyrm", rect: { x: 621, y: 624, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "warren",
    name: "Goblin Warren",
    levels: "Lv 22–28",
    area: { x: 0, y: 656, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "goblinScout", rect: { x: 32, y: 688, w: 16, h: 18 }, count: 7 },
      { monster: "mudWorm", rect: { x: 26, y: 663, w: 12, h: 11 }, count: 4 },
      { monster: "goblinPikeman", rect: { x: 38, y: 663, w: 12, h: 11 }, count: 5 },
      { monster: "goblinFirecaller", rect: { x: 32, y: 748, w: 20, h: 14 }, count: 7 },
      { monster: "hobgoblin", rect: { x: 42, y: 724, w: 26, h: 10 }, count: 7 },
      { monster: "goblinKing", rect: { x: 16, y: 726, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon, through the portal in its land (see DUNGEONS in shared/town.ts).
    id: "den",
    name: "Moonfang Den",
    levels: "Lv 37–45",
    area: { x: 80, y: 656, w: 80, h: 112 },
    wild: true,
    spawns: [
      { monster: "denStalker", rect: { x: 110, y: 692, w: 18, h: 14 }, count: 7 },
      { monster: "denGnawer", rect: { x: 96, y: 664, w: 12, h: 12 }, count: 4 },
      { monster: "denRaider", rect: { x: 108, y: 664, w: 12, h: 12 }, count: 5 },
      { monster: "moonShaman", rect: { x: 112, y: 748, w: 22, h: 14 }, count: 7 },
      { monster: "caveTroll", rect: { x: 132, y: 720, w: 22, h: 12 }, count: 7 },
      { monster: "moonfang", rect: { x: 102, y: 724, w: 6, h: 6 }, count: 1 },
    ],
  },
  {
    // A dungeon under the Orc Woods, through the portal in the clearing east of the Orc Warlord's camp.
    id: "orc-caves",
    name: "Orc Caves",
    levels: "Lv 28–36",
    area: { x: 0, y: 336, w: 80, h: 112 },
    wild: true,
    spawns: [
      // The first floor: Cave Bats in the big cavern, Cave Crawlers in its corners, Orc Miners in the miners' cavern.
      { monster: "caveBat", rect: { x: 32, y: 342, w: 16, h: 18 }, count: 7 },
      { monster: "caveCrawler", rect: { x: 30, y: 374, w: 10, h: 11 }, count: 4 },
      { monster: "orcMiner", rect: { x: 40, y: 374, w: 14, h: 11 }, count: 5 },
      // The second floor: Orc Shamans in the first hall, Orc Guards in the second; the Orc Chieftain in his chamber.
      { monster: "orcShaman", rect: { x: 28, y: 398, w: 20, h: 14 }, count: 7 },
      { monster: "orcGuard", rect: { x: 12, y: 426, w: 26, h: 10 }, count: 7 },
      { monster: "orcChieftain", rect: { x: 58, y: 428, w: 6, h: 6 }, count: 1 },
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
