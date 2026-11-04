import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema(
  {
    name: t.string(),
    look: t.string(),
    // Whole pixels are plenty and keep each update to a few bytes.
    x: t.uint16(),
    y: t.uint16(),
    dir: t.uint8().default(2),
    moving: t.boolean().default(false),
    /** Server time (ms since the room started) of this position; clients interpolate on it. */
    ts: t.uint32(),
    /** Sitting on the ground: resting, or minding a shop. */
    sit: t.boolean().default(false),
    // Level and health are filled in by Combat.join.
    lv: t.uint8().default(1),
    hp: t.uint16().default(0),
    /** Max HP, so others can draw your health bar. */
    mhp: t.uint16().default(0),
    /** Knocked out, until they return to town. */
    dead: t.boolean().default(false),
    /** What they're wearing, for drawing them (see gearString in shared/items.ts). */
    gear: t.string().default(""),
    /** Novice, Knight, Mage or Archer (a ClassId). */
    cls: t.string().default("novice"),
    /** Aura: from gear (see auraOf in shared/items.ts) or the shown title (shared/titles.ts); 0 = none. */
    aura: t.uint8().default(0),
    /** The title shown under the name (a TitleId, "" = none). */
    title: t.string().default(""),
    /** Session id of the player they're in a duel with ("" = none). */
    duel: t.string().default(""),
    /** Attacked a player who wasn't an Outlaw, in the Wildlands, not long ago (see shared/pvp.ts). */
    outlaw: t.boolean().default(false),
    /** Their party's id ("" = none; see Parties.ts). */
    party: t.string().default(""),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

/** A player shop, keyed by its id. It stays open for a while after its owner leaves. */
export const PlayerShop = schema(
  {
    name: t.string(),
    look: t.string(),
    title: t.string(),
    /** Where the seller sits (feet), in pixels. */
    x: t.uint16(),
    y: t.uint16(),
    /** The owner's session id while they're in town; empty while they're away. */
    owner: t.string(),
    /** How many cards are listed on the Gattchaa marketplace (shown on the sign). */
    cards: t.uint16(),
    /** How many different things from the bag are still for sale, for gold (shown on the sign too). */
    items: t.uint8().default(0),
    /** Bumped when the listings or the stock change, so open shop panels reload. */
    rev: t.uint16(),
  },
  "PlayerShop",
);
export type PlayerShop = SchemaType<typeof PlayerShop>;

export const Npc = schema(
  {
    name: t.string(),
    look: t.string(),
    x: t.uint16(),
    y: t.uint16(),
    dir: t.uint8().default(2),
    moving: t.boolean().default(false),
    ts: t.uint32(),
  },
  "Npc",
);
export type Npc = SchemaType<typeof Npc>;

/** A monster in a field. Its name, level and max HP come from MONSTERS[kind]. */
export const Monster = schema(
  {
    kind: t.string(),
    x: t.uint16(),
    y: t.uint16(),
    dir: t.uint8().default(2),
    moving: t.boolean().default(false),
    ts: t.uint32(),
    hp: t.uint16(),
  },
  "Monster",
);
export type Monster = SchemaType<typeof Monster>;

/** An item lying on the ground (monster loot, or dropped by a player). */
export const Drop = schema(
  {
    item: t.string(),
    n: t.uint16().default(1),
    x: t.uint16(),
    y: t.uint16(),
    /** Session id of whoever gets first pick; cleared when anyone may take it. */
    owner: t.string().default(""),
    /** …and the owner's party ("" = none), who may take it too. */
    party: t.string().default(""),
    /** Cards in a dropped piece of equipment ("hornetCard.hornetCard"). */
    cards: t.string().default(""),
    /** How far a dropped piece of equipment was upgraded (0 = not). */
    up: t.uint8().default(0),
  },
  "Drop",
);
export type Drop = SchemaType<typeof Drop>;

export const WorldState = schema(
  {
    // .view(): each client only receives the players its StateView contains
    // (the ones near it), so 100+ players don't flood everyone.
    players: t.map(Player).view(),
    // Monsters out in the fields; like players, each client only gets the ones near it.
    monsters: t.map(Monster).view(),
    // Items on the ground; also only the ones near you.
    drops: t.map(Drop).view(),
    // A dozen townspeople; everyone gets all of them.
    npcs: t.map(Npc),
    // Open player shops. Everyone gets all of them: the Market Keeper lists them, and the minimap shows them.
    shops: t.map(PlayerShop),
    online: t.uint16(),
    /** People on gattchaaoripa.com right now. */
    siteOnline: t.uint16(),
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
