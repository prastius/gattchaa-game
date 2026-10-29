import Phaser from "phaser";
import { Terrain, TILE_SIZE, hash2, isWet, type World } from "../../../shared/world";
import { Floor, STRUCT_GROUPS, type StructStyle } from "../../../shared/town";

// Corner-based autotiling for Eliza Wyatt's LPC Revised terrain sheet.
//
// Each autotile set in the sheet is a 3x3 "outer" block (edges + outer corners)
// plus a 2x2 "inner" block (inner corners). Which tile to draw depends on which
// of the tile's four corners contain the terrain: a 4-bit mask TL=1 TR=2 BL=4 BR=8.

type Cell = readonly [col: number, row: number];
/** A cell in another sheet (town floors). */
export interface SheetCell {
  tex: string;
  cell: Cell;
}

export const FLOOR_TEX = {
  herringbone: "floor-herringbone",
  diamond: "floor-diamond",
  wall: "wall-brick",
  stone: "wall-stone",
  tile: "floor-tile",
  carpet: "carpet-floral",
  /** Wood Bridge A (no rails): the ferry piers. */
  pier: "pier",
  /** Plain black, generated at runtime (see WorldScene). */
  void: "floor-void",
} as const;

const FLOOR_CELLS: Record<number, SheetCell> = {
  [Floor.Stone]: { tex: FLOOR_TEX.herringbone, cell: [0, 0] },
  [Floor.StoneEdge]: { tex: FLOOR_TEX.herringbone, cell: [0, 1] },
  [Floor.Brand]: { tex: FLOOR_TEX.diamond, cell: [6, 2] },
  [Floor.Wood]: { tex: FLOOR_TEX.herringbone, cell: [2, 0] },
  [Floor.Void]: { tex: FLOOR_TEX.void, cell: [0, 0] },
  // Charcoal brick (Brick Wall A, bottom-left block): cap, body, baseboard.
  [Floor.WallTop]: { tex: FLOOR_TEX.wall, cell: [1, 6] },
  [Floor.WallMid]: { tex: FLOOR_TEX.wall, cell: [1, 7] },
  [Floor.WallBottom]: { tex: FLOOR_TEX.wall, cell: [1, 8] },
};

/** Big square flagstones (Tile C, cream): a 2x2 pattern. */
const SLAB_CELLS: SheetCell[] = [0, 1, 2, 3].map((i) => ({ tex: FLOOR_TEX.tile, cell: [i & 1, i >> 1] }));

/** Framed carpets: top-left of each colour's 3x3 corners/edges/fill block in Floral Carpet A. */
const CARPETS: Record<number, Cell> = {
  [Floor.CarpetRed]: [29, 6],
  [Floor.CarpetBlue]: [29, 0],
  [Floor.CarpetCream]: [1, 0],
};
const CARPET_CELLS: SheetCell[] = Object.values(CARPETS).flatMap(([cx, cy]) =>
  [0, 1, 2].flatMap((r) => [0, 1, 2].map((c): SheetCell => ({ tex: FLOOR_TEX.carpet, cell: [cx + c, cy + r] }))),
);

/** Pier planks: the left edge, the middle and the right edge. */
const PIER_CELLS: SheetCell[] = [0, 1, 2].map((c) => ({ tex: FLOOR_TEX.pier, cell: [c, 1] }));

/** Floor tile for a town tile, if it is paved. */
export function floorCell(world: World, tx: number, ty: number): SheetCell | null {
  const f = world.floorAt(tx, ty);
  if (f === Floor.Slab) return SLAB_CELLS[(tx & 1) | ((ty & 1) << 1)];
  if (f === Floor.Pier) return PIER_CELLS[world.floorAt(tx - 1, ty) !== f ? 0 : world.floorAt(tx + 1, ty) !== f ? 2 : 1];
  const carpet = CARPETS[f];
  if (carpet) {
    // Border where the carpet ends, fill inside.
    const col = world.floorAt(tx - 1, ty) !== f ? 0 : world.floorAt(tx + 1, ty) !== f ? 2 : 1;
    const row = world.floorAt(tx, ty - 1) !== f ? 0 : world.floorAt(tx, ty + 1) !== f ? 2 : 1;
    return { tex: FLOOR_TEX.carpet, cell: [carpet[0] + col, carpet[1] + row] };
  }
  return FLOOR_CELLS[f] ?? null;
}

// ---------------------------------------------------------------- stone structures
//
// Ramparts, towers and the palace (see STRUCT_BLOCKS) are drawn from tiles
// composed at load time: the top surface is a flagstone fill with battlements
// (or a smooth cornice) along every open edge, the face is the Jagged Stone
// Walls sheet with its end caps where the wall stops. Each distinct tile gets a
// string key, and only the keys the map actually uses are drawn into the atlas.

interface StyleArt {
  /** Wall face: top-left of a 3x3 Jagged Stone Walls panel (in tiles). */
  face: Cell;
  /** Top surface: top-left of a 2x2 Tile C colour group (in tiles), or a flat colour. */
  top: Cell | string;
  /** Parapet colours: outline, highlight, body, shade. */
  rim: [string, string, string, string];
}

const STYLES: Record<StructStyle, StyleArt> = {
  rampart: { face: [3, 0], top: [0, 4], rim: ["#4b4b60", "#d8d2c0", "#a89a8c", "#726b7e"] },
  palace: { face: [0, 0], top: [2, 2], rim: ["#4b4b60", "#ffffff", "#e3e7d3", "#c4b59f"] },
  // Indoors: the wall tops read as dark mass with a gilded edge, as in LPC interiors.
  hall: { face: [0, 0], top: "#1d1a24", rim: ["#100e14", "#f2c14e", "#3a3344", "#2a2532"] },
};

/** Structure tile key for a town tile, if a stone structure covers it. */
export function structKey(world: World, tx: number, ty: number): string | null {
  const s = world.structAt(tx, ty);
  if (s.top) {
    const g = STRUCT_GROUPS[s.top - 1];
    // Open edges: neighbours that are not the top of the same group.
    const same = (dx: number, dy: number) => world.structAt(tx + dx, ty + dy).top === s.top;
    const n = same(0, -1);
    const e = same(1, 0);
    const so = same(0, 1);
    const w = same(-1, 0);
    let mask = (n ? 1 : 0) | (e ? 2 : 0) | (so ? 4 : 0) | (w ? 8 : 0);
    // Inner corners: both sides join but the diagonal doesn't.
    if (n && e && !same(1, -1)) mask |= 16;
    if (so && e && !same(1, 1)) mask |= 32;
    if (so && w && !same(-1, 1)) mask |= 64;
    if (n && w && !same(-1, -1)) mask |= 128;
    return `T:${g.style}:${g.battlements ? 1 : 0}:${mask}:${tx & 1}${ty & 1}`;
  }
  if (s.face) {
    const g = STRUCT_GROUPS[s.face - 1];
    const same = (dx: number) => {
      const o = world.structAt(tx + dx, ty);
      return o.face === s.face || o.top === s.face;
    };
    const ends = (same(-1) ? 0 : 1) | (same(1) ? 0 : 2);
    const row = s.row === 0 ? 0 : s.row === g.face - 1 ? 2 : 1;
    return `F:${g.style}:${row}:${ends}`;
  }
  return null;
}

/** Draws the structure tile `key` at (x, y) on `ctx`. */
function drawStruct(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, key: string, x: number, y: number) {
  const S = TILE_SIZE;
  const parts = key.split(":");
  const art = STYLES[parts[1] as StructStyle];

  if (parts[0] === "F") {
    const stone = scene.textures.get(FLOOR_TEX.stone).getSourceImage() as HTMLImageElement;
    const row = Number(parts[2]);
    const ends = Number(parts[3]);
    const sy = (art.face[1] + row) * S;
    const col = (c: number) => (art.face[0] + c) * S;
    if (ends === 3) {
      // A one-tile-wide face: left half of the left cap + right half of the right cap.
      ctx.drawImage(stone, col(0), sy, S / 2, S, x, y, S / 2, S);
      ctx.drawImage(stone, col(2) + S / 2, sy, S / 2, S, x + S / 2, y, S / 2, S);
    } else {
      ctx.drawImage(stone, col(ends === 1 ? 0 : ends === 2 ? 2 : 1), sy, S, S, x, y, S, S);
    }
    return;
  }

  const battlements = parts[2] === "1";
  const mask = Number(parts[3]);
  if (typeof art.top === "string") {
    ctx.fillStyle = art.top;
    ctx.fillRect(x, y, S, S);
  } else {
    const tile = scene.textures.get(FLOOR_TEX.tile).getSourceImage() as HTMLImageElement;
    ctx.drawImage(tile, (art.top[0] + Number(parts[4][0])) * S, (art.top[1] + Number(parts[4][1])) * S, S, S, x, y, S, S);
  }

  const [outline, light, body, shade] = art.rim;
  const fill = (c: string, rx: number, ry: number, rw: number, rh: number) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + rx, y + ry, rw, rh);
  };
  /** A raised stone block seen from above: lit top, darker south side, outlined. */
  const block = (rx: number, ry: number, rw: number, rh: number) => {
    const side = Math.min(3, rh - 3);
    fill(outline, rx, ry, rw, rh);
    fill(body, rx + 1, ry + 1, rw - 2, rh - 2);
    fill(light, rx + 1, ry + 1, rw - 2, 1);
    fill(shade, rx + 1, ry + rh - 1 - side, rw - 2, side);
    // Soft shadow on the walkway just south of the block.
    if (ry + rh + 2 <= S) fill("rgba(20,16,30,0.28)", rx + 1, ry + rh, rw - 1, 2);
  };

  const open = { n: !(mask & 1), e: !(mask & 2), s: !(mask & 4), w: !(mask & 8) };
  if (battlements) {
    const L = 9; // merlon depth
    const low = 3; // the low wall the merlons stand on
    if (open.n) fill(outline, 0, 0, S, low), fill(shade, 0, 1, S, low - 1);
    if (open.s) fill(outline, 0, S - low, S, low), fill(shade, 0, S - low, S, low - 1);
    if (open.w) fill(outline, 0, 0, low, S), fill(shade, 1, 0, low - 1, S);
    if (open.e) fill(outline, S - low, 0, low, S), fill(shade, S - low, 0, low - 1, S);
    for (const m of [3, 19]) {
      if (open.n) block(m, 0, 10, L);
      if (open.s) block(m, S - L, 10, L);
      if (open.w) block(0, m - 2, L, 12);
      if (open.e) block(S - L, m - 2, L, 12);
    }
    if (mask & 16) block(S - L, 0, L, L);
    if (mask & 32) block(S - L, S - L, L, L);
    if (mask & 64) block(0, S - L, L, L);
    if (mask & 128) block(0, 0, L, L);
  } else {
    // A smooth cornice: one continuous band round the roof.
    const L = 5;
    const top = open.n ? 1 : 0;
    const bottom = open.s ? 1 : 0;
    if (open.n) fill(outline, 0, 0, S, L), fill(body, 0, 1, S, L - 2), fill(light, 0, 1, S, 1);
    if (open.s) fill(outline, 0, S - L, S, L), fill(body, 0, S - L + 1, S, L - 2), fill(light, 0, S - L + 1, S, 1);
    if (open.w) fill(outline, 0, 0, L, S), fill(body, 1, top, L - 2, S - top - bottom);
    if (open.e) fill(outline, S - L, 0, L, S), fill(body, S - L + 1, top, L - 2, S - top - bottom);
    for (const [bit, cx, cy] of [[16, S - L, 0], [32, S - L, S - L], [64, 0, S - L], [128, 0, 0]] as const) {
      if (mask & bit) fill(outline, cx, cy, L, L), fill(body, cx + 1, cy + 1, L - 2, L - 2);
    }
  }
}
interface AutoSet {
  outer: Cell;
  inner: Cell;
}

const GRASS: AutoSet = { outer: [0, 0], inner: [0, 6] }; // grass over transparent
const WATER: AutoSet = { outer: [0, 10], inner: [0, 13] }; // water inside grassy banks
const DEEP: AutoSet = { outer: [0, 23], inner: [3, 23] }; // deep water inside shallow water

const GRASS_FULL: Cell[] = [[1, 1], [3, 1], [4, 1], [5, 1], [3, 2], [4, 2], [5, 2]];
const DIRT_FULL: Cell[] = [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4]];
const WATER_FULL: Cell[] = [[1, 11], [12, 16], [13, 16], [14, 16], [15, 16], [12, 17], [13, 17], [14, 17], [15, 17]];

function autotile(mask: number, set: AutoSet): Cell {
  const [ox, oy] = set.outer;
  const [ix, iy] = set.inner;
  switch (mask) {
    case 15: return [ox + 1, oy + 1];
    case 8: return [ox, oy]; // only bottom-right
    case 4: return [ox + 2, oy]; // only bottom-left
    case 2: return [ox, oy + 2]; // only top-right
    case 1: return [ox + 2, oy + 2]; // only top-left
    case 12: return [ox + 1, oy]; // bottom half
    case 3: return [ox + 1, oy + 2]; // top half
    case 10: return [ox, oy + 1]; // right half
    case 5: return [ox + 2, oy + 1]; // left half
    case 7: return [ix, iy]; // all but bottom-right
    case 11: return [ix + 1, iy]; // all but bottom-left
    case 13: return [ix, iy + 1]; // all but top-right
    case 14: return [ix + 1, iy + 1]; // all but top-left
    default: return [ox + 1, oy + 1]; // diagonals are removed by the generator
  }
}

function mask(c: readonly number[], pred: (t: number) => boolean): number {
  return (pred(c[0]) ? 1 : 0) | (pred(c[1]) ? 2 : 0) | (pred(c[2]) ? 4 : 0) | (pred(c[3]) ? 8 : 0);
}

function pickVariant(list: Cell[], tx: number, ty: number, seed: number): Cell {
  // First entry is the "plain" tile; keep it most common so the ground isn't busy.
  const r = hash2(tx, ty, seed);
  return r < 0.55 ? list[0] : list[1 + Math.floor(((r - 0.55) / 0.45) * (list.length - 1))];
}

/** Source cells for a tile: [ground, overlay or null]. */
export function tileCells(world: World, tx: number, ty: number): [Cell, Cell | null] {
  const c = world.corners(tx, ty);
  const wet = mask(c, isWet);
  if (wet === 15) {
    const deep = mask(c, (t) => t === Terrain.Deep);
    return [deep ? autotile(deep, DEEP) : pickVariant(WATER_FULL, tx, ty, world.seed + 3), null];
  }
  if (wet) return [autotile(wet, WATER), null];
  const grass = mask(c, (t) => t === Terrain.Grass);
  if (grass === 15) return [pickVariant(GRASS_FULL, tx, ty, world.seed + 3), null];
  return [pickVariant(DIRT_FULL, tx, ty, world.seed + 4), grass ? autotile(grass, GRASS) : null];
}

const ATLAS_COLS = 16;
const PAD = 1; // 1px extruded border around every tile: prevents seams/flicker
const STRIDE = TILE_SIZE + PAD * 2;

export interface TerrainAtlas {
  /** A terrain cell, from the winter sheet on Frostfell. */
  terrain(cell: Cell, winter?: boolean): number;
  sheet(c: SheetCell): number;
  struct(key: string): number;
}

/**
 * Copies every tile the autotiler can produce (from the summer sheet and the
 * winter one, which has the same layout) plus the town floors into one padded
 * atlas texture and returns lookups from source cell to atlas index.
 */
export function buildTerrainAtlas(scene: Phaser.Scene, sourceKey: string, winterKey: string, atlasKey: string, structKeys: Iterable<string> = []): TerrainAtlas {
  const cells: Cell[] = [...GRASS_FULL, ...DIRT_FULL, ...WATER_FULL];
  for (const set of [GRASS, WATER, DEEP]) {
    for (let m = 1; m <= 15; m++) if (m !== 6 && m !== 9) cells.push(autotile(m, set));
  }
  const entries: SheetCell[] = [
    ...[sourceKey, winterKey].flatMap((tex) => [...new Map(cells.map((c) => [`${c[0]},${c[1]}`, { tex, cell: c }])).values()]),
    ...Object.values(FLOOR_CELLS),
    ...SLAB_CELLS,
    ...CARPET_CELLS,
    ...PIER_CELLS,
  ];
  const keyOf = (e: SheetCell) => `${e.tex}:${e.cell[0]},${e.cell[1]}`;
  const structs = [...new Set(structKeys)];

  const rows = Math.ceil((entries.length + structs.length) / ATLAS_COLS);
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * STRIDE;
  canvas.height = rows * STRIDE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const index = new Map<string, number>();
  entries.forEach((entry, i) => {
    const src = scene.textures.get(entry.tex).getSourceImage() as HTMLImageElement;
    const ax = (i % ATLAS_COLS) * STRIDE + PAD;
    const ay = Math.floor(i / ATLAS_COLS) * STRIDE + PAD;
    const sx = entry.cell[0] * TILE_SIZE;
    const sy = entry.cell[1] * TILE_SIZE;
    const S = TILE_SIZE;
    ctx.drawImage(src, sx, sy, S, S, ax, ay, S, S);
    // Extrude edges by one pixel.
    ctx.drawImage(src, sx, sy, S, 1, ax, ay - 1, S, 1);
    ctx.drawImage(src, sx, sy + S - 1, S, 1, ax, ay + S, S, 1);
    ctx.drawImage(src, sx, sy, 1, S, ax - 1, ay, 1, S);
    ctx.drawImage(src, sx + S - 1, sy, 1, S, ax + S, ay, 1, S);
    ctx.drawImage(src, sx, sy, 1, 1, ax - 1, ay - 1, 1, 1);
    ctx.drawImage(src, sx + S - 1, sy, 1, 1, ax + S, ay - 1, 1, 1);
    ctx.drawImage(src, sx, sy + S - 1, 1, 1, ax - 1, ay + S, 1, 1);
    ctx.drawImage(src, sx + S - 1, sy + S - 1, 1, 1, ax + S, ay + S, 1, 1);
    index.set(keyOf(entry), i);
  });
  const structIndex = new Map<string, number>();
  structs.forEach((key, j) => {
    const i = entries.length + j;
    const ax = (i % ATLAS_COLS) * STRIDE + PAD;
    const ay = Math.floor(i / ATLAS_COLS) * STRIDE + PAD;
    drawStruct(scene, ctx, key, ax, ay);
    // Extrude edges by one pixel (copied from the tile just drawn).
    const S = TILE_SIZE;
    ctx.drawImage(canvas, ax, ay, S, 1, ax, ay - 1, S, 1);
    ctx.drawImage(canvas, ax, ay + S - 1, S, 1, ax, ay + S, S, 1);
    ctx.drawImage(canvas, ax, ay - 1, 1, S + 2, ax - 1, ay - 1, 1, S + 2);
    ctx.drawImage(canvas, ax + S - 1, ay - 1, 1, S + 2, ax + S, ay - 1, 1, S + 2);
    structIndex.set(key, i);
  });

  scene.textures.addCanvas(atlasKey, canvas);
  return {
    terrain: (cell, winter) => index.get(keyOf({ tex: winter ? winterKey : sourceKey, cell })) ?? 0,
    sheet: (c) => index.get(keyOf(c)) ?? 0,
    struct: (key) => structIndex.get(key) ?? 0,
  };
}

export const ATLAS_MARGIN = PAD;
export const ATLAS_SPACING = PAD * 2;
