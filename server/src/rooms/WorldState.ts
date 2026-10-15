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
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const WorldState = schema(
  {
    // .view(): each client only receives the players its StateView contains
    // (the ones near it), so 100+ players don't flood everyone.
    players: t.map(Player).view(),
    online: t.uint16(),
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
