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
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

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

export const WorldState = schema(
  {
    // .view(): each client only receives the players its StateView contains
    // (the ones near it), so 100+ players don't flood everyone.
    players: t.map(Player).view(),
    // A dozen townspeople; everyone gets all of them.
    npcs: t.map(Npc),
    online: t.uint16(),
    /** People on gattchaaoripa.com right now. */
    siteOnline: t.uint16(),
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
