// Deterministic world generation shared by client (rendering) and server (validation).
// Both sides build the exact same map from the same seed, so the map itself never
// has to be sent over the network.

export const TILE_SIZE = 32;
export const WORLD_TILES_W = 512;
export const WORLD_TILES_H = 512;
export const WORLD_PX_W = WORLD_TILES_W * TILE_SIZE;
export const WORLD_PX_H = WORLD_TILES_H * TILE_SIZE;
export const WORLD_SEED = 1337;

export const PLAYER_SPEED = 180; // pixels per second
export const CHUNK_TILES = 32; // client streams ground + decorations in chunks of this size

export const Tile = {
  DeepWater: 0,
  Water: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Rock: 5,
  Snow: 6,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];
export const TILE_TYPE_COUNT = 7;

export const Decor = {
  None: 0,
  Tree: 1,
  Pine: 2,
  Boulder: 3,
} as const;
export const TILE_VARIANTS = 4;

const BLOCKING_TILES = new Set<number>([Tile.DeepWater, Tile.Water]);

// Feet hitbox, relative to the player's (x, y) which sits at the feet.
const FOOT_HALF_W = 9;
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
  readonly tiles: Uint8Array;
  readonly decor: Uint8Array; // Blocking decoration per tile, see Decor
  readonly seed: number;

  constructor(seed = WORLD_SEED) {
    this.seed = seed;
    this.tiles = new Uint8Array(this.width * this.height);
    this.decor = new Uint8Array(this.width * this.height);
    this.generate();
  }

  private generate(): void {
    const { width, height, seed } = this;
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(cx, cy);

    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        // Island shape: noise elevation pulled down toward the edges, so the
        // world is naturally bounded by ocean.
        const dx = (tx - cx) / maxR;
        const dy = (ty - cy) / maxR;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let e = fbm(tx / 90, ty / 90, seed, 5);
        e = e * 1.2 - Math.pow(dist, 4) * 0.8 + 0.12;
        const m = fbm(tx / 60, ty / 60, seed + 999, 4);

        let tile: Tile;
        if (e < 0.3) tile = Tile.DeepWater;
        else if (e < 0.36) tile = Tile.Water;
        else if (e < 0.4) tile = Tile.Sand;
        else if (e < 0.7) tile = m > 0.53 ? Tile.Forest : Tile.Grass;
        else if (e < 0.78) tile = Tile.Rock;
        else tile = Tile.Snow;

        const i = ty * width + tx;
        this.tiles[i] = tile;

        const r = hash2(tx, ty, seed + 7);
        if (tile === Tile.Forest && r < 0.38) this.decor[i] = e > 0.6 ? Decor.Pine : Decor.Tree;
        else if (tile === Tile.Grass && r < 0.025) this.decor[i] = Decor.Tree;
        else if (tile === Tile.Rock && r < 0.18) this.decor[i] = Decor.Boulder;
        else if (tile === Tile.Snow && r < 0.05) this.decor[i] = Decor.Pine;
      }
    }
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  tileAt(tx: number, ty: number): Tile {
    return this.tiles[ty * this.width + tx] as Tile;
  }

  /** Tile index into the generated tileset (type * variants + variant). */
  tileIndexAt(tx: number, ty: number): number {
    const variant = Math.floor(hash2(tx, ty, this.seed + 3) * TILE_VARIANTS);
    return this.tileAt(tx, ty) * TILE_VARIANTS + variant;
  }

  isBlockedTile(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.width + tx;
    return BLOCKING_TILES.has(this.tiles[i]) || this.decor[i] !== 0;
  }

  isBlockedAt(px: number, py: number): boolean {
    return this.isBlockedTile(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
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
    const steps = Math.max(1, Math.ceil(dist / 8));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.canStand(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /** Finds a standable spawn point near the island centre. */
  findSpawn(rand: () => number = Math.random): { x: number; y: number } {
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (let radius = 2; radius < this.width / 2; radius += 2) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * radius;
        const x = (cx + Math.cos(a) * r) * TILE_SIZE + TILE_SIZE / 2;
        const y = (cy + Math.sin(a) * r) * TILE_SIZE + TILE_SIZE / 2;
        if (this.canStand(x, y)) return { x, y };
      }
    }
    return { x: cx * TILE_SIZE, y: cy * TILE_SIZE };
  }
}
