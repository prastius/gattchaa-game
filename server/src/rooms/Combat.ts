import type { MapSchema } from "@colyseus/schema";
import { TILE_SIZE, type World } from "../../../shared/world";
import { Dir, MONSTER_ID_PREFIX, type FxEvent, type StatsMessage } from "../../../shared/protocol";
import {
  CLASSES,
  FIELDS,
  JOBS,
  JOB_LEVEL,
  JOB_WEAPON,
  NEXT_JOBS,
  jobChain,
  jobLevel,
  LEVEL_CAP,
  aClass,
  MONSTERS,
  REGEN_RATE,
  SIT_REGEN,
  BOSS_WINDUP_MS,
  TOWN_REGEN,
  expFactor,
  expToNext,
  hitChance,
  inSafeZone,
  isClassId,
  reach,
  rollDamage,
  statsFor,
  type ClassId,
  type MonsterDef,
  type MonsterId,
  type Stats,
} from "../../../shared/rpg";
import {
  ITEMS,
  MAX_STACK,
  MAX_UPGRADE,
  PICKUP_RANGE,
  POTION_MS,
  RARITY,
  SLOT_NAMES,
  WEAPON_NAMES,
  canUpgrade,
  canWear,
  cardFits,
  itemName,
  sellPrice,
  upgradeCost,
  wearersText,
  withArticle,
  type BagMessage,
  type ItemDef,
  type ItemId,
  type ItemStack,
  type Slot,
} from "../../../shared/items";
import { MAX_PRICE, SHOP_WARES, goldText, isPrice, type ShopWare, type WarePick } from "../../../shared/vending";
import { GLOBAL_COOLDOWN_MS, SKILLS, SKILL_MAX, cleanSkills, hasSkill, pointsLeft, type SkillDef, type SkillId, type SkillLevels } from "../../../shared/skills";
import { TITLES, type TitleDef, type TitleId, type TitlesMessage } from "../../../shared/titles";
import {
  DUEL_ASK_COOLDOWN_MS,
  DUEL_ASK_MS,
  DUEL_ASK_RANGE,
  DUEL_COUNTDOWN_MS,
  DUEL_LEASH,
  DUEL_MS,
  PLAYER_RADIUS,
  PVP_DAMAGE,
  inArena,
  type DuelAskEvent,
  type DuelStartEvent,
} from "../../../shared/duels";
import { OUTLAW_MS, PVP_COMBAT_MS, PVP_RECOUNT_MS, bountyOf, pvpBlock, type PvpSide, type WantedRow } from "../../../shared/pvp";
import { PARTY_LEVEL_GAP, PARTY_SHARE_PX, partyShare } from "../../../shared/party";
import { CRYSTAL, GUARDIAN_POSTS } from "../../../shared/siege";
import { TRIAL_GROUND, TRIAL_SHADE_AT, inCastle } from "../../../shared/town";
import { TRIALS, TRIAL_MS, Trial, isTrial } from "../../../shared/trial";
import type { Progress } from "../db";
import { Monster, type Player } from "./WorldState";
import { Inventory, type GearAt } from "./Inventory";
import { TitleBook } from "./Titles";
import type { Drops } from "./Drops";

/** Spawn groups with a player this close (px) think; the rest sleep, so empty fields cost nothing. */
const WAKE_PX = 1600;
/** Monsters chase this far outside their home area, then give up and go home (field bosses further). */
const LEASH_PX = 6 * TILE_SIZE;
const BOSS_LEASH_PX = 14 * TILE_SIZE;
/** …and drop a target that gets this far away. */
const LOSE_PX = 12 * TILE_SIZE;
/** The server sees players a moment late; give hits this much slack (the client stops short of reach). */
const REACH_SLACK = 6;
/** Players and monsters only heal after this long without fighting. */
const COMBAT_MS = 5000;
const REGEN_MS = 1000;
const SAVE_MS = 30_000;
/** A monster that just noticed you waits this long before its first bite. */
const FIRST_BITE_MS = 600;
/** Out of combat, monsters heal this share of their max HP per second. */
const MOB_REGEN = 0.05;
/** A chasing monster stuck behind a tree for this long gives up. */
const STUCK_MS = 3000;
/** Rooted monsters (Snapper Flowers) spawn at least this far apart. */
const ROOTED_GAP_PX = 96;

/** Every spawn group of every field, numbered. */
const GROUPS = FIELDS.flatMap((f) => f.spawns);
/** …and the field each group lives in. */
const GROUP_FIELDS = FIELDS.flatMap((f) => f.spawns.map(() => f));

export interface CombatHooks {
  /** Something happened at (x, y): tell the players who can see it. */
  emit(x: number, y: number, ev: FxEvent): void;
  /** Tell one player only. */
  tell(id: string, ev: FxEvent): void;
  /** A player's own sheet changed. */
  sheet(id: string, sheet: StatsMessage): void;
  /** A player's bag or equipment changed. */
  bag(id: string, bag: BagMessage): void;
  /** A line in one player's chat ("Your bag is full."). */
  notice(id: string, text: string): void;
  save(id: string, progress: Progress): void;
  /** A monster is about to be removed from the state: take it out of every view first. */
  despawn(mob: Monster): void;
  levelUp(id: string, lv: number): void;
  /** Someone became a Knight, Mage or Archer. */
  jobChange(id: string, cls: ClassId): void;
  /** `owner`'s Shade is gone (see shared/trial.ts): they beat it, it beat them, or the time ran out. */
  trialOver(owner: string, how: "won" | "fell" | "time"): void;
  /** A field boss rose again (`field` is where), or fell (`by` did the most damage). */
  boss(def: MonsterDef, event: "rise" | "down", field: string, by?: string): void;
  /** Someone picked up something legendary, or a monster card: worth telling the town. */
  found(id: string, item: ItemDef): void;
  /** The Blacksmith took someone's gear to +`up` (`item` is its plain name). */
  upgraded(id: string, item: string, up: number): void;
  /** A player's titles changed (earned one, shown one, or got further along). */
  titles(id: string, msg: TitlesMessage): void;
  /** Someone earned a title (the room decides whether the town hears). */
  titleEarned(id: string, title: TitleDef): void;
  /** Someone reached the level cap: maybe a Pioneer (the room knows the accounts). */
  reachedCap(id: string, cap: number): void;
  /** `id` beat another player in the Wildlands, and it counts (`outlaw`: they were one, and paid `bounty`). */
  pvpWin(id: string, outlaw: boolean, bounty: number): void;
  /** `by` broke Crownhold's crystal (see shared/siege.ts): the castle is their guild's. */
  crystal(by: string): void;
  /** The guardian at this post fell: it's gone until someone hires another. */
  guardianDown(post: number): void;
  /** Someone challenged `to` to a duel. */
  duelAsk(to: string, ev: DuelAskEvent): void;
  /** A duel began (told to each duelist). */
  duelStart(id: string, ev: DuelStartEvent): void;
  /** A duel ended (`winner` undefined: a draw). The room settles the ranking and tells both. */
  duelEnded(d: { a: string; b: string; winner?: string; ranked: boolean; why: string }): void;
}

/** Two players fighting each other: one object, filed under both their ids. */
interface Duel {
  a: string;
  b: string;
  /** In the Arena's ring between signed-in players: counts for the ranking. */
  ranked: boolean;
  /** Fighting starts after the countdown; from `endsAt` it's a draw. */
  startsAt: number;
  endsAt: number;
}

interface Fighter {
  id: string;
  player: Player;
  /** Exact position, kept up to date by the room. */
  pos: { x: number; y: number };
  cls: ClassId;
  exp: number;
  mp: number;
  gold: number;
  inv: Inventory;
  /** Class, level and equipment together; recomputed whenever one changes. */
  stats: Stats;
  /** No potion before this. */
  potionAt: number;
  skills: SkillLevels;
  /** When each skill is ready again, and when any skill is (the global cooldown). */
  cooldowns: Map<SkillId, number>;
  gcdAt: number;
  /** Buffs running: the skill's level when cast, and when it wears off. */
  buffs: Map<SkillId, { lv: number; until: number }>;
  /** Signed in: progress goes to the database. */
  saved: boolean;
  target?: string;
  nextAttackAt: number;
  lastCombatAt: number;
  regenAt: number;
  /** Fractions of a point healed so far (small characters heal less than 1 per second). */
  hpAcc: number;
  mpAcc: number;
  /** Progress changed since the last save. */
  dirty: boolean;
  /** The owner's sheet needs resending. */
  sheetDirty: boolean;
  /** …and their bag. */
  bagDirty: boolean;
  /** Deeds and titles. */
  book: TitleBook;
  /** How far along the Trial of Mastery. */
  trial: Trial;
  titlesDirty: boolean;
  /** An Outlaw until then (0: not one). */
  outlawUntil: number;
  /** The last player to attack them in the Wildlands, and when. */
  pvpBy?: { id: string; at: number };
}

interface Mob {
  id: string;
  def: MonsterDef;
  group: number;
  /** Home area in pixels. */
  home: { x0: number; y0: number; x1: number; y1: number };
  state: Monster;
  /** Exact position; the state only carries whole pixels. */
  x: number;
  y: number;
  hp: number;
  target?: string;
  nextAttackAt: number;
  lastHitAt: number;
  regenAt: number;
  returning: boolean;
  wander?: { x: number; y: number };
  restUntil: number;
  stuckFor: number;
  /** Damage taken from each player, so the EXP is shared by who did the work. */
  damage: Map<string, number>;
  /** Frozen (Frost Nova) until then: no moving, no biting. */
  frozenUntil: number;
  /** A castle guardian: its post in GUARDIAN_POSTS (and no group: it never comes back by itself). */
  post?: number;
  /** A Shade on the Isle of Trials: the one player it fights (and only they can strike it), and when the time runs out. */
  owner?: string;
  until?: number;
  /** A field boss: when its next slam and blast may come, and the ones it's winding up. */
  slamAt?: number;
  blastAt?: number;
  windups?: { kind: "slam" | "blast"; x: number; y: number; r: number; power: number; at: number }[];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = ([a, b]: [number, number]) => a + Math.floor(Math.random() * (b - a + 1));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** A bow's or staff's reach, if one is in hand. */
const weaponRange = (inv: Inventory) => (inv.gear.weapon ? ITEMS[inv.gear.weapon.id].range : undefined);
const parse = (json: string | null | undefined): unknown => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};
const dirTo = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down);

/**
 * Fighting in the fields. The server decides everything: who is in reach,
 * every hit and miss, EXP and level-ups. Clients only say what they're
 * attacking and draw the results.
 */
export class Combat {
  private fighters = new Map<string, Fighter>();
  private mobs = new Map<string, Mob>();
  private respawns: { group: number; at: number }[] = [];
  private duels = new Map<string, Duel>();
  /** Open challenges by challenger: whom, and until when. */
  private asks = new Map<string, { to: string; until: number }>();
  private askedAt = new Map<string, number>();
  /** Outlaws who left the game, by name, and until when: coming back doesn't clear their name. */
  private outlaws = new Map<string, number>();
  /** Crownhold is under siege (set by the room's Siege), and the guild holding it ("" = nobody). */
  siege = false;
  castleGuild = "";
  /** Beaten in the siege and not up again yet: they get up at the castle's camp. */
  private siegeDowns = new Set<string>();
  /** "winner>loser" names, and when that last counted towards titles. */
  private beatenAt = new Map<string, number>();
  private nextId = 0;
  private saveAt = Date.now() + SAVE_MS;

  constructor(
    private world: World,
    private monsters: MapSchema<Monster>,
    private drops: Drops,
    private now: () => number,
    private hooks: CombatHooks,
  ) {
    GROUPS.forEach((g, i) => {
      for (let n = 0; n < g.count; n++) this.spawn(i);
    });
  }

  // ---------------------------------------------------------------- players

  /** A player entered the world with their saved progress (none for guests and new characters). */
  join(id: string, player: Player, pos: { x: number; y: number }, progress: Progress | undefined, saved: boolean) {
    const cls = isClassId(progress?.cls) ? progress.cls : "novice";
    const lv = Math.min(LEVEL_CAP, Math.max(1, Math.floor(progress?.lv ?? 1)));
    const inv = Inventory.load(progress?.bag, progress?.gear);
    // Gear the class can't use (saved before a rule changed) goes back in the bag.
    const worn = inv.gear.weapon && ITEMS[inv.gear.weapon.id];
    if (worn && !canWear(cls, worn)) inv.unequip("weapon");
    if (inv.gear.weapon && ITEMS[inv.gear.weapon.id].twoHanded) inv.unequip("offhand");
    const s = statsFor(cls, lv, inv.bonus(), weaponRange(inv));
    const book = TitleBook.load(progress?.deeds, progress?.titles);
    // Titles earned before titles existed (by level, say) are simply there, no fanfare.
    book.check(lv);
    const f: Fighter = {
      id,
      player,
      pos,
      cls,
      exp: lv >= LEVEL_CAP ? 0 : Math.max(0, Math.floor(progress?.exp ?? 0)),
      mp: Math.min(s.maxMp, progress?.mp ?? s.maxMp),
      gold: Math.max(0, Math.floor(progress?.gold ?? 0)),
      inv,
      stats: s,
      potionAt: 0,
      skills: cleanSkills(cls, lv, parse(progress?.skills)),
      cooldowns: new Map(),
      gcdAt: 0,
      buffs: new Map(),
      saved,
      nextAttackAt: 0,
      lastCombatAt: 0,
      regenAt: 0,
      hpAcc: 0,
      mpAcc: 0,
      dirty: false,
      sheetDirty: true,
      bagDirty: true,
      book,
      titlesDirty: true,
      // Already in their second job (a test command, or a rule change): nothing left to do.
      trial: isTrial(progress?.trial) && TRIALS[cls] ? progress.trial : Trial.None,
      outlawUntil: 0,
    };
    const outlaw = this.outlaws.get(player.name) ?? 0;
    this.outlaws.delete(player.name);
    if (outlaw > Date.now()) f.outlawUntil = outlaw;
    player.outlaw = f.outlawUntil > 0;
    player.lv = lv;
    player.cls = cls;
    player.mhp = s.maxHp;
    player.gear = inv.visible();
    player.aura = this.auraOf(f);
    player.title = book.shown;
    // Knocked out when they left: they're back in town now, fully healed.
    const hp = progress?.hp ?? s.maxHp;
    player.hp = hp > 0 ? Math.min(s.maxHp, hp) : s.maxHp;
    player.dead = false;
    this.fighters.set(id, f);
  }

  leave(id: string) {
    const f = this.fighters.get(id);
    if (!f) return;
    const duel = this.duels.get(id);
    if (duel) this.endDuel(duel, duel.a === id ? duel.b : duel.a, `${f.player.name} left`);
    const now = Date.now();
    // Leaving mid-fight in the Wildlands counts as being beaten by whoever attacked you last.
    const by = f.pvpBy && now - f.pvpBy.at < PVP_COMBAT_MS && !f.player.dead ? this.fighters.get(f.pvpBy.id) : undefined;
    if (by && by !== f && !by.player.dead) this.beaten(f, by);
    if (f.outlawUntil > now) this.outlaws.set(f.player.name, f.outlawUntil);
    this.siegeDowns.delete(id);
    this.asks.delete(id);
    this.askedAt.delete(id);
    for (const [from, ask] of this.asks) if (ask.to === id) this.asks.delete(from);
    this.removeShade(id);
    this.save(f);
    this.fighters.delete(id);
    this.drops.release(id);
    for (const mob of this.mobs.values()) {
      mob.damage.delete(id);
      if (mob.target === id) this.giveUp(mob);
    }
  }

  /** Saves one player now (before the same account enters from another window). */
  flush(id: string) {
    const f = this.fighters.get(id);
    if (f) this.save(f);
  }

  saveAll() {
    for (const f of this.fighters.values()) this.save(f);
  }

  /** Attack this monster (or player) whenever it's in reach ("" stops). */
  setTarget(id: string, mobId: string) {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return;
    const mob = this.mobs.get(mobId);
    const why = mob && this.strikeBlock(f, mob);
    if (!mobId) f.target = undefined;
    else if (why) this.fail(f, why);
    else if (mob || this.opponentId(f) === mobId || this.foe(f, mobId)) f.target = mobId;
    else {
      const g = this.fighters.get(mobId);
      if (g && g !== f) this.fail(f, pvpBlock(this.side(f), this.side(g), this.siege));
    }
  }

  /** Back on your feet in town: full health. Returns false if they weren't knocked out. */
  revive(id: string): boolean {
    const f = this.fighters.get(id);
    if (!f?.player.dead) return false;
    const s = f.stats;
    f.player.dead = false;
    f.player.hp = s.maxHp;
    f.mp = s.maxMp;
    f.lastCombatAt = 0;
    f.dirty = f.sheetDirty = true;
    this.save(f);
    return true;
  }

  /** Testing only: jump to a level. */
  cheatLevel(id: string, lv: number) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.exp = 0;
    this.setLevel(f, Math.min(LEVEL_CAP, Math.max(1, Math.floor(lv))), true);
  }

  /** Testing only: conjure items and gold. */
  cheatItem(id: string, item: ItemId, n: number, up?: number) {
    const f = this.fighters.get(id);
    if (!f) return;
    if (f.inv.add(item, Math.min(MAX_STACK, Math.max(1, Math.floor(n))), { up }) > 0) this.changed(f);
  }

  /** Testing only: back to Novice, then (from level 10) straight into a job, through every job before it. */
  cheatJob(id: string, cls: ClassId) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.cls = "novice";
    f.player.cls = "novice";
    f.skills = {};
    f.trial = Trial.None;
    f.buffs.clear();
    this.restat(f);
    f.dirty = true;
    if (cls === "novice") return;
    jobChain(cls).forEach((job, i) => {
      if (f.player.lv < jobLevel(job)) return;
      // Skipping the trial for each job after the first.
      if (i > 0) f.trial = Trial.Passed;
      this.changeJob(id, job);
    });
    if ((f.cls as ClassId) !== cls) this.hooks.notice(id, `Test command: you're ${aClass(f.cls)}. ${CLASSES[cls].name} needs level ${jobLevel(cls)}.`);
  }

  /** Testing only: jump to a step of the Trial of Mastery. */
  cheatTrial(id: string, trial: Trial) {
    const f = this.fighters.get(id);
    if (f) this.setTrial(f, trial);
  }

  cheatGold(id: string, gold: number) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.gold = Math.max(0, Math.floor(gold));
    f.dirty = f.sheetDirty = true;
  }

  // ---------------------------------------------------------------- the loop

  tick(dtMs: number) {
    const now = Date.now();
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      if (now < this.respawns[i].at) continue;
      const { group } = this.respawns[i];
      this.respawns.splice(i, 1);
      this.spawn(group, true);
    }

    const awake = GROUPS.map((g) => this.anyoneNear(g.rect, WAKE_PX));
    // Guardians only stir in a siege; a Shade is always after its owner, until its time runs out.
    for (const mob of [...this.mobs.values()]) {
      if (mob.owner !== undefined && now >= (mob.until ?? 0)) this.endShade(mob, "time");
      else if (mob.owner !== undefined || (mob.post === undefined ? awake[mob.group] : this.siege)) this.think(mob, dtMs, now);
    }
    for (const f of this.fighters.values()) {
      this.fight(f, now);
      this.regen(f, now);
      this.expireBuffs(f, now);
      if (f.player.outlaw && now >= f.outlawUntil) {
        f.player.outlaw = false;
        f.outlawUntil = 0;
        f.sheetDirty = true;
        this.hooks.notice(f.id, "You're no longer an Outlaw.");
      }
    }
    this.tickDuels(now);

    if (now >= this.saveAt) {
      this.saveAt = now + SAVE_MS;
      for (const f of this.fighters.values()) if (f.dirty) this.save(f);
      for (const [key, at] of this.beatenAt) if (now - at >= PVP_RECOUNT_MS) this.beatenAt.delete(key);
      for (const [name, until] of this.outlaws) if (now >= until) this.outlaws.delete(name);
    }
    for (const f of this.fighters.values()) {
      if (f.sheetDirty) {
        f.sheetDirty = false;
        this.hooks.sheet(f.id, this.sheet(f));
      }
      if (f.bagDirty) {
        f.bagDirty = false;
        this.hooks.bag(f.id, f.inv.message());
      }
      if (f.titlesDirty) {
        f.titlesDirty = false;
        this.hooks.titles(f.id, f.book.message(f.player.lv));
      }
    }
  }

  private anyoneNear(r: { x: number; y: number; w: number; h: number }, pad: number): boolean {
    const x0 = r.x * TILE_SIZE - pad;
    const y0 = r.y * TILE_SIZE - pad;
    const x1 = (r.x + r.w) * TILE_SIZE + pad;
    const y1 = (r.y + r.h) * TILE_SIZE + pad;
    for (const f of this.fighters.values()) {
      if (f.pos.x >= x0 && f.pos.x <= x1 && f.pos.y >= y0 && f.pos.y <= y1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- players hitting monsters

  private fight(f: Fighter, now: number) {
    if (!f.target || f.player.dead) return;
    if (!f.target.startsWith(MONSTER_ID_PREFIX)) return this.playerFight(f, now);
    const mob = this.mobs.get(f.target);
    if (!mob) {
      f.target = undefined;
      return;
    }
    if (now < f.nextAttackAt || inSafeZone(f.pos.x, f.pos.y)) return;
    const blocked = this.strikeBlock(f, mob);
    if (blocked) {
      // The siege ended, or their guild took the castle, while they were swinging.
      f.target = undefined;
      return this.fail(f, blocked);
    }
    const s = f.stats;
    if (dist(f.pos, mob) > reach(s.range, mob.def) + REACH_SLACK) return;

    f.nextAttackAt = now + s.attackMs;
    f.lastCombatAt = now;
    f.player.sit = false;
    f.player.dir = dirTo(mob.x - f.pos.x, mob.y - f.pos.y);
    this.provoke(mob, f, now);

    // Ghosts are hard to hit (skills always land).
    if (Math.random() >= hitChance(f.player.lv, mob.def.level) * (1 - (mob.def.flee ?? 0))) {
      this.hooks.emit(mob.x, mob.y, { k: "miss", a: f.id, t: mob.id });
      return;
    }
    const { damage, crit } = rollDamage(s.atk, mob.def.def, s.crit);
    this.hurt(mob, f, damage, crit ? { crit: 1 } : {});
  }

  /** Night Bat Cards: a share of every hit (not thorns) comes back as HP. */
  private drain(f: Fighter, dealt: number) {
    if (f.stats.drain <= 0 || f.player.dead || f.player.hp >= f.stats.maxHp) return;
    const healed = Math.min(Math.max(1, Math.round(dealt * f.stats.drain)), f.stats.maxHp - f.player.hp);
    f.player.hp += healed;
    f.dirty = true;
    this.hooks.emit(f.pos.x, f.pos.y, { k: "heal", t: f.id, d: healed });
  }

  /** `f` attacked it: even shy monsters fight back. */
  private provoke(mob: Mob, f: Fighter, now: number) {
    mob.lastHitAt = now;
    if (mob.target) return;
    if (mob.def.slam && (mob.slamAt ?? 0) < now) mob.slamAt = now + 2500;
    if (mob.def.blast && (mob.blastAt ?? 0) < now) mob.blastAt = now + 4000;
    mob.target = f.id;
    mob.returning = false;
    mob.nextAttackAt = Math.max(mob.nextAttackAt, now + FIRST_BITE_MS);
  }

  /** `f` deals damage to a monster (a hit, a skill, or thorns from a card); it may go down. */
  private hurt(mob: Mob, f: Fighter, damage: number, flags: { crit?: 1; thorn?: 1; skill?: SkillId }) {
    if (this.strikeBlock(f, mob)) return;
    const dealt = Math.min(damage, mob.hp);
    mob.damage.set(f.id, (mob.damage.get(f.id) ?? 0) + dealt);
    if (!flags.thorn) this.drain(f, dealt);
    mob.hp = Math.max(0, mob.hp - damage);
    mob.state.hp = mob.hp;
    this.hooks.emit(mob.x, mob.y, { k: "hit", a: f.id, t: mob.id, d: damage, ...flags });
    if (mob.hp > 0) return;
    if (mob.def.id === CRYSTAL) this.hooks.crystal(f.id);
    this.defeat(mob);
  }

  /** Why `f` may not strike this monster ("": they may). Only Shades, Crownhold's crystal and its guardians say no. */
  private strikeBlock(f: Fighter, mob: Mob): string {
    if (mob.owner !== undefined) return mob.owner === f.id ? "" : "That Shade is someone else's trial";
    const crystal = mob.def.id === CRYSTAL;
    if (!crystal && mob.post === undefined) return "";
    const what = crystal ? "the crystal" : "guardians";
    if (!this.siege) return `${crystal ? "The crystal" : "Guardians"} can only be struck during a siege`;
    if (!f.player.guild) return `Only guild members can strike ${what}`;
    if (f.player.guild === this.castleGuild) return crystal ? "Your guild holds the castle: defend the crystal!" : "That's your guild's guardian";
    return "";
  }

  /** A guardian's quarry: a member of another guild, inside the walls, during a siege. */
  private guardianFoe(f: Fighter): boolean {
    return this.siege && inCastle(f.pos.x, f.pos.y) && Boolean(f.player.guild) && f.player.guild !== this.castleGuild;
  }

  /** A siege starts or ends: the crystal is whole, and every guardian is healed and back at its post. */
  mendCastle() {
    for (const mob of this.mobs.values()) {
      if (mob.def.id !== CRYSTAL && mob.post === undefined) continue;
      mob.hp = mob.def.hp;
      mob.state.hp = mob.hp;
      mob.damage.clear();
      mob.target = undefined;
      mob.frozenUntil = 0;
      if (mob.post === undefined) continue;
      const at = this.postAt(mob.post);
      mob.returning = false;
      mob.x = at.x;
      mob.y = at.y;
      Object.assign(mob.state, { x: Math.round(at.x), y: Math.round(at.y), dir: GUARDIAN_POSTS[mob.post].dir, moving: false, ts: this.now() });
    }
  }

  /** The middle of a guardian's post, in pixels. */
  private postAt(post: number) {
    const p = GUARDIAN_POSTS[post];
    return { x: (p.x + 0.5) * TILE_SIZE, y: (p.y + 0.5) * TILE_SIZE };
  }

  /** A hired guardian takes up its post. */
  spawnGuardian(post: number) {
    const p = GUARDIAN_POSTS[post];
    const at = this.postAt(post);
    const id = this.addMob(MONSTERS[p.kind], -1, { x: p.x, y: p.y, w: 1, h: 1 }, at, post);
    this.mobs.get(id)!.state.dir = p.dir;
  }

  /** Every guardian leaves (the castle changed hands). */
  clearGuardians() {
    for (const mob of [...this.mobs.values()]) {
      if (mob.post === undefined) continue;
      this.hooks.despawn(mob.state);
      this.monsters.delete(mob.id);
      this.mobs.delete(mob.id);
      for (const f of this.fighters.values()) if (f.target === mob.id) f.target = undefined;
    }
  }

  /** Woke up after being beaten in the siege (once): they get up at the camp outside the castle gate, not in town. */
  wokeInSiege(id: string): boolean {
    return this.siegeDowns.delete(id);
  }

  /** The castle's daily tribute for a member of its guild. False (having said why) if their bag is too full. */
  giveTribute(id: string, gold: number, items: [ItemId, number][], slots: number): boolean {
    const f = this.fighters.get(id);
    if (!f) return false;
    if (f.inv.bag.filter((s) => !s).length < slots) {
      this.hooks.notice(id, `Make room in your bag first: the tribute needs ${slots} free slots.`);
      return false;
    }
    for (const [item, n] of items) f.inv.add(item, n);
    f.gold += gold;
    this.changed(f);
    this.traded(f);
    return true;
  }

  private defeat(mob: Mob) {
    // A Shade leaves nothing behind but a second job.
    if (mob.owner !== undefined) return this.endShade(mob, "won");
    this.hooks.emit(mob.x, mob.y, { k: "down", t: mob.id });
    const top = this.reward(mob);
    if (mob.def.boss) this.hooks.boss(mob.def, "down", GROUP_FIELDS[mob.group].name, top);
    // Each drop is rolled on its own; whoever did the most damage (and their party) gets first pick.
    const party = (top && this.fighters.get(top)?.player.party) || "";
    for (const [item, chance] of mob.def.drops) {
      if (Math.random() < chance) this.drops.spawn({ id: item, n: 1 }, mob.x, mob.y, { owner: top ?? "", party });
    }
    this.hooks.despawn(mob.state);
    this.monsters.delete(mob.id);
    this.mobs.delete(mob.id);
    if (mob.post !== undefined) this.hooks.guardianDown(mob.post);
    else this.respawns.push({ group: mob.group, at: Date.now() + mob.def.respawnMs });
    for (const f of this.fighters.values()) if (f.target === mob.id) f.target = undefined;
  }

  /** EXP goes to everyone who hurt it, by how much; the gold to whoever did the most (returned). */
  private reward(mob: Mob): string | undefined {
    let total = 0;
    for (const d of mob.damage.values()) total += d;
    if (total <= 0) return undefined;
    const earners: { f: Fighter; dmg: number }[] = [];
    for (const [id, dmg] of mob.damage) {
      const f = this.fighters.get(id);
      if (f && !f.player.dead) earners.push({ f, dmg });
    }
    const top = earners.reduce<{ f: Fighter; dmg: number } | undefined>((best, e) => (!best || e.dmg > best.dmg ? e : best), undefined);
    // EXP by damage, except that what a party earned is shared evenly by every
    // member close by (with a bonus each), as long as they're within a few levels.
    const shares = new Map<Fighter, number>();
    const add = (f: Fighter, exp: number) => shares.set(f, (shares.get(f) ?? 0) + exp);
    const byParty = new Map<string, number>();
    for (const { f, dmg } of earners) {
      if (f.player.party) byParty.set(f.player.party, (byParty.get(f.player.party) ?? 0) + dmg);
      else add(f, mob.def.exp * (dmg / total));
    }
    for (const [party, dmg] of byParty) {
      const near = [...this.fighters.values()].filter((g) => g.player.party === party && !g.player.dead && dist(g.pos, mob) <= PARTY_SHARE_PX);
      const lvs = near.map((g) => g.player.lv);
      if (near.length > 1 && Math.max(...lvs) - Math.min(...lvs) <= PARTY_LEVEL_GAP) {
        for (const g of near) add(g, partyShare(mob.def.exp * (dmg / total), near.length));
      } else {
        for (const e of earners) if (e.f.player.party === party) add(e.f, mob.def.exp * (e.dmg / total));
      }
    }
    if (top && !shares.has(top.f)) shares.set(top.f, 0);
    for (const [f, share] of shares) {
      const kills = f.book.deeds.kills;
      kills[mob.def.id] = (kills[mob.def.id] ?? 0) + 1;
      this.deed(f);
      const exp = this.gainExp(f, Math.floor(share * expFactor(f.player.lv, mob.def.level)));
      const gold = f === top?.f ? randInt(mob.def.gold) : 0;
      if (gold) {
        f.gold += gold;
        f.dirty = f.sheetDirty = true;
      }
      if (exp || gold) this.hooks.tell(f.id, { k: "gain", exp, gold });
    }
    return top?.f.id;
  }

  /** Returns the EXP actually gained (none at the level cap). */
  private gainExp(f: Fighter, amount: number): number {
    if (f.player.lv >= LEVEL_CAP || amount <= 0) return 0;
    f.exp += amount;
    let lv = f.player.lv;
    while (lv < LEVEL_CAP && f.exp >= expToNext(lv)) {
      f.exp -= expToNext(lv);
      lv++;
    }
    if (lv >= LEVEL_CAP) f.exp = 0;
    f.dirty = f.sheetDirty = true;
    if (lv !== f.player.lv) this.setLevel(f, lv, true);
    return amount;
  }

  /** New level: new max HP/MP, fully healed, and a burst of light for everyone nearby. */
  private setLevel(f: Fighter, lv: number, announce: boolean) {
    f.player.lv = lv;
    // Only a test jump down can leave more skills than points: then they all come back.
    if (pointsLeft(f.cls, lv, f.skills) < 0) f.skills = {};
    this.restat(f);
    f.player.hp = f.stats.maxHp;
    f.mp = f.stats.maxMp;
    f.dirty = true;
    if (announce) {
      this.hooks.emit(f.pos.x, f.pos.y, { k: "lvup", t: f.id, lv });
      this.hooks.levelUp(f.id, lv);
    }
    this.deed(f);
    if (lv >= LEVEL_CAP) this.hooks.reachedCap(f.id, LEVEL_CAP);
    this.save(f);
  }

  private regen(f: Fighter, now: number) {
    if (now < f.regenAt) return;
    f.regenAt = now + REGEN_MS;
    // No healing mid-duel: it would never end.
    if (f.player.dead || this.duels.has(f.id) || now - f.lastCombatAt < COMBAT_MS) return;
    const s = f.stats;
    const rate = (REGEN_RATE * REGEN_MS) / 1000 * (f.player.sit ? SIT_REGEN : 1) * (inSafeZone(f.pos.x, f.pos.y) ? TOWN_REGEN : 1);
    if (f.player.hp < s.maxHp) {
      f.hpAcc += s.maxHp * rate;
      const whole = Math.floor(f.hpAcc);
      f.hpAcc -= whole;
      if (whole) {
        f.player.hp = Math.min(s.maxHp, f.player.hp + whole);
        f.dirty = true;
      }
    } else f.hpAcc = 0;
    if (f.mp < s.maxMp) {
      f.mpAcc += s.maxMp * rate;
      const whole = Math.floor(f.mpAcc);
      f.mpAcc -= whole;
      if (whole) {
        f.mp = Math.min(s.maxMp, f.mp + whole);
        f.dirty = f.sheetDirty = true;
      }
    } else f.mpAcc = 0;
  }

  /** Down to 0 HP: knocked out until they go back to town (`loseExp` false: beaten by a player while not an Outlaw). */
  private knockOut(f: Fighter, loseExp = true) {
    // A monster got a duelist: the other one wins.
    const duel = this.duels.get(f.id);
    if (duel) this.endDuel(duel, duel.a === f.id ? duel.b : duel.a, `${f.player.name} fainted`);
    const p = f.player;
    p.dead = true;
    p.hp = 0;
    p.moving = false;
    p.sit = false;
    f.target = undefined;
    f.pvpBy = undefined;
    if (loseExp) f.exp = Math.max(0, f.exp - Math.floor(expToNext(p.lv) * CLASSES[f.cls].deathExpLoss));
    f.dirty = f.sheetDirty = true;
    for (const mob of this.mobs.values()) if (mob.target === f.id) this.giveUp(mob);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "down", t: f.id });
    const shade = this.shadeOf(f.id);
    if (shade) this.endShade(shade, "fell");
    this.save(f);
  }

  private sheet(f: Fighter): StatsMessage {
    const s = f.stats;
    const now = Date.now();
    return {
      cls: f.cls,
      lv: f.player.lv,
      exp: f.exp,
      mp: f.mp,
      mmp: s.maxMp,
      gold: f.gold,
      atk: s.atk,
      def: s.def,
      range: s.range,
      skills: f.skills,
      points: pointsLeft(f.cls, f.player.lv, f.skills),
      buffs: [...f.buffs].map(([id, b]) => ({ id, ms: Math.max(0, b.until - now) })),
      saved: f.saved,
      ...(f.player.outlaw && { outlaw: Math.max(0, f.outlawUntil - now) }),
      ...(f.trial !== Trial.None && { trial: f.trial }),
      ...(this.shadeOf(f.id) && { trialLeft: Math.max(0, (this.shadeOf(f.id)!.until ?? 0) - now) }),
    };
  }

  /** After a level, equipment or buff change: new totals, with HP and MP kept under the new maximums. */
  private restat(f: Fighter) {
    const st = statsFor(f.cls, f.player.lv, f.inv.bonus(), weaponRange(f.inv));
    for (const [id, b] of f.buffs) {
      const buff = SKILLS[id].buff;
      if (buff?.atk) st.atk = Math.round(st.atk * (1 + buff.atk(b.lv)));
      if (buff?.def) st.def = Math.round(st.def * (1 + buff.def(b.lv)));
      if (buff?.crit) st.crit += buff.crit(b.lv);
    }
    f.stats = st;
    f.player.mhp = f.stats.maxHp;
    f.player.hp = Math.min(f.player.hp, f.stats.maxHp);
    f.mp = Math.min(f.mp, f.stats.maxMp);
    f.player.gear = f.inv.visible();
    f.player.aura = this.auraOf(f);
    f.sheetDirty = true;
  }

  /** The shown title's aura, if it has one; otherwise the gear's. */
  private auraOf(f: Fighter): number {
    return f.book.aura() ?? f.inv.aura();
  }

  private save(f: Fighter) {
    f.dirty = false;
    if (!f.saved) return;
    const s = f.stats;
    const p = f.player;
    this.hooks.save(f.id, {
      cls: f.cls,
      lv: p.lv,
      exp: f.exp,
      hp: p.hp >= s.maxHp ? null : p.hp,
      mp: f.mp >= s.maxMp ? null : f.mp,
      gold: f.gold,
      ...f.inv.save(),
      skills: Object.keys(f.skills).length ? JSON.stringify(f.skills) : null,
      ...f.book.save(),
      trial: f.trial,
    });
  }

  // ---------------------------------------------------------------- items

  /** The bag changed: resend it, and save it with the next batch. */
  private changed(f: Fighter) {
    f.dirty = f.bagDirty = true;
  }

  /** Wear it, or drink it. */
  useItem(id: string, slot: number) {
    const f = this.fighters.get(id);
    const s = f?.inv.bag[slot];
    if (!f || !s || f.player.dead) return;
    const it = ITEMS[s.id];
    if (it.kind === "use") return this.drink(f, slot, it);
    if (it.kind !== "equip") return;
    if (f.player.lv < (it.lv ?? 1)) return this.hooks.notice(id, `You need to be level ${it.lv} to wear the ${it.name}.`);
    if (!canWear(f.cls, it)) return this.hooks.notice(id, `The ${it.name} is for ${wearersText(it).replace(" only", "")}: ${aClass(f.cls)} can't use it.`);
    const weapon = f.inv.gear.weapon && ITEMS[f.inv.gear.weapon.id];
    if (it.slot === "offhand" && weapon?.twoHanded) return this.hooks.notice(id, `You need both hands for your ${weapon.name}.`);
    // A bow needs both hands: the shield goes into the bag first.
    if (it.twoHanded && f.inv.gear.offhand && !f.inv.unequip("offhand")) return this.hooks.notice(id, "Your bag is full: no room to put your shield away.");
    f.inv.equip(slot);
    this.restat(f);
    this.changed(f);
  }

  private drink(f: Fighter, slot: number, it: ItemDef) {
    const now = Date.now();
    if (!it.heal || now < f.potionAt) return;
    if (f.player.lv < (it.lv ?? 1)) return this.hooks.notice(f.id, `You need to be level ${it.lv} to drink ${withArticle(it.name)}.`);
    if (this.duels.has(f.id)) return this.hooks.notice(f.id, "No potions in a duel!");
    if (f.player.hp >= f.stats.maxHp) return this.hooks.notice(f.id, "You're already at full health.");
    f.potionAt = now + POTION_MS;
    f.inv.take(slot, 1);
    const healed = Math.min(it.heal, f.stats.maxHp - f.player.hp);
    f.player.hp += healed;
    this.hooks.emit(f.pos.x, f.pos.y, { k: "heal", t: f.id, d: healed });
    this.changed(f);
  }

  unequip(id: string, slot: Slot) {
    const f = this.fighters.get(id);
    if (!f || f.player.dead || !f.inv.gear[slot]) return;
    if (!f.inv.unequip(slot)) return this.hooks.notice(id, "Your bag is full.");
    this.restat(f);
    this.changed(f);
  }

  /** Puts some of a bag slot on the ground at your feet, for anyone to take. */
  dropItem(id: string, slot: number, n: number) {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return;
    const taken = f.inv.take(slot, n);
    if (!taken) return;
    this.drops.spawn(taken, f.pos.x, f.pos.y);
    this.changed(f);
  }

  pickup(id: string, dropId: string) {
    const f = this.fighters.get(id);
    const d = this.drops.get(dropId);
    if (!f || !d || f.player.dead) return;
    // The client walks up first; allow for it being a step ahead of us.
    if (dist(f.pos, d) > PICKUP_RANGE + 2 * REACH_SLACK) return;
    if (d.owner && d.owner !== id && !(d.party && d.party === f.player.party)) return this.hooks.notice(id, "That's someone else's loot for a few more seconds.");
    const item = ITEMS[d.item as ItemId];
    if (!item) return this.drops.remove(dropId);
    const got = f.inv.add(item.id as ItemId, d.n, this.drops.extras(d));
    if (got <= 0) return this.hooks.notice(id, "Your bag is full. Sell or drop something first.");
    // Only news when it's fresh from a monster, not something a player put down.
    const news = this.drops.isLoot(dropId);
    if (got < d.n) d.n -= got;
    else this.drops.remove(dropId);
    this.hooks.tell(id, { k: "loot", item: item.id, n: got });
    this.changed(f);
    if (item.rarity === "common") return;
    // A good find is saved straight away.
    this.save(f);
    if (!news) return;
    // Fresh finds count toward titles (not cards passed from player to player).
    const deeds = f.book.deeds;
    if (item.kind === "card" && !deeds.cards.includes(item.id as ItemId)) deeds.cards.push(item.id as ItemId);
    if (item.rarity === "legendary") deeds.legendary++;
    this.deed(f);
    if (item.rarity === "legendary" || item.kind === "card") this.hooks.found(id, item);
    else if (item.rarity !== "uncommon") this.hooks.notice(id, `You found ${item.rarity === "epic" ? "an" : "a"} ${RARITY[item.rarity].name.toLowerCase()} item: ${item.name}!`);
  }

  /** Buys from a merchant (the room checked you're at their counter and they sell it). */
  buy(id: string, item: ItemId, n: number) {
    const f = this.fighters.get(id);
    const price = ITEMS[item].price ?? 0;
    const count = Math.min(MAX_STACK, Math.max(1, Math.floor(n) || 1));
    if (!f || f.player.dead || price <= 0) return;
    if (f.gold < price * count) return this.hooks.notice(id, "You don't have enough gold.");
    if (f.inv.room(item, count) < count) return this.hooks.notice(id, "Your bag is full.");
    f.gold -= price * count;
    f.inv.add(item, count);
    this.hooks.tell(id, { k: "loot", item, n: count });
    this.traded(f);
  }

  /** Sells some of one bag slot, or (slot -1) every piece of monster loot. Returns the gold earned. */
  sell(id: string, slot: number, n: number): number {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return 0;
    const one = slot >= 0 ? f.inv.bag[slot] : undefined;
    if (one?.cards) {
      this.hooks.notice(id, `The cards in your ${itemName(one)} would be lost, so the Outfitter won't buy it.`);
      return 0;
    }
    if (one?.up) {
      this.hooks.notice(id, `The Outfitter won't buy upgraded gear: your ${itemName(one)} is worth far more than he could pay.`);
      return 0;
    }
    let gold = 0;
    const slots = slot < 0 ? f.inv.bag.flatMap((s, i) => (s && ITEMS[s.id].kind === "loot" ? [i] : [])) : [slot];
    for (const i of slots) {
      const s = f.inv.bag[i];
      const price = s ? sellPrice(ITEMS[s.id]) : 0;
      if (!s || price <= 0) continue;
      const taken = f.inv.take(i, slot < 0 ? s.n : n);
      if (taken) gold += price * taken.n;
    }
    if (gold <= 0) {
      this.hooks.notice(id, slot < 0 ? "You have no monster loot to sell." : one && ITEMS[one.id].kind === "card" ? "Keep your cards: other adventurers will pay far more for them." : "The Outfitter won't buy that.");
      return 0;
    }
    f.gold += gold;
    this.hooks.tell(id, { k: "gain", exp: 0, gold });
    this.traded(f);
    return gold;
  }

  /** Everyone who's an Outlaw right now, the biggest bounty first (for Sable's board). */
  wanted(): WantedRow[] {
    const now = Date.now();
    return [...this.fighters.values()]
      .filter((f) => f.player.outlaw && f.outlawUntil > now)
      .map((f) => ({ name: f.player.name, lv: f.player.lv, bounty: bountyOf(f.gold), ms: f.outlawUntil - now }))
      .sort((a, b) => b.bounty - a.bounty || b.ms - a.ms);
  }

  /** Pays the ferry fare (the room checked you're with the captain). False if you can't sail now. */
  payFare(id: string, fare: number): boolean {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return false;
    if (this.duels.has(id)) {
      this.fail(f, "Finish your duel first.");
      return false;
    }
    if (f.gold < fare) {
      this.hooks.notice(id, `The crossing costs ${goldText(fare)} gold: you have ${goldText(f.gold)}.`);
      return false;
    }
    f.target = undefined;
    if (fare > 0) {
      f.gold -= fare;
      this.traded(f);
    }
    return true;
  }

  /** Pays for something the room takes gold for (founding a guild, a gift to its purse). False, having said why, if they can't. */
  spend(id: string, gold: number, what: string): boolean {
    const f = this.fighters.get(id);
    if (!f) return false;
    if (f.gold < gold) {
      this.hooks.notice(id, `${what} costs ${goldText(gold)} gold: you have ${goldText(f.gold)}.`);
      return false;
    }
    f.gold -= gold;
    this.traded(f);
    return true;
  }

  /** Gold changed hands: show it and save now. */
  private traded(f: Fighter) {
    this.changed(f);
    f.sheetDirty = true;
    this.save(f);
  }

  /** Puts a card from the bag into a piece of equipment (in the bag or worn), for good. */
  insertCard(id: string, cardSlot: number, at: GearAt) {
    const f = this.fighters.get(id);
    const card = f?.inv.bag[cardSlot];
    const target = f?.inv.gearAt(at);
    if (!f || !card || !target || f.player.dead) return;
    const c = ITEMS[card.id];
    const g = ITEMS[target.id];
    if (c.kind !== "card") return;
    if (!cardFits(c, g)) return this.hooks.notice(id, `The ${c.name} only goes into: ${(c.fits ?? []).map((s) => SLOT_NAMES[s]).join(", ")}.`);
    if (!f.inv.insert(cardSlot, at)) return this.hooks.notice(id, `The ${g.name} has no free card slot.`);
    if ("gear" in at) this.restat(f);
    this.hooks.notice(id, `The ${c.name} is now part of your ${itemName(target)}.`);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "card", t: f.id });
    this.traded(f);
  }

  /**
   * The Blacksmith upgrades a piece of equipment (the room checked you're at
   * the forge): one ingot and a fee per try. From +5 a try can fail, and then
   * the gear drops one level. It never breaks.
   */
  upgrade(id: string, at: GearAt, roll = Math.random()) {
    const f = this.fighters.get(id);
    const s = f?.inv.gearAt(at);
    if (!f || !s || f.player.dead) return;
    const it = ITEMS[s.id];
    if (!canUpgrade(it)) return this.hooks.notice(id, "Rings and amulets are too small to upgrade.");
    const from = s.up ?? 0;
    if (from >= MAX_UPGRADE) return this.hooks.notice(id, `Your ${itemName(s)} can't go any higher.`);
    const cost = upgradeCost(from + 1);
    if (f.gold < cost.gold) return this.hooks.notice(id, `Upgrading to +${from + 1} costs ${cost.gold} gold.`);
    if (!f.inv.spend(cost.ore)) return this.hooks.notice(id, `Upgrading to +${from + 1} needs ${withArticle(ITEMS[cost.ore].name)}.`);
    f.gold -= cost.gold;
    const ok = roll < cost.chance;
    const up = ok ? from + 1 : from - 1;
    if (up > 0) s.up = up;
    else delete s.up;
    if (ok) f.book.deeds.bestUp = Math.max(f.book.deeds.bestUp, up);
    else f.book.deeds.upFails++;
    if ("gear" in at) this.restat(f);
    this.hooks.notice(id, ok ? `Success! Your ${it.name} is now +${up}.` : `The upgrade failed: your ${it.name} went down to +${up}.`);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "forge", t: f.id, ok: ok ? 1 : 0, up, item: it.name });
    if (ok && up >= 9) this.hooks.upgraded(id, it.name, up);
    this.deed(f);
    this.traded(f);
  }

  // ---------------------------------------------------------------- duels

  /** Whether someone is in a duel (they can't open a shop meanwhile). */
  inDuel(id: string): boolean {
    return this.duels.has(id);
  }

  private opponentId(f: Fighter): string | undefined {
    const d = this.duels.get(f.id);
    return d && (d.a === f.id ? d.b : d.a);
  }

  /** The player `id`, if `f` may hit them now: their duel opponent once the countdown is over, or anyone fair game in the Wildlands. */
  private foe(f: Fighter, id: string | undefined): Fighter | undefined {
    if (!id || id.startsWith(MONSTER_ID_PREFIX)) return undefined;
    const d = this.duels.get(f.id);
    if (d) return id === this.opponentId(f) && Date.now() >= d.startsAt ? this.fighters.get(id) : undefined;
    const g = this.fighters.get(id);
    return g && g !== f && !pvpBlock(this.side(f), this.side(g), this.siege) ? g : undefined;
  }

  /** What the PVP rules need to know about someone. */
  private side(f: Fighter): PvpSide {
    return { x: f.pos.x, y: f.pos.y, lv: f.player.lv, dead: f.player.dead, duel: f.player.duel, party: f.player.party, guild: f.player.guild };
  }

  /** Ranked: both in the Arena's ring, and both signed in (the ranking is kept per account). */
  private rankable(f: Fighter, g: Fighter): boolean {
    return f.saved && g.saved && inArena(f.pos.x, f.pos.y) && inArena(g.pos.x, g.pos.y);
  }

  /** `id` challenges `to` (the room checked neither is minding a shop). */
  askDuel(id: string, to: string) {
    const f = this.fighters.get(id);
    const g = this.fighters.get(to);
    if (!f || !g || f === g || f.player.dead || g.player.dead) return;
    const now = Date.now();
    if (now < (this.askedAt.get(id) ?? 0) + DUEL_ASK_COOLDOWN_MS) return this.hooks.notice(id, "Wait a moment before challenging again.");
    if (this.duels.has(id)) return this.hooks.notice(id, "You're already in a duel.");
    if (this.duels.has(to)) return this.hooks.notice(id, `${g.player.name} is already in a duel.`);
    if (dist(f.pos, g.pos) > DUEL_ASK_RANGE) return this.hooks.notice(id, `Get closer to ${g.player.name} to challenge them.`);
    this.askedAt.set(id, now);
    this.asks.set(id, { to, until: now + DUEL_ASK_MS });
    const ranked = this.rankable(f, g);
    this.hooks.duelAsk(to, { from: id, name: f.player.name, lv: f.player.lv, cls: f.cls, ranked, ms: DUEL_ASK_MS });
    this.hooks.notice(id, `You challenged ${g.player.name} to a ${ranked ? "ranked " : ""}duel. Waiting for an answer…`);
  }

  /** `id` answers `from`'s challenge. */
  answerDuel(id: string, from: string, yes: boolean) {
    const ask = this.asks.get(from);
    const f = this.fighters.get(from);
    const g = this.fighters.get(id);
    if (!ask || ask.to !== id || !f || !g) return;
    this.asks.delete(from);
    if (Date.now() > ask.until) return this.hooks.notice(id, "That challenge has run out.");
    if (!yes) return this.hooks.notice(from, `${g.player.name} turned down your duel.`);
    if (f.player.dead || g.player.dead || this.duels.has(from) || this.duels.has(id) || dist(f.pos, g.pos) > DUEL_ASK_RANGE * 1.5) {
      for (const who of [f, g]) this.hooks.notice(who.id, "The duel can't start right now.");
      return;
    }
    this.startDuel(f, g);
  }

  private startDuel(f: Fighter, g: Fighter) {
    const now = Date.now();
    const d: Duel = { a: f.id, b: g.id, ranked: this.rankable(f, g), startsAt: now + DUEL_COUNTDOWN_MS, endsAt: now + DUEL_COUNTDOWN_MS + DUEL_MS };
    for (const [me, opp] of [[f, g], [g, f]] as const) {
      this.duels.set(me.id, d);
      this.asks.delete(me.id);
      me.player.duel = opp.id;
      me.player.sit = false;
      me.target = undefined;
      this.hooks.duelStart(me.id, { opp: opp.id, name: opp.player.name, ranked: d.ranked, countdown: DUEL_COUNTDOWN_MS, ms: DUEL_MS });
    }
    this.hooks.emit((f.pos.x + g.pos.x) / 2, (f.pos.y + g.pos.y) / 2, { k: "duel", a: f.id, b: g.id, ev: "start" });
  }

  /** Gives up your duel. */
  quitDuel(id: string) {
    const d = this.duels.get(id);
    const f = this.fighters.get(id);
    if (d && f) this.endDuel(d, d.a === id ? d.b : d.a, `${f.player.name} gave up`);
  }

  /** Auto-attacks on a player: your duel opponent (once the countdown is over), or anyone fair game in the Wildlands. */
  private playerFight(f: Fighter, now: number) {
    const g = this.foe(f, f.target);
    if (!g) {
      // A duel still counting down: wait. The duel is over, or they're out of bounds: stop.
      if (!this.duels.has(f.id)) f.target = undefined;
      return;
    }
    if (now < f.nextAttackAt) return;
    const s = f.stats;
    if (dist(f.pos, g.pos) > s.range + PLAYER_RADIUS + REACH_SLACK) return;
    f.nextAttackAt = now + s.attackMs;
    f.player.sit = false;
    f.player.dir = dirTo(g.pos.x - f.pos.x, g.pos.y - f.pos.y);
    this.aggress(f, g, now);
    // Grass Snake and Ghost Cards help against players too.
    if (Math.random() >= hitChance(f.player.lv, g.player.lv) * (1 - g.stats.flee)) {
      f.lastCombatAt = g.lastCombatAt = now;
      this.hooks.emit(g.pos.x, g.pos.y, { k: "miss", a: f.id, t: g.id });
      return;
    }
    const { damage, crit } = rollDamage(s.atk, g.stats.def, s.crit);
    this.hurtFoe(f, g, damage, crit ? { crit: 1 } : {});
  }

  /** One player hits another, for PVP_DAMAGE of the damage. Whoever drops to 0 HP loses the duel, or is beaten. */
  private hurtFoe(f: Fighter, g: Fighter, raw: number, flags: { crit?: 1; skill?: SkillId }) {
    const damage = Math.max(1, Math.round(raw * PVP_DAMAGE));
    const dealt = Math.min(damage, g.player.hp);
    g.player.hp -= dealt;
    g.dirty = true;
    f.lastCombatAt = g.lastCombatAt = Date.now();
    this.hooks.emit(g.pos.x, g.pos.y, { k: "hit", a: f.id, t: g.id, d: damage, ...flags });
    this.drain(f, dealt);
    if (g.player.hp > 0) return;
    const d = this.duels.get(f.id);
    if (d) this.endDuel(d, f.id, `${g.player.name} was beaten`);
    else this.beaten(g, f);
  }

  // ---------------------------------------------------------------- open PVP (the Wildlands)

  /** `f` attacks `g` in the Wildlands: unless `g` is an Outlaw, that makes `f` one (or keeps them one a while longer). */
  private aggress(f: Fighter, g: Fighter, now: number) {
    if (this.duels.has(f.id)) return;
    if (this.siegeFight(f, g)) {
      g.pvpBy = { id: f.id, at: now };
      return;
    }
    const fresh = g.pvpBy?.id !== f.id || now - g.pvpBy.at > PVP_COMBAT_MS;
    g.pvpBy = { id: f.id, at: now };
    if (!g.player.outlaw) {
      if (!f.player.outlaw) {
        this.hooks.notice(
          f.id,
          `You attacked ${g.player.name}, who isn't an Outlaw: now you are one, for ${OUTLAW_MS / 60_000} minutes. If someone beats you meanwhile, you lose EXP and a bounty from your gold.`,
        );
      }
      f.outlawUntil = now + OUTLAW_MS;
      f.player.outlaw = true;
      f.sheetDirty = true;
    }
    if (fresh) this.hooks.notice(g.id, `${f.player.name} is attacking you!${g.player.outlaw ? "" : " Fighting back won't make you an Outlaw."}`);
  }

  /** `f` beat `g` in the Wildlands. An Outlaw pays: EXP like any knock-out, and a bounty from their gold to `f`. */
  private beaten(g: Fighter, f: Fighter) {
    if (this.siegeFight(f, g)) {
      this.knockOut(g, false);
      this.siegeDowns.add(g.id);
      this.hooks.notice(f.id, `You beat ${g.player.name}!`);
      this.hooks.notice(g.id, `${f.player.name} beat you. In a siege you lose nothing: you'll get up at the camp outside the gate.`);
      return;
    }
    const now = Date.now();
    const outlaw = g.player.outlaw;
    const bounty = outlaw ? bountyOf(g.gold) : 0;
    // Paid for: their name is clean again.
    g.outlawUntil = 0;
    g.player.outlaw = false;
    if (bounty) {
      g.gold -= bounty;
      f.gold += bounty;
      g.sheetDirty = f.dirty = f.sheetDirty = true;
      this.hooks.tell(f.id, { k: "gain", exp: 0, gold: bounty });
    }
    this.knockOut(g, outlaw);
    // Beating the same player over and over only counts once in a while.
    const key = `${f.player.name}>${g.player.name}`;
    if (now - (this.beatenAt.get(key) ?? -Infinity) >= PVP_RECOUNT_MS) {
      this.beatenAt.set(key, now);
      f.book.deeds.pvpWins++;
      if (outlaw) f.book.deeds.bounties++;
      this.deed(f);
      this.hooks.pvpWin(f.id, outlaw, bounty);
    }
    const gold = bounty ? ` and a bounty of ${goldText(bounty)} gold` : "";
    this.hooks.notice(f.id, outlaw ? `You beat the Outlaw ${g.player.name}${bounty ? ` and claimed a bounty of ${goldText(bounty)} gold` : ""}!` : `You beat ${g.player.name}!`);
    this.hooks.notice(g.id, outlaw ? `${f.player.name} beat you. As an Outlaw, you lost EXP${gold}.` : `${f.player.name} beat you. You lost nothing, as you weren't an Outlaw.`);
    this.save(f);
  }

  /** Both inside Crownhold's walls during a siege: the siege's rules, not the Wildlands'. */
  private siegeFight(f: Fighter, g: Fighter): boolean {
    return this.siege && inCastle(f.pos.x, f.pos.y) && inCastle(g.pos.x, g.pos.y);
  }

  /** Over: both healed (unless a monster knocked one out), deeds counted, and the room settles the rest. */
  private endDuel(d: Duel, winner: string | undefined, why: string) {
    if (this.duels.get(d.a) !== d) return;
    this.duels.delete(d.a);
    this.duels.delete(d.b);
    for (const id of [d.a, d.b]) {
      const f = this.fighters.get(id);
      if (!f) continue;
      f.player.duel = "";
      if (f.target === d.a || f.target === d.b) f.target = undefined;
      if (!f.player.dead) {
        f.player.hp = f.stats.maxHp;
        f.mp = f.stats.maxMp;
      }
      f.lastCombatAt = 0;
      f.sheetDirty = true;
      const deeds = f.book.deeds;
      deeds.duels++;
      if (winner === id) {
        deeds.duelWins++;
        if (d.ranked) deeds.arenaWins++;
      }
      this.deed(f);
    }
    const at = this.fighters.get(winner ?? d.a) ?? this.fighters.get(d.b);
    if (at) this.hooks.emit(at.pos.x, at.pos.y, { k: "duel", a: d.a, b: d.b, ev: "end", ...(winner && { w: winner }) });
    this.hooks.duelEnded({ a: d.a, b: d.b, winner, ranked: d.ranked, why });
  }

  /** Time limits, wandering apart, stepping out of the ring in a ranked duel; old challenges lapse. */
  private tickDuels(now: number) {
    for (const [id, ask] of this.asks) if (now > ask.until) this.asks.delete(id);
    for (const d of new Set(this.duels.values())) {
      const a = this.fighters.get(d.a);
      const b = this.fighters.get(d.b);
      if (!a || !b) continue;
      const out = d.ranked ? [a, b].find((f) => !inArena(f.pos.x, f.pos.y)) : undefined;
      if (now >= d.endsAt) this.endDuel(d, undefined, "Time's up");
      else if (dist(a.pos, b.pos) > DUEL_LEASH) this.endDuel(d, undefined, "You were too far apart");
      else if (out) this.endDuel(d, out === a ? b.id : a.id, `${out.player.name} left the ring`);
    }
  }

  // ---------------------------------------------------------------- titles

  /** Deeds changed: send the progress, and hand out any titles just earned. */
  private deed(f: Fighter) {
    f.dirty = f.titlesDirty = true;
    const fresh = f.book.check(f.player.lv);
    for (const t of fresh) this.earnedTitle(f, t);
  }

  private earnedTitle(f: Fighter, id: TitleId) {
    const t = TITLES[id] as TitleDef;
    f.titlesDirty = true;
    this.hooks.notice(f.id, `You earned the title "${t.name}"! Show it under your name from your titles (T).`);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "title", t: f.id, title: id });
    this.hooks.titleEarned(f.id, t);
    this.save(f);
  }

  /** Gives a title outright (Pioneer: the room checked the places left). */
  grantTitle(id: string, title: TitleId) {
    const f = this.fighters.get(id);
    if (f && f.book.grant(title)) this.earnedTitle(f, title);
  }

  /** Shows an earned title under your name ("" for none). */
  showTitle(id: string, title: TitleId | "") {
    const f = this.fighters.get(id);
    if (!f || !f.book.show(title)) return;
    f.player.title = title;
    f.player.aura = this.auraOf(f);
    f.dirty = f.titlesDirty = true;
    this.save(f);
  }

  /** Gave gold to their guild's purse. */
  gaveToGuild(id: string, gold: number) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.book.deeds.given += gold;
    this.deed(f);
  }

  /** Opened a shop in the Market Square. */
  shopOpened(id: string) {
    const f = this.fighters.get(id);
    if (!f || f.book.deeds.shop) return;
    f.book.deeds.shop = true;
    this.deed(f);
  }

  // ---------------------------------------------------------------- player shops

  /**
   * Takes the things picked for a shop out of the bag (the room checked the
   * shop may open here). Returns the shop's stock, or why it can't.
   */
  stockShop(id: string, picks: WarePick[]): ShopWare[] | string {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return "You can't open a shop right now.";
    if (picks.length > SHOP_WARES) return `A shop holds up to ${SHOP_WARES} different things.`;
    const seen = new Set<number>();
    for (const p of picks) {
      const s = f.inv.bag[p.slot];
      if (!s || seen.has(p.slot)) return "Something you picked isn't in your bag any more. Please pick again.";
      if (!(Number.isInteger(p.n) && p.n >= 1 && p.n <= s.n)) return `You only have ${s.n} ${ITEMS[s.id].name}.`;
      if (!isPrice(p.price)) return `Prices go from 1 to ${goldText(MAX_PRICE)} gold.`;
      seen.add(p.slot);
    }
    const wares = picks.map((p) => ({ item: f.inv.take(p.slot, p.n)!, price: p.price, sold: 0 }));
    if (wares.length) this.traded(f);
    return wares;
  }

  /** Puts a shop's stock back in the bag: it couldn't open after all. */
  unstock(id: string, wares: ShopWare[]) {
    const f = this.fighters.get(id);
    if (!f || !wares.length) return;
    for (const w of wares) f.inv.add(w.item.id, w.item.n, w.item);
    this.traded(f);
  }

  /** Whether someone can pay for something from a player's shop and carry it. If not, they're told why. */
  canBuy(id: string, item: ItemStack, gold: number): boolean {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return false;
    if (f.gold < gold) this.hooks.notice(id, `That costs ${goldText(gold)} gold: you have ${goldText(f.gold)}.`);
    else if (f.inv.room(item.id, item.n) < item.n) this.hooks.notice(id, "Your bag is full. Make room first.");
    else return true;
    return false;
  }

  /** Bought from a player's shop (the room settled it with the shop): the gold out, the item in. */
  bought(id: string, item: ItemStack, gold: number) {
    const f = this.fighters.get(id);
    if (!f) return;
    f.gold -= gold;
    f.inv.add(item.id, item.n, item);
    this.hooks.tell(id, { k: "loot", item: item.id, n: item.n });
    this.traded(f);
  }

  /**
   * Mail: gold from a sale in your shop, or something it didn't sell. False
   * when the item doesn't fit in the bag (it waits). Save with flush() after.
   */
  receive(id: string, m: { gold: number; item: ItemStack | null }): boolean {
    const f = this.fighters.get(id);
    if (!f) return false;
    if (m.item && f.inv.room(m.item.id, m.item.n) < m.item.n) return false;
    if (m.item) {
      f.inv.add(m.item.id, m.item.n, m.item);
      this.hooks.tell(id, { k: "loot", item: m.item.id, n: m.item.n });
    }
    if (m.gold > 0) {
      f.gold += m.gold;
      f.book.deeds.sold += m.gold;
      this.hooks.tell(id, { k: "gain", exp: 0, gold: m.gold });
      this.deed(f);
    }
    this.changed(f);
    f.sheetDirty = true;
    return true;
  }

  // ---------------------------------------------------------------- the Trial of Mastery (see shared/trial.ts)

  /** How far along the trial they are. */
  trial(id: string): Trial {
    return this.fighters.get(id)?.trial ?? Trial.None;
  }

  private setTrial(f: Fighter, trial: Trial) {
    f.trial = trial;
    f.dirty = f.sheetDirty = true;
    this.save(f);
  }

  /** Orin tells a first job of level 45 (or a second job of level 75) what to bring. False (having said why) if he can't yet. */
  askTrial(id: string): boolean {
    const f = this.fighters.get(id);
    const trial = f && TRIALS[f.cls];
    if (!f || !trial || f.player.dead || f.trial !== Trial.None) return false;
    if (f.player.lv < trial.ask) {
      this.hooks.notice(id, `Come back at level ${trial.ask}.`);
      return false;
    }
    this.setTrial(f, Trial.Asked);
    return true;
  }

  /** Hands Orin the proof (from Frostfell, or Ashpeak), all of it at once. False (having said why) if something's missing. */
  proveTrial(id: string): boolean {
    const f = this.fighters.get(id);
    const proof = f && TRIALS[f.cls]?.proof;
    if (!f || !proof || f.player.dead || f.trial !== Trial.Asked) return false;
    const missing = proof.filter(([item, n]) => f.inv.count(item) < n);
    if (missing.length) {
      this.hooks.notice(id, `You still need ${missing.map(([item, n]) => `${n - f.inv.count(item)} more ${ITEMS[item].name}`).join(" and ")}.`);
      return false;
    }
    for (const [item, n] of proof) {
      let left = n;
      for (let slot = 0; slot < f.inv.bag.length && left > 0; slot++) {
        if (f.inv.bag[slot]?.id === item) left -= f.inv.take(slot, left)?.n ?? 0;
      }
    }
    this.changed(f);
    this.setTrial(f, Trial.Proven);
    return true;
  }

  /** Their Shade, while it's up. */
  private shadeOf(owner: string): Mob | undefined {
    for (const mob of this.mobs.values()) if (mob.owner === owner) return mob;
    return undefined;
  }

  hasShade(owner: string): boolean {
    return Boolean(this.shadeOf(owner));
  }

  /** Raises `kind` in the trial circle, for `owner` only; the clock starts now. False if they already have one. */
  raiseShade(owner: string, kind: MonsterId): boolean {
    const f = this.fighters.get(owner);
    if (!f || f.player.dead || this.shadeOf(owner)) return false;
    const id = this.addMob(MONSTERS[kind], -1, TRIAL_GROUND, TRIAL_SHADE_AT);
    const mob = this.mobs.get(id)!;
    mob.owner = owner;
    mob.until = Date.now() + TRIAL_MS;
    mob.target = owner;
    mob.nextAttackAt = Date.now() + 1500;
    f.sheetDirty = true;
    return true;
  }

  /** Their Shade goes, without a word (they gave up, or left the game). */
  removeShade(owner: string) {
    const mob = this.shadeOf(owner);
    if (mob) this.dropShade(mob);
  }

  private dropShade(mob: Mob) {
    this.hooks.despawn(mob.state);
    this.monsters.delete(mob.id);
    this.mobs.delete(mob.id);
    for (const f of this.fighters.values()) if (f.target === mob.id) f.target = undefined;
    const owner = mob.owner && this.fighters.get(mob.owner);
    if (owner) owner.sheetDirty = true;
  }

  /** The trial is over: beaten (they passed), fallen, or out of time. */
  private endShade(mob: Mob, how: "won" | "fell" | "time") {
    this.hooks.emit(mob.x, mob.y, { k: "down", t: mob.id });
    this.dropShade(mob);
    const f = mob.owner && this.fighters.get(mob.owner);
    if (!f) return;
    if (how === "won") this.setTrial(f, Trial.Passed);
    this.hooks.trialOver(f.id, how);
  }

  // ---------------------------------------------------------------- jobs and skills

  /**
   * Novice -> Knight, Mage or Archer, for good (the room checked you're with
   * the Job Master): the class's stats, its weapon, and a first skill point.
   * From level 50 a first job goes on to its second job, and from 80 a second job to its third (`nextJob`).
   */
  changeJob(id: string, cls: ClassId) {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return;
    if (NEXT_JOBS[f.cls] === cls) return this.nextJob(f, cls);
    if (!JOBS.includes(cls)) return;
    if (f.cls !== "novice") return this.hooks.notice(id, `You're already ${aClass(f.cls)}.`);
    if (f.player.lv < JOB_LEVEL) return this.hooks.notice(id, `Come back at level ${JOB_LEVEL}.`);

    // The gift is worn straight away, unless you hold a weapon the new job can still use.
    const gift = JOB_WEAPON[cls];
    const giftDef = gift && ITEMS[gift];
    const worn = f.inv.gear.weapon && ITEMS[f.inv.gear.weapon.id];
    const wearGift = Boolean(giftDef) && !(worn && canWear(cls, worn));
    const toBag = (wearGift ? (worn ? 1 : 0) + (giftDef?.twoHanded && f.inv.gear.offhand ? 1 : 0) : giftDef ? 1 : 0);
    if (f.inv.bag.filter((s) => !s).length < toBag) {
      return this.hooks.notice(id, `Make room in your bag first: you need ${toBag} free slot${toBag === 1 ? "" : "s"}.`);
    }
    if (gift && wearGift) {
      if (worn) f.inv.unequip("weapon");
      if (giftDef?.twoHanded) f.inv.unequip("offhand");
      f.inv.gear.weapon = { id: gift, n: 1 };
    } else if (gift) f.inv.add(gift, 1);

    f.cls = cls;
    f.player.cls = cls;
    f.skills = {};
    f.buffs.clear();
    f.cooldowns.clear();
    this.restat(f);
    f.player.hp = f.stats.maxHp;
    f.mp = f.stats.maxMp;
    this.changed(f);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "job", t: f.id, cls });
    this.hooks.jobChange(id, cls);
    if (giftDef) this.hooks.tell(id, { k: "loot", item: giftDef.id, n: 1 });
    this.save(f);
  }

  /**
   * Knight -> Lord Knight -> Paladin, Mage -> Wizard -> Archmage, Archer -> Hunter -> Ranger:
   * better stats, three more skills (keys 4 to 6, then 7 to 9), and everything learned so far is kept.
   */
  private nextJob(f: Fighter, cls: ClassId) {
    if (f.player.lv < jobLevel(cls)) return this.hooks.notice(f.id, `Come back at level ${jobLevel(cls)}.`);
    if (f.trial !== Trial.Passed) return this.hooks.notice(f.id, "Pass the Trial of Mastery first: ask Orin about it.");
    f.trial = Trial.None;
    f.cls = cls;
    f.player.cls = cls;
    this.restat(f);
    f.player.hp = f.stats.maxHp;
    f.mp = f.stats.maxMp;
    this.changed(f);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "job", t: f.id, cls });
    this.hooks.jobChange(f.id, cls);
    this.save(f);
  }

  /** Spends a skill point. */
  learnSkill(id: string, skill: SkillId) {
    const f = this.fighters.get(id);
    const s = SKILLS[skill];
    if (!f || !hasSkill(f.cls, s)) return;
    const lv = f.skills[skill] ?? 0;
    if (lv >= SKILL_MAX) return;
    if (pointsLeft(f.cls, f.player.lv, f.skills) <= 0) return this.hooks.notice(id, "No skill points left. You get one every level.");
    f.skills[skill] = lv + 1;
    f.dirty = f.sheetDirty = true;
    this.save(f);
  }

  /** Uses a skill: on `targetId` (or your target) for the ones aimed at a monster. */
  useSkill(id: string, skill: SkillId, targetId?: string) {
    const f = this.fighters.get(id);
    const s = SKILLS[skill];
    if (!f || f.player.dead || !hasSkill(f.cls, s)) return;
    const lv = f.skills[skill] ?? 0;
    if (lv < 1) return this.fail(f, `Learn ${s.name} first (K)`);
    const now = Date.now();
    // Too soon: the client shows the cooldowns, so this is only key mashing.
    if (now < f.gcdAt || now < (f.cooldowns.get(skill) ?? 0)) return;
    const weapon = f.inv.gear.weapon && ITEMS[f.inv.gear.weapon.id];
    if (s.weapon && weapon?.weapon !== s.weapon) return this.fail(f, `${s.name} needs a ${WEAPON_NAMES[s.weapon]}`);
    const attack = s.kind !== "self";
    const duel = this.duels.get(f.id);
    if (attack && inSafeZone(f.pos.x, f.pos.y) && !duel) return this.fail(f, "No fighting in town");
    if (attack && duel && now < duel.startsAt) return this.fail(f, "Wait for the countdown");
    let mob: Mob | undefined;
    // Aimed at your duel opponent instead of a monster.
    let foe: Fighter | undefined;
    if (s.kind === "strike" || s.kind === "rain") {
      const aim = targetId || f.target || "";
      foe = this.foe(f, aim);
      mob = foe ? undefined : this.mobs.get(aim);
      const blocked = mob && this.strikeBlock(f, mob);
      if (blocked) return this.fail(f, blocked);
      const to = foe ? { ...foe.pos, radius: PLAYER_RADIUS } : mob && { x: mob.x, y: mob.y, radius: mob.def.radius };
      if (!to) return this.fail(f, "No target");
      if (dist(f.pos, to) > (s.range ?? f.stats.range) + to.radius + REACH_SLACK) return this.fail(f, "Too far away");
    }
    const mp = s.mp(lv);
    if (f.mp < mp) return this.fail(f, "Not enough MP");
    if (s.heal && !s.buff && f.player.hp >= f.stats.maxHp) return this.fail(f, "Already at full health");

    f.mp -= mp;
    f.dirty = f.sheetDirty = true;
    f.gcdAt = now + GLOBAL_COOLDOWN_MS;
    f.cooldowns.set(skill, now + s.cooldownMs);
    f.player.sit = false;
    if (attack) f.lastCombatAt = now;
    const aimed = mob ? { id: mob.id, x: mob.x, y: mob.y } : foe && { id: foe.id, ...foe.pos };
    if (aimed) {
      f.target = aimed.id;
      f.player.dir = dirTo(aimed.x - f.pos.x, aimed.y - f.pos.y);
    }
    this.hooks.emit(f.pos.x, f.pos.y, { k: "cast", a: f.id, s: skill, ...(aimed && { t: aimed.id }) });

    if (s.kind === "strike" && mob) {
      for (let i = 0; i < (s.hits ?? 1) && this.mobs.has(mob.id); i++) this.skillHit(f, mob, s, lv, now);
      if (s.freezeMs && this.mobs.has(mob.id)) this.freeze(mob, s.freezeMs(lv), now);
    } else if (s.kind === "strike" && foe) {
      for (let i = 0; i < (s.hits ?? 1); i++) this.foeSkillHit(f, foe, s, lv, Boolean(duel));
    } else if (s.kind === "burst" || s.kind === "rain") {
      const at = aimed ?? f.pos;
      // Your duel opponent, or the player you're fighting, is hit too if in the blast (but never frozen). Nobody else is.
      const opp = this.foe(f, this.opponentId(f) ?? f.target);
      if (opp && dist(at, opp.pos) <= (s.radius ?? 0) + PLAYER_RADIUS) this.foeSkillHit(f, opp, s, lv, Boolean(duel));
      for (const m of [...this.mobs.values()]) {
        if (dist(at, m) > (s.radius ?? 0) + m.def.radius || this.strikeBlock(f, m)) continue;
        this.skillHit(f, m, s, lv, now);
        if (s.freezeMs && this.mobs.has(m.id)) this.freeze(m, s.freezeMs(lv), now);
      }
    } else {
      if (s.heal) {
        const healed = Math.min(Math.round(f.stats.maxHp * s.heal(lv)), f.stats.maxHp - f.player.hp);
        f.player.hp += healed;
        this.hooks.emit(f.pos.x, f.pos.y, { k: "heal", t: f.id, d: healed });
      }
      if (s.buff) {
        f.buffs.set(skill, { lv, until: now + s.buff.ms });
        this.restat(f);
      }
    }
  }

  /** A monster can't move or bite for `ms` (Frost Nova, Storm Gust, Ankle Snare). */
  private freeze(mob: Mob, ms: number, now: number) {
    mob.frozenUntil = now + ms;
    this.halt(mob);
    this.hooks.emit(mob.x, mob.y, { k: "freeze", t: mob.id, ms });
  }

  /** One hit of a skill: skills never miss, and every monster they touch fights back. */
  private skillHit(f: Fighter, mob: Mob, s: SkillDef, lv: number, now: number) {
    this.provoke(mob, f, now);
    const { damage, crit } = rollDamage(Math.round(f.stats.atk * (s.power?.(lv) ?? 1)), mob.def.def, s.sureCrit ? 1 : f.stats.crit);
    this.hurt(mob, f, damage, { ...(crit && { crit: 1 as const }), skill: s.id as SkillId });
  }

  /** One hit of a skill on a player (unless an earlier hit already won the duel, or beat them). */
  private foeSkillHit(f: Fighter, g: Fighter, s: SkillDef, lv: number, duel: boolean) {
    if (duel ? !this.duels.has(f.id) : this.foe(f, g.id) !== g) return;
    this.aggress(f, g, Date.now());
    const { damage, crit } = rollDamage(Math.round(f.stats.atk * (s.power?.(lv) ?? 1)), g.stats.def, s.sureCrit ? 1 : f.stats.crit);
    this.hurtFoe(f, g, damage, { ...(crit && { crit: 1 as const }), skill: s.id as SkillId });
  }

  /** Why a skill didn't go off, floated over your head. */
  private fail(f: Fighter, why: string) {
    this.hooks.tell(f.id, { k: "fail", why });
  }

  private expireBuffs(f: Fighter, now: number) {
    let changed = false;
    for (const [id, b] of f.buffs) {
      if (now < b.until) continue;
      f.buffs.delete(id);
      changed = true;
    }
    if (changed) this.restat(f);
  }

  // ---------------------------------------------------------------- monsters

  /** A monster of a group appears (`announce`: a boss coming back is news; the first spawn at start isn't). */
  private spawn(group: number, announce = false) {
    const g = GROUPS[group];
    const def = MONSTERS[g.monster];
    const at = this.findSpot(group);
    if (!at) {
      this.respawns.push({ group, at: Date.now() + 5000 });
      return;
    }
    this.addMob(def, group, g.rect, at);
    if (announce && def.boss) this.hooks.boss(def, "rise", GROUP_FIELDS[group].name);
  }

  /** A monster appears at `at`, at home in `r` (tiles). Returns its id. */
  private addMob(def: MonsterDef, group: number, r: { x: number; y: number; w: number; h: number }, at: { x: number; y: number }, post?: number): string {
    const id = `${MONSTER_ID_PREFIX}${++this.nextId}`;
    const state = new Monster({ kind: def.id, x: Math.round(at.x), y: Math.round(at.y), dir: Dir.Down, moving: false, ts: this.now(), hp: def.hp });
    this.mobs.set(id, {
      id,
      def,
      group,
      post,
      home: { x0: r.x * TILE_SIZE, y0: r.y * TILE_SIZE, x1: (r.x + r.w) * TILE_SIZE, y1: (r.y + r.h) * TILE_SIZE },
      state,
      x: at.x,
      y: at.y,
      hp: def.hp,
      nextAttackAt: 0,
      lastHitAt: 0,
      regenAt: 0,
      returning: false,
      restUntil: Date.now() + rand(500, 4000),
      stuckFor: 0,
      damage: new Map(),
      frozenUntil: 0,
    });
    this.monsters.set(id, state);
    return id;
  }

  private findSpot(group: number): { x: number; y: number } | undefined {
    const { rect, monster } = GROUPS[group];
    const rooted = MONSTERS[monster].speed === 0;
    for (let i = 0; i < 40; i++) {
      const x = (rect.x + Math.random() * rect.w) * TILE_SIZE;
      const y = (rect.y + Math.random() * rect.h) * TILE_SIZE;
      if (!this.world.canStand(x, y) || inSafeZone(x, y)) continue;
      if (rooted && [...this.mobs.values()].some((m) => m.group === group && dist(m, { x, y }) < ROOTED_GAP_PX)) continue;
      return { x, y };
    }
    return undefined;
  }

  private think(mob: Mob, dtMs: number, now: number) {
    const def = mob.def;
    // Frozen solid: no moving, no biting, until it thaws (a slam or blast already wound up still lands).
    if (now < mob.frozenUntil) {
      this.halt(mob);
      this.bossAttacks(mob, now);
      return;
    }
    let target = mob.target ? this.fighters.get(mob.target) : undefined;
    if (mob.target && (!target || !this.canChase(mob, target))) {
      this.giveUp(mob);
      target = undefined;
    }
    if (!target && def.aggro > 0 && !mob.returning) {
      target = this.nearestPrey(mob);
      if (target) {
        mob.target = target.id;
        mob.nextAttackAt = Math.max(mob.nextAttackAt, now + FIRST_BITE_MS);
      }
    }
    if (target) {
      this.bossAttacks(mob, now);
      this.hunt(mob, target, dtMs, now);
      return;
    }
    this.bossAttacks(mob, now);

    // Left alone: heal up, then wander (or walk home first).
    if (mob.owner === undefined && mob.hp < def.hp && now - mob.lastHitAt > COMBAT_MS && now >= mob.regenAt) {
      mob.regenAt = now + 1000;
      mob.hp = Math.min(def.hp, mob.hp + Math.max(1, Math.round(def.hp * (def.regen ?? MOB_REGEN))));
      mob.state.hp = mob.hp;
      if (mob.hp >= def.hp) mob.damage.clear();
    }
    if (mob.returning) {
      if (this.atHome(mob, 0) || def.speed === 0) mob.returning = false;
      else {
        const home = { x: (mob.home.x0 + mob.home.x1) / 2, y: (mob.home.y0 + mob.home.y1) / 2 };
        if (!this.step(mob, home, def.speed * 1.5, dtMs)) mob.stuckFor += dtMs;
        // Wedged on the way home: wander from here instead, it'll drift back.
        if (mob.stuckFor > STUCK_MS) mob.returning = false;
        return;
      }
    }
    // Guardians stand at their posts; everything else that can walk wanders.
    if (mob.post !== undefined) {
      this.halt(mob);
      mob.state.dir = GUARDIAN_POSTS[mob.post].dir;
    } else if (def.speed > 0) this.wander(mob, dtMs, now);
  }

  private canChase(mob: Mob, f: Fighter): boolean {
    if (f.player.dead || inSafeZone(f.pos.x, f.pos.y) || !this.atHome(mob, mob.def.boss ? BOSS_LEASH_PX : LEASH_PX)) return false;
    if (mob.post !== undefined && !this.guardianFoe(f)) return false;
    if (mob.owner !== undefined) return mob.owner === f.id;
    const giveUpAt = mob.def.speed > 0 ? LOSE_PX : Math.max(mob.def.aggro, mob.def.range) * 1.5;
    return dist(mob, f.pos) <= giveUpAt;
  }

  private giveUp(mob: Mob) {
    mob.target = undefined;
    mob.returning = true;
    mob.stuckFor = 0;
    mob.wander = undefined;
  }

  private nearestPrey(mob: Mob): Fighter | undefined {
    let best: Fighter | undefined;
    let bestD = mob.def.aggro;
    for (const f of this.fighters.values()) {
      if (f.player.dead || inSafeZone(f.pos.x, f.pos.y) || (mob.post !== undefined && !this.guardianFoe(f)) || (mob.owner !== undefined && mob.owner !== f.id)) continue;
      const d = dist(mob, f.pos);
      if (d <= bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  private hunt(mob: Mob, f: Fighter, dtMs: number, now: number) {
    const def = mob.def;
    if (dist(mob, f.pos) > def.range) {
      if (def.speed === 0) return;
      mob.stuckFor = this.step(mob, f.pos, def.chase, dtMs) ? 0 : mob.stuckFor + dtMs;
      if (mob.stuckFor > STUCK_MS) this.giveUp(mob);
      return;
    }
    this.halt(mob);
    mob.state.dir = dirTo(f.pos.x - mob.x, f.pos.y - mob.y);
    if (now < mob.nextAttackAt) return;
    mob.nextAttackAt = now + def.attackMs;
    f.lastCombatAt = now;
    // Grass Snake Cards make monsters miss more often.
    if (Math.random() >= hitChance(def.level, f.player.lv) * (1 - f.stats.flee)) {
      this.hooks.emit(f.pos.x, f.pos.y, { k: "miss", a: mob.id, t: f.id });
      return;
    }
    const { damage, crit } = rollDamage(def.atk, f.stats.def);
    f.player.hp = Math.max(0, f.player.hp - damage);
    f.dirty = true;
    this.hooks.emit(f.pos.x, f.pos.y, { k: "hit", a: mob.id, t: f.id, d: damage, ...(crit && { crit: 1 as const }) });
    if (f.player.hp <= 0) {
      // Falling to your Shade costs nothing: try again.
      if (mob.owner !== undefined) return this.knockOut(f, false);
      if (mob.post === undefined) return this.knockOut(f);
      // Falling in a siege costs nothing, whoever does it.
      this.knockOut(f, false);
      this.siegeDowns.add(f.id);
      return this.hooks.notice(f.id, `A ${mob.def.name} beat you. In a siege you lose nothing: you'll get up at the camp outside the gate.`);
    }
    // Snapper Flower Cards bite back (always at least 1, so they matter against weak monsters too).
    if (f.stats.reflect > 0) this.hurt(mob, f, Math.max(1, Math.round(damage * f.stats.reflect)), { thorn: 1 });
  }

  /**
   * A field boss's slam and blast (see BossAttack in rpg.ts): while it's fighting, it winds one up
   * (everyone sees the circle) and it lands BOSS_WINDUP_MS later on whoever is still inside. The slam
   * goes round the boss when someone is close; the blast goes where the furthest of its attackers
   * stands, so fighting it from the edge of your reach isn't safe either. Windups land even after it
   * stops fighting; a frozen boss starts no new ones.
   */
  private bossAttacks(mob: Mob, now: number) {
    const def = mob.def;
    if (!def.slam && !def.blast) return;
    for (const w of [...(mob.windups ?? [])]) {
      if (now < w.at) continue;
      mob.windups!.splice(mob.windups!.indexOf(w), 1);
      this.hooks.emit(w.x, w.y, { k: "boom", a: mob.id, x: Math.round(w.x), y: Math.round(w.y), r: w.r, kind: w.kind });
      for (const f of [...this.fighters.values()]) {
        if (f.player.dead || inSafeZone(f.pos.x, f.pos.y) || dist(f.pos, w) > w.r + PLAYER_RADIUS) continue;
        const { damage, crit } = rollDamage(Math.round(def.atk * w.power), f.stats.def);
        f.player.hp = Math.max(0, f.player.hp - damage);
        f.lastCombatAt = now;
        f.dirty = true;
        this.hooks.emit(f.pos.x, f.pos.y, { k: "hit", a: mob.id, t: f.id, d: damage, aoe: 1, ...(crit && { crit: 1 as const }) });
        if (f.player.hp <= 0) this.knockOut(f);
      }
    }
    if (!mob.target || now < mob.frozenUntil) return;
    mob.windups ??= [];
    // Anyone who's hurt it lately and is still around counts as one of its attackers.
    const foes = [...mob.damage.keys()].map((id) => this.fighters.get(id)).filter((f): f is Fighter => Boolean(f && !f.player.dead && !inSafeZone(f.pos.x, f.pos.y)));
    if (def.slam && now >= (mob.slamAt ?? 0) && foes.some((f) => dist(f.pos, mob) <= def.slam!.radius + PLAYER_RADIUS)) {
      mob.slamAt = now + def.slam.everyMs;
      this.windUp(mob, "slam", mob.x, mob.y, def.slam.radius, def.slam.power, now);
    }
    if (def.blast && now >= (mob.blastAt ?? 0)) {
      const far = foes
        .map((f) => ({ f, d: dist(f.pos, mob) }))
        .filter(({ d }) => d <= def.blast!.reach && d > (def.slam?.radius ?? 0))
        .sort((a, b) => b.d - a.d)[0];
      if (far) {
        mob.blastAt = now + def.blast.everyMs;
        this.windUp(mob, "blast", far.f.pos.x, far.f.pos.y, def.blast.radius, def.blast.power, now);
      }
    }
  }

  private windUp(mob: Mob, kind: "slam" | "blast", x: number, y: number, r: number, power: number, now: number) {
    mob.windups!.push({ kind, x, y, r, power, at: now + BOSS_WINDUP_MS });
    this.hooks.emit(x, y, { k: "warn", a: mob.id, x: Math.round(x), y: Math.round(y), r, ms: BOSS_WINDUP_MS, kind });
  }

  /** Inside its home area, plus `pad` pixels. */
  private atHome(mob: Mob, pad: number): boolean {
    const h = mob.home;
    return mob.x >= h.x0 - pad && mob.x <= h.x1 + pad && mob.y >= h.y0 - pad && mob.y <= h.y1 + pad;
  }

  private wander(mob: Mob, dtMs: number, now: number) {
    if (!mob.wander) {
      if (now < mob.restUntil) return;
      const h = mob.home;
      for (let i = 0; i < 12 && !mob.wander; i++) {
        const x = rand(h.x0, h.x1);
        const y = rand(h.y0, h.y1);
        if (this.world.canStand(x, y) && !inSafeZone(x, y) && dist(mob, { x, y }) > 48) mob.wander = { x, y };
      }
      if (!mob.wander) {
        mob.restUntil = now + 2000;
        return;
      }
      mob.stuckFor = 0;
    }
    const moved = this.step(mob, mob.wander, mob.def.speed, dtMs);
    mob.stuckFor = moved ? 0 : mob.stuckFor + dtMs;
    if (dist(mob, mob.wander) <= 2 || mob.stuckFor > 600) {
      mob.wander = undefined;
      mob.restUntil = now + rand(2000, 7000);
      this.halt(mob);
    }
  }

  /** One step toward `to`, sliding along obstacles and never into town. Returns whether it got anywhere. */
  private step(mob: Mob, to: { x: number; y: number }, speed: number, dtMs: number): boolean {
    const dx = to.x - mob.x;
    const dy = to.y - mob.y;
    const d = Math.hypot(dx, dy);
    if (d < 1 || speed <= 0) {
      this.halt(mob);
      return false;
    }
    const len = Math.min(d, (speed * dtMs) / 1000);
    const next = this.world.move(mob.x, mob.y, (dx / d) * len, (dy / d) * len);
    if (inSafeZone(next.x, next.y)) {
      this.halt(mob);
      return false;
    }
    const moved = Math.hypot(next.x - mob.x, next.y - mob.y) > len * 0.3;
    mob.x = next.x;
    mob.y = next.y;
    const s = mob.state;
    s.x = Math.round(next.x);
    s.y = Math.round(next.y);
    s.dir = dirTo(dx, dy);
    s.moving = true;
    s.ts = this.now();
    return moved;
  }

  private halt(mob: Mob) {
    if (!mob.state.moving) return;
    mob.state.moving = false;
    mob.state.ts = this.now();
  }
}
