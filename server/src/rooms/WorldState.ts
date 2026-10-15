import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema(
  {
    name: t.string(),
    x: t.number(),
    y: t.number(),
    hue: t.uint16(),
    facing: t.int8().default(1),
    moving: t.boolean().default(false),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const WorldState = schema(
  {
    players: t.map(Player),
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
