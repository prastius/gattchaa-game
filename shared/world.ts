// Deterministic world generation shared by client (rendering) and server (validation).
// Both sides build the exact same map from the same seed, so the map itself never
// has to be sent over the network.
//
// Terrain is stored per *vertex* (tile corner), not per tile. Each tile picks its
// artwork from the terrain at its four corners ("corner autotiling"), which is what
// produces smooth grass/water/dirt edges with the LPC tilesets.

import {
  FLOORS,
  FORGE_YARD,
  FROSTFELL_ISLE,
  RAVENMOOR_ISLE,
  PETALFALL_ISLE,
  CASTLE_ISLE,
  FROST_LAIR,
  WARLORD_CAMP,
  CAVES,
  DUNGEONS,
  OVERWORLD_H,
  isCaveRoom,
  type CaveZone,
  CINDER_CRATER,
  SUN_TEMPLE,
  STAR_ALTAR,
  TRIAL_ISLE,
  ASHPEAK_ISLE,
  SUNSCAR_ISLE,
  STARFALL_ISLE,
  TRIAL_GROUND,
  CASTLE,
  CASTLE_CAMP,
  RUINS,
  Floor,
  PIERS,
  isSnowy,
  biomeAt,
  ORC_CAMP,
  MINOTAUR_LAIR,
  GARDENS,
  GROVES,
  INTERIOR_ZONE,
  POND,
  PROPS,
  PROP_TYPES,
  ROADS,
  SOLID_FLOORS,
  SPAWN_AREA,
  STRUCT_BLOCKS,
  STRUCT_GROUPS,
  TOWN_AREA,
  TRAILS,
  inRect,
  type Rect,
} from "./town";
import { FIELDS } from "./rpg";

export const TILE_SIZE = 32;
export const WORLD_TILES_W = 640;
/** The overworld (OVERWORLD_H rows) and, below it, the underground band where dungeons live. */
export const WORLD_TILES_H = OVERWORLD_H + 128;
/** The main island is shaped round this tile (the world grew south and east for the islands; this stays put). */
const MAIN_CX = 192;
const MAIN_CY = 192;
export const WORLD_PX_W = WORLD_TILES_W * TILE_SIZE;
export const WORLD_PX_H = WORLD_TILES_H * TILE_SIZE;
export const WORLD_SEED = 20261015;

export const PLAYER_SPEED = 160; // pixels per second
export const CHUNK_TILES = 16; // client streams ground + decorations in chunks of this size

export const Terrain = {
  Deep: 0,
  Water: 1,
  Grass: 2,
  Dirt: 3,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const isWet = (t: number) => t === Terrain.Deep || t === Terrain.Water;

/**
 * Decorations placed on tiles. `block` makes the tile unwalkable (tree trunks,
 * boulders). The client maps each id to a sprite.
 */
export const DECOR = [
  { id: "none", block: false },
  { id: "oak", block: true },
  { id: "oakRoots", block: true },
  { id: "oakTall", block: true },
  { id: "bushTree", block: true },
  { id: "pine", block: true },
  { id: "pineTall", block: true },
  { id: "boulder", block: true },
  { id: "rock", block: true },
  { id: "stone", block: false },
  { id: "bush", block: true },
  { id: "fern", block: false },
  { id: "tallGrass", block: false },
  { id: "flowers", block: false },
  { id: "cypress", block: true },
] as const;
export type DecorId = (typeof DECOR)[number]["id"];
export const Decor = Object.fromEntries(DECOR.map((d, i) => [d.id, i])) as Record<DecorId, number>;
const DECOR_BLOCKS: boolean[] = DECOR.map((d) => d.block);

// Feet hitbox, relative to the player's (x, y) which sits at the feet.
const FOOT_HALF_W = 8;
const FOOT_H = 6;

export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const sx = smooth(x - xi);
  const sy = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export class World {
  readonly width = WORLD_TILES_W;
  readonly height = WORLD_TILES_H;
  /** Vertex grid, (width + 1) x (height + 1). */
  readonly vw = WORLD_TILES_W + 1;
  readonly vh = WORLD_TILES_H + 1;
  readonly verts: Uint8Array;
  /** Decoration per tile, see DECOR. */
  readonly decor: Uint8Array;
  /** Paved floor per tile (town), see Floor. */
  readonly floor: Uint8Array;
  /** 1 where a town building or prop blocks the tile. */
  readonly solid: Uint8Array;
  /** Stone structures (see STRUCT_BLOCKS): group index + 1 where the tile is a block's top… */
  readonly structTop: Uint8Array;
  /** …or its wall face, with the face row (0 = just under the top). */
  readonly structFace: Uint8Array;
  readonly faceRow: Uint8Array;
  readonly seed: number;

  constructor(seed = WORLD_SEED) {
    this.seed = seed;
    this.verts = new Uint8Array(this.vw * this.vh);
    this.decor = new Uint8Array(this.width * this.height);
    this.floor = new Uint8Array(this.width * this.height);
    this.solid = new Uint8Array(this.width * this.height);
    this.structTop = new Uint8Array(this.width * this.height);
    this.structFace = new Uint8Array(this.width * this.height);
    this.faceRow = new Uint8Array(this.width * this.height);
    this.generateTerrain();
    this.shapeTown();
    this.cleanTerrain();
    this.placeDecor();
    this.stampTown();
  }

  // ------------------------------------------------------------ generation

  private elevation(vx: number, vy: number): number {
    const dx = (vx - MAIN_CX) / MAIN_CX;
    const dy = (vy - MAIN_CY) / MAIN_CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const e = fbm(vx / 70, vy / 70, this.seed, 5);
    return Math.max(e * 1.2 - Math.pow(dist, 3.5) * 0.85 + 0.14, this.isleElevation(vx, vy, FROSTFELL_ISLE, 4242), this.isleElevation(vx, vy, RAVENMOOR_ISLE, 7373), this.isleElevation(vx, vy, PETALFALL_ISLE, 3131), this.isleElevation(vx, vy, CASTLE_ISLE, 9494), this.trialElevation(vx, vy), this.ashElevation(vx, vy), this.isleElevation(vx, vy, SUNSCAR_ISLE, 8282), this.isleElevation(vx, vy, STARFALL_ISLE, 5757));
  }

  /** Ashpeak: an island like the others, but higher, so most of it is bare volcanic rock with grass only near the shore. */
  private ashElevation(vx: number, vy: number): number {
    const e = this.isleElevation(vx, vy, ASHPEAK_ISLE, 6161);
    return e < 0 ? e : e + 0.1;
  }

  /** The Isle of Trials: small, low and round, so the circle in its middle is always dry grass. */
  private trialElevation(vx: number, vy: number): number {
    const { cx, cy, rx, ry } = TRIAL_ISLE;
    const d = Math.hypot((vx - cx) / rx, (vy - cy) / ry);
    if (d > 1.2) return -1;
    return 0.62 - d * d * 0.51 + (fbm(vx / 6, vy / 6, this.seed + 2468, 2) - 0.5) * 0.06;
  }

  /** An island out at sea (Frostfell, Ravenmoor, Petalfall, Crownhold, Ashpeak, Sunscar, Starfall): its own hills, falling away to the shore. */
  private isleElevation(vx: number, vy: number, isle: { cx: number; cy: number; rx: number; ry: number }, salt: number): number {
    const { cx, cy, rx, ry } = isle;
    const d = Math.hypot((vx - cx) / rx, (vy - cy) / ry);
    if (d > 1.2) return -1;
    const e = fbm(vx / 45, vy / 45, this.seed + salt, 5);
    return e * 1.1 - Math.pow(d, 3) * 0.9 + 0.12;
  }

  private generateTerrain() {
    const { vw, vh, seed } = this;
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        // The underground band is open sea (the dungeons are filled in later): no hills to work out.
        if (vy > OVERWORLD_H) {
          this.verts[vy * vw + vx] = Terrain.Deep;
          continue;
        }
        const e = this.elevation(vx, vy);
        const rough = fbm(vx / 40, vy / 40, seed + 555, 3);
        let t: Terrain;
        if (e < 0.31) t = Terrain.Deep;
        else if (e < 0.37) t = Terrain.Water;
        else if (e > 0.74 || (rough < 0.27 && e > 0.5)) t = Terrain.Dirt;
        else t = Terrain.Grass;
        this.verts[vy * vw + vx] = t;
      }
    }
  }

  /** Town ground is plain grass with dirt roads leading away (before cleaning, so edges get fixed up). */
  private shapeTown() {
    const { vw, vh, verts } = this;
    const fill = (r: Rect, t: Terrain, pad: number) => {
      for (let y = Math.max(0, r.y - pad); y <= Math.min(vh - 1, r.y + r.h + pad); y++) {
        for (let x = Math.max(0, r.x - pad); x <= Math.min(vw - 1, r.x + r.w + pad); x++) verts[y * vw + x] = t;
      }
    };
    fill(TOWN_AREA, Terrain.Grass, 2);
    fill(INTERIOR_ZONE, Terrain.Grass, 2); // dry ground under the store interior
    for (const d of CAVES) fill(d.zone, Terrain.Dirt, 0); // earth under every dungeon and the Battle Pit

    // The park pond: deep in the middle, shallow at the edge, a dirt trail round it.
    const { cx, cy, rx, ry } = POND;
    for (let vy = Math.floor(cy - ry * 1.6); vy <= Math.ceil(cy + ry * 1.6); vy++) {
      for (let vx = Math.floor(cx - rx * 1.6); vx <= Math.ceil(cx + rx * 1.6); vx++) {
        const e = Math.hypot((vx - cx) / rx, (vy - cy) / ry);
        const i = vy * vw + vx;
        if (e < 0.55) verts[i] = Terrain.Deep;
        else if (e < 1) verts[i] = Terrain.Water;
        else if (e >= 1.3 && e < 1.55) verts[i] = Terrain.Dirt;
      }
    }
    for (const t of TRAILS) {
      for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) verts[y * vw + x] = Terrain.Dirt;
    }

    for (const road of ROADS) {
      // Only carve roads over land; they simply end at the shore.
      for (let y = road.y; y < road.y + road.h; y++) {
        for (let x = road.x; x < road.x + road.w; x++) {
          const i = y * vw + x;
          // Inside the plaza the dirt is hidden under the paving, which is fine.
          if (!isWet(verts[i])) verts[i] = Terrain.Dirt;
        }
      }
    }
  }

  /** Paves the floors and marks building footprints solid. */
  private stampTown() {
    const { width } = this;
    for (const { rect, floor } of FLOORS) {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          this.floor[y * width + x] = floor;
          this.solid[y * width + x] = SOLID_FLOORS.includes(floor) ? 1 : 0;
        }
      }
    }
    for (const d of CAVES) this.carveCaves(d);
    this.stampStructures();
    for (const p of PROPS) {
      const t: { w: number; h: number; walkable?: boolean } = PROP_TYPES[p.type];
      if (t.walkable) continue;
      for (let y = p.y; y < p.y + t.h; y++) {
        for (let x = p.x; x < p.x + t.w; x++) this.solid[y * width + x] = 1;
      }
    }
    this.plantGardens();
    this.plantGroves();
  }

  /**
   * The park and the orchard: trees far enough apart to walk between, kept off
   * the trails, the banks and the furniture, with ferns and flowers in between.
   */
  private plantGroves() {
    const { width, seed } = this;
    const grassy = (x: number, y: number) => this.corners(x, y).every((t) => t === Terrain.Grass);
    const near = (x: number, y: number, r: number, test: (x: number, y: number) => boolean) => {
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (test(x + ox, y + oy)) return true;
      return false;
    };
    for (const r of GROVES) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = y * width + x;
          if (this.solid[i] || this.floor[i] || this.decor[i] || !grassy(x, y)) continue;
          const roll = hash2(x, y, seed + 41);
          const kind = hash2(x, y, seed + 42);
          let d: number = Decor.none;
          if (
            roll < 0.2 &&
            !near(x, y, 1, (ax, ay) => !grassy(ax, ay) || this.solidAt(ax, ay) || this.floorAt(ax, ay) !== 0) &&
            !near(x, y, 2, (ax, ay) => DECOR_BLOCKS[this.decorAt(ax, ay)])
          ) {
            d = [Decor.oak, Decor.bushTree, Decor.oakRoots, Decor.oakTall, Decor.cypress][Math.floor(kind * 5)];
          } else if (roll > 0.88) {
            d = Decor.flowers;
          } else if (roll > 0.82) {
            d = kind < 0.5 ? Decor.fern : Decor.tallGrass;
          }
          this.decor[i] = d;
        }
      }
    }
  }

  /**
   * A cave zone (a dungeon, or the Battle Pit): solid rock (the black void) everywhere in its zone except the rooms
   * and passages, whose walls are ragged in the big rooms, with loose stones on their floors.
   */
  private carveCaves(d: CaveZone) {
    const { width, seed } = this;
    const z = d.zone;
    const CAVE_ROOMS = d.rooms;
    for (let ty = z.y; ty < z.y + z.h; ty++) {
      for (let tx = z.x; tx < z.x + z.w; tx++) {
        const i = ty * width + tx;
        this.decor[i] = Decor.none;
        const room = CAVE_ROOMS.find((r) => inRect(r, tx, ty));
        const edge = room && isCaveRoom(room) && (tx === room.x || ty === room.y || tx === room.x + room.w - 1 || ty === room.y + room.h - 1);
        // Another room overlapping this edge (a passage coming in) keeps it open.
        const joined = edge && CAVE_ROOMS.some((r) => r !== room && inRect(r, tx, ty));
        const open = Boolean(room) && !(edge && !joined && hash2(tx, ty, seed + 77) < 0.45);
        if (open) {
          if (room && isCaveRoom(room) && !edge && hash2(tx, ty, seed + 78) < 0.06) this.decor[i] = Decor.stone;
          continue;
        }
        this.floor[i] = Floor.Void;
        this.solid[i] = 1;
      }
    }
    // Boulders and rocks heaped against the big rooms' walls, so they look like rock, not a cut-out.
    for (let ty = z.y + 1; ty < z.y + z.h - 1; ty++) {
      for (let tx = z.x + 1; tx < z.x + z.w - 1; tx++) {
        const i = ty * width + tx;
        const room = CAVE_ROOMS.find((r) => inRect(r, tx, ty));
        if (this.solid[i] || !room || !isCaveRoom(room) || CAVE_ROOMS.some((r) => r !== room && !isCaveRoom(r) && inRect({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, tx, ty))) continue;
        const byWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.solid[(ty + dy) * width + tx + dx] && this.floor[(ty + dy) * width + tx + dx] === Floor.Void);
        const roll = hash2(tx, ty, seed + 79);
        if (byWall && roll < 0.42) this.decor[i] = roll < 0.18 ? Decor.boulder : roll < 0.32 ? Decor.rock : Decor.stone;
      }
    }
  }

  /** Ramparts, towers and the palace: a solid top plus a solid face hanging below it. */
  private stampStructures() {
    const { width } = this;
    for (const block of STRUCT_BLOCKS) {
      const gi = STRUCT_GROUPS.findIndex((g) => g.id === block.group);
      const g = gi + 1;
      const { rect } = block;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          const i = y * width + x;
          this.structTop[i] = g;
          this.structFace[i] = 0;
          this.solid[i] = 1;
        }
      }
      const faceRows = block.face ?? STRUCT_GROUPS[gi].face;
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        for (let r = 0; r < faceRows; r++) {
          const i = (rect.y + rect.h + r) * width + x;
          // Runs into more of the same structure (a wall turning a corner): no face here.
          if (this.structTop[i] === g) break;
          this.structTop[i] = 0;
          this.structFace[i] = g;
          this.faceRow[i] = r;
          this.solid[i] = 1;
        }
      }
    }
  }

  /** Garden beds: clipped cypresses round the edge, flowers inside. */
  private plantGardens() {
    const { width, seed } = this;
    for (const r of GARDENS) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = y * width + x;
          if (this.solid[i] || this.floor[i]) continue;
          const edgeX = x === r.x || x === r.x + r.w - 1;
          const edgeY = y === r.y || y === r.y + r.h - 1;
          const centre = r.w >= 5 && r.h >= 5 && x === r.x + (r.w >> 1) && y === r.y + (r.h >> 1);
          let d: number = Decor.none;
          if (centre) d = Decor.bushTree;
          else if (edgeX && edgeY) d = Decor.cypress;
          else if (edgeY && r.h >= 3 && (x - r.x) % 4 === 0 && y === r.y + r.h - 1) d = Decor.cypress;
          // Flowers in neat rows, a few gaps so it doesn't look printed.
          else if ((y - r.y) % 2 === 1 && hash2(x, y, seed + 31) < 0.85) d = Decor.flowers;
          this.decor[i] = d;
        }
      }
    }
  }

  /** Stone structure at a tile: group index + 1 of its top or face (0 = none), and the face row. */
  structAt(tx: number, ty: number): { top: number; face: number; row: number } {
    if (!this.inBounds(tx, ty)) return { top: 0, face: 0, row: 0 };
    const i = ty * this.width + tx;
    return { top: this.structTop[i], face: this.structFace[i], row: this.faceRow[i] };
  }

  /** Trees and rocks stay out of town, the Blacksmith's yard, the bosses' camps, the Isle of Trials' circle, the piers, the dungeon portals and off the roads. */
  private isReserved(tx: number, ty: number): boolean {
    if (inRect(TOWN_AREA, tx, ty) || inRect(FORGE_YARD, tx, ty) || inRect(ORC_CAMP, tx, ty) || inRect(MINOTAUR_LAIR, tx, ty) || inRect(FROST_LAIR, tx, ty) || inRect(RUINS, tx, ty) || inRect(WARLORD_CAMP, tx, ty) || inRect(CINDER_CRATER, tx, ty) || inRect(SUN_TEMPLE, tx, ty) || inRect(STAR_ALTAR, tx, ty) || inRect(CASTLE, tx, ty) || inRect(CASTLE_CAMP, tx, ty)) return true;
    if (tx >= TRIAL_GROUND.x - 2 && ty >= TRIAL_GROUND.y - 3 && tx < TRIAL_GROUND.x + TRIAL_GROUND.w + 2 && ty < TRIAL_GROUND.y + TRIAL_GROUND.h + 2) return true;
    if (Object.values(PIERS).some((p) => tx >= p.x - 3 && ty >= p.y - 3 && tx < p.x + p.w + 3 && ty < p.y + p.h + 3)) return true;
    if (tx < INTERIOR_ZONE.x + INTERIOR_ZONE.w + 2 && ty < INTERIOR_ZONE.y + INTERIOR_ZONE.h + 2) return true;
    if (CAVES.some((d) => inRect(d.zone, tx, ty))) return true;
    // A clearing round every dungeon's portal (its signpost and warden stand in it too).
    if (DUNGEONS.some((d) => Math.abs(tx + 0.5 - d.mouth.x) <= 4.5 && ty >= d.mouth.y - 3 && ty <= d.mouth.y + 4)) return true;
    return ROADS.some((r) => tx >= r.x - 2 && ty >= r.y - 2 && tx < r.x + r.w + 1 && ty < r.y + r.h + 1);
  }

  /** Enforces the layering rules the tileset can draw, then removes diagonal-only corners. */
  private cleanTerrain() {
    const { vw, vh, verts } = this;
    const at = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= vw || y >= vh ? Terrain.Deep : verts[y * vw + x];

    for (let pass = 0; pass < 8; pass++) {
      let changed = 0;
      const set = (x: number, y: number, t: Terrain) => {
        if (verts[y * vw + x] !== t) {
          verts[y * vw + x] = t;
          changed++;
        }
      };

      for (let y = 0; y < vh; y++) {
        for (let x = 0; x < vw; x++) {
          const t = at(x, y);
          let nearWet = false;
          let nearLand = false;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              if (isWet(at(x + ox, y + oy))) nearWet = true;
              else nearLand = true;
            }
          }
          // Banks are grass: shore tiles only exist as water-in-grass art.
          if (t === Terrain.Dirt && nearWet) set(x, y, Terrain.Grass);
          // Deep water never touches land directly.
          if (t === Terrain.Deep && nearLand) set(x, y, Terrain.Water);
          // Single-vertex islands look like noise; drop them.
          if (!isWet(t) && !nearLand) set(x, y, Terrain.Water);
        }
      }

      // Diagonal-only corners (TL+BR vs TR+BL) have no tile art: fill one side.
      for (let y = 0; y < vh - 1; y++) {
        for (let x = 0; x < vw - 1; x++) {
          const fix = (p: (t: number) => boolean, to: Terrain) => {
            const a = p(at(x, y));
            const b = p(at(x + 1, y));
            const c = p(at(x, y + 1));
            const d = p(at(x + 1, y + 1));
            if (a && d && !b && !c) {
              set(x + 1, y, to);
              set(x, y + 1, to);
            } else if (b && c && !a && !d) {
              set(x, y, to);
              set(x + 1, y + 1, to);
            }
          };
          fix(isWet, Terrain.Water);
          fix((t) => t === Terrain.Deep, Terrain.Deep);
          fix((t) => t === Terrain.Grass, Terrain.Grass);
        }
      }
      if (!changed) break;
    }
  }

  private placeDecor() {
    const { width, height, seed } = this;
    const big = new Uint8Array(width * height); // tiles holding a blocking prop

    for (let ty = 2; ty < height - 1; ty++) {
      for (let tx = 2; tx < width - 2; tx++) {
        const c = this.corners(tx, ty);
        if (c.some(isWet) || this.isReserved(tx, ty)) continue;
        const allGrass = c.every((t) => t === Terrain.Grass);
        const allDirt = c.every((t) => t === Terrain.Dirt);
        const r = hash2(tx, ty, seed + 7);
        const r2 = hash2(tx, ty, seed + 8);
        const forest = fbm(tx / 28, ty / 28, seed + 999, 3);
        // Meadow fields are open: only the thickest woods stay, as small groves. Wild fields stay as they are.
        const meadow = FIELDS.some((f) => !f.wild && inRect(f.area, tx, ty));
        const e = this.elevation(tx, ty);
        // Petalfall grows cherry blossom (the broadleaf trees' spring look) even on its high ground, where pines would be.
        const spring = biomeAt(tx, ty) === "spring";

        // Blocking props keep a gap (checked against tiles already visited) so
        // canopies overlap a little but players can still walk between trunks.
        let free = true;
        for (let oy = -2; oy <= 0 && free; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            if (oy === 0 && ox >= 0) break;
            if (big[(ty + oy) * width + (tx + ox)]) {
              free = false;
              break;
            }
          }
        }

        let d: number = Decor.none;
        if (allGrass) {
          if (free && forest > (meadow ? 0.74 : 0.56) && r < (meadow ? 0.4 : 0.6)) {
            d =
              e > 0.58 && !spring
                ? r2 < 0.5
                  ? Decor.pine
                  : Decor.pineTall
                : [Decor.oak, Decor.oakRoots, Decor.oakTall, Decor.bushTree][Math.floor(r2 * 4)];
          } else if (free && r < 0.014) {
            d = [Decor.oak, Decor.oakTall, Decor.cypress, Decor.bush][Math.floor(r2 * 4)];
          } else if (r < 0.06) {
            d = r2 < 0.55 ? Decor.tallGrass : Decor.fern;
          } else if (r < 0.1 && forest < (meadow ? 0.6 : 0.45) && !isSnowy(tx, ty) && biomeAt(tx, ty) !== "ash" && biomeAt(tx, ty) !== "desert") {
            d = Decor.flowers;
          }
        } else if (allDirt) {
          if (free && r < 0.035) d = r2 < 0.5 ? Decor.boulder : Decor.rock;
          else if (free && r < 0.07 && e > 0.6) d = spring ? Decor.oakTall : Decor.pine;
          else if (r < 0.12) d = Decor.stone;
        }

        this.decor[ty * width + tx] = d;
        if (DECOR_BLOCKS[d]) big[ty * width + tx] = 1;
      }
    }
  }

  // ------------------------------------------------------------ queries

  vertexAt(vx: number, vy: number): number {
    if (vx < 0 || vy < 0 || vx >= this.vw || vy >= this.vh) return Terrain.Deep;
    return this.verts[vy * this.vw + vx];
  }

  /** Terrain at a tile's corners: [top-left, top-right, bottom-left, bottom-right]. */
  corners(tx: number, ty: number): [number, number, number, number] {
    return [this.vertexAt(tx, ty), this.vertexAt(tx + 1, ty), this.vertexAt(tx, ty + 1), this.vertexAt(tx + 1, ty + 1)];
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  decorAt(tx: number, ty: number): number {
    return this.inBounds(tx, ty) ? this.decor[ty * this.width + tx] : Decor.none;
  }

  floorAt(tx: number, ty: number): number {
    return this.inBounds(tx, ty) ? this.floor[ty * this.width + tx] : 0;
  }

  solidAt(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.solid[ty * this.width + tx] === 1;
  }

  isBlockedAt(px: number, py: number): boolean {
    const tx = Math.floor(px / TILE_SIZE);
    const ty = Math.floor(py / TILE_SIZE);
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.width + tx;
    // Water: the nearest vertex decides, which matches where the shoreline is drawn. Piers stand over it.
    if (isWet(this.vertexAt(Math.round(px / TILE_SIZE), Math.round(py / TILE_SIZE))) && this.floor[i] !== Floor.Pier) return true;
    return this.solid[i] === 1 || DECOR_BLOCKS[this.decor[i]];
  }

  /** Whether a player's feet can occupy pixel position (x, y). */
  canStand(x: number, y: number): boolean {
    return (
      !this.isBlockedAt(x - FOOT_HALF_W, y - FOOT_H) &&
      !this.isBlockedAt(x + FOOT_HALF_W, y - FOOT_H) &&
      !this.isBlockedAt(x - FOOT_HALF_W, y) &&
      !this.isBlockedAt(x + FOOT_HALF_W, y)
    );
  }

  /** Moves with per-axis collision so players slide along walls. */
  move(x: number, y: number, dx: number, dy: number): { x: number; y: number } {
    if (dx !== 0 && this.canStand(x + dx, y)) x += dx;
    if (dy !== 0 && this.canStand(x, y + dy)) y += dy;
    return { x, y };
  }

  /** True if every point sampled along the segment is standable (anti-teleport check). */
  canTravel(x0: number, y0: number, x1: number, y1: number): boolean {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / 6));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.canStand(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /** No water or props within `r` tiles (and the tiles just below, where tall sprites stand). */
  private isOpenArea(tx: number, ty: number, r: number): boolean {
    for (let y = ty - r; y <= ty + r + 2; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (!this.inBounds(x, y) || this.decorAt(x, y) !== Decor.none) return false;
        if (this.corners(x, y).some(isWet)) return false;
      }
    }
    return true;
  }

  /** A free spot on the town plaza (falls back to searching around the island centre). */
  findSpawn(rand: () => number = Math.random): { x: number; y: number } {
    for (let attempt = 0; attempt < 64; attempt++) {
      const x = (SPAWN_AREA.x + rand() * SPAWN_AREA.w) * TILE_SIZE;
      const y = (SPAWN_AREA.y + rand() * SPAWN_AREA.h) * TILE_SIZE;
      if (this.canStand(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return this.findWildSpawn(rand);
  }

  private findWildSpawn(rand: () => number): { x: number; y: number } {
    const cx = MAIN_CX;
    const cy = MAIN_CY;
    for (let radius = 2; radius < MAIN_CX; radius += 2) {
      for (let attempt = 0; attempt < 32; attempt++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * radius;
        const tx = Math.floor(cx + Math.cos(a) * r);
        const ty = Math.floor(cy + Math.sin(a) * r);
        const x = tx * TILE_SIZE + TILE_SIZE / 2;
        const y = ty * TILE_SIZE + TILE_SIZE / 2;
        if (this.canStand(x, y) && this.isOpenArea(tx, ty, 2)) return { x, y };
      }
    }
    return { x: cx * TILE_SIZE, y: cy * TILE_SIZE };
  }
}
