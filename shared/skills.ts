// Class skills: what each one does at each level, what it costs, and how it looks.
//
// Pure data shared by the server (which runs every cast) and the client (which
// draws the skill bar, the skills window and the effects). Skill ids are saved
// in the database, so never rename one; retire it instead.

import { CLASSES, skillPoints, type ClassId } from "./rpg";
import type { WeaponType } from "./items";

/**
 * strike: hits your target. burst: hits every monster around you.
 * rain: hits every monster around your target. self: on yourself (a heal or a buff).
 */
export type SkillKind = "strike" | "burst" | "rain" | "self";

/** How a cast looks; the client draws each one. */
export type SkillFx =
  | "bash"
  | "whirl"
  | "guard"
  | "fire"
  | "nova"
  | "heal"
  | "arrows"
  | "rain"
  | "eagle"
  | "pierce"
  | "brandish"
  | "berserk"
  | "meteor"
  | "gust"
  | "lightning"
  | "falcon"
  | "snare"
  | "sharp";

export interface SkillBuff {
  ms: number;
  /** Shares (0.3 = +30 %) of ATK and DEF, and extra critical chance (0..1). */
  atk?: (lv: number) => number;
  def?: (lv: number) => number;
  crit?: (lv: number) => number;
}

export interface SkillDef {
  id: string;
  name: string;
  cls: ClassId;
  kind: SkillKind;
  /** An icon from assets/items (Kyrise's pack). */
  icon: string;
  mp: (lv: number) => number;
  cooldownMs: number;
  /** strike and rain: how far the target may be (px, feet to feet, plus its size). Missing: your weapon's reach. */
  range?: number;
  /** burst and rain: radius in px. */
  radius?: number;
  /** Damage of each hit as a share of your ATK, and how many hits. Skills never miss. */
  power?: (lv: number) => number;
  hits?: number;
  /** Monsters hit can't move or bite for this long. */
  freezeMs?: (lv: number) => number;
  /** strike: every hit is a critical hit (1.5x, ignoring defence). */
  sureCrit?: boolean;
  /** self: share of max HP healed. */
  heal?: (lv: number) => number;
  buff?: SkillBuff;
  /** Only with this kind of weapon in hand. */
  weapon?: WeaponType;
  fx: SkillFx;
  /** What it does at a level, in one line. */
  effect: (lv: number) => string;
}

/** Highest level of every skill. */
export const SKILL_MAX = 10;
/** No two skills closer together than this, whatever their cooldowns. */
export const GLOBAL_COOLDOWN_MS = 700;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${+(ms / 1000).toFixed(1)} s`;

const def = <T extends Record<string, Omit<SkillDef, "id">>>(skills: T) =>
  Object.fromEntries(Object.entries(skills).map(([id, s]) => [id, { id, ...s }])) as { [K in keyof T]: SkillDef & { id: K } };

export const SKILLS = def({
  // ------------------------------------------------------------ Knight
  bash: {
    name: "Bash", cls: "knight", kind: "strike", icon: "sword_02e", fx: "bash",
    mp: (lv) => 5 + lv, cooldownMs: 3000,
    power: (lv) => 1.6 + 0.16 * lv,
    effect: (lv) => `A heavy blow: ${pct(1.6 + 0.16 * lv)} of your ATK.`,
  },
  whirlwind: {
    name: "Whirlwind", cls: "knight", kind: "burst", icon: "sword_03d", fx: "whirl",
    mp: (lv) => 12 + lv, cooldownMs: 8000, radius: 72,
    power: (lv) => 1 + 0.1 * lv,
    effect: (lv) => `Spin and hit every monster around you for ${pct(1 + 0.1 * lv)} of your ATK.`,
  },
  guard: {
    name: "Guard", cls: "knight", kind: "self", icon: "shield_02a", fx: "guard",
    mp: (lv) => 10 + lv, cooldownMs: 35_000,
    buff: { ms: 20_000, def: (lv) => 0.25 + 0.05 * lv },
    effect: (lv) => `DEF +${pct(0.25 + 0.05 * lv)} for 20 s.`,
  },

  // ------------------------------------------------------------ Mage
  firebolt: {
    name: "Fire Bolt", cls: "mage", kind: "strike", icon: "crystal_01g", fx: "fire",
    mp: (lv) => 8 + lv, cooldownMs: 2500, range: 220,
    power: (lv) => 1.7 + 0.2 * lv,
    effect: (lv) => `A bolt of fire for ${pct(1.7 + 0.2 * lv)} of your ATK, from up to 220 px away.`,
  },
  frostNova: {
    name: "Frost Nova", cls: "mage", kind: "burst", icon: "crystal_01c", fx: "nova",
    mp: (lv) => 16 + 2 * lv, cooldownMs: 12_000, radius: 110,
    power: (lv) => 0.8 + 0.08 * lv,
    freezeMs: (lv) => 1500 + 250 * lv,
    effect: (lv) => `Ice bursts around you: ${pct(0.8 + 0.08 * lv)} of your ATK, and monsters freeze for ${secs(1500 + 250 * lv)}.`,
  },
  heal: {
    name: "Heal", cls: "mage", kind: "self", icon: "crystal_01a", fx: "heal",
    mp: (lv) => 12 + 2 * lv, cooldownMs: 6000,
    heal: (lv) => 0.15 + 0.03 * lv,
    effect: (lv) => `Restores ${pct(0.15 + 0.03 * lv)} of your max HP.`,
  },

  // ------------------------------------------------------------ Archer
  doubleShot: {
    name: "Double Shot", cls: "archer", kind: "strike", icon: "arrow_01d", fx: "arrows", weapon: "bow",
    mp: (lv) => 6 + lv, cooldownMs: 3000, hits: 2,
    power: (lv) => 0.9 + 0.08 * lv,
    effect: (lv) => `Two arrows at once, each ${pct(0.9 + 0.08 * lv)} of your ATK.`,
  },
  arrowRain: {
    name: "Arrow Rain", cls: "archer", kind: "rain", icon: "arrow_03c", fx: "rain", weapon: "bow",
    mp: (lv) => 14 + 2 * lv, cooldownMs: 10_000, radius: 80,
    power: (lv) => 1 + 0.1 * lv,
    effect: (lv) => `Arrows fall on your target and every monster near it: ${pct(1 + 0.1 * lv)} of your ATK.`,
  },
  eagleEye: {
    name: "Eagle Eye", cls: "archer", kind: "self", icon: "arrow_03b", fx: "eagle",
    mp: (lv) => 12 + lv, cooldownMs: 40_000,
    buff: { ms: 20_000, atk: (lv) => 0.05 + 0.01 * lv, crit: (lv) => 0.1 + 0.02 * lv },
    effect: (lv) => `ATK +${pct(0.05 + 0.01 * lv)} and critical chance +${pct(0.1 + 0.02 * lv)} for 20 s.`,
  },

  // ------------------------------------------------------------ Lord Knight (keeps the Knight's three)
  spiralPierce: {
    name: "Spiral Pierce", cls: "lordKnight", kind: "strike", icon: "sword_01d", fx: "pierce",
    mp: (lv) => 18 + 2 * lv, cooldownMs: 7000, hits: 2,
    power: (lv) => 1.5 + 0.15 * lv,
    effect: (lv) => `Two twisting thrusts, each ${pct(1.5 + 0.15 * lv)} of your ATK.`,
  },
  brandish: {
    name: "Brandish", cls: "lordKnight", kind: "rain", icon: "sword_01a", fx: "brandish",
    mp: (lv) => 20 + 2 * lv, cooldownMs: 9000, radius: 70,
    power: (lv) => 1.5 + 0.14 * lv,
    effect: (lv) => `A wide sweep through your target and every monster next to it: ${pct(1.5 + 0.14 * lv)} of your ATK.`,
  },
  berserk: {
    name: "Berserk", cls: "lordKnight", kind: "self", icon: "gem_01d", fx: "berserk",
    mp: (lv) => 20 + 2 * lv, cooldownMs: 45_000,
    buff: { ms: 20_000, atk: (lv) => 0.15 + 0.025 * lv, crit: (lv) => 0.05 + 0.01 * lv },
    effect: (lv) => `ATK +${pct(0.15 + 0.025 * lv)} and critical chance +${pct(0.05 + 0.01 * lv)} for 20 s.`,
  },

  // ------------------------------------------------------------ Wizard (keeps the Mage's three)
  lightningBolt: {
    name: "Lightning Bolt", cls: "wizard", kind: "strike", icon: "spellbook_01d", fx: "lightning",
    mp: (lv) => 14 + 2 * lv, cooldownMs: 4000, range: 230,
    power: (lv) => 2.4 + 0.24 * lv,
    effect: (lv) => `Lightning strikes your target for ${pct(2.4 + 0.24 * lv)} of your ATK, from up to 230 px away.`,
  },
  meteorStorm: {
    name: "Meteor Storm", cls: "wizard", kind: "rain", icon: "spellbook_03d", fx: "meteor",
    mp: (lv) => 30 + 3 * lv, cooldownMs: 12_000, range: 220, radius: 100,
    power: (lv) => 1.3 + 0.14 * lv,
    effect: (lv) => `Meteors crash down on your target and every monster near it: ${pct(1.3 + 0.14 * lv)} of your ATK.`,
  },
  stormGust: {
    name: "Storm Gust", cls: "wizard", kind: "rain", icon: "spellbook_03c", fx: "gust",
    mp: (lv) => 34 + 3 * lv, cooldownMs: 16_000, range: 220, radius: 100,
    power: (lv) => 0.9 + 0.09 * lv,
    freezeMs: (lv) => 2000 + 200 * lv,
    effect: (lv) => `A blizzard round your target: ${pct(0.9 + 0.09 * lv)} of your ATK to every monster in it, frozen for ${secs(2000 + 200 * lv)}.`,
  },

  // ------------------------------------------------------------ Hunter (keeps the Archer's three)
  falconStrike: {
    name: "Falcon Strike", cls: "hunter", kind: "strike", icon: "arrow_01b", fx: "falcon",
    mp: (lv) => 16 + 2 * lv, cooldownMs: 5000, range: 240, hits: 3,
    power: (lv) => 0.8 + 0.08 * lv,
    effect: (lv) => `Your falcon dives at your target three times, each ${pct(0.8 + 0.08 * lv)} of your ATK, from up to 240 px away.`,
  },
  ankleSnare: {
    name: "Ankle Snare", cls: "hunter", kind: "strike", icon: "arrow_02a", fx: "snare",
    mp: (lv) => 12 + 2 * lv, cooldownMs: 12_000, range: 200,
    power: (lv) => 0.6 + 0.06 * lv,
    freezeMs: (lv) => 3000 + 300 * lv,
    effect: (lv) => `A snare on your target: ${pct(0.6 + 0.06 * lv)} of your ATK, and it's stuck for ${secs(3000 + 300 * lv)}.`,
  },
  sharpShooting: {
    name: "Sharp Shooting", cls: "hunter", kind: "strike", icon: "arrow_03e", fx: "sharp", weapon: "bow",
    mp: (lv) => 16 + 2 * lv, cooldownMs: 6000, sureCrit: true,
    power: (lv) => 1.6 + 0.16 * lv,
    effect: (lv) => `One perfect arrow: always a critical hit, ${pct(1.6 + 0.16 * lv)} of your ATK (1.5x, ignoring defence).`,
  },
});

export type SkillId = keyof typeof SKILLS;
export const isSkillId = (id: unknown): id is SkillId => typeof id === "string" && Object.hasOwn(SKILLS, id);

/** A class's skills in skill-bar order (keys 1, 2, 3…): a second job's come after its first job's. */
export const skillsOf = (cls: ClassId): SkillDef[] => {
  const from = CLASSES[cls].from;
  return Object.values(SKILLS).filter((s) => s.cls === cls || s.cls === from);
};

/** Whether a class has this skill (its own, or its first job's). */
export const hasSkill = (cls: ClassId, s: SkillDef) => s.cls === cls || s.cls === CLASSES[cls].from;

/** Learned skills and their levels. */
export type SkillLevels = Partial<Record<SkillId, number>>;

export const pointsSpent = (skills: SkillLevels) => Object.values(skills).reduce((a, b) => a + (b ?? 0), 0);

/** Skill points not spent yet. */
export const pointsLeft = (cls: ClassId, level: number, skills: SkillLevels) => skillPoints(cls, level) - pointsSpent(skills);

/** Saved skills, if they still make sense for this class and level (otherwise every point comes back). */
export function cleanSkills(cls: ClassId, level: number, raw: unknown): SkillLevels {
  if (!raw || typeof raw !== "object") return {};
  const out: SkillLevels = {};
  for (const [id, lv] of Object.entries(raw)) {
    if (!isSkillId(id) || !hasSkill(cls, SKILLS[id])) continue;
    const n = Math.floor(Number(lv));
    if (n >= 1) out[id] = Math.min(SKILL_MAX, n);
  }
  return pointsLeft(cls, level, out) < 0 ? {} : out;
}
