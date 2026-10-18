// Gattchaa Town: the walled royal town in the middle of the island.
//
// Pure data (tile coordinates), shared by the server (collision, spawning, NPC
// walking) and the client (rendering). The procedural world is generated
// first; World then flattens this area, clears trees and stamps the floors,
// stone structures and props below on top of it.
//
// Layout, north to south (the town is mirrored around tile column 192):
//   Gattchaa Palace (the store) against the north rampart, oripa machines at its feet
//   Forecourt with the Kuji house (west) and Grading house (east)
//   Gardens either side of the grand avenue
//   Fountain plaza where the east-west street crosses the avenue
//   Rooms pavilion (west) and the market (east)
//   South gate between two towers, the main road out

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
  Brand: 3, // orange diamond tiles in front of the palace door
  Wood: 4, // the Rooms pavilion
  Void: 5, // black, solid: everything around the palace interior
  WallTop: 6, // the store's back wall, three tiles tall
  WallMid: 7,
  WallBottom: 8,
  Slab: 9, // big square flagstones: forecourt, market and the palace hall
  // Framed carpets (Floral Carpet A): any rectangle gets a gold-trimmed border.
  CarpetRed: 10,
  CarpetBlue: 11,
  CarpetCream: 12,
} as const;
export type Floor = (typeof Floor)[keyof typeof Floor];
/** Floors that block movement. */
export const SOLID_FLOORS: readonly number[] = [Floor.Void, Floor.WallTop, Floor.WallMid, Floor.WallBottom];

/** The town's centre line: tiles 191 | 192, pixel x 6144. */
export const TOWN_CX = 192;

/** Flattened to grass and cleared of wild trees. */
export const TOWN_AREA: Rect = { x: 148, y: 148, w: 88, h: 80 };
/** Inside the ramparts. */
export const TOWN_INSIDE: Rect = { x: 158, y: 161, w: 68, h: 55 };

export const AVENUE: Rect = { x: 189, y: 176, w: 6, h: 46 };
export const STREET: Rect = { x: 150, y: 185, w: 84, h: 4 };
export const FORECOURT: Rect = { x: 160, y: 169, w: 64, h: 7 };
export const BRAND_TERRACE: Rect = { x: 186, y: 169, w: 12, h: 3 };
export const PLAZA: Rect = { x: 179, y: 181, w: 26, h: 21 };
export const PAVILION: Rect = { x: 162, y: 193, w: 15, h: 15 };
export const MARKET: Rect = { x: 207, y: 193, w: 15, h: 15 };
/** New players appear on the avenue just south of the plaza. */
export const SPAWN_AREA: Rect = { x: 189, y: 203, w: 6, h: 9 };
/** Where wandering NPCs may walk: the fountain plaza. */
export const WANDER_AREA: Rect = { x: 180, y: 182, w: 24, h: 19 };

/** Dirt roads (vertex rectangles) leading out of the three gates. */
export const ROADS: Rect[] = [
  { x: 189, y: 218, w: 6, h: 44 }, // south
  { x: 104, y: 185, w: 50, h: 4 }, // west
  { x: 230, y: 185, w: 50, h: 4 }, // east
];

// ---------------------------------------------------------------- stone structures
//
// Ramparts, towers and the palace are raised stone blocks: a flat top (seen
// from above) with a wall face hanging below its south edge, `face` tiles tall.
// Both are solid. Blocks of the same group merge seamlessly; a later block is
// drawn over an earlier one, so towers stand in front of the walls they join.

export const STRUCT_GROUPS = [
  { id: "rampart", style: "rampart", face: 3, battlements: true },
  { id: "tower", style: "rampart", face: 4, battlements: true },
  { id: "palace", style: "palace", face: 4, battlements: false },
  { id: "palaceTower", style: "palace", face: 5, battlements: true },
  { id: "keep", style: "palace", face: 4, battlements: true },
  { id: "hall", style: "hall", face: 4, battlements: false },
] as const;
export type StructGroup = (typeof STRUCT_GROUPS)[number]["id"];
export type StructStyle = (typeof STRUCT_GROUPS)[number]["style"];

export interface StructBlock {
  group: StructGroup;
  rect: Rect;
  /** Override the group's face height (0 = no face, e.g. a wall seen only from its inner side). */
  face?: number;
}

/** Mirror a rect across the town's centre line. */
const mirror = (r: Rect): Rect => ({ ...r, x: 2 * TOWN_CX - r.x - r.w });
const both = (group: StructGroup, r: Rect): StructBlock[] => [
  { group, rect: r },
  { group, rect: mirror(r) },
];

export const STRUCT_BLOCKS: StructBlock[] = [
  // Ramparts: two tiles thick. Gaps for the south gate and the west/east street.
  { group: "rampart", rect: { x: 156, y: 156, w: 72, h: 2 } },
  ...both("rampart", { x: 156, y: 216, w: 33, h: 2 }),
  ...both("rampart", { x: 156, y: 156, w: 2, h: 26 }),
  ...both("rampart", { x: 156, y: 189, w: 2, h: 29 }),
  // Corner towers, and a pair of towers at each gate.
  ...both("tower", { x: 154, y: 154, w: 5, h: 5 }),
  ...both("tower", { x: 154, y: 213, w: 5, h: 5 }),
  ...both("tower", { x: 154, y: 177, w: 5, h: 4 }),
  ...both("tower", { x: 154, y: 189, w: 5, h: 4 }),
  ...both("tower", { x: 184, y: 213, w: 5, h: 5 }),
  // Gattchaa Palace: the main hall, a tower at each end and a raised keep.
  { group: "palace", rect: { x: 178, y: 157, w: 28, h: 8 } },
  ...both("palaceTower", { x: 172, y: 155, w: 6, h: 9 }),
  { group: "keep", rect: { x: 185, y: 153, w: 14, h: 6 } },
  // The palace hall's walls (interior, see below): a tall back wall, then sides and front
  // seen only from inside, so they show no face.
  { group: "hall", rect: { x: 6, y: 4, w: 52, h: 2 } },
  { group: "hall", rect: { x: 6, y: 4, w: 2, h: 36 }, face: 0 },
  { group: "hall", rect: { x: 56, y: 4, w: 2, h: 36 }, face: 0 },
  { group: "hall", rect: { x: 6, y: 38, w: 24, h: 2 }, face: 0 },
  { group: "hall", rect: { x: 34, y: 38, w: 24, h: 2 }, face: 0 },
];

/** The palace face (row 165-168) and its door, centred on the town line. */
export const PALACE_FACE_BOTTOM = 169; // first tile row below the palace face
export const PALACE_DOOR_X = TOWN_CX * 32;

// ---------------------------------------------------------------- palace interior
//
// The inside of Gattchaa Palace lives in the far north-west corner of the map,
// out in the ocean where nobody can walk. The door teleports you there, so it
// needs no separate map or room, and interest management keeps shoppers inside
// from seeing (or being seen by) the town.
//
// One grand hall, 48 x 28 tiles, mirrored around tile column 32:
//   north wall: crest and throne in the middle, Pickup and New & Hot counters either side
//   west wing: the oripa machine gallery, booster-box aisles, a lounge
//   east wing: the Battle Hall with six Rooms tables
//   a red carpet from the door to the throne, lined with columns

/** Four 16x16 chunks by three; the client draws only this while you're inside. */
export const INTERIOR_ZONE: Rect = { x: 0, y: 0, w: 64, h: 48 };
/** The hall's walkable floor. */
export const HALL: Rect = { x: 8, y: 10, w: 48, h: 28 };
export const HALL_CX = 32;
export const HALL_RUNNER: Rect = { x: 30, y: 13, w: 4, h: 25 };
export const HALL_DAIS: Rect = { x: 21, y: 10, w: 22, h: 3 };
export const BATTLE_HALL: Rect = { x: 41, y: 15, w: 14, h: 20 };
export const LOUNGE: Rect = { x: 10, y: 26, w: 12, h: 8 };
/** Where the in-palace shopper may wander. */
export const STORE_WANDER: Rect = { x: 24, y: 15, w: 16, h: 20 };

export const FLOORS: { rect: Rect; floor: Floor }[] = [
  { rect: AVENUE, floor: Floor.Stone },
  // Paved through the west and east gates.
  { rect: { x: 153, y: STREET.y, w: 78, h: STREET.h }, floor: Floor.Stone },
  { rect: PLAZA, floor: Floor.Stone },
  // Flagstone square round the fountain.
  { rect: { x: 188, y: 188, w: 8, h: 6 }, floor: Floor.Slab },
  { rect: FORECOURT, floor: Floor.Slab },
  { rect: MARKET, floor: Floor.Slab },
  { rect: PAVILION, floor: Floor.Wood },
  { rect: BRAND_TERRACE, floor: Floor.Brand },
  // Paths from the street to the pavilion and market.
  { rect: { x: 168, y: 189, w: 3, h: 4 }, floor: Floor.Stone },
  { rect: mirror({ x: 168, y: 189, w: 3, h: 4 }), floor: Floor.Stone },
  // Paths from the forecourt down to the street.
  { rect: { x: 168, y: 176, w: 3, h: 9 }, floor: Floor.Stone },
  { rect: mirror({ x: 168, y: 176, w: 3, h: 9 }), floor: Floor.Stone },

  { rect: INTERIOR_ZONE, floor: Floor.Void },
  { rect: HALL, floor: Floor.Slab },
  { rect: HALL_DAIS, floor: Floor.CarpetCream },
  { rect: HALL_RUNNER, floor: Floor.CarpetRed },
  { rect: BATTLE_HALL, floor: Floor.CarpetBlue },
  { rect: LOUNGE, floor: Floor.CarpetCream },
  { rect: { x: 30, y: 38, w: 4, h: 2 }, floor: Floor.Brand }, // the doorway
];

/** Garden beds: flowers and clipped trees, no paving. */
export const GARDENS: Rect[] = [
  { x: 160, y: 177, w: 7, h: 7 },
  { x: 172, y: 177, w: 16, h: 3 },
  { x: 160, y: 209, w: 23, h: 5 },
  { x: 172, y: 190, w: 5, h: 2 },
].flatMap((r) => [r, mirror(r)]);

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

export const DOORS: Door[] = [
  {
    id: "store-in",
    label: "Enter Gattchaa Palace",
    trigger: { x: PALACE_DOOR_X - 24, y: PALACE_FACE_BOTTOM * 32, w: 48, h: 26 },
    dir: 0,
    to: { x: HALL_CX * 32, y: 37 * 32 + 4 },
  },
  {
    id: "store-out",
    label: "Back to town",
    trigger: { x: 30 * 32, y: 39 * 32 + 6, w: 128, h: 26 },
    dir: 2,
    to: { x: PALACE_DOOR_X, y: PALACE_FACE_BOTTOM * 32 + 36 },
  },
];

/**
 * Prop footprints: `w` x `h` solid tiles. The sprite is anchored at the
 * footprint's bottom centre and may extend above it (roofs, lamp posts).
 */
export const PROP_TYPES = {
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
  pillar: { w: 1, h: 1 },
  throne: { w: 2, h: 1 },
  loveseat: { w: 2, h: 1 },
  loveseatBack: { w: 2, h: 1 },
  coffeeTable: { w: 2, h: 1 },
  clock: { w: 1, h: 1 },
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

/** A prop and its mirror image on the other side of the avenue. */
const pair = (p: Prop): Prop[] => {
  const w = PROP_TYPES[p.type].w;
  return [p, { ...p, x: 2 * TOWN_CX - p.x - w }];
};

/** Rooms tables (tag = table index), each with four stools. */
const table = (x: number, y: number, i: number, stool: number): Prop[] => [
  { type: "cardTable", x, y, tag: `table:${i}` },
  { type: "stool", x, y: y - 1, variant: stool },
  { type: "stool", x: x + 1, y: y - 1, variant: stool },
  { type: "stool", x, y: y + 1, variant: stool },
  { type: "stool", x: x + 1, y: y + 1, variant: stool },
];

const props: Prop[] = [
  { type: "kujiHouse", x: 162, y: 164 },
  { type: "gradingHouse", x: 217, y: 165 },
  { type: "fountain", x: 191, y: 190 },

  // Pillars either side of the palace door.
  ...pair({ type: "pillar", x: 189, y: 168 }),

  // Market: four stalls (vendors stand behind the counters)
  { type: "counter", x: 209, y: 197, tag: "stall:pokemon" },
  { type: "counter", x: 215, y: 197, tag: "stall:anime" },
  { type: "counter", x: 209, y: 203, tag: "stall:duel" },
  { type: "counter", x: 215, y: 203, tag: "stall:market" },
  { type: "crate", x: 212, y: 197, variant: 0 },
  { type: "barrel", x: 218, y: 197 },
  { type: "barrels", x: 218, y: 203 },
  { type: "crate", x: 212, y: 203, variant: 1 },
  { type: "barrel", x: 207, y: 193 },
  { type: "crate", x: 221, y: 193, variant: 0 },

  // Rooms pavilion: four tables with stools
  ...table(164, 197, 0, 5),
  ...table(171, 197, 1, 5),
  ...table(164, 203, 2, 5),
  ...table(171, 203, 3, 5),

  // Lamps down the avenue, around the plaza and along the street.
  ...[178, 205, 210].flatMap((y) => pair({ type: "lamp", x: 188, y })),
  ...pair({ type: "lamp", x: 179, y: 181 }),
  ...pair({ type: "lamp", x: 179, y: 201 }),
  ...pair({ type: "lamp", x: 188, y: 188 }),
  ...pair({ type: "lamp", x: 160, y: 184 }),
  ...pair({ type: "lamp", x: 172, y: 184 }),
  ...pair({ type: "lamp", x: 161, y: 193 }),
  ...pair({ type: "lamp", x: 161, y: 207 }),
  ...pair({ type: "lamp", x: 186, y: 172 }),
  ...pair({ type: "lamp", x: 160, y: 171 }),

  // Potted trees: an honour guard down the avenue.
  ...[180, 183, 207].flatMap((y) => pair({ type: "pottedTree", x: 188, y })),
  ...pair({ type: "pottedTree", x: 188, y: 193 }),
  ...pair({ type: "pottedTree", x: 184, y: 171 }),
  ...pair({ type: "pottedTree", x: 182, y: 181 }),
  ...pair({ type: "pottedTree", x: 182, y: 201 }),
];

// Oripa machines: four each side of the palace door, against the palace wall.
[180, 181, 182, 183, 200, 201, 202, 203].forEach((x, i) => {
  props.push({ type: "machine", x, y: 169, tag: `machine:${MACHINES[i].id}`, variant: i % 2 });
});

// ---- Inside the palace (mirrored around HALL_CX where it can be).
const hallPair = (p: Prop): Prop[] => [p, { ...p, x: 2 * HALL_CX - p.x - PROP_TYPES[p.type].w }];

// West wing: the machine gallery against the back wall, two banks of four.
[9, 10, 11, 12, 15, 16, 17, 18].forEach((x, i) => {
  props.push({ type: "machine", x, y: 10, tag: `machine:${MACHINES[i].id}`, variant: (i + 1) % 2 });
});
props.push(
  // The throne, and the two counters either side of it.
  { type: "throne", x: 31, y: 10 },
  { type: "counter", x: 24, y: 11, tag: "stall:pickup" },
  { type: "counter", x: 37, y: 11, tag: "stall:new" },
  ...hallPair({ type: "floorLamp", x: 22, y: 10 }),
  ...hallPair({ type: "floorLamp", x: 28, y: 10 }),

  // East wing back wall: booster-box shelves, mirroring the machine banks.
  ...[45, 46, 47, 48, 51, 52, 53, 54].map((x, i): Prop => ({ type: "shelf", x, y: 10, variant: i % 2 })),
  // West wing: aisles of display shelves.
  ...[15, 19].flatMap((y) => [9, 10, 11, 12, 15, 16, 17, 18].map((x, i): Prop => ({ type: "shelf", x, y, variant: (i + y) % 2 }))),

  // Columns down both sides of the red carpet.
  ...[16, 21, 26, 31].flatMap((y) => hallPair({ type: "pillar", x: 27, y })),

  // Battle Hall: six Rooms tables (indices 4-9).
  ...[18, 24, 30].flatMap((y, r) => [...table(43, y, 4 + r * 2, 0), ...table(50, y, 5 + r * 2, 0)]),

  // Lounge: loveseats round a table, clocks, plants.
  { type: "loveseat", x: 12, y: 27 },
  { type: "loveseat", x: 17, y: 27 },
  { type: "coffeeTable", x: 12, y: 30 },
  { type: "coffeeTable", x: 17, y: 30 },
  { type: "loveseatBack", x: 12, y: 32 },
  { type: "loveseatBack", x: 17, y: 32 },
  ...hallPair({ type: "clock", x: 9, y: 25 }),
  ...hallPair({ type: "pottedTree", x: 8, y: 36 }),
  ...hallPair({ type: "pottedTree", x: 8, y: 10 }),
  ...hallPair({ type: "pottedTree", x: 26, y: 36 }),
  ...hallPair({ type: "floorLamp", x: 22, y: 26 }),
  ...hallPair({ type: "floorLamp", x: 22, y: 34 }),
);

export const PROPS: readonly Prop[] = props;

/**
 * Things mounted on the stone faces (client art only, no collision of their
 * own: the face is already solid). x is the pixel centre, y the pixel bottom.
 */
export interface Facade {
  kind: "door" | "window" | "banner" | "portrait" | "torch" | "swag";
  x: number;
  y: number;
  variant?: number;
}

const px = (t: number) => t * 32;
export const FACADES: Facade[] = [
  { kind: "door", x: PALACE_DOOR_X, y: px(PALACE_FACE_BOTTOM) },
  // Keep: a row of tall windows.
  ...[186.5, 189.5, 194.5, 197.5].map((t): Facade => ({ kind: "window", x: px(t), y: px(163) - 2 })),
  // Palace hall, between the machines and the door.
  ...[178.75, 186, 198, 205.25].map((t): Facade => ({ kind: "window", x: px(t), y: px(169) - 6 })),
  // Palace towers: a window above a Gattchaa banner.
  ...[175, 209].map((t): Facade => ({ kind: "window", x: px(t), y: px(167) - 4 })),
  // Banners on the palace towers and the south gate towers.
  ...[173.5, 176.5, 207.5, 210.5].map((t): Facade => ({ kind: "banner", x: px(t), y: px(169) - 8 })),
  ...[186.5, 197.5].map((t): Facade => ({ kind: "banner", x: px(t), y: px(222) - 6 })),

  // Palace hall, back wall (face rows 6-9).
  ...[14, 20, 44, 50].map((t): Facade => ({ kind: "window", x: px(t), y: px(10) - 4 })),
  ...[11, 17, 47, 53].map((t): Facade => ({ kind: "torch", x: px(t), y: px(8) + 12 })),
  ...[22, 42].map((t): Facade => ({ kind: "banner", x: px(t), y: px(10) - 6 })),
  { kind: "portrait", x: px(27), y: px(10) - 14, variant: 0 },
  { kind: "portrait", x: px(37), y: px(10) - 14, variant: 1 },
  { kind: "swag", x: px(HALL_CX), y: px(10) },
];

export const TILE = 32;
/** Pixel position of a prop's anchor (bottom centre of its footprint). */
export function propAnchor(p: Prop): { x: number; y: number } {
  const t = PROP_TYPES[p.type];
  return { x: (p.x + t.w / 2) * TILE, y: (p.y + t.h) * TILE };
}
