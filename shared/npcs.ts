// Townspeople of Gattchaa Town. The server owns their positions (so every
// player sees the same NPC in the same place); everything else here is static
// data both sides read.

import { CATALOG, type CatalogItem } from "./catalog";
import { COLOR_FIELDS, ITEM_FIELDS, defaultLook, encodeLook, type ColorField, type ItemField, type Look } from "./appearance";
import { MARKET_WANDER, PARK_WANDER, STORE_WANDER, TILE, WANDER_AREA, type Rect } from "./town";
import type { ShopProduct } from "./gattchaa";
import { Dir } from "./protocol";

export type NpcKind = "guide" | "shop" | "kuji" | "rooms" | "market" | "grading" | "pickup" | "crier" | "keeper" | "outfitter" | "jobs" | "local";

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
  /** Sells whatever is new or hot right now, across all categories. */
  featured?: boolean;
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
  "Tip: the tables in the Rooms pavilion show live Sharing Pack and Packs Battle rooms. Talk to Andi to join one.",
  "Tip: when someone pulls a big hit on Gattchaa, the whole town hears about it!",
  "Tip: press X to sit anywhere. Signed in with Gattchaa? Walk to the Market Square, south of the fountain, and press V (or Open shop) to sell your cards.",
];
const LOCAL_CHATTER = [
  ["Which set are you collecting?", "I love the fountain here.", "Anyone joining a Sharing Pack?"],
  ["Has anyone tried a Packs Battle yet?", "Saving up for the next Kuji…", "Nice outfit!"],
  ["The new Pokémon sets look amazing.", "Meet me at the Rooms pavilion!", "Hi everyone!"],
  ["Who wants to trade?", "I found a great card in the Market Square!", "This town is cozy."],
];

export const NPCS: NpcDef[] = [
  {
    id: "guide",
    name: "Nadia",
    title: "Gattchaa Guide",
    kind: "guide",
    look: look({ body: "female", ...staff, hair: "long", hairColor: "black", skin: "olive", bottom: "straightSkirt" }),
    ...at(188.5, 171.4),
    dir: Dir.Down,
    greeting: "Welcome to Gattchaa Town! The palace behind me is the Gattchaa store, and every machine and stall opens the real Gattchaa Oripa shop. Need your daily login bonus or your inventory?",
    chatter: ["Welcome to Gattchaa Town!", "Don't forget your daily login bonus!", "Cards you pull can be picked up in Batam or listed on the marketplace."],
  },
  {
    id: "pokemon",
    name: "Rina",
    title: "Pokémon Packs",
    kind: "shop",
    look: look({ body: "female", ...staff, hair: "highPonytail", hairColor: "chestnut", skin: "light", bottom: "pants", hat: "cap", hatColor: "black" }),
    ...behindCounter(209, 197),
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
    ...behindCounter(215, 197),
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
    ...behindCounter(209, 203),
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
    ...behindCounter(215, 203),
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
    ...at(168.5, 170.8),
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
    ...at(168.5, 200.8),
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
    ...at(215.5, 170.8),
    dir: Dir.Down,
    greeting: "Got a card worth protecting? Send it for grading and track it here.",
    chatter: ["Protect your best pulls, get them graded.", "Check your grading status any time.", "Gem mint? Let's find out."],
  },
  // ------------------------------------------------ inside the Gattchaa store
  {
    id: "pickup",
    name: "Putri",
    title: "Pickup & Orders",
    kind: "pickup",
    look: look({ body: "female", ...staff, hair: "bobSide", hairColor: "dark_brown", skin: "amber", bottom: "pants", glasses: "round" }),
    ...behindCounter(24, 11),
    dir: Dir.Down,
    greeting: "Hi! Every card you pull on Gattchaa goes to your inventory. Pick it up at Gattchaa One, Batam Mall, have it shipped, or sell it back.",
    chatter: ["Your pulls are waiting in your inventory!", "Pickup at Gattchaa One, Batam Mall.", "We can ship your cards too."],
  },
  {
    id: "new",
    name: "Yuki",
    title: "New & Hot",
    kind: "shop",
    look: look({ body: "female", ...staff, hair: "pigtails", hairColor: "black", skin: "light", bottom: "skirt", hat: "cap", hatColor: "orange" }),
    ...behindCounter(37, 11),
    dir: Dir.Down,
    featured: true,
    greeting: "These are the newest and hottest packs on Gattchaa right now. Fresh off the truck!",
    chatter: ["New releases just landed!", "Hot packs, right here!", "Looking for something new?"],
  },
  {
    id: "sinta",
    name: "Sinta",
    title: "",
    kind: "local",
    look: look({ body: "female", hair: "halfUp", hairColor: "chestnut", skin: "bronze", top: "cardigan", topColor: "lavender", bottom: "straightSkirt", bottomColor: "charcoal", shoes: "shoes", shoesColor: "brown" }),
    ...at(31, 24),
    dir: Dir.Down,
    wander: STORE_WANDER,
    greeting: "I come here every week! The machine gallery in the west wing covers every franchise, and the Battle Hall tables show open rooms.",
    chatter: ["This palace is so grand.", "I always check the New & Hot counter first.", "Which machine should I try?"],
  },
  {
    id: "battle",
    name: "Dewi",
    title: "Battle Hall Host",
    kind: "rooms",
    ...at(47.5, 21.8),
    dir: Dir.Down,
    look: look({ body: "female", ...staff, hair: "ponytail", hairColor: "black", skin: "bronze", bottom: "pants" }),
    greeting: "Welcome to the Battle Hall! Grab a seat in a Sharing Pack to split a box, or join a Packs Battle and see who pulls best.",
    chatter: ["Seats open in the Battle Hall!", "Packs Battle starting soon!", "Sharing Pack, anyone?"],
  },
  ...(
    [
      ["guard-w", "Bima", 28.6, "Welcome to Gattchaa Palace! The machine gallery is in the west wing, the Battle Hall in the east.", ["Welcome to the palace!", "Mind the red carpet.", "The New & Hot counter is by the throne."]],
      ["guard-e", "Arya", 35.4, "The counters by the throne handle pickups and the newest packs. Enjoy your visit!", ["Long live the collectors!", "Pickups at the counter by the throne.", "No running in the palace!"]],
    ] as const
  ).map(
    ([id, name, x, greeting, chatter]): NpcDef => ({
      id,
      name,
      title: "Royal Guard",
      kind: "local",
      ...at(x, 37.6),
      dir: Dir.Down,
      look: look({ body: "male", hair: "highTight", hairColor: "black", skin: "brown", top: "longPolo", topColor: "red", bottom: "formal", bottomColor: "black", shoes: "boots", shoesColor: "black", hat: "headband", hatColor: "black" }),
      greeting,
      chatter: [...chatter],
    }),
  ),
  {
    id: "keeper",
    name: "Tina",
    title: "Market Keeper",
    kind: "keeper",
    look: look({ body: "female", hair: "bun", hairColor: "black", skin: "bronze", top: "cardigan", topColor: "forest", bottom: "belleSkirt", bottomColor: "walnut", shoes: "sandals", shoesColor: "brown", hat: "kerchief", hatColor: "orange" }),
    ...at(187.5, 212.6),
    dir: Dir.Down,
    greeting: "Welcome to the Market Square! Collectors sell their own Gattchaa cards right here in the square. Here's every shop that's open: pick one to browse it. Buying happens on Gattchaa Oripa.",
    chatter: ["Fresh cards in the Market Square!", "Open your own shop right here in the square!", "Looking for a card? Ask me who's selling."],
  },
  {
    id: "cafe",
    name: "Leo",
    title: "Café Owner",
    kind: "local",
    look: look({ body: "male", hair: "parted", hairColor: "chestnut", beard: "stubble", skin: "light", top: "longsleeve", topColor: "white", bottom: "pants", bottomColor: "black", shoes: "shoes", shoesColor: "brown" }),
    ...at(240.5, 201.4),
    dir: Dir.Down,
    greeting: "Welcome to the Collectors' Café! Grab a table, show off your pulls and swap stories. Best seats in town for people-watching.",
    chatter: ["Grab a table, stay a while!", "Who pulled something good today?", "Best spot in town to talk cards."],
  },
  {
    // Outside the south gate, where the road leads into the South Meadow.
    id: "gate-guard",
    name: "Rowan",
    title: "Gate Guard",
    kind: "local",
    look: look({ body: "male", hair: "highTight", hairColor: "chestnut", beard: "trimmed", skin: "olive", top: "longPolo", topColor: "red", bottom: "formal", bottomColor: "black", shoes: "boots", shoesColor: "brown", hat: "headband", hatColor: "black" }),
    ...at(187.5, 257.6),
    dir: Dir.Down,
    greeting:
      "Off to the South Meadow? Slimes (Lv 1) by the road only fight back if you hit them. Grass Snakes (Lv 4) hide in the west grass. Hornets (Lv 7) in the east field sting on sight, and Snapper Flowers (Lv 10) guard the lake. Click a monster or press Space to attack. Hurt? Sit down (X) to heal faster, or rest inside the walls.",
    chatter: ["Monsters past this gate. Stay sharp!", "Hornets in the east field sting first!", "Hurt? Sit down and rest a while.", "Level 10? Orin the Job Master is just inside the gate."],
  },
  {
    // Just inside the south gate: Novices walk past him on their way out, and come back at level 10.
    id: "job-master",
    name: "Orin",
    title: "Job Master",
    kind: "jobs",
    look: look({ body: "male", hair: "long", hairColor: "white", beard: "beard", skin: "light", top: "cardigan", topColor: "navy", bottom: "longPants", bottomColor: "charcoal", shoes: "boots", shoesColor: "brown", hat: "hood", hatColor: "navy" }),
    ...at(198.5, 241.6),
    dir: Dir.Left,
    greeting:
      "Every hero starts as a Novice. Reach level 10 out in the meadow and come back to me: I'll make you a Knight, a Mage or an Archer. Choose well, for a job is for life.",
    chatter: ["Knight, Mage or Archer… which will you be?", "Level 10, and not a day before!", "A job is for life. Choose well.", "Your skills grow with every level."],
  },
  {
    id: "outfitter",
    name: "Bram",
    title: "Outfitter",
    kind: "outfitter",
    look: look({ body: "male", hair: "bedhead", hairColor: "ginger", beard: "medium", skin: "light", top: "shirt", topColor: "forest", bottom: "pants", bottomColor: "brown", shoes: "boots", shoesColor: "walnut", hat: "cap", hatColor: "leather" }),
    ...at(196.5, 257.6),
    dir: Dir.Down,
    greeting:
      "Potions, blades and good leather! Gear up before you head out, and bring me whatever the monsters drop. I pay fair. Wear your gear from your bag (I), and keep a few Red Potions handy (Q drinks one).",
    chatter: [
      "Red Potions! Don't leave town without them!",
      "Got slime jelly? I'll buy it!",
      "A sharp blade and good boots. That's all you need.",
      "Bring me what the monsters drop!",
      "Every monster out there carries its own card. Find one, and your gear will never be the same!",
    ],
  },
  {
    id: "ivy",
    name: "Ivy",
    title: "",
    kind: "local",
    look: look({ body: "female", hair: "braid", hairColor: "dark_brown", skin: "light", top: "longsleeve", topColor: "forest", bottom: "pants", bottomColor: "tan", shoes: "boots", shoesColor: "brown", hat: "cap", hatColor: "forest" }),
    ...at(151, 216.5),
    dir: Dir.Left,
    greeting: "Shh… I'm watching the fish. The pond is the calmest spot in town. Come back at night, when the campfire's lit.",
    chatter: ["So calm here…", "Did you see that fish jump?", "The campfire's lovely at night."],
  },
  {
    id: "crier",
    name: "Toto",
    title: "Town Crier",
    kind: "crier",
    look: look({ body: "male", hair: "mop", hairColor: "ginger", skin: "light", top: "vneck", topColor: "orange", bottom: "shorts", bottomColor: "navy", shoes: "sandals", shoesColor: "brown", hat: "bandana", hatColor: "orange" }),
    ...at(192, 196),
    dir: Dir.Down,
    wander: WANDER_AREA,
    greeting: "Hear ye! I shout out every new release and every big pull on Gattchaa. Stick around!",
    chatter: ["Hear ye, hear ye!", "New packs at the stalls!", "Check the Rooms pavilion for open seats!"],
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
      ...at(184 + i * 5, 185 + (i % 2) * 12),
      dir: Dir.Down,
      wander: WANDER_AREA,
      greeting: LOCAL_TIPS[i],
      chatter: LOCAL_CHATTER[i],
    }),
  ),
  // Strollers in the park and shoppers in the Market Square.
  ...(
    [
      ["mila", "Mila", PARK_WANDER, at(146, 204), { body: "female", hair: "wavy", hairColor: "blonde", skin: "light", top: "scoop", topColor: "rose", bottom: "skirt", bottomColor: "white", shoes: "sandals", shoesColor: "white" },
        "Isn't the park lovely? Walk round the pond, then sit by the campfire. Locals swap cards there at night.",
        ["What a lovely day for a walk.", "I come here to sort my binder.", "Campfire tonight, anyone?"]],
      ["theo", "Theo", PARK_WANDER, at(136, 232), { body: "male", hair: "curly", hairColor: "dark_brown", skin: "brown", top: "tshirt", topColor: "sky", bottom: "shorts", bottomColor: "navy", shoes: "sneakers", shoesColor: "white" },
        "The west gate leads out to the wilds. Not much out there yet, but I hear monsters will roam those fields one day.",
        ["Nice day for a walk.", "I traded three cards by the campfire last night!", "This park is my favourite spot."]],
      ["kai", "Kai", MARKET_WANDER, at(176, 226), { body: "male", hair: "spiked", hairColor: "black", skin: "olive", top: "vneck", topColor: "orange", bottom: "cuffed", bottomColor: "charcoal", shoes: "sneakers", shoesColor: "black" },
        "Players sell their own cards in the Market Square. Walk up to anyone sitting under a sign and press E to see what they've got.",
        ["So many shops today!", "Anyone selling Pokémon SRs?", "I always check the Market Square first."]],
      ["nina", "Nina", MARKET_WANDER, at(208, 232), { body: "female", hair: "lob", hairColor: "black", skin: "amber", top: "blouse", topColor: "lavender", bottom: "leggings", bottomColor: "black", shoes: "shoes", shoesColor: "black", glasses: "round" },
        "Tina by the avenue knows every shop that's open. Ask her before you walk the whole square!",
        ["Window shopping again…", "Found a great deal over there!", "Who's selling One Piece cards?"]],
    ] as const
  ).map(
    ([id, name, wander, pos, spec, greeting, chatter]): NpcDef => ({
      id,
      name,
      title: "",
      kind: "local",
      look: look(spec),
      ...pos,
      dir: Dir.Down,
      wander,
      greeting,
      chatter: [...chatter],
    }),
  ),
];

/** What an NPC's stall offers right now (sold-out items last for featured stalls). */
export function npcProducts(npc: NpcDef, products: readonly ShopProduct[]): ShopProduct[] {
  if (npc.featured) return products.filter((p) => p.label || p.hot).slice(0, 18);
  return npc.sells ? products.filter((p) => npc.sells!.test(p.category)) : [];
}
