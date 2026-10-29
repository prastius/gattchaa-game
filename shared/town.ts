// Gattchaa Town: the walled royal town in the middle of the island.
//
// Pure data (tile coordinates), shared by the server (collision, spawning, NPC
// walking) and the client (rendering). The procedural world is generated
// first; World then flattens this area, clears trees and stamps the floors,
// stone structures and props below on top of it.
//
// Layout, north to south (the core is mirrored around tile column 192):
//   Gattchaa Palace (the store) against the north rampart, oripa machines at its feet
//   Forecourt with the Kuji house (west) and Grading house (east), houses beyond them
//   Gardens either side of the grand avenue
//   Fountain plaza where the east-west street crosses the avenue
//   Rooms pavilion (west) and the pack stalls (east)
//   Lakeside park along the west wall; the café and more houses along the east wall
//   The Market Square, where players run their own shops, either side of the avenue
//   The Arena behind the café (east quarter), with the orchard south of it
//   South gate between two towers, the main road out

export const TILE = 32;

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
  Pier: 13, // wooden planks out over the water: the only floor you can walk on there
} as const;
export type Floor = (typeof Floor)[keyof typeof Floor];
/** Floors that block movement. */
export const SOLID_FLOORS: readonly number[] = [Floor.Void, Floor.WallTop, Floor.WallMid, Floor.WallBottom];

/** The town's centre line: tiles 191 | 192, pixel x 6144. */
export const TOWN_CX = 192;

/** Flattened to grass and cleared of wild trees. */
export const TOWN_AREA: Rect = { x: 120, y: 148, w: 144, h: 112 };
/** Inside the ramparts. */
export const TOWN_INSIDE: Rect = { x: 130, y: 158, w: 124, h: 92 };

export const AVENUE: Rect = { x: 189, y: 176, w: 6, h: 80 };
/** The east-west street, paved right through the west and east gates. */
export const STREET: Rect = { x: 125, y: 185, w: 134, h: 4 };
export const FORECOURT: Rect = { x: 160, y: 169, w: 64, h: 7 };
export const BRAND_TERRACE: Rect = { x: 186, y: 169, w: 12, h: 3 };
export const PLAZA: Rect = { x: 179, y: 181, w: 26, h: 21 };
export const PAVILION: Rect = { x: 162, y: 193, w: 15, h: 15 };
/** The four pack stalls run by Gattchaa staff. */
export const PACK_STALLS: Rect = { x: 207, y: 193, w: 15, h: 15 };
/** The Market Square: wide open paving where players sit down and run their shops. */
export const MARKET: Rect = { x: 156, y: 211, w: 72, h: 33 };
/** Lakeside park along the west wall: a pond, a dirt trail round it, trees and benches. */
export const PARK: Rect = { x: 130, y: 191, w: 25, h: 59 };
/** The pond in the park (an ellipse, in tiles), with a dirt trail round it. */
export const POND = { cx: 142, cy: 216, rx: 6.5, ry: 8.5 };
/** The café terrace in the east quarter. */
export const CAFE: Rect = { x: 231, y: 201, w: 19, h: 9 };
/** The Arena's ring of sand: duels fought inside it count for the arena ranking. */
export const ARENA: Rect = { x: 235, y: 220, w: 12, h: 10 };
/** The open ground round the ring, kept clear of the orchard's trees. */
const ARENA_YARD: Rect = { x: 229, y: 214, w: 25, h: 22 };

/** New players appear on the avenue between the plaza and the Market Square. */
export const SPAWN_AREA: Rect = { x: 189, y: 203, w: 6, h: 8 };
/** Where wandering NPCs may walk: the fountain plaza… */
export const WANDER_AREA: Rect = { x: 180, y: 182, w: 24, h: 19 };
/** …the park (they walk round the pond)… */
export const PARK_WANDER: Rect = { x: 131, y: 193, w: 22, h: 54 };
/** …and the Market Square. */
export const MARKET_WANDER: Rect = { x: 158, y: 213, w: 68, h: 29 };

/** Outside the south gate, west of the road: kept clear of trees so the Blacksmith and her forge can be seen. */
export const FORGE_YARD: Rect = { x: 174, y: 258, w: 13, h: 5 };
/** The Orc Warlord's camp where the west road ends: kept clear of trees too. */
export const ORC_CAMP: Rect = { x: 68, y: 176, w: 16, h: 9 };
/** The Minotaur King's lair on the highest ground of the Wildlands: old stones round a fire, clear of rocks. */
export const MINOTAUR_LAIR: Rect = { x: 190, y: 52, w: 16, h: 10 };

/**
 * Frostfell (Lv 40–50), the snowy island across the sea south of the meadow:
 * the world generator raises it here (tiles), and everything south of the snow
 * line is drawn in winter art. The ferry docks are on either shore.
 */
export const FROSTFELL_ISLE = { cx: 200, cy: 452, rx: 104, ry: 70 };
/** Ravenmoor (Lv 50–60), the autumn island across the sea east of Dusk Hollow, under an endless dusk. */
export const RAVENMOOR_ISLE = { cx: 440, cy: 200, rx: 66, ry: 86 };
export const SNOW_LINE = 372;
/** Everything east of this column is Ravenmoor's: autumn colours instead of summer. */
export const AUTUMN_LINE = 368;
/** Which season the art shows at a tile: the islands have their own. */
export type Biome = "summer" | "winter" | "autumn";
export const biomeAt = (tx: number, ty: number): Biome => (tx >= AUTUMN_LINE ? "autumn" : ty >= SNOW_LINE ? "winter" : "summer");
export const isSnowy = (tx: number, ty: number) => biomeAt(tx, ty) === "winter";
/** Ravenmoor's endless dusk hangs over this area (tiles). */
export const GLOOM: Rect = { x: 376, y: 112, w: 136, h: 168 };
/** The Fallen King's ruined castle on Ravenmoor's high ground: broken walls round his throne, kept clear of trees. */
export const RUINS: Rect = { x: 424, y: 139, w: 38, h: 27 };
/** The Frost Giant's ring of standing stones on Frostfell's icy highlands: kept clear of trees and rocks. */
export const FROST_LAIR: Rect = { x: 170, y: 458, w: 16, h: 10 };
/** The ferry piers: out to sea from the meadow's south-east point, and from Frostfell's north shore. */
export const PIERS = {
  meadow: { x: 241, y: 331, w: 3, h: 6 },
  frostfell: { x: 189, y: 396, w: 3, h: 7 },
  // East from Dusk Hollow where the east road ends, and west from Ravenmoor's shore, facing each other across the strait.
  dusk: { x: 334, y: 185, w: 8, h: 3 },
  ravenmoor: { x: 385, y: 185, w: 9, h: 3 },
} satisfies Record<string, Rect>;

/** Dirt roads (vertex rectangles) leading out of the three gates, and two paths north along the walls to the Wildlands. */
export const ROADS: Rect[] = [
  { x: 189, y: 252, w: 6, h: 44 }, // south
  { x: 60, y: 185, w: 66, h: 4 }, // west
  { x: 258, y: 185, w: 66, h: 4 }, // east
  { x: 121, y: 118, w: 4, h: 68 }, // north from the west road
  { x: 259, y: 118, w: 4, h: 68 }, // north from the east road
  { x: 195, y: 283, w: 47, h: 3 }, // east from the south road, towards the ferry…
  { x: 241, y: 283, w: 3, h: 48 }, // …and down to the meadow's pier
  { x: 189, y: 402, w: 3, h: 58 }, // Frostfell: from the pier up to the Frost Giant's stones
  { x: 322, y: 185, w: 13, h: 4 }, // the east road goes on past the Pumpking, to the pier for Ravenmoor
  { x: 393, y: 185, w: 51, h: 3 }, // Ravenmoor: from the pier east across the island…
  { x: 441, y: 160, w: 4, h: 28 }, // …and north, up to the castle gate
];
/** Where the two paths north cross into the Wildlands (tile x of each path's middle, and the border's tile row). */
export const WILD_CROSSINGS = [123, 261];
export const WILD_BORDER_Y = 136;

/** Names for parts of town, for "where is this shop?" (first match wins). */
const PLACES: { name: string; rect: Rect }[] = [
  { name: "the Market Square", rect: MARKET },
  { name: "the fountain plaza", rect: PLAZA },
  { name: "the Rooms pavilion", rect: PAVILION },
  { name: "the pack stalls", rect: PACK_STALLS },
  { name: "the café", rect: { x: 228, y: 189, w: 26, h: 24 } },
  { name: "the park", rect: PARK },
  { name: "the palace forecourt", rect: { x: 158, y: 158, w: 68, h: 18 } },
  { name: "the main street", rect: { x: 130, y: 182, w: 124, h: 9 } },
  { name: "the avenue", rect: AVENUE },
  { name: "the west quarter", rect: { x: 130, y: 158, w: 28, h: 30 } },
  { name: "the Arena", rect: ARENA_YARD },
  { name: "the east quarter", rect: { x: 226, y: 158, w: 28, h: 92 } },
];

/** Where a pixel position is, in words: "the Market Square", "the park"… */
export function placeName(px: number, py: number): string {
  const tx = px / TILE;
  const ty = py / TILE;
  return PLACES.find((p) => inRect(p.rect, tx, ty))?.name ?? "town";
}

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
  // Ravenmoor's castle: the same grey stone, long since fallen in.
  { id: "ruin", style: "rampart", face: 3, battlements: true },
  { id: "ruinTower", style: "rampart", face: 4, battlements: true },
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

/** The south rampart's top row; the gate is the gap in it where the avenue runs out of town. */
export const SOUTH_WALL_Y = 250;

export const STRUCT_BLOCKS: StructBlock[] = [
  // Ramparts: two tiles thick. Gaps for the south gate and the west/east street.
  { group: "rampart", rect: { x: 128, y: 156, w: 128, h: 2 } },
  ...both("rampart", { x: 128, y: SOUTH_WALL_Y, w: 61, h: 2 }),
  ...both("rampart", { x: 128, y: 156, w: 2, h: 26 }),
  ...both("rampart", { x: 128, y: 189, w: 2, h: 63 }),
  // Corner towers, a pair of towers at each gate, and towers along the long stretches.
  ...both("tower", { x: 126, y: 154, w: 5, h: 5 }),
  ...both("tower", { x: 126, y: SOUTH_WALL_Y - 3, w: 5, h: 5 }),
  ...both("tower", { x: 126, y: 177, w: 5, h: 4 }),
  ...both("tower", { x: 126, y: 189, w: 5, h: 4 }),
  ...both("tower", { x: 126, y: 219, w: 5, h: 4 }),
  ...both("tower", { x: 154, y: 154, w: 5, h: 5 }),
  ...both("tower", { x: 156, y: SOUTH_WALL_Y - 3, w: 5, h: 5 }),
  ...both("tower", { x: 184, y: SOUTH_WALL_Y - 3, w: 5, h: 5 }),
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
  // ---- Ravenmoor: the Fallen King's castle, its walls broken through in places, the gate long gone.
  { group: "ruin", rect: { x: 431, y: 143, w: 8, h: 2 } },
  { group: "ruin", rect: { x: 442, y: 143, w: 5, h: 2 } },
  { group: "ruin", rect: { x: 450, y: 143, w: 5, h: 2 } },
  { group: "ruin", rect: { x: 431, y: 160, w: 9, h: 2 } },
  { group: "ruin", rect: { x: 446, y: 160, w: 9, h: 2 } },
  { group: "ruin", rect: { x: 428, y: 149, w: 2, h: 3 } },
  { group: "ruin", rect: { x: 428, y: 158, w: 2, h: 2 } },
  { group: "ruin", rect: { x: 456, y: 149, w: 2, h: 2 } },
  { group: "ruin", rect: { x: 456, y: 157, w: 2, h: 3 } },
  { group: "ruinTower", rect: { x: 427, y: 141, w: 4, h: 4 } },
  { group: "ruinTower", rect: { x: 455, y: 141, w: 4, h: 4 } },
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

// ---------------------------------------------------------------- floors

/** Lanes between the quarters (stone paving). */
const LANES: Rect[] = [
  // Paths from the street to the pavilion and the pack stalls.
  { x: 168, y: 189, w: 3, h: 4 },
  mirror({ x: 168, y: 189, w: 3, h: 4 }),
  // Paths from the forecourt down to the street.
  { x: 168, y: 176, w: 3, h: 9 },
  mirror({ x: 168, y: 176, w: 3, h: 9 }),
  // From the street down to the Market Square, past the park and the café.
  { x: 156, y: 189, w: 3, h: 22 },
  mirror({ x: 156, y: 189, w: 3, h: 22 }),
  // Through the west and east quarters, from the forecourt to the ramparts.
  { x: 130, y: 171, w: 30, h: 3 },
  mirror({ x: 130, y: 171, w: 30, h: 3 }),
  // Into the east quarter, between its houses and the café.
  { x: 228, y: 211, w: 26, h: 3 },
];

/** The Market Square's two fountains, either side of the avenue on its cross street. */
const MARKET_FOUNTAIN = { x: 171, y: 226 };

type TilePos = { x: number; y: number };
/** A lamp post's mirror image across the avenue (lamps are one tile wide). */
const mirrorLamp = (p: TilePos): TilePos => ({ x: 2 * TOWN_CX - p.x - 1, y: p.y });
const strings = (...pairs: [TilePos, TilePos][]) => pairs.flatMap(([a, b]): [TilePos, TilePos][] => [[a, b], [mirrorLamp(b), mirrorLamp(a)]]);

/** Bunting over the Market Square, strung between pairs of lamp posts (their footprint tiles). */
export const BUNTING: [TilePos, TilePos][] = [
  // Along the north and south sides of each fountain's paving.
  ...strings(
    ...[MARKET_FOUNTAIN.y - 2, MARKET_FOUNTAIN.y + 3].map((y): [TilePos, TilePos] => [
      { x: MARKET_FOUNTAIN.x - 3, y },
      { x: MARKET_FOUNTAIN.x + 4, y },
    ]),
  ),
  // Along the square's north and south edges.
  ...strings([{ x: 170, y: 211 }, { x: 182, y: 211 }], [{ x: 162, y: 243 }, { x: 174, y: 243 }], [{ x: 174, y: 243 }, { x: 186, y: 243 }]),
  // Across the avenue where it comes into the square.
  [{ x: 188, y: 210 }, { x: 195, y: 210 }],
];

export const FLOORS: { rect: Rect; floor: Floor }[] = [
  { rect: PIERS.meadow, floor: Floor.Pier },
  { rect: PIERS.frostfell, floor: Floor.Pier },
  { rect: PIERS.dusk, floor: Floor.Pier },
  { rect: PIERS.ravenmoor, floor: Floor.Pier },
  // Old flagstones in the Fallen King's courtyard.
  { rect: { x: 430, y: 145, w: 26, h: 15 }, floor: Floor.Slab },
  { rect: MARKET, floor: Floor.Slab },
  // A stone kerb round the Arena's sand.
  { rect: { x: ARENA.x - 1, y: ARENA.y - 1, w: ARENA.w + 2, h: 1 }, floor: Floor.StoneEdge },
  { rect: { x: ARENA.x - 1, y: ARENA.y + ARENA.h, w: ARENA.w + 2, h: 1 }, floor: Floor.StoneEdge },
  { rect: { x: ARENA.x - 1, y: ARENA.y, w: 1, h: ARENA.h }, floor: Floor.StoneEdge },
  { rect: { x: ARENA.x + ARENA.w, y: ARENA.y, w: 1, h: ARENA.h }, floor: Floor.StoneEdge },
  // A cross street through the square, widening round each fountain.
  { rect: { x: MARKET.x, y: 226, w: MARKET.w, h: 2 }, floor: Floor.Stone },
  { rect: { x: MARKET_FOUNTAIN.x - 3, y: MARKET_FOUNTAIN.y - 2, w: 8, h: 6 }, floor: Floor.Stone },
  { rect: mirror({ x: MARKET_FOUNTAIN.x - 3, y: MARKET_FOUNTAIN.y - 2, w: 8, h: 6 }), floor: Floor.Stone },
  { rect: AVENUE, floor: Floor.Stone },
  { rect: STREET, floor: Floor.Stone },
  { rect: PLAZA, floor: Floor.Stone },
  // Flagstone square round the fountain.
  { rect: { x: 188, y: 188, w: 8, h: 6 }, floor: Floor.Slab },
  { rect: FORECOURT, floor: Floor.Slab },
  { rect: PACK_STALLS, floor: Floor.Slab },
  { rect: PAVILION, floor: Floor.Wood },
  { rect: CAFE, floor: Floor.Wood },
  { rect: BRAND_TERRACE, floor: Floor.Brand },
  ...LANES.map((rect) => ({ rect, floor: Floor.Stone })),

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
  { x: 172, y: 190, w: 5, h: 2 },
  // Flower beds along the lanes in the west and east quarters.
  { x: 131, y: 174, w: 6, h: 2 },
  { x: 147, y: 174, w: 8, h: 2 },
  // Between the Market Square and the south wall.
  { x: 162, y: 245, w: 22, h: 2 },
].flatMap((r) => [r, mirror(r)]);

/** Wild corners with trees, ferns and flowers at random: the park, and the orchard south of the Arena. */
export const GROVES: Rect[] = [PARK, { x: 229, y: ARENA_YARD.y + ARENA_YARD.h, w: 24, h: 247 - (ARENA_YARD.y + ARENA_YARD.h) }];

/** Dirt trails (vertex rectangles) besides the ring round the pond: in from the lane, and down to the campfire. */
export const TRAILS: Rect[] = [
  { x: 148, y: 205, w: 9, h: 2 },
  { x: 148, y: 226, w: 9, h: 2 },
  { x: 141, y: 228, w: 2, h: 10 },
  { x: 137, y: 237, w: 10, h: 6 },
  // The Arena's sand (vertices one past the ring, so every tile inside is sand).
  { x: ARENA.x, y: ARENA.y, w: ARENA.w + 1, h: ARENA.h + 1 },
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
  // Townhouses: big brick, red-brick gable, paneled with a porch.
  houseA: { w: 6, h: 4 },
  houseB: { w: 5, h: 5 },
  houseC: { w: 5, h: 4 },
  bench: { w: 2, h: 1 },
  stoneSeat: { w: 2, h: 1 },
  picnicTable: { w: 3, h: 1 },
  campfire: { w: 1, h: 1 },
  bin: { w: 1, h: 1 },
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
  /** Drawn mirrored (houses on the east side face the other way). */
  flip?: boolean;
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

/** A prop and its mirror image on the other side of the avenue (drawn flipped). */
const pair = (p: Prop): Prop[] => {
  const w = PROP_TYPES[p.type].w;
  return [p, { ...p, x: 2 * TOWN_CX - p.x - w, flip: !p.flip }];
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

  // Pack stalls: four counters (vendors stand behind them)
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

  // ---- West and east quarters: townhouses either side of a lane, lamps along the street.
  ...pair({ type: "houseA", x: 131, y: 167 }),
  ...pair({ type: "houseC", x: 139, y: 167 }),
  ...pair({ type: "houseB", x: 146, y: 166 }),
  ...pair({ type: "houseB", x: 132, y: 178 }),
  ...pair({ type: "houseA", x: 140, y: 179 }),
  ...pair({ type: "houseC", x: 149, y: 179 }),
  ...pair({ type: "lamp", x: 137, y: 174 }),
  ...pair({ type: "lamp", x: 146, y: 174 }),
  ...pair({ type: "bin", x: 145, y: 170, variant: 1 }),
  ...pair({ type: "pottedTree", x: 152, y: 169 }),
  ...pair({ type: "lamp", x: 140, y: 184 }),
  ...pair({ type: "lamp", x: 150, y: 184 }),

  // ---- The Market Square: open paving for player shops, a fountain in each half with lamps
  // at the corners of its paving (bunting is strung between them), lamps and benches round the edge.
  ...pair({ type: "fountain", ...MARKET_FOUNTAIN }),
  ...[MARKET_FOUNTAIN.y - 2, MARKET_FOUNTAIN.y + 3].flatMap((y) =>
    [MARKET_FOUNTAIN.x - 3, MARKET_FOUNTAIN.x + 4].flatMap((x) => pair({ type: "lamp", x, y })),
  ),
  ...pair({ type: "bench", x: MARKET_FOUNTAIN.x, y: MARKET_FOUNTAIN.y - 3, variant: 6 }),
  ...pair({ type: "bench", x: MARKET_FOUNTAIN.x, y: MARKET_FOUNTAIN.y + 4, variant: 4 }),
  ...[162, 174, 186].flatMap((x) => pair({ type: "lamp", x, y: 243 })),
  ...[170, 182].flatMap((x) => pair({ type: "lamp", x, y: 211 })),
  ...pair({ type: "bench", x: 175, y: 211, variant: 0 }),
  ...pair({ type: "bench", x: 165, y: 211, variant: 2 }),
  ...pair({ type: "pottedTree", x: 160, y: 211 }),
  ...pair({ type: "pottedTree", x: 156, y: 243 }),
  ...pair({ type: "barrels", x: 157, y: 239 }),
  ...pair({ type: "crate", x: 157, y: 241, variant: 1 }),

  // ---- The Arena: pillars at the corners of the kerb, lamps either side, benches for the crowd.
  ...[ARENA.x - 1, ARENA.x + ARENA.w].flatMap((x) => [ARENA.y - 1, ARENA.y + ARENA.h].map((y): Prop => ({ type: "pillar", x, y }))),
  ...[ARENA.x - 3, ARENA.x + ARENA.w + 2].flatMap((x) => [ARENA.y + 1, ARENA.y + ARENA.h - 2].map((y): Prop => ({ type: "lamp", x, y }))),
  ...[ARENA.x + 2, ARENA.x + 6, ARENA.x + 10].map((x): Prop => ({ type: "bench", x, y: ARENA.y - 3, variant: 6 })),
  ...[ARENA.x + 2, ARENA.x + 6, ARENA.x + 10].map((x): Prop => ({ type: "bench", x, y: ARENA.y + ARENA.h + 2, variant: 4 })),

  // ---- Outside the south gate: the Blacksmith's forge fire, barrels and a crate.
  { type: "campfire", x: 179, y: 257 },
  { type: "barrels", x: 177, y: 255 },
  { type: "crate", x: 179, y: 255 },

  // ---- The Orc Warlord's camp, where the west road ends: a fire, and loot piled round it.
  { type: "campfire", x: 75, y: 181 },
  { type: "barrels", x: 70, y: 178 },
  { type: "crate", x: 72, y: 178 },
  { type: "crate", x: 79, y: 179 },
  { type: "barrel", x: 81, y: 181 },
  { type: "crate", x: 70, y: 182 },

  // ---- The Minotaur King's lair: four old stones round his fire, and what he took from travellers.
  ...[MINOTAUR_LAIR.x + 1, MINOTAUR_LAIR.x + MINOTAUR_LAIR.w - 2].flatMap((x) =>
    [MINOTAUR_LAIR.y + 1, MINOTAUR_LAIR.y + MINOTAUR_LAIR.h - 2].map((y): Prop => ({ type: "pillar", x, y })),
  ),
  { type: "campfire", x: 198, y: 57 },
  { type: "crate", x: 194, y: 53, variant: 1 },
  { type: "barrels", x: 201, y: 53 },

  // ---- The Frost Giant's stones on Frostfell: six old pillars in a ring, and the bones of his last meal.
  ...[FROST_LAIR.x + 1, FROST_LAIR.x + 7, FROST_LAIR.x + FROST_LAIR.w - 2].flatMap((x) =>
    [FROST_LAIR.y + 1, FROST_LAIR.y + FROST_LAIR.h - 2].map((y): Prop => ({ type: "pillar", x, y })),
  ),
  { type: "crate", x: FROST_LAIR.x + 3, y: FROST_LAIR.y + 3, variant: 1 },
  { type: "barrels", x: FROST_LAIR.x + 11, y: FROST_LAIR.y + 6 },

  // ---- The ferry: crates and barrels waiting at the foot of each pier.
  { type: "crate", x: PIERS.meadow.x + 4, y: PIERS.meadow.y - 2 },
  { type: "barrel", x: PIERS.meadow.x + 5, y: PIERS.meadow.y - 2 },
  { type: "barrels", x: PIERS.frostfell.x + 3, y: PIERS.frostfell.y + PIERS.frostfell.h + 1 },
  { type: "crate", x: PIERS.dusk.x - 1, y: PIERS.dusk.y - 2 },
  { type: "barrel", x: PIERS.ravenmoor.x + PIERS.ravenmoor.w + 1, y: PIERS.ravenmoor.y + PIERS.ravenmoor.h + 1 },

  // ---- The Fallen King's castle: his throne, two rows of pillars down the hall, and rubble.
  { type: "throne", x: 442, y: 148 },
  ...[434, 438, 447, 451].flatMap((x) => [151, 155].map((y): Prop => ({ type: "pillar", x, y }))),
  { type: "crate", x: 432, y: 147, variant: 1 },
  { type: "barrels", x: 452, y: 157 },
  { type: "barrel", x: 433, y: 158 },

  // ---- The park: benches by the pond, a campfire in the clearing, lamps where the trails start.
  { type: "bench", x: 141, y: 201, variant: 3 },
  { type: "bench", x: 138, y: 230, variant: 1 },
  { type: "campfire", x: 141, y: 239 },
  { type: "stoneSeat", x: 138, y: 239 },
  { type: "stoneSeat", x: 143, y: 239, variant: 1 },
  { type: "stoneSeat", x: 140, y: 241 },
  { type: "lamp", x: 154, y: 203 },
  { type: "lamp", x: 154, y: 229 },

  // ---- The café: a house with picnic tables on its terrace.
  { type: "houseA", x: 237, y: 196 },
  ...[233, 245].flatMap((x) => [204, 207].map((y): Prop => ({ type: "picnicTable", x, y, variant: (x + y) % 2 }))),
  ...[233, 235, 245, 247].flatMap((x) => [
    { type: "stool", x, y: 203, variant: 2 } as Prop,
    { type: "stool", x, y: 208, variant: 2 } as Prop,
  ]),
  { type: "pottedTree", x: 231, y: 201 },
  { type: "pottedTree", x: 249, y: 201 },
  { type: "lamp", x: 231, y: 209 },
  { type: "lamp", x: 249, y: 209 },
  { type: "bin", x: 236, y: 200 },
  { type: "lamp", x: 236, y: 214 },
  { type: "lamp", x: 248, y: 214 },
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
  // (the gate towers' faces end 6 rows below the top of the south wall)
  ...[186.5, 197.5].map((t): Facade => ({ kind: "banner", x: px(t), y: px(SOUTH_WALL_Y + 6) - 6 })),

  // Palace hall, back wall (face rows 6-9).
  ...[14, 20, 44, 50].map((t): Facade => ({ kind: "window", x: px(t), y: px(10) - 4 })),
  ...[11, 17, 47, 53].map((t): Facade => ({ kind: "torch", x: px(t), y: px(8) + 12 })),
  ...[22, 42].map((t): Facade => ({ kind: "banner", x: px(t), y: px(10) - 6 })),
  { kind: "portrait", x: px(27), y: px(10) - 14, variant: 0 },
  { kind: "portrait", x: px(37), y: px(10) - 14, variant: 1 },
  { kind: "swag", x: px(HALL_CX), y: px(10) },
];

/** Pixel position of a prop's anchor (bottom centre of its footprint). */
export function propAnchor(p: Prop): { x: number; y: number } {
  const t = PROP_TYPES[p.type];
  return { x: (p.x + t.w / 2) * TILE, y: (p.y + t.h) * TILE };
}
