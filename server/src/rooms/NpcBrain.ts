import { NPCS, type NpcDef } from "../../../shared/npcs";
import { ROOM_MODES, formatRupiah, type NpcSay } from "../../../shared/gattchaa";
import { Dir } from "../../../shared/protocol";
import { TILE_SIZE, type World } from "../../../shared/world";
import type { GattchaaFeed } from "../gattchaa";
import { Npc } from "./WorldState";

const WALK_SPEED = 58; // px/s, a stroll
const CHATTER_MIN_MS = 9_000;
const CHATTER_MAX_MS = 20_000;
const CRIER_EVERY_MS = 45_000;

interface Walker {
  def: NpcDef;
  state: Npc;
  x: number;
  y: number;
  target?: { x: number; y: number };
  restUntil: number;
  stuckFor: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** Moves wandering NPCs and makes the town talk. All randomness lives on the server, so everyone sees the same thing. */
export class NpcBrain {
  readonly npcs = new Map<string, Npc>();
  private walkers: Walker[] = [];
  private nextChatterAt = Date.now() + rand(CHATTER_MIN_MS, CHATTER_MAX_MS);
  private nextCrierAt = Date.now() + 15_000;

  constructor(
    private world: World,
    private feed: GattchaaFeed,
    private now: () => number,
    private say: (msg: NpcSay) => void,
  ) {
    for (const def of NPCS) {
      const state = new Npc({ name: def.name, look: def.look, x: def.x, y: def.y, dir: def.dir, moving: false, ts: now() });
      this.npcs.set(def.id, state);
      if (def.wander) this.walkers.push({ def, state, x: def.x, y: def.y, restUntil: Date.now() + rand(1000, 5000), stuckFor: 0 });
    }
  }

  tick(dtMs: number) {
    const wall = Date.now();
    for (const w of this.walkers) this.walk(w, dtMs, wall);

    if (wall >= this.nextChatterAt) {
      this.nextChatterAt = wall + rand(CHATTER_MIN_MS, CHATTER_MAX_MS);
      const def = pick(NPCS.filter((n) => n.kind !== "crier"));
      const line = def && pick(def.chatter);
      if (def && line) this.say({ id: def.id, text: line });
    }
    if (wall >= this.nextCrierAt) {
      this.nextCrierAt = wall + CRIER_EVERY_MS;
      const line = this.crierLine();
      if (line) this.say({ id: "crier", text: line });
    }
  }

  /** The crier shouts big news right away (used for purchase announcements). */
  shout(text: string) {
    this.nextCrierAt = Date.now() + CRIER_EVERY_MS;
    this.say({ id: "crier", text });
  }

  /** Something true and current from the shop, never invented. */
  private crierLine(): string | undefined {
    const products = this.feed.liveProducts.filter((p) => !p.soldOut);
    const rooms = this.feed.liveRooms.filter((r) => r.taken < r.seats);
    const options: (() => string | undefined)[] = [
      () => {
        const p = products.find((x) => x.label) ?? products[0];
        return p && `${p.label ? `${p.label}: ` : "Now open: "}${p.title}, ${formatRupiah(p.price)} a pack!`;
      },
      () => {
        const p = pick(products);
        return p && `Hear ye! ${p.title} is in stock at the stalls!`;
      },
      () => {
        const r = rooms.find((x) => x.taken > 0) ?? rooms[0];
        if (!r) return undefined;
        const open = r.seats - r.taken;
        return `${ROOM_MODES[r.mode] ?? "Room"} for ${r.product.title}: ${open} seat${open === 1 ? "" : "s"} left!`;
      },
      () => (this.feed.online > 1 ? `${this.feed.online} collectors are on Gattchaa right now!` : undefined),
    ];
    for (let i = 0; i < options.length; i++) {
      const line = pick(options)?.();
      if (line) return line;
    }
    return undefined;
  }

  private walk(w: Walker, dtMs: number, wall: number) {
    const area = w.def.wander!;
    if (!w.target) {
      if (wall < w.restUntil) return;
      for (let i = 0; i < 12 && !w.target; i++) {
        const tx = (area.x + Math.random() * area.w) * TILE_SIZE;
        const ty = (area.y + Math.random() * area.h) * TILE_SIZE;
        if (this.world.canStand(tx, ty) && Math.hypot(tx - w.x, ty - w.y) > 48) w.target = { x: tx, y: ty };
      }
      if (!w.target) {
        w.restUntil = wall + 2000;
        return;
      }
      w.stuckFor = 0;
    }

    const dx = w.target.x - w.x;
    const dy = w.target.y - w.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.min(dist, (WALK_SPEED * dtMs) / 1000);
    const next = this.world.move(w.x, w.y, (dx / dist) * step, (dy / dist) * step);
    const moved = Math.hypot(next.x - w.x, next.y - w.y);
    w.x = next.x;
    w.y = next.y;
    w.stuckFor = moved < step * 0.3 ? w.stuckFor + dtMs : 0;

    const s = w.state;
    if (dist <= 2 || w.stuckFor > 600) {
      w.target = undefined;
      w.restUntil = wall + rand(2500, 9000);
      s.moving = false;
    } else {
      s.moving = true;
      s.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    }
    s.x = Math.round(w.x);
    s.y = Math.round(w.y);
    s.ts = this.now();
  }
}
