// Class skills: what each one does at each level, what it costs, and how it looks.
//
// Pure data shared by the server (which runs every cast) and the client (which
// draws the skill bar, the skills window and the effects). Skill ids are saved
// in the database, so never rename one; retire it instead.

import { skillPoints, type ClassId } from "./rpg";
import type { WeaponType } from "./items";

/**
 * strike: hits your target. burst: hits every monster around you.
 * rain: hits every monster around your target. self: on yourself (a heal or a buff).
 */
export type SkillKind = "strike" | "burst" | "rain" | "self";

/** How a cast looks; the client draws each one. */
export type SkillFx = "bash" | "whirl" | "guard" | "fire" | "nova" | "heal" | "arrows" | "rain" | "eagle";

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
  /** burst: monsters hit can't move or bite for this long. */
  freezeMs?: (lv: number) => number;
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
});

export type SkillId = keyof typeof SKILLS;
export const isSkillId = (id: unknown): id is SkillId => typeof id === "string" && Object.hasOwn(SKILLS, id);

/** A class's skills in skill-bar order (keys 1, 2, 3…). */
export const skillsOf = (cls: ClassId): SkillDef[] => Object.values(SKILLS).filter((s) => s.cls === cls);

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
    if (!isSkillId(id) || SKILLS[id].cls !== cls) continue;
    const n = Math.floor(Number(lv));
    if (n >= 1) out[id] = Math.min(SKILL_MAX, n);
  }
  return pointsLeft(cls, level, out) < 0 ? {} : out;
}
