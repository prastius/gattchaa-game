// Townspeople of Gattchaa Town. The server owns their positions (so every
// player sees the same NPC in the same place); everything else here is static
// data both sides read.

import { CATALOG, type CatalogItem } from "./catalog";
import { COLOR_FIELDS, ITEM_FIELDS, defaultLook, encodeLook, type ColorField, type ItemField, type Look } from "./appearance";
import { MARKET_WANDER, PARK_WANDER, STORE_WANDER, TILE, WANDER_AREA, type Rect } from "./town";
import type { ShopProduct } from "./gattchaa";
import { Dir } from "./protocol";

export type NpcKind = "guide" | "shop" | "kuji" | "rooms" | "market" | "grading" | "pickup" | "crier" | "keeper" | "outfitter" | "jobs" | "smith" | "arena" | "ferry" | "bounty" | "guild" | "castle" | "trial" | "local";

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
    greeting: "Welcome to the Market Square! Adventurers sell gear, ingots and monster cards here for gold, and collectors show their real Gattchaa cards. Pick a shop to browse it, or tell me what you're looking for.",
    chatter: ["Fresh goods in the Market Square!", "Open your own shop right here in the square!", "Looking for Mithril? Ask me who's selling.", "Sell your spare loot to other adventurers!"],
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
    chatter: [
      "Monsters past this gate. Stay sharp!",
      "Hornets in the east field sting first!",
      "Hurt? Sit down and rest a while.",
      "Level 10? Orin the Job Master is just inside the gate.",
      "Outgrown the meadow? Dusk Hollow is out the east gate.",
      "Level 40? Follow the path east to the ferry. It sails to Frostfell.",
    ],
  },
  {
    // Outside the east gate, where the road runs into Dusk Hollow.
    id: "ranger",
    name: "Mara",
    title: "Ranger",
    kind: "local",
    look: look({ body: "female", hair: "braid", hairColor: "chestnut", skin: "light", top: "longsleeve", topColor: "forest", bottom: "pants", bottomColor: "brown", shoes: "boots", shoesColor: "brown", hat: "hood", hatColor: "forest" }),
    ...at(260.5, 183.6),
    dir: Dir.Down,
    greeting:
      "Dusk Hollow (Lv 10–20) starts here. Grubs (Lv 11) by the road only fight back, but Night Bats (Lv 12) swoop at anyone. Rock Worms (Lv 14) are slow and thick-shelled. Deeper in, Gazers (Lv 16) shoot from afar and Ghosts (Lv 18) are hard to hit: use your skills. And where the road ends lives the Pumpking (Lv 22). Don't face him alone.",
    chatter: [
      "Dusk Hollow is no meadow. Be careful!",
      "Ghosts dodge plain attacks. Use your skills!",
      "Gazers shoot from afar. Close in fast!",
      "Something big lives where the road ends…",
      "Past level 20? The Orc Woods lie out the west gate.",
      "Level 50? Follow the road past the Pumpking to Finn's boat. He sails to Ravenmoor.",
    ],
  },
  {
    // Outside the west gate, where the road runs into the Orc Woods.
    id: "scout",
    name: "Gregor",
    title: "Scout",
    kind: "local",
    look: look({ body: "male", hair: "buzzcut", hairColor: "dark_brown", beard: "medium", skin: "taupe", top: "longsleeve", topColor: "walnut", bottom: "pants", bottomColor: "charcoal", shoes: "boots", shoesColor: "black", hat: "none" }),
    ...at(123.5, 183.6),
    dir: Dir.Down,
    greeting:
      "The Orc Woods (Lv 20–30) start here. Goblins (Lv 20) in the grass north of the road jump anyone who comes close. Orc Warriors (Lv 23) on the rocks south of the road only fight back, but they hit hard. Orc Archers (Lv 25) shoot from up north. West of the inlet the Orc Skeletons (Lv 27) rattle about, and far to the south the Orc Zombies (Lv 29) never stop walking. Where the road ends, the Orc Warlord (Lv 33) keeps his camp. Bring friends.",
    chatter: [
      "The Orc Woods are no place for beginners!",
      "Goblins hide in the grass north of the road.",
      "Orc Archers shoot from up north. Keep moving!",
      "The Warlord's camp is where the road ends…",
      "Level 20? You're ready for the woods.",
      "Past level 30? Take the path north to the Wildlands. Mind the other players!",
    ],
  },
  {
    // Beside the path north from the west road, just short of the Wildlands' border.
    id: "bounty",
    name: "Sable",
    title: "Bounty Hunter",
    kind: "bounty",
    look: look({ body: "female", hair: "long", hairColor: "black", skin: "olive", top: "longsleeve", topColor: "black", bottom: "leggings", bottomColor: "charcoal", shoes: "boots", shoesColor: "black", hat: "bandana", hatColor: "red" }),
    ...at(119.6, 139.6),
    dir: Dir.Down,
    greeting:
      "Past the red line lie the Wildlands (Lv 30–40), and there's no law up there: players can attack each other. Hit someone who isn't an Outlaw and you become one for 3 minutes. Get beaten while you're an Outlaw and you lose EXP, and a bounty from your gold goes to whoever beat you. Fight back, or hunt Outlaws, and you lose nothing. Players under level 20 can't fight or be fought. Inside: Boarmen (Lv 31), Lizardmen (Lv 33), Werewolves (Lv 35), Trolls (Lv 37), Vampires (Lv 39), and the Minotaur King (Lv 44) on the highest ground.",
    chatter: [
      "Past the red line, anyone can attack you!",
      "Red names are Outlaws. Hunting them costs you nothing.",
      "An Outlaw's bounty goes to whoever beats them.",
      "Bring White Potions. Bram sells them by the south gate.",
      "The Minotaur King waits on the highest ground…",
      "Past level 40? The ferry south of the meadow sails to Frostfell.",
      "Want to see who's wanted? Come and read my board.",
      "Top hunter of the week? Your name goes on my board.",
    ],
  },
  {
    // At the end of the meadow's pier, on its south-east point.
    id: "ferry-meadow",
    name: "Edda",
    title: "Ferry Captain",
    kind: "ferry",
    look: look({ body: "female", hair: "braid", hairColor: "strawberry", skin: "light", top: "longsleeve", topColor: "navy", bottom: "pants", bottomColor: "charcoal", shoes: "boots", shoesColor: "black", hat: "bandana", hatColor: "navy" }),
    ...at(242.5, 336.6),
    dir: Dir.Down,
    greeting:
      "All aboard for Frostfell! It's an island of ice and snow across the sea, for adventurers of level 40 and up. Yetis, Ramhorns, Frost Shamans, Frost Wights and Frost Drakes live there, and the Frost Giant keeps a ring of stones on the highlands. The crossing costs 500 gold. The way back is free.",
    chatter: [
      "Ferry to Frostfell! 500 gold!",
      "Wrap up warm. It's cold out there.",
      "Frostfell is for level 40 and up!",
      "The way back is always free.",
      "I saw the Frost Giant once. Once was enough.",
      "Level 60? Follow the path east to Marlow's boat. She sails to Petalfall.",
    ],
  },
  {
    // At the end of Frostfell's pier, on the island's north shore.
    id: "ferry-frostfell",
    name: "Bjorn",
    title: "Ferryman",
    kind: "ferry",
    look: look({ body: "male", hair: "long", hairColor: "platinum", beard: "beard", skin: "light", top: "longsleeve", topColor: "white", bottom: "pants", bottomColor: "slate", shoes: "foldBoots", shoesColor: "brown", hat: "hood", hatColor: "white" }),
    ...at(190.5, 396.6),
    dir: Dir.Up,
    greeting:
      "Welcome to Frostfell (Lv 40–50). Yetis (Lv 41) in the woods west of the pier jump anyone who comes close; Ramhorns (Lv 43) to the east only fight back. Frost Shamans (Lv 45) throw ice from the west shore, and the Frost Drakes (Lv 49) out east are slow but hit very hard. Frost Wights (Lv 47) patrol the icy highlands. Follow the path south to find the Frost Giant (Lv 54) in his ring of stones. When you've had enough of the cold, I'll sail you back for free.",
    chatter: [
      "Ferry back to the meadow! Free of charge!",
      "Mind the Yetis by the pier!",
      "Frost Shamans throw ice. Close in fast!",
      "The Frost Giant waits at the end of the path…",
      "Bring White Potions. Lots of them.",
    ],
  },
  {
    // At the end of the pier where the east road meets the sea.
    id: "ferry-dusk",
    name: "Finn",
    title: "Boatman",
    kind: "ferry",
    look: look({ body: "male", hair: "messy", hairColor: "sandy", beard: "stubble", skin: "taupe", top: "vneck", topColor: "teal", bottom: "cuffed", bottomColor: "slate", shoes: "boots", shoesColor: "brown", hat: "bandana", hatColor: "teal" }),
    ...at(341.5, 186.6),
    dir: Dir.Right,
    greeting:
      "Ravenmoor? Across the strait, under a sky that never gets light. It's for adventurers of level 50 and up: Wraiths, Gargoyles, Dark Knights, Liches and worse, and the Fallen King on his throne in the old castle. I'll row you over for 800 gold. Corvin brings you back for free.",
    chatter: ["Boat to Ravenmoor! 800 gold!", "Ravenmoor is for level 50 and up!", "Strange lights over that island at night…", "Corvin rows you back for free."],
  },
  {
    // At the end of Ravenmoor's pier, on the island's west shore.
    id: "ferry-ravenmoor",
    name: "Corvin",
    title: "Ferryman",
    kind: "ferry",
    look: look({ body: "male", hair: "long", hairColor: "dark_gray", beard: "beard", skin: "light", top: "longsleeve", topColor: "black", bottom: "pants", bottomColor: "charcoal", shoes: "boots", shoesColor: "black", hat: "hood", hatColor: "black" }),
    ...at(385.5, 186.6),
    dir: Dir.Left,
    greeting:
      "Welcome to Ravenmoor (Lv 50–60), where the sun never quite comes up. Wraiths (Lv 51) drift through the woods by the pier: plain attacks pass through them, so use your skills. Gargoyles (Lv 53) swoop down from the high ground either side of the castle. Below the castle gate, Dark Knights (Lv 55) still keep watch, and inside, the Fallen King (Lv 64) waits on his throne. Liches (Lv 57) cast from the east, past the lake, and Flesh Golems (Lv 59) lurch about in the south. When you've seen enough, I'll row you back for free.",
    chatter: [
      "Boat back to Dusk Hollow! Free!",
      "Wraiths dodge plain attacks. Use your skills!",
      "The Fallen King never leaves his throne…",
      "Liches cast from afar. Close in fast!",
      "Level 60? Marlow sails to Petalfall from the meadow's east shore.",
    ],
  },
  {
    // At the end of the pier on the meadow's east shore, where the ferry path ends.
    id: "ferry-east",
    name: "Marlow",
    title: "Ship Captain",
    kind: "ferry",
    look: look({ body: "female", hair: "long", hairColor: "dark_brown", skin: "taupe", top: "longsleeve", topColor: "white", bottom: "pants", bottomColor: "navy", shoes: "boots", shoesColor: "brown", hat: "bandana", hatColor: "red" }),
    ...at(317.5, 283.6),
    dir: Dir.Right,
    greeting:
      "Petalfall? Out across the south-east sea, where it's always spring and the cherry blossom never stops falling. Pretty, and deadly: it's for adventurers of level 60 and up. Moon Hares, Fox Spirits, Crow Blades, Phantom Swordsmen and Red Ogres live there, and the Ogre Warlord holds a war camp on the high ground. I'll sail you over for 1,200 gold. Willow brings you back for free.",
    chatter: ["Ship to Petalfall! 1,200 gold!", "Petalfall is for level 60 and up!", "Go in a party. The Ogre Warlord is no joke.", "Willow sails you back for free.", "Level 70? Dorian sails to Ashpeak, from this same pier."],
  },
  {
    // On the same pier as Marlow, on the meadow's east shore: the ship for Ashpeak.
    id: "ferry-ash",
    name: "Dorian",
    title: "Ship Captain",
    kind: "ferry",
    look: look({ body: "male", hair: "messy", hairColor: "black", beard: "trimmed", skin: "bronze", top: "longsleeve", topColor: "black", bottom: "pants", bottomColor: "charcoal", shoes: "boots", shoesColor: "black", hat: "bandana", hatColor: "red" }),
    ...at(313.5, 282.4),
    dir: Dir.Right,
    greeting:
      "Ashpeak? A volcano, far out in the eastern sea, past Ravenmoor and Petalfall. The rock is bare and black, ash falls like snow, and it's for adventurers of level 70 and up. Ember Imps, Salamanders, Obsidian Knights, Cinder Wraiths and Magma Golems live there, and the Cinder Colossus sits in the crater at the top of the road. I'll sail you over for 1,500 gold. Cassia brings you back for free.",
    chatter: ["Ship to Ashpeak! 1,500 gold!", "Ashpeak is for level 70 and up!", "Bring potions. Lots of potions.", "Take a party for the Cinder Colossus.", "Cassia sails you back for free."],
  },
  {
    // At the end of Ashpeak's pier, on the island's west shore.
    id: "ferry-ashpeak",
    name: "Cassia",
    title: "Ferry Captain",
    kind: "ferry",
    look: look({ body: "female", hair: "long", hairColor: "red", skin: "light", top: "longsleeve", topColor: "maroon", bottom: "pants", bottomColor: "black", shoes: "boots", shoesColor: "black", hat: "bandana", hatColor: "black" }),
    ...at(523.5, 251.6),
    dir: Dir.Left,
    greeting:
      "Welcome to Ashpeak (Lv 70–80). Mind the ash. Ember Imps (Lv 71) swarm the rock north of the pier, and Salamanders (Lv 73) spit fire from the south-west slopes: close in fast. Obsidian Knights (Lv 75) stand guard along the north, and Cinder Wraiths (Lv 77) drift over the hot rock in the east: they're hard to hit with plain attacks, so use your skills. Magma Golems (Lv 79) wander the south: leave them be and they leave you be, but they hit harder than anything else here. Follow this road east to the crater, where the Cinder Colossus (Lv 84) waits. Take a party. When you've had enough, I'll sail you back for free.",
    chatter: ["Ship back to the meadow! Free!", "Cinder Wraiths dodge plain attacks. Use your skills!", "Salamanders spit fire. Close in fast!", "The Cinder Colossus waits in the crater…", "Leave the Magma Golems alone, unless you mean it."],
  },
  {
    // At the end of Petalfall's pier, on the island's west shore.
    id: "ferry-petalfall",
    name: "Willow",
    title: "Ferry Captain",
    kind: "ferry",
    look: look({ body: "female", hair: "braid", hairColor: "pink", skin: "light", top: "longsleeve", topColor: "pink", bottom: "pants", bottomColor: "white", shoes: "boots", shoesColor: "white", hat: "bandana", hatColor: "white" }),
    ...at(326.5, 400.6),
    dir: Dir.Left,
    greeting:
      "Welcome to Petalfall (Lv 60–70), where it's always spring. Moon Hares (Lv 61) bound about the meadows by the pier: they only fight back, but they're quick and hard to hit, so use your skills. Fox Spirits (Lv 63) throw foxfire from the woods to the north-west, and Crow Blades (Lv 65) wait in the middle of the island. Phantom Swordsmen (Lv 67) haunt the north-east, and Red Ogres (Lv 69) wander the south: leave them be and they leave you be, but they hit very hard. Follow this road east, up onto the high ground, to the Ogre Warlord's camp (Lv 74). Take a party. When you've had enough, I'll sail you back for free.",
    chatter: ["Ship back to the meadow! Free!", "Moon Hares dodge plain attacks. Use your skills!", "Fox Spirits throw fire. Close in fast!", "The Ogre Warlord waits at the end of the road…", "Leave the Red Ogres alone, unless you mean it."],
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
      "Every hero starts as a Novice. Reach level 10 out in the meadow and come back to me: I'll make you a Knight, a Mage or an Archer. Choose well, for a job is for life. The second job has to be earned: from level 45, come and ask me about the Trial of Mastery. Pass it, and Knights become Lord Knights, Mages become Wizards, and Archers become Hunters.",
    chatter: [
      "Knight, Mage or Archer… which will you be?",
      "Level 10, and not a day before!",
      "A job is for life. Choose well.",
      "Your skills grow with every level.",
      "Level 45? Ask me about the Trial of Mastery!",
      "The Shades on the Isle of Trials fight only you.",
    ],
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
      "Want your gear stronger? Hilda the Blacksmith is just west of the gate.",
    ],
  },
  {
    // West of the south gate, by her forge fire.
    id: "blacksmith",
    name: "Hilda",
    title: "Blacksmith",
    kind: "smith",
    look: look({ body: "female", hair: "bun", hairColor: "black", skin: "bronze", top: "sleeveless", topColor: "charcoal", bottom: "pants", bottomColor: "brown", shoes: "boots", shoesColor: "black", hat: "bandana", hatColor: "maroon" }),
    ...at(181.5, 257.6),
    dir: Dir.Down,
    greeting:
      "Bring me your gear and I'll make it stronger. Up to +4 never fails. After that it gets risky: a failed upgrade knocks it down one level, but my work never breaks anything. Gear at +7 and above glows for everyone to see.",
    chatter: [
      "Iron Ingots! One for every upgrade!",
      "Mithril from Dusk Hollow takes gear past +5.",
      "A +10? Only with Star Crystals… and luck.",
      "My upgrades never break your gear. Promise!",
      "See that glow? Somebody's gear is +7 or better.",
    ],
  },
  {
    // On the Isle of Trials, at the north end of the circle: Orin sends people here for the Trial of Mastery.
    id: "trial-keeper",
    name: "Vesna",
    title: "Trial Keeper",
    kind: "trial",
    look: look({ body: "female", hair: "long", hairColor: "white", skin: "light", top: "longsleeve", topColor: "white", bottom: "skirt", bottomColor: "navy", shoes: "boots", shoesColor: "brown", hat: "hood", hatColor: "white" }),
    ...at(30.5, 114.4),
    dir: Dir.Down,
    greeting:
      "Welcome to the Isle of Trials. When you're ready, I'll raise a Shade of what you could become, here in the circle. It fights only you, and nobody else can help or get in the way. Beat it within three minutes and Orin will give you your second job. Fall, or run out of time, and you can try again: nothing is lost.",
    chatter: ["Take your time. The Shade will wait.", "Potions are allowed. Shades don't drink them.", "It fights only you. Nobody can help, or get in the way.", "Three minutes, once it rises."],
  },
  {
    // At the camp outside Crownhold's gate, where the road from the long bridge arrives.
    id: "herald",
    name: "Aldric",
    title: "Castle Herald",
    kind: "castle",
    look: look({ body: "male", hair: "messy", hairColor: "dark_brown", beard: "trimmed", skin: "light", top: "longsleeve", topColor: "navy", bottom: "longPants", bottomColor: "black", shoes: "boots", shoesColor: "brown", hat: "hood", hatColor: "navy" }),
    ...at(364.5, 78.6),
    dir: Dir.Down,
    greeting:
      "This is Crownhold, the guild castle. Every Wednesday and Saturday, 8 to 9 pm Batam time, it's under siege: guild members fight their way through the gate, round the keep and break the crystal at its heart, and the castle is their guild's. Whoever holds it when the hour is up keeps it until the next siege. Inside the walls, during a siege, every guild fights every other, and nobody loses anything for falling. The guild holding the castle collects a tribute from me every day, and its leader and officers can hire guardians.",
    chatter: ["Sieges every Wednesday and Saturday, 8 pm!", "Break the crystal and the castle is yours!", "Only guild members may enter during a siege.", "The castle's guild collects a tribute every day.", "Hire guardians before the siege. Not during it!"],
  },
  {
    // On the main street just east of the fountain plaza, by the GUILDS signpost.
    id: "registrar",
    name: "Leopold",
    title: "Guild Registrar",
    kind: "guild",
    look: look({ body: "male", hair: "messy", hairColor: "gray", beard: "trimmed", skin: "light", top: "cardigan", topColor: "maroon", bottom: "longPants", bottomColor: "black", shoes: "boots", shoesColor: "black" }),
    ...at(226.5, 183.6),
    dir: Dir.Down,
    greeting:
      "A guild of your own? Reach level 20, bring 10,000 gold, and choose a name and an emblem. Your guild's name and emblem show over every member's head, you get your own chat (type /g), and guild mates never fight each other in the Wildlands. The founder leads: they choose officers, and together they can invite up to 30 members. Every guild has a purse for its gold, and I keep the ranking of the top guilds.",
    chatter: [
      "Found a guild! Level 20 and 10,000 gold.",
      "A guild is for good: it's still there tomorrow.",
      "Guild mates never fight in the Wildlands.",
      "Type /g to talk to your guild.",
      "Sieges at Crownhold, Wednesdays and Saturdays at 8!",
    ],
  },
  {
    // At the Arena's west side, facing the ring.
    id: "arena-master",
    name: "Magnus",
    title: "Arena Master",
    kind: "arena",
    look: look({ body: "male", hair: "topknot", hairColor: "dark_gray", beard: "trimmed", skin: "olive", top: "sleeveless", topColor: "maroon", bottom: "longPants", bottomColor: "black", shoes: "boots", shoesColor: "black", hat: "headband", hatColor: "red" }),
    ...at(231.5, 225.6),
    dir: Dir.Right,
    greeting:
      "Welcome to the Arena! Click any player and challenge them to a duel. Fight it out here on the sand and it counts for my ranking: win, and your rating goes up. Out there it's just for fun. Nobody loses anything in a duel, and I patch you both up after.",
    chatter: [
      "Who's next on the sand?",
      "Click a player to challenge them!",
      "Duels in the ring count for the ranking!",
      "No potions in a duel. Skill wins!",
      "Nobody gets hurt for real here. Promise.",
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
        "The west gate leads out to the Orc Woods. Don't go out there before level 20!",
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

/** The ferry: where each captain sails you, which way you face stepping off, the fare in gold, and the level the far shore is for. */
export const FERRY: Record<string, { to: { x: number; y: number }; dir: number; fare: number; dest: string; lv?: number }> = {
  "ferry-meadow": { to: at(190.5, 399.6), dir: Dir.Down, fare: 500, dest: "Frostfell", lv: 40 },
  "ferry-frostfell": { to: at(242.5, 333.6), dir: Dir.Up, fare: 0, dest: "the South Meadow" },
  "ferry-dusk": { to: at(388.5, 186.6), dir: Dir.Right, fare: 800, dest: "Ravenmoor", lv: 50 },
  "ferry-ravenmoor": { to: at(338.5, 186.6), dir: Dir.Left, fare: 0, dest: "Dusk Hollow" },
  "ferry-east": { to: at(329.5, 400.6), dir: Dir.Right, fare: 1200, dest: "Petalfall", lv: 60 },
  "ferry-petalfall": { to: at(314.5, 283.6), dir: Dir.Left, fare: 0, dest: "the meadow's east shore" },
  "ferry-ash": { to: at(529.5, 251.6), dir: Dir.Right, fare: 1500, dest: "Ashpeak", lv: 70 },
  "ferry-ashpeak": { to: at(314.5, 283.6), dir: Dir.Left, fare: 0, dest: "the meadow's east shore" },
};

/** What an NPC's stall offers right now (sold-out items last for featured stalls). */
export function npcProducts(npc: NpcDef, products: readonly ShopProduct[]): ShopProduct[] {
  if (npc.featured) return products.filter((p) => p.label || p.hot).slice(0, 18);
  return npc.sells ? products.filter((p) => npc.sells!.test(p.category)) : [];
}
