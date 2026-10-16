import Phaser from "phaser";
import { Terrain, TILE_SIZE, hash2, isWet, type World } from "../../../shared/world";
import { Floor } from "../../../shared/town";

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

/** Floor tile for a town tile, if it is paved. */
export function floorCell(world: World, tx: number, ty: number): SheetCell | null {
  return FLOOR_CELLS[world.floorAt(tx, ty)] ?? null;
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
  terrain(cell: Cell): number;
  sheet(c: SheetCell): number;
}

/**
 * Copies every tile the autotiler can produce (plus the town floors) into one
 * padded atlas texture and returns lookups from source cell to atlas index.
 */
export function buildTerrainAtlas(scene: Phaser.Scene, sourceKey: string, atlasKey: string): TerrainAtlas {
  const cells: Cell[] = [...GRASS_FULL, ...DIRT_FULL, ...WATER_FULL];
  for (const set of [GRASS, WATER, DEEP]) {
    for (let m = 1; m <= 15; m++) if (m !== 6 && m !== 9) cells.push(autotile(m, set));
  }
  const entries: SheetCell[] = [
    ...new Map(cells.map((c) => [`${c[0]},${c[1]}`, { tex: sourceKey, cell: c }])).values(),
    ...Object.values(FLOOR_CELLS),
  ];
  const keyOf = (e: SheetCell) => `${e.tex}:${e.cell[0]},${e.cell[1]}`;

  const rows = Math.ceil(entries.length / ATLAS_COLS);
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

  scene.textures.addCanvas(atlasKey, canvas);
  return {
    terrain: (cell) => index.get(keyOf({ tex: sourceKey, cell })) ?? 0,
    sheet: (c) => index.get(keyOf(c)) ?? 0,
  };
}

export const ATLAS_MARGIN = PAD;
export const ATLAS_SPACING = PAD * 2;
