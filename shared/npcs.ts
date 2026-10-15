// Townspeople of Gattchaa Town. The server owns their positions (so every
// player sees the same NPC in the same place); everything else here is static
// data both sides read.

import { CATALOG, type CatalogItem } from "./catalog";
import { COLOR_FIELDS, ITEM_FIELDS, defaultLook, encodeLook, type ColorField, type ItemField, type Look } from "./appearance";
import { TILE, WANDER_AREA, type Rect } from "./town";
import { Dir } from "./protocol";

export type NpcKind = "guide" | "shop" | "kuji" | "rooms" | "market" | "grading" | "crier" | "local";

export interface NpcDef {
  id: string;
  name: string;
  /** Shown under the name, e.g. "Pokémon Packs". Empty for locals. */
  title: string;
  kind: NpcKind;
  look: string;
  /** Feet position in pixels. */
  x: number;
  y: number;
  dir: number;
  /** Wanders inside this area instead of standing still. */
  wander?: Rect;
  /** Live product categories this NPC sells (matched against category titles). */
  sells?: RegExp;
  /** First line when you talk to them. */
  greeting: string;
  /** Things they say out loud now and then (speech bubbles). */
  chatter: string[];
}

type LookSpec = { body: "male" | "female"; skin?: string; eyes?: string } & Partial<Record<ItemField, string>> &
  Partial<Record<Exclude<ColorField, "skin" | "eyes">, string>>;

/** Builds an encoded look from catalog ids and palette names (throws on typos, at startup). */
function look(spec: LookSpec): string {
  const body = CATALOG.bodies.indexOf(spec.body);
  const out: Look = defaultLook(body);
  for (const [key, value] of Object.entries(spec)) {
    if (key === "body" || value === undefined) continue;
    if (key in ITEM_FIELDS) {
      const i = ITEM_FIELDS[key as ItemField].findIndex((item) => item.id === value);
      const item: CatalogItem | undefined = ITEM_FIELDS[key as ItemField][i];
      if (!item || !item.bodies.includes(spec.body)) throw new Error(`npc look: bad ${key} "${value}"`);
      out[key as ItemField] = i;
    } else {
      const i = (COLOR_FIELDS[key as ColorField] as readonly string[]).indexOf(value);
      if (i < 0) throw new Error(`npc look: bad ${key} "${value}"`);
      out[key as ColorField] = i;
    }
  }
  return encodeLook(out);
}

/** Staff wear the Gattchaa colours: orange polo, black trousers. */
const staff = { top: "polo", topColor: "orange", bottomColor: "black", shoes: "sneakers", shoesColor: "black" } as const;

const at = (tx: number, ty: number) => ({ x: Math.round(tx * TILE), y: Math.round(ty * TILE) });
/** Vendors stand "inside" their counter so it hides their legs. */
const behindCounter = (cx: number, cy: number) => ({ x: (cx + 1.5) * TILE, y: (cy + 1) * TILE - 12 });

const LOCAL_TIPS = [
  "Tip: walk up to any machine or stall and press E (or tap it) to see what's in stock right now.",
  "Tip: the tables on the wooden deck show live Sharing Pack and Packs Battle rooms. Talk to Andi to join one.",
  "Tip: when someone pulls a big hit on Gattchaa, the whole town hears about it!",
  "Tip: open the Wardrobe (top right) to change your outfit any time.",
];
const LOCAL_CHATTER = [
  ["Which set are you collecting?", "I love the fountain here.", "Anyone joining a Sharing Pack?"],
  ["Has anyone tried a Packs Battle yet?", "Saving up for the next Kuji…", "Nice outfit!"],
  ["The new Pokémon sets look amazing.", "Meet me at the Rooms deck!", "Hi everyone!"],
  ["Who wants to trade?", "I should get my cards graded.", "This town is cozy."],
];

export const NPCS: NpcDef[] = [
  {
    id: "guide",
    name: "Nadia",
    title: "Gattchaa Guide",
    kind: "guide",
    look: look({ body: "female", ...staff, hair: "long", hairColor: "black", skin: "olive", bottom: "straightSkirt" }),
    ...at(194.5, 186.6),
    dir: Dir.Down,
    greeting: "Welcome to Gattchaa Town! Every machine and stall here opens the real Gattchaa Oripa shop. Need your daily login bonus or your inventory?",
    chatter: ["Welcome to Gattchaa Town!", "Don't forget your daily login bonus!", "Cards you pull can be picked up in Batam or listed on the marketplace."],
  },
  {
    id: "pokemon",
    name: "Rina",
    title: "Pokémon Packs",
    kind: "shop",
    look: look({ body: "female", ...staff, hair: "highPonytail", hairColor: "chestnut", skin: "light", bottom: "pants", hat: "cap", hatColor: "black" }),
    ...behindCounter(199, 189),
    dir: Dir.Down,
    sells: /pok[eé]mon/i,
    greeting: "Pokémon packs from Indonesia, China and Japan, opened online and shipped or picked up in Batam. Take a look!",
    chatter: ["Fresh Pokémon packs here!", "Indonesian, Chinese or Japanese sets?", "Looking for a new set?"],
  },
  {
    id: "anime",
    name: "Kenji",
    title: "Anime TCG Packs",
    kind: "shop",
    look: look({ body: "male", ...staff, hair: "spiked", hairColor: "raven", skin: "amber", bottom: "pants" }),
    ...behindCounter(204, 189),
    dir: Dir.Down,
    sells: /one\s*piece|dragon ball|gundam|digimon|union arena|hololive|wuthering/i,
    greeting: "One Piece, Dragon Ball, Gundam, Digimon, Hololive… if it's anime, I've got packs for it.",
    chatter: ["One Piece packs in stock!", "Digimon, Gundam, Dragon Ball…", "Anime card packs here!"],
  },
  {
    id: "duel",
    name: "Dimas",
    title: "Yu-Gi-Oh! & More",
    kind: "shop",
    look: look({ body: "male", ...staff, hair: "parted", hairColor: "dark_brown", skin: "bronze", bottom: "formal", glasses: "round" }),
    ...behindCounter(199, 195),
    dir: Dir.Down,
    sells: /yu-?gi-?oh|vanguard|shadowverse|wei|riftbound|marvel/i,
    greeting: "Yu-Gi-Oh!, Vanguard, Riftbound, Shadowverse, Weiß Schwarz and Marvel. Pick your game.",
    chatter: ["It's time to duel… with fresh packs!", "New Yu-Gi-Oh! sets just in.", "Riftbound and Vanguard over here."],
  },
  {
    id: "market",
    name: "Bayu",
    title: "Marketplace",
    kind: "market",
    look: look({ body: "male", hair: "buzzcut", hairColor: "black", beard: "trimmed", skin: "brown", top: "buttonTee", topColor: "teal", bottom: "pants", bottomColor: "charcoal", shoes: "boots", shoesColor: "brown" }),
    ...behindCounter(204, 195),
    dir: Dir.Down,
    greeting: "Buying or selling single cards? The marketplace has thousands of listings, and you can post a Want-to-Buy too.",
    chatter: ["Singles! Get your singles!", "Selling a card? List it on the marketplace.", "Post a Want-to-Buy and let sellers come to you."],
  },
  {
    id: "kuji",
    name: "Sari",
    title: "Ichiban Kuji",
    kind: "kuji",
    look: look({ body: "female", ...staff, hair: "bun", hairColor: "black", skin: "taupe", bottom: "skirt", hat: "headband", hatColor: "orange" }),
    ...at(184.5, 186.8),
    dir: Dir.Down,
    sells: /kuji/i,
    greeting: "Ichiban Kuji! Every ticket wins a prize, and the last ticket wins the Last One prize.",
    chatter: ["Ichiban Kuji! Every ticket wins!", "Who's going for the Last One prize?", "New Kuji boards are up!"],
  },
  {
    id: "rooms",
    name: "Andi",
    title: "Rooms Host",
    kind: "rooms",
    look: look({ body: "male", ...staff, hair: "curly", hairColor: "black", skin: "brown", bottom: "pants" }),
    ...at(181.5, 198.4),
    dir: Dir.Down,
    greeting: "Join a Sharing Pack to split a box with others, or a Packs Battle to see who pulls best. If a room doesn't fill in time, you get refunded.",
    chatter: ["Seats open for Sharing Pack!", "Who's up for a Packs Battle?", "Grab a seat, rooms are filling up!"],
  },
  {
    id: "grading",
    name: "Hendra",
    title: "Card Grading",
    kind: "grading",
    look: look({ body: "male", hair: "swoop", hairColor: "gray", skin: "light", top: "longsleeve", topColor: "white", bottom: "formal", bottomColor: "navy", shoes: "shoes", shoesColor: "black", glasses: "nerd" }),
    ...at(203.5, 186.8),
    dir: Dir.Down,
    greeting: "Got a card worth protecting? Send it for grading and track it here.",
    chatter: ["Protect your best pulls, get them graded.", "Check your grading status any time.", "Gem mint? Let's find out."],
  },
  {
    id: "crier",
    name: "Toto",
    title: "Town Crier",
    kind: "crier",
    look: look({ body: "male", hair: "mop", hairColor: "ginger", skin: "light", top: "vneck", topColor: "orange", bottom: "shorts", bottomColor: "navy", shoes: "sandals", shoesColor: "brown", hat: "bandana", hatColor: "orange" }),
    ...at(192, 200),
    dir: Dir.Down,
    wander: WANDER_AREA,
    greeting: "Hear ye! I shout out every new release and every big pull on Gattchaa. Stick around!",
    chatter: ["Hear ye, hear ye!", "New packs at the stalls!", "Check the Rooms deck for open seats!"],
  },
  ...(
    [
      ["lia", "Lia", { body: "female", hair: "bob", hairColor: "black", skin: "olive", top: "scoop", topColor: "sky", bottom: "leggings", bottomColor: "black", shoes: "sneakers", shoesColor: "white" }],
      ["reza", "Reza", { body: "male", hair: "messy", hairColor: "dark_brown", skin: "bronze", top: "tshirt", topColor: "red", bottom: "cuffed", bottomColor: "blue", shoes: "sneakers", shoesColor: "white" }],
      ["maya", "Maya", { body: "female", hair: "longStraight", hairColor: "black", skin: "amber", top: "blouse", topColor: "white", bottom: "belleSkirt", bottomColor: "maroon", shoes: "shoes", shoesColor: "black", hat: "hijab", hatColor: "rose" }],
      ["fajar", "Fajar", { body: "male", hair: "afro", hairColor: "black", skin: "black", top: "polo", topColor: "green", bottom: "shorts", bottomColor: "tan", shoes: "sandals", shoesColor: "brown" }],
    ] as const
  ).map(
    ([id, name, spec], i): NpcDef => ({
      id,
      name,
      title: "",
      kind: "local",
      look: look(spec),
      ...at(188 + i * 3, 190 + (i % 2) * 9),
      dir: Dir.Down,
      wander: WANDER_AREA,
      greeting: LOCAL_TIPS[i],
      chatter: LOCAL_CHATTER[i],
    }),
  ),
];
