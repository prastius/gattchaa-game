// Gattchaa Town: the hand-built plaza in the middle of the island.
//
// Pure data (tile coordinates), shared by the server (collision, spawning, NPC
// walking) and the client (rendering). The procedural world is generated
// first; World then flattens this area, clears trees and stamps the floors and
// props below on top of it.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Paved floors drawn over the terrain (per tile, hard edges). */
export const Floor = {
  None: 0,
  Stone: 1,
  StoneEdge: 2,
  Brand: 3, // orange diamond tiles in front of the store
  Wood: 4, // the Rooms deck and the store interior
  Void: 5, // black, solid: everything around the store interior
  WallTop: 6, // the store's back wall, three tiles tall
  WallMid: 7,
  WallBottom: 8,
} as const;
export type Floor = (typeof Floor)[keyof typeof Floor];
/** Floors that block movement. */
export const SOLID_FLOORS: readonly number[] = [Floor.Void, Floor.WallTop, Floor.WallMid, Floor.WallBottom];

/** Flattened to grass and cleared of trees. */
export const TOWN_AREA: Rect = { x: 168, y: 171, w: 49, h: 42 };
export const PLAZA: Rect = { x: 176, y: 185, w: 33, h: 21 };
export const ROOMS_DECK: Rect = { x: 177, y: 192, w: 10, h: 12 };
export const BRAND_TERRACE: Rect = { x: 187, y: 185, w: 11, h: 2 };
/** New players appear south of the fountain. */
export const SPAWN_AREA: Rect = { x: 187, y: 197, w: 11, h: 6 };
/** Where wandering NPCs may walk. */
export const WANDER_AREA: Rect = { x: 187, y: 188, w: 11, h: 16 };

/** Dirt roads (vertex rectangles) leading out of town. */
export const ROADS: Rect[] = [
  { x: 190, y: 205, w: 5, h: 40 }, // south
  { x: 138, y: 187, w: 39, h: 4 }, // west
  { x: 208, y: 199, w: 40, h: 4 }, // east
];

// ---------------------------------------------------------------- store interior
//
// The inside of the Gattchaa store lives in the far north-west corner of the
// map, out in the ocean where nobody can walk. The door teleports you there, so
// it needs no separate map or room, and interest management keeps shoppers
// inside from seeing (or being seen by) the plaza.

/** Two 16x16 chunks square; the client draws only this while you're inside. */
export const INTERIOR_ZONE: Rect = { x: 0, y: 0, w: 32, h: 32 };
/** The walkable room plus its back wall (rows 8-10). */
export const STORE_ROOM: Rect = { x: 6, y: 8, w: 20, h: 13 };
const ROOM_FLOOR: Rect = { x: 6, y: 11, w: 20, h: 10 };
export const STORE_RUG: Rect = { x: 13, y: 14, w: 6, h: 5 };
/** Where the in-store shopper may wander. */
export const STORE_WANDER: Rect = { x: 11, y: 14, w: 10, h: 6 };

export const FLOORS: { rect: Rect; floor: Floor }[] = [
  { rect: PLAZA, floor: Floor.Stone },
  { rect: ROOMS_DECK, floor: Floor.Wood },
  { rect: BRAND_TERRACE, floor: Floor.Brand },
  { rect: INTERIOR_ZONE, floor: Floor.Void },
  { rect: { x: STORE_ROOM.x, y: 8, w: STORE_ROOM.w, h: 1 }, floor: Floor.WallTop },
  { rect: { x: STORE_ROOM.x, y: 9, w: STORE_ROOM.w, h: 1 }, floor: Floor.WallMid },
  { rect: { x: STORE_ROOM.x, y: 10, w: STORE_ROOM.w, h: 1 }, floor: Floor.WallBottom },
  { rect: ROOM_FLOOR, floor: Floor.Wood },
  { rect: STORE_RUG, floor: Floor.Brand },
  { rect: { x: 15, y: 20, w: 2, h: 1 }, floor: Floor.Brand }, // doormat
];

/**
 * Doors: stepping into `trigger` (pixels) while walking in `dir` asks the
 * server to move you to `to`. The server re-checks that you're really there.
 */
export interface Door {
  id: string;
  label: string;
  trigger: Rect;
  /** 0 = up, 2 = down (protocol Dir values). */
  dir: number;
  to: { x: number; y: number };
}

const STORE_DOOR_X = 6112; // centre of the doorway in the Brick House sprite
export const DOORS: Door[] = [
  {
    id: "store-in",
    label: "Enter Gattchaa Store",
    trigger: { x: STORE_DOOR_X - 16, y: 185 * 32, w: 32, h: 26 },
    dir: 0,
    to: { x: 16 * 32, y: 20 * 32 + 8 },
  },
  {
    id: "store-out",
    label: "Back to town",
    trigger: { x: 15 * 32, y: 20 * 32 + 14, w: 64, h: 18 },
    dir: 2,
    to: { x: STORE_DOOR_X, y: 186 * 32 + 4 },
  },
];

/**
 * Prop footprints: `w` x `h` solid tiles. The sprite is anchored at the
 * footprint's bottom centre and may extend above it (roofs, lamp posts).
 */
export const PROP_TYPES = {
  store: { w: 7, h: 6 },
  kujiHouse: { w: 5, h: 5 },
  gradingHouse: { w: 5, h: 4 },
  fountain: { w: 2, h: 2 },
  machine: { w: 1, h: 1 },
  counter: { w: 3, h: 1 },
  cardTable: { w: 2, h: 1 },
  lamp: { w: 1, h: 1 },
  pottedTree: { w: 1, h: 1 },
  barrels: { w: 2, h: 1 },
  barrel: { w: 1, h: 1 },
  crate: { w: 1, h: 1 },
  stool: { w: 1, h: 1, walkable: true },
  shelf: { w: 1, h: 1 },
  floorLamp: { w: 1, h: 1 },
} as const satisfies Record<string, { w: number; h: number; walkable?: boolean }>;
export type PropType = keyof typeof PROP_TYPES;

export interface Prop {
  type: PropType;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  /** Links the prop to an interaction (machine id, table index…). */
  tag?: string;
  variant?: number;
}

/** Oripa machines: one per franchise, matched against live category titles. */
export const MACHINES: { id: string; label: string; match: RegExp }[] = [
  { id: "pokemon-id", label: "POKÉMON ID", match: /pok[eé]mon\s*id/i },
  { id: "pokemon-ch", label: "POKÉMON CH", match: /pok[eé]mon\s*ch/i },
  { id: "pokemon-jp", label: "POKÉMON JP", match: /pok[eé]mon\s*jp/i },
  { id: "one-piece", label: "ONE PIECE", match: /one\s*piece/i },
  { id: "yugioh", label: "YU-GI-OH!", match: /yu-?gi-?oh/i },
  { id: "digimon", label: "DIGIMON", match: /digimon/i },
  { id: "anime", label: "ANIME TCG", match: /union arena|gundam|dragon ball|hololive|wuthering/i },
  { id: "more", label: "MORE TCG", match: /riftbound|vanguard|shadowverse|wei|marvel/i },
];

const props: Prop[] = [
  { type: "store", x: 189, y: 179 },
  { type: "kujiHouse", x: 179, y: 180 },
  { type: "gradingHouse", x: 200, y: 181 },
  { type: "fountain", x: 191, y: 193 },

  // Stalls (vendors stand behind the counters)
  { type: "counter", x: 199, y: 189, tag: "stall:pokemon" },
  { type: "counter", x: 204, y: 189, tag: "stall:anime" },
  { type: "counter", x: 199, y: 195, tag: "stall:duel" },
  { type: "counter", x: 204, y: 195, tag: "stall:market" },
  { type: "crate", x: 207, y: 189, variant: 0 },
  { type: "barrel", x: 202, y: 189 },
  { type: "barrels", x: 207, y: 195 },
  { type: "crate", x: 202, y: 195, variant: 1 },

  // Rooms deck: four tables with stools
  ...[
    [178, 195],
    [183, 195],
    [178, 200],
    [183, 200],
  ].flatMap(([x, y], i): Prop[] => [
    { type: "cardTable", x, y, tag: `table:${i}` },
    { type: "stool", x, y: y - 1, variant: 5 },
    { type: "stool", x: x + 1, y: y - 1, variant: 5 },
    { type: "stool", x, y: y + 1, variant: 5 },
    { type: "stool", x: x + 1, y: y + 1, variant: 5 },
  ]),

  // Lamps and greenery
  { type: "lamp", x: 176, y: 185 },
  { type: "lamp", x: 208, y: 185 },
  { type: "lamp", x: 176, y: 205 },
  { type: "lamp", x: 208, y: 205 },
  { type: "lamp", x: 189, y: 205 },
  { type: "lamp", x: 195, y: 205 },
  { type: "lamp", x: 188, y: 192 },
  { type: "lamp", x: 196, y: 192 },
  { type: "pottedTree", x: 187, y: 185 },
  { type: "pottedTree", x: 197, y: 185 },
  { type: "pottedTree", x: 177, y: 185 },
  { type: "pottedTree", x: 207, y: 185 },
];

// Machines: four in each gap between the buildings.
[184, 185, 186, 187, 196, 197, 198, 199].forEach((x, i) => {
  props.push({ type: "machine", x, y: 184, tag: `machine:${MACHINES[i].id}`, variant: i % 2 });
});

// Inside the store: the full machine wall, two counters, shelves and a play corner.
[7, 8, 9, 10, 21, 22, 23, 24].forEach((x, i) => {
  props.push({ type: "machine", x, y: 13, tag: `machine:${MACHINES[i].id}`, variant: (i + 1) % 2 });
});
props.push(
  { type: "counter", x: 12, y: 11, tag: "stall:pickup" },
  { type: "counter", x: 17, y: 11, tag: "stall:new" },
  ...[7, 8, 9, 22, 23, 24].map((x, i): Prop => ({ type: "shelf", x, y: 11, variant: i % 2 })),
  ...[
    [8, 17],
    [22, 17],
  ].flatMap(([x, y], i): Prop[] => [
    { type: "cardTable", x, y, tag: `table:${4 + i}` },
    { type: "stool", x, y: y - 1, variant: 0 },
    { type: "stool", x: x + 1, y: y - 1, variant: 0 },
    { type: "stool", x, y: y + 1, variant: 0 },
    { type: "stool", x: x + 1, y: y + 1, variant: 0 },
  ]),
  { type: "pottedTree", x: 6, y: 20 },
  { type: "pottedTree", x: 25, y: 20 },
  { type: "floorLamp", x: 11, y: 11 },
  { type: "floorLamp", x: 20, y: 11 },
);

export const PROPS: readonly Prop[] = props;

export const TILE = 32;
/** Pixel position of a prop's anchor (bottom centre of its footprint). */
export function propAnchor(p: Prop): { x: number; y: number } {
  const t = PROP_TYPES[p.type];
  return { x: (p.x + t.w / 2) * TILE, y: (p.y + t.h) * TILE };
}
