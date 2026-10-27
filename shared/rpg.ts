// Leveling and fighting: classes, the EXP curve, monsters and where they live.
//
// Pure data and formulas, shared by the server (which runs every fight) and
// the client (which draws bars, names and reach). Balance lives here, so
// tuning a monster or raising the level cap is a one-line change.

import { TILE, TOWN_AREA, INTERIOR_ZONE, inRect, type Rect } from "./town";
import type { Bonus, ItemId } from "./items";

/** Highest level for now; raised step by step. The EXP curve already continues past it. */
export const LEVEL_CAP = 50;

/** EXP needed to go from `level` to the next one. Gentle early, steeper past ~30. */
export function expToNext(level: number): number {
  return Math.round(25 * Math.pow(level, 1.8) * (1 + Math.pow(level / 30, 2)));
}

// ---------------------------------------------------------------- classes

export type ClassId = "novice" | "knight" | "mage" | "archer";

export interface ClassDef {
  id: ClassId;
  name: string;
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
};

export const isClassId = (id: unknown): id is ClassId => typeof id === "string" && Object.hasOwn(CLASSES, id);

/** "a Knight", "an Archer". */
export const aClass = (cls: ClassId) => `${/^[AEIOU]/.test(CLASSES[cls].name) ? "an" : "a"} ${CLASSES[cls].name}`;

/** A Novice can choose a job from this level. */
export const JOB_LEVEL = 10;
/** What the Job Master offers, in his order. */
export const JOBS: ClassId[] = ["knight", "mage", "archer"];
/** The weapon each job starts with, a gift from the Job Master. */
export const JOB_WEAPON: Partial<Record<ClassId, ItemId>> = { knight: "squireSword", mage: "apprenticeStaff", archer: "huntingBow" };

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
  };
}

// ---------------------------------------------------------------- monsters

export type MonsterId = "slime" | "snake" | "hornet" | "snapper";

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
    drops: [["honey", 0.55], ["orangePotion", 0.03], ["kettleHelm", 0.006], ["legionArmor", 0.005], ["bronzeSword", 0.005], ["ironGreaves", 0.006], ["ironBoots", 0.006], ["stingerPendant", 0.003], ["hornetCard", 0.001]],
  },
  // Rooted, but it spits seeds at anyone who shoots it from afar.
  snapper: {
    id: "snapper", name: "Snapper Flower", level: 10, hp: 280, atk: 17, def: 5, exp: 240, gold: [18, 30], speed: 0, chase: 0, aggro: 110, range: 190, attackMs: 1600, radius: 22, respawnMs: 30_000,
    drops: [
      ["bloom", 0.6], ["orangePotion", 0.08], ["redPotion", 0.1], ["saber", 0.008], ["bronzeHelm", 0.008], ["guardShield", 0.01], ["plateArmor", 0.004],
      ["recurveBow", 0.006], ["gnarledStaff", 0.006], ["crystalStaff", 0.0015], ["meadowCrown", 0.0005], ["snapperCard", 0.0012],
    ],
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
