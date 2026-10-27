import type { MapSchema } from "@colyseus/schema";
import type { World } from "../../../shared/world";
import type { ItemId } from "../../../shared/items";
import { Drop } from "./WorldState";

/** Monster loot is only the top fighter's to take for this long; then anyone may. */
const OWNER_MS = 15_000;
/** Items vanish from the ground after this long. */
const EXPIRE_MS = 90_000;
/** Most items on the ground at once; past that, the oldest go first. */
const MAX_DROPS = 500;
/** Loot scatters this far (px) around where the monster fell, so a pile stays clickable. */
const SCATTER_PX = 22;

interface Entry {
  drop: Drop;
  ownerUntil: number;
  expiresAt: number;
}

/** Items lying on the ground: monster loot, and anything players put down. */
export class Drops {
  private entries = new Map<string, Entry>();
  private nextId = 0;

  constructor(
    private drops: MapSchema<Drop>,
    private world: World,
    /** About to leave the state: take it out of every view first. */
    private despawn: (drop: Drop) => void,
  ) {}

  /** Puts `n` of an item on the ground near (x, y); `owner` gets first pick for a while. */
  spawn(item: ItemId, n: number, x: number, y: number, owner = "", scatter = true) {
    let px = x;
    let py = y;
    if (scatter) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * (SCATTER_PX - 6);
        const tx = x + Math.cos(a) * r;
        const ty = y + Math.sin(a) * r * 0.7;
        if (this.world.canStand(tx, ty)) {
          px = tx;
          py = ty;
          break;
        }
      }
    }
    while (this.entries.size >= MAX_DROPS) this.remove(this.entries.keys().next().value!);
    const id = String(++this.nextId);
    const drop = new Drop({ item, n, x: Math.round(px), y: Math.round(py), owner });
    const now = Date.now();
    this.entries.set(id, { drop, ownerUntil: owner ? now + OWNER_MS : 0, expiresAt: now + EXPIRE_MS });
    this.drops.set(id, drop);
  }

  get(id: string): Drop | undefined {
    return this.entries.get(id)?.drop;
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.despawn(e.drop);
    this.entries.delete(id);
    this.drops.delete(id);
  }

  /** Someone left: whatever they had first pick of is up for grabs. */
  release(owner: string) {
    for (const e of this.entries.values()) {
      if (e.drop.owner !== owner) continue;
      e.drop.owner = "";
      e.ownerUntil = 0;
    }
  }

  tick(now: number) {
    for (const [id, e] of this.entries) {
      if (now >= e.expiresAt) this.remove(id);
      else if (e.ownerUntil && now >= e.ownerUntil) {
        e.ownerUntil = 0;
        e.drop.owner = "";
      }
    }
  }
}
