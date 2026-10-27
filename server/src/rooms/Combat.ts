import type { MapSchema } from "@colyseus/schema";
import { TILE_SIZE, type World } from "../../../shared/world";
import { Dir, MONSTER_ID_PREFIX, type FxEvent, type StatsMessage } from "../../../shared/protocol";
import {
  CLASSES,
  FIELDS,
  LEVEL_CAP,
  MONSTERS,
  REGEN_RATE,
  SIT_REGEN,
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
} from "../../../shared/rpg";
import type { Progress } from "../db";
import { Monster, type Player } from "./WorldState";

/** Spawn groups with a player this close (px) think; the rest sleep, so empty fields cost nothing. */
const WAKE_PX = 1600;
/** Monsters chase this far outside their home area, then give up and go home. */
const LEASH_PX = 6 * TILE_SIZE;
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

export interface CombatHooks {
  /** Something happened at (x, y): tell the players who can see it. */
  emit(x: number, y: number, ev: FxEvent): void;
  /** Tell one player only. */
  tell(id: string, ev: FxEvent): void;
  /** A player's own sheet changed. */
  sheet(id: string, sheet: StatsMessage): void;
  save(id: string, progress: Progress): void;
  /** A monster is about to be removed from the state: take it out of every view first. */
  despawn(mob: Monster): void;
  levelUp(id: string, lv: number): void;
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
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = ([a, b]: [number, number]) => a + Math.floor(Math.random() * (b - a + 1));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
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
  private nextId = 0;
  private saveAt = Date.now() + SAVE_MS;

  constructor(
    private world: World,
    private monsters: MapSchema<Monster>,
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
    const s = statsFor(cls, lv);
    const f: Fighter = {
      id,
      player,
      pos,
      cls,
      exp: lv >= LEVEL_CAP ? 0 : Math.max(0, Math.floor(progress?.exp ?? 0)),
      mp: Math.min(s.maxMp, progress?.mp ?? s.maxMp),
      gold: Math.max(0, Math.floor(progress?.gold ?? 0)),
      saved,
      nextAttackAt: 0,
      lastCombatAt: 0,
      regenAt: 0,
      hpAcc: 0,
      mpAcc: 0,
      dirty: false,
      sheetDirty: true,
    };
    player.lv = lv;
    player.mhp = s.maxHp;
    // Knocked out when they left: they're back in town now, fully healed.
    const hp = progress?.hp ?? s.maxHp;
    player.hp = hp > 0 ? Math.min(s.maxHp, hp) : s.maxHp;
    player.dead = false;
    this.fighters.set(id, f);
  }

  leave(id: string) {
    const f = this.fighters.get(id);
    if (!f) return;
    this.save(f);
    this.fighters.delete(id);
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

  /** Attack this monster whenever it's in reach ("" stops). */
  setTarget(id: string, mobId: string) {
    const f = this.fighters.get(id);
    if (!f || f.player.dead) return;
    if (!mobId) f.target = undefined;
    else if (this.mobs.has(mobId)) f.target = mobId;
  }

  /** Back on your feet in town: full health. Returns false if they weren't knocked out. */
  revive(id: string): boolean {
    const f = this.fighters.get(id);
    if (!f?.player.dead) return false;
    const s = statsFor(f.cls, f.player.lv);
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

  // ---------------------------------------------------------------- the loop

  tick(dtMs: number) {
    const now = Date.now();
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      if (now < this.respawns[i].at) continue;
      const { group } = this.respawns[i];
      this.respawns.splice(i, 1);
      this.spawn(group);
    }

    const awake = GROUPS.map((g) => this.anyoneNear(g.rect, WAKE_PX));
    for (const mob of this.mobs.values()) if (awake[mob.group]) this.think(mob, dtMs, now);
    for (const f of this.fighters.values()) {
      this.fight(f, now);
      this.regen(f, now);
    }

    if (now >= this.saveAt) {
      this.saveAt = now + SAVE_MS;
      for (const f of this.fighters.values()) if (f.dirty) this.save(f);
    }
    for (const f of this.fighters.values()) {
      if (!f.sheetDirty) continue;
      f.sheetDirty = false;
      this.hooks.sheet(f.id, this.sheet(f));
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
    const mob = this.mobs.get(f.target);
    if (!mob) {
      f.target = undefined;
      return;
    }
    if (now < f.nextAttackAt || inSafeZone(f.pos.x, f.pos.y)) return;
    const s = statsFor(f.cls, f.player.lv);
    if (dist(f.pos, mob) > reach(s.range, mob.def) + REACH_SLACK) return;

    f.nextAttackAt = now + s.attackMs;
    f.lastCombatAt = now;
    f.player.sit = false;
    f.player.dir = dirTo(mob.x - f.pos.x, mob.y - f.pos.y);
    mob.lastHitAt = now;
    // Even shy monsters fight back.
    if (!mob.target) {
      mob.target = f.id;
      mob.returning = false;
      mob.nextAttackAt = Math.max(mob.nextAttackAt, now + FIRST_BITE_MS);
    }

    if (Math.random() >= hitChance(f.player.lv, mob.def.level)) {
      this.hooks.emit(mob.x, mob.y, { k: "miss", a: f.id, t: mob.id });
      return;
    }
    const { damage, crit } = rollDamage(s.atk, mob.def.def);
    mob.damage.set(f.id, (mob.damage.get(f.id) ?? 0) + Math.min(damage, mob.hp));
    mob.hp = Math.max(0, mob.hp - damage);
    mob.state.hp = mob.hp;
    this.hooks.emit(mob.x, mob.y, { k: "hit", a: f.id, t: mob.id, d: damage, ...(crit && { crit: 1 as const }) });
    if (mob.hp <= 0) this.defeat(mob);
  }

  private defeat(mob: Mob) {
    this.hooks.emit(mob.x, mob.y, { k: "down", t: mob.id });
    this.reward(mob);
    this.hooks.despawn(mob.state);
    this.monsters.delete(mob.id);
    this.mobs.delete(mob.id);
    this.respawns.push({ group: mob.group, at: Date.now() + mob.def.respawnMs });
    for (const f of this.fighters.values()) if (f.target === mob.id) f.target = undefined;
  }

  /** EXP goes to everyone who hurt it, by how much; the gold to whoever did the most. */
  private reward(mob: Mob) {
    let total = 0;
    for (const d of mob.damage.values()) total += d;
    if (total <= 0) return;
    const earners: { f: Fighter; dmg: number }[] = [];
    for (const [id, dmg] of mob.damage) {
      const f = this.fighters.get(id);
      if (f && !f.player.dead) earners.push({ f, dmg });
    }
    const top = earners.reduce<{ f: Fighter; dmg: number } | undefined>((best, e) => (!best || e.dmg > best.dmg ? e : best), undefined);
    for (const { f, dmg } of earners) {
      const exp = this.gainExp(f, Math.floor(mob.def.exp * (dmg / total) * expFactor(f.player.lv, mob.def.level)));
      const gold = f === top?.f ? randInt(mob.def.gold) : 0;
      if (gold) {
        f.gold += gold;
        f.dirty = f.sheetDirty = true;
      }
      if (exp || gold) this.hooks.tell(f.id, { k: "gain", exp, gold });
    }
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
    const s = statsFor(f.cls, lv);
    f.player.lv = lv;
    f.player.mhp = s.maxHp;
    f.player.hp = s.maxHp;
    f.mp = s.maxMp;
    f.dirty = f.sheetDirty = true;
    if (announce) {
      this.hooks.emit(f.pos.x, f.pos.y, { k: "lvup", t: f.id, lv });
      this.hooks.levelUp(f.id, lv);
    }
    this.save(f);
  }

  private regen(f: Fighter, now: number) {
    if (now < f.regenAt) return;
    f.regenAt = now + REGEN_MS;
    if (f.player.dead || now - f.lastCombatAt < COMBAT_MS) return;
    const s = statsFor(f.cls, f.player.lv);
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

  private knockOut(f: Fighter) {
    const p = f.player;
    p.dead = true;
    p.hp = 0;
    p.moving = false;
    p.sit = false;
    f.target = undefined;
    f.exp = Math.max(0, f.exp - Math.floor(expToNext(p.lv) * CLASSES[f.cls].deathExpLoss));
    f.dirty = f.sheetDirty = true;
    for (const mob of this.mobs.values()) if (mob.target === f.id) this.giveUp(mob);
    this.hooks.emit(f.pos.x, f.pos.y, { k: "down", t: f.id });
    this.save(f);
  }

  private sheet(f: Fighter): StatsMessage {
    const s = statsFor(f.cls, f.player.lv);
    return { cls: f.cls, lv: f.player.lv, exp: f.exp, mp: f.mp, mmp: s.maxMp, gold: f.gold, saved: f.saved };
  }

  private save(f: Fighter) {
    f.dirty = false;
    if (!f.saved) return;
    const s = statsFor(f.cls, f.player.lv);
    const p = f.player;
    this.hooks.save(f.id, {
      cls: f.cls,
      lv: p.lv,
      exp: f.exp,
      hp: p.hp >= s.maxHp ? null : p.hp,
      mp: f.mp >= s.maxMp ? null : f.mp,
      gold: f.gold,
    });
  }

  // ---------------------------------------------------------------- monsters

  private spawn(group: number) {
    const g = GROUPS[group];
    const def = MONSTERS[g.monster];
    const at = this.findSpot(group);
    if (!at) {
      this.respawns.push({ group, at: Date.now() + 5000 });
      return;
    }
    const id = `${MONSTER_ID_PREFIX}${++this.nextId}`;
    const state = new Monster({ kind: def.id, x: Math.round(at.x), y: Math.round(at.y), dir: Dir.Down, moving: false, ts: this.now(), hp: def.hp });
    const r = g.rect;
    this.mobs.set(id, {
      id,
      def,
      group,
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
    });
    this.monsters.set(id, state);
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
      this.hunt(mob, target, dtMs, now);
      return;
    }

    // Left alone: heal up, then wander (or walk home first).
    if (mob.hp < def.hp && now - mob.lastHitAt > COMBAT_MS && now >= mob.regenAt) {
      mob.regenAt = now + 1000;
      mob.hp = Math.min(def.hp, mob.hp + Math.max(1, Math.round(def.hp * MOB_REGEN)));
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
    if (def.speed > 0) this.wander(mob, dtMs, now);
  }

  private canChase(mob: Mob, f: Fighter): boolean {
    if (f.player.dead || inSafeZone(f.pos.x, f.pos.y) || !this.atHome(mob, LEASH_PX)) return false;
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
      if (f.player.dead || inSafeZone(f.pos.x, f.pos.y)) continue;
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
    if (Math.random() >= hitChance(def.level, f.player.lv)) {
      this.hooks.emit(f.pos.x, f.pos.y, { k: "miss", a: mob.id, t: f.id });
      return;
    }
    const { damage, crit } = rollDamage(def.atk, statsFor(f.cls, f.player.lv).def);
    f.player.hp = Math.max(0, f.player.hp - damage);
    f.dirty = true;
    this.hooks.emit(f.pos.x, f.pos.y, { k: "hit", a: mob.id, t: f.id, d: damage, ...(crit && { crit: 1 as const }) });
    if (f.player.hp <= 0) this.knockOut(f);
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
