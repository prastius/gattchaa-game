# My World

A browser-based multiplayer open world with customizable characters and live chat.

- **Client:** Phaser 4 + TypeScript + Vite
- **Server:** Colyseus 0.18 + TypeScript on Node.js
- **Art:** LPC (Liberated Pixel Cup) pixel art: 32 px tiles, ¾ top-down view, layered characters. See [CREDITS.md](CREDITS.md).

**How to play** (controls, the town, jobs, skills, every item, card and monster, the Blacksmith) is in [docs/GAMEPLAY.md](docs/GAMEPLAY.md), written for players and the team. This README is for developers.

## Run locally

```bash
npm install
npm run dev        # server on :2567, client on http://localhost:5173
```

Open the page in two browser windows to see multiplayer and chat.

| Control | Action |
| --- | --- |
| WASD / arrow keys | Move |
| Hold finger | Walk toward it (phones) |
| E / tap | Talk, use a machine, browse a player's shop |
| Click / tap a monster | Attack it: you walk up to it and keep hitting while it's in reach |
| Space / sword button | Attack the nearest monster (outside the town walls) |
| Esc | Stop attacking |
| Click / tap loot on the ground | Walk over and pick it up |
| I / bag button | Bag: wear gear, drink potions, put monster cards into gear, see your ATK and DEF |
| Q / potion button | Drink a potion (the smallest one that heals you fully) |
| 1–6 / skill buttons | Use your skills (once you're a Knight, Mage or Archer); aimed skills pick your target, or the nearest monster |
| K / lightning button | Skills: learn and level them with skill points |
| X / chair button | Sit down where you stand; walking gets you up |
| V / Open shop | Open your shop where you stand in the Market Square (signed-in players); while it's open: see it, or close it |
| Smiley button | Emotes over your head: wave, happy, LOL, love, wow, sad, angry, nice, !, ? |
| Enter | Open chat, then Enter again to send. Esc cancels. |
| Wardrobe | Change your outfit at any time; everyone sees it |
| Scroll / + − | Zoom |

## Production

```bash
npm run build      # builds client/dist (plus .br/.gz copies) and server/build
npm start          # one port (2567) serves the game page, assets and the WebSocket
```

The build compresses the game's scripts and styles ahead of time (Brotli and gzip), and the server sends those small copies: the 1.6 MB game script goes out as about 360 KB, at no CPU cost per visit. Browsers keep the scripts for a year (their file names change with every build) and re-check the page itself on every visit, so a deploy shows up right away.

### Deploying to a Linux VPS (terminal only)

Point a domain's DNS at the VPS, clone the repo there, then:

```bash
bash deploy/setup-ubuntu.sh play.example.com   # Node 24, PM2, nginx, HTTPS
bash deploy/update.sh                          # later: pull, rebuild, reload
```

Files in `deploy/`:

- `nginx.conf` is the reverse proxy, with WebSocket upgrade headers.
- `nginx-gzip.conf` compresses the server's other text replies (shop data, sign-in). New servers get it from `setup-ubuntu.sh`. On a server set up before it existed, install it once:
  `sudo cp deploy/nginx-gzip.conf /etc/nginx/conf.d/my-world-gzip.conf && sudo nginx -t && sudo systemctl reload nginx`
- `setup-ubuntu.sh` does the one-time install.
- `update.sh` redeploys.

PM2 settings are in `ecosystem.config.cjs`.

### Saved data

Accounts (players who signed in with Gattchaa), their characters' progress (class, level, EXP, HP/MP, bag, equipment and skills), open shops with what they sell, and mail (news of sales and items waiting for a player who was away) are kept in one SQLite file, `server/data/town.db`, using Node's built-in `node:sqlite`. There's no database server to run. Deploys and restarts leave the file alone; open shops come back after a restart. Back it up with a copy while the server is stopped, or live with `sqlite3 server/data/town.db ".backup town-backup.db"`. Set `DB_PATH` to keep it somewhere else.

### Load testing

```bash
npm run bots -- http://localhost:2567 100     # or your VPS URL
```

This connects 100 bots that walk around (using the real collision code) and chat. It prints the server's CPU and memory every 5 seconds. Measured on a dev machine with 100 bots: 2–14 % of one CPU core, about 160 MB of RAM, and 0 rejected moves. A 1 vCPU / 1 GB VPS handles that.

## Layout

```
shared/       Code used by both client and server
  world.ts        Seeded generator (corner-based terrain) for the main island, Frostfell, Ravenmoor, Petalfall, Ashpeak, Sunscar, Starfall and the Isle of Trials, decorations, collision
  town.ts         The town's layout: walls, quarters, buildings, props, doors, the park and the Market Square; roads, bosses' camps, the islands and their seasons, Ravenmoor's castle, the Ogre Warlord's camp, the piers
  appearance.ts   Character look: encode/decode/validate, random looks
  catalog.ts      Generated list of hair/clothes/colour options
  protocol.ts     Message types, name/chat sanitizing
  vending.ts      Player shop rules (where a shop may open, what it sells for Points) and messages
  points.ts       Gattchaa Points: the game's only money (how they're written; the rules in its header)
  rpg.ts          Leveling and fighting: classes, the EXP curve, monsters (and their drops), fields, damage rules
  items.ts        Every item and monster card: stats, prices, rarity, icon, card slots, who may wear it and how it looks when worn; the Outfitter's stock; the Blacksmith's upgrade table and auras
  skills.ts       Class skills: what each does per level, MP, cooldowns, and how it looks
  titles.ts       Titles: how each is earned (deeds), its rarity and aura, and progress counting
  duels.ts        Duel rules (ranges, timers, PvP damage, the Arena ring) and the arena rating maths (Elo)
  pvp.ts          The Battle Pit's rules (who may fight whom), Glory and its shop, and Sable's board
  party.ts        Party rules: size, EXP sharing and its bonus, and the party messages
  guild.ts        Guild rules: size, founding, ranks, names, emblems, the history, the ranking, and the guild messages
  siege.ts        Guild wars: the siege schedule, the crystal, the guardians' posts and costs, the tribute, and where the beaten get up
  trial.ts        The Trial of Mastery (the way to a second job): its steps, each job's proof and Shade, the clock
server/       Colyseus server
  src/rooms/WorldRoom.ts   Joins, interest management, movement validation, chat, emotes, wardrobe, sitting, shops, trading
  src/rooms/WorldState.ts  Synced state
  src/rooms/Combat.ts      Monsters (spawning, AI), auto-attacks, EXP, level-ups, knockouts, loot, using items, jobs and skills, upgrades, titles and duels
  src/rooms/Titles.ts      A character's deeds and titles (bookkeeping only)
  src/rooms/Inventory.ts   A character's bag and equipment
  src/rooms/Drops.ts       Items on the ground: first pick for the top fighter (and their party), then anyone; they fade after 90 s
  src/rooms/Parties.ts     Parties: invites, leaving and removing, the leader, and keeping members up to date
  src/rooms/Guilds.ts      Guilds: founding (for Points), invites, ranks, removing, the notice, who's online, the names over heads
  src/rooms/Siege.ts       Guild wars at Crownhold: the schedule, who may go in, the crystal breaking, the end, the tribute, hiring guardians
  src/rooms/Trials.ts      The Trial of Mastery step by step: Orin's proof and the trip out, Vesna raising the Shade, the trip home
  src/db.ts                SQLite: accounts, sessions, characters, open shops, mail, rankings, guilds
  src/api.ts               Sign-in with Gattchaa, shop details
  src/gattchaa.ts          Gattchaa Town API client + webhooks
  src/static.ts            Serves the built client: pre-compressed files, cache headers
client/       Phaser game
  src/main.ts              Character creator and sign-in, then boots Phaser; wardrobe panel
  src/auth.ts              Gattchaa sign-in (ticket -> session token)
  src/vending.ts           Player shops: open/close yours, load what a shop sells, buy, search the market
  src/character.ts         Builds character sprite sheets (walk + sit) from recolored LPC layers, gear included; item icons
  src/PlayerSprite.ts      Avatar, walk/sit animation, name tag, chat bubble, emotes, health bar
  src/MonsterSprite.ts     Monster: animation, health bar, name on hover, target ring
  src/DropSprite.ts        Loot on the ground: bounce, rarity glow, name on hover
  src/world/terrainTiles.ts  Corner autotiling + padded tile atlas
  src/world/decorSprites.ts  Trees, rocks, plants
  src/world/town.ts        Buildings and furniture, lit windows at night, bunting, live shop displays
  src/world/shops.ts       Player shops: rugs, signs, the away seller's look-alike
  src/world/daylight.ts    Day and night (Batam time), lamp and fire glow
  src/world/ambience.ts    Butterflies by day, fireflies at night, snow over Frostfell, leaves over Ravenmoor, petals over Petalfall, embers over Ashpeak, sand over Sunscar, starlight over Starfall
  src/world/monsterArt.ts  Monster sprite sheets and their animations; humanoid monsters' parts
  src/world/fx.ts          Damage numbers, slashes, level-up light, arrows and magic bolts, skill effects
  src/scenes/WorldScene.ts   Chunk streaming, water glints, input, camera, interpolation
  src/ui/                  Creator, chat, HUD + minimap + emote picker, status panel (HP/MP/EXP), bag, skills (bar and window), NPC and shop panels, duels, the party panel, the guild window
  public/assets/           Downloaded art + manifest (committed)
scripts/
  fetch-assets.mjs   Re-downloads the art from pinned commits and regenerates catalog + credits
  compress-dist.mjs  Writes Brotli and gzip copies of the built client (part of npm run build)
  bots.ts            Load-test bots
```

## How it works

- **Same world on both sides.** Client and server generate the same 384×384-tile island from one seed, so the map is never sent over the network. Terrain is stored per tile *corner*, and each tile picks its art from its four corners. That gives smooth grassy banks, water and dirt edges.
- **The town.** A walled town of 124×92 tiles in the middle of the island, with gates west, east and south. Gattchaa Palace (the store) stands against the north wall. Below it are the fountain plaza, the Rooms pavilion and the pack stalls. Townhouses fill the west and east quarters. A lakeside park with a campfire runs along the west wall, and the Collectors' Café, the Arena (a ring for duels) and an orchard are on the east side. The Market Square, by the south gate, is where player shops gather.
- **Alive day and night.** Day and night follow Batam time. At night, lamps, the campfire, house windows and shop signs glow, and fireflies drift over the grass. By day, butterflies flit over the flowers and the water glints. These are cheap touches drawn only around the camera.
- **Crisp pixel art with no flicker.** The game renders at the screen's real pixel density with whole-number zoom, nearest-neighbor filtering and whole-pixel positions. Tiles come from an atlas with a 1 px padded border, so neighboring tiles can't bleed into each other while the camera moves.
- **Characters.** Each look is a short string such as `0.3.1.5.12.0.4.2.7.1.22`. The client stacks the LPC layers (shadow, body, head, shoes, legs, top, hair) and swaps the palette colors to the chosen skin, hair, eye and cloth colors. It makes one sprite sheet per distinct look and frees it when nobody on screen wears it.
- **Scales to 100+ players.** The server sends each client only the players within about one screen of them (Colyseus `StateView`), with positions as whole pixels.
- **Responsive movement.** Your character moves instantly on your screen. The server checks every move against the collision map and a speed budget, and snaps cheaters back. The budget tolerates messages that arrive in bursts (mobile networks, a busy server), so honest players never rubber-band; over any stretch longer than a second or two, speed stays capped at 1.25× walking speed.
- **Smooth other players.** Everyone else is drawn about 150 ms in the past and blended between timestamped server snapshots. The delay grows automatically on a bad connection. Press F3 to see it.
- **Doors.** The store interior is a separate area in a corner of the map. Walking into the door asks the server to move you; the server checks you're really at the door first.
- **Chat.** Your own messages appear instantly. The server cleans and rate-limits messages (5 per 5 s) and replays the last 50 to players who join. Chat is rendered as text, never HTML.
- **Emotes.** Ten Ragnarok-style emotes pop up over your head (the smiley button; the number keys are for skills), one per second at most.
- **Reconnects.** A dropped connection keeps your character in the world for 20 s while the SDK reconnects automatically.
- **Accounts are required.** The town is played with a Gattchaa Oripa account (its money is the player's Gattchaa Points), so `onAuth` turns away anyone without a valid session: `SIGN_IN_REQUIRED`, or `SIGN_IN_EXPIRED` for an old token. A test server can let guests in with `ALLOW_GUESTS=1` (never in production); the bots rely on it, and a dev build of the client shows a test-only guest button. **Sign in with Gattchaa** goes to gattchaaoripa.com, which sends the player back with a one-time ticket. The game swaps it for its own 30-day session, so passwords never reach the game. Signed-in players get their character back on any device. One window per account: opening a second one takes over.
- **Player shops.** Ragnarok-style vending: a signed-in player presses **Open shop** (V) in the Market Square, names their shop, picks up to 12 things from their bag with a price in Points each, and sits down on a rug with a sign over their head. The shop also shows the cards they've listed on the Gattchaa marketplace; each links to its listing, so real cards stay on the website.
  - **Stock:** the picked things leave the bag (`Combat.stockShop`) and are saved as JSON on the shop row (`shops.wares`, migration v8). Sold-out wares stay at 0 so their numbers never shift.
  - **Buying** (`shop:buy`): the buyer sends the ware number plus the item and price they saw; the room checks they're in the Market Square, can pay and have room, then `db.buyWare` takes the stock in one transaction. The sign's count (`PlayerShop.items`) and `rev` update, so open panels reload.
  - **Paying:** `db.takeWare` takes the ware out of the shop first (so nobody else can buy it meanwhile), then the wallet moves the Points from the buyer's Gattchaa account to the seller's (`transfer`); if that fails, `db.restock` puts it back. The item goes to the buyer, or to their mail if their bag filled up meanwhile.
  - **Mail:** the `mail` table holds news of a sale (the Points, already paid, and a note; the column is still called `gold`) and items waiting for someone (leftovers, purchases that didn't fit). The room hands mail to whoever is in town: right after a sale, on joining, and every 5 s (for sales through another room, and for bags that were full). Delivery and deleting the mail happen in one transaction, so nothing arrives twice. Closing a shop (by hand, by expiry, or because it sold out) mails back what didn't sell.
  - **Search:** `GET /api/market` lists everything for sale in every shop; Tina's "Find an item" tab filters it.
  - **Where:** only in the Market Square, and not right in front of staff or so close to another shop that the signs would overlap. The form says whether the spot is good before you open. Shops saved outside the square (from before this rule) close when the server starts.
  - **While it's open:** the seller stays seated, and signs stay lit at night.
  - **When the seller leaves:** a look-alike minds the shop for 24 hours.
  - **Finding shops:** Tina, the Market Keeper in the Market Square, lists every open shop, and you can browse them from her list or search what's for sale. The minimap marks shops in orange.
  - **Updates:** listing changes arrive by webhook, so prices and card counts update within seconds.
  - **Server cost:** nothing between purchases, apart from one small mail query every 5 s. Shops only do work when opened, browsed, bought from or updated.

## Leveling and fighting

Ragnarok and TibiaME style: click a monster and your character fights it. Everything about a fight is decided on the server, and the numbers live in `shared/rpg.ts`.

- **Classes.** Everyone starts as a Novice; at level 10 the Job Master makes you a Knight, Mage or Archer, and at level 50 a Lord Knight, Wizard or Hunter (see below). HP, MP, attack and defence grow by class as you level.
- **Levels.** The cap is `LEVEL_CAP` (100). The EXP curve (`expToNext`) is gentle through the Novice levels, then climbs to three times as much from the job change to level 13, so job levels take a few minutes each (about 4 at level 12, about 8 at level 18, 12 to 15 in the Orc Woods, 11 to 15 in the Wildlands, 10 to 16 on Frostfell, 14 to 17 on Ravenmoor, 15 to 20 on Petalfall, 12 to 24 on Ashpeak, 13 to 23 on Sunscar and Starfall, fighting on-level monsters with plain attacks). It keeps going past the cap, so raising it is a one-line change. At the cap, EXP stops filling.
- **Fields.** Monsters live outside the walls. The town (and the palace) is always safe: monsters never come in, and nobody can attack from inside. The first field is the **South Meadow**, out of the south gate (Rowan the Gate Guard explains it):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Slime | 1 | By the road | Only fights back |
  | Grass Snake | 4 | West grass | Only fights back |
  | Hornet | 7 | East field | Attacks on sight |
  | Snapper Flower | 10 | By the lake | Rooted; bites anyone who comes close, and spits seeds at anyone shooting it from afar |

  The second field is **Dusk Hollow** (Lv 10–20), out of the east gate: rocky ground with boulders and a few pines (Mara the Ranger explains it):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Grub | 11 | Along the east road | Only fights back |
  | Night Bat | 12 | North of the road | Fast; attacks on sight |
  | Rock Worm | 14 | South of the road | Slow, thick shell; only fights back |
  | Gazer | 16 | North-east | Shoots a beam from 170 px away; attacks on sight |
  | Ghost | 18 | South-east | Plain attacks often miss it (skills always land); attacks on sight |
  | **Pumpking** | 22 | Where the east road ends | Field boss (below) |

  The third field is the **Orc Woods** (Lv 20–30), out of the west gate: open grass and a rocky patch around a big inlet (Gregor the Scout explains it):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Goblin | 20 | Grass north of the west road | Fast; attacks anyone close |
  | Orc Warrior | 23 | Rocky ground south of the road | Tough; only fights back |
  | Orc Archer | 25 | North, west of the path to the Wildlands | Shoots arrows from 180 px; attacks on sight |
  | Orc Skeleton | 27 | West of the inlet | Attacks anyone close |
  | Orc Zombie | 29 | Far south | Very slow; hits hardest |
  | **Orc Warlord** | 33 | His camp where the west road ends (`ORC_CAMP`) | Field boss: 24,000 HP, 15 min respawn, for a party |

  The fourth field is the **Wildlands** (Lv 30–40), north of town, up two paths that run along the walls from the west and east roads: grass and woods round rocky highlands. Like every monster land, it's not PVP (see "The Battle Pit" below). Rook the Scout explains it:

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Boarman | 31 | Grass past the west path | Charges anyone close |
  | Lizardman | 33 | Dry ground past the east path | Only fights back; reach 48 px (a trident) |
  | Werewolf | 35 | North-west woods | Fast; attacks anyone close |
  | Troll | 37 | The highlands | Huge and slow; only fights back |
  | Vampire | 39 | High ground, north-east | Casts dark bolts from 170 px; attacks on sight |
  | **Minotaur King** | 44 | His lair on the highest ground (`MINOTAUR_LAIR`) | Field boss: 45,000 HP, 20 min respawn, for a party of four |

  The fifth field is **Frostfell** (Lv 40–50), an island of snow and ice across the sea south of the meadow. The world grew from 384 to 512 tiles tall to fit it: the generator raises it with its own hills (`FROSTFELL_ISLE`, `isleElevation` in `shared/world.ts`) while the main island keeps its exact shape (it's centred on fixed `MAIN_CX`/`MAIN_CY`, not the map's middle). Everything south of `SNOW_LINE` is drawn from LPC's winter sheets (terrain, trees and plants share the summer layout, so only the texture changes), with snowfall over it (`Snowfall` in `ambience.ts`) and white land on the minimap. The only way there is **the ferry**: a path branches east off the south road to a wooden pier (`PIERS`, `Floor.Pier`, the one floor you can walk on over water) where Edda the Ferry Captain sails you across for 500 Points (`ferry` message, `FERRY` in `shared/npcs.ts`, `payFare` in `Combat`); Bjorn the Ferryman sails you back for free from Frostfell's pier:

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Yeti | 41 | Woods west of the pier | Attacks anyone close |
  | Ramhorn | 43 | Woods east of the pier | Only fights back; reach 48 px (a spear) |
  | Frost Shaman | 45 | The west shore | Throws ice from 170 px; attacks on sight |
  | Frost Wight | 47 | The icy highlands | Attacks anyone close |
  | Frost Drake | 49 | The east | Big and slow; only fights back; hits hardest |
  | **Frost Giant** | 54 | His ring of stones on the highlands (`FROST_LAIR`) | Field boss: 70,000 HP, throws ice from 140 px, 25 min respawn, for a party of four at level 50 |

  The sixth field is **Ravenmoor** (Lv 50–60), an autumn island across the strait east of Dusk Hollow; the world grew to 512 tiles wide for it (`RAVENMOOR_ISLE`; `isleElevation` raises any island). `biomeAt` picks the season per tile (summer, Frostfell's winter, Ravenmoor's autumn east of `AUTUMN_LINE`); the client draws each from its own LPC sheets, falling leaves (`Weather`) and a purple dusk with soft edges over the island (`GLOOM`). The boat leaves from a pier where the east road meets the sea (Finn, 800 Points) to one on Ravenmoor's west shore (Corvin, free back); those piers run east–west, so their planks are drawn turned. The Fallen King's castle is broken walls of new `ruin`/`ruinTower` structure groups round a flagstone courtyard (`RUINS`). The Wraith is the Ghost sheet recoloured (`tint` in `MONSTER_ART`, `tintSheet`):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Wraith | 51 | Woods by the pier | Plain attacks often miss it; attacks anyone close |
  | Gargoyle | 53 | Either side of the castle | Fast; attacks anyone close |
  | Dark Knight | 55 | Below the castle gate | Tough; attacks anyone close |
  | Lich | 57 | East, past the lake | Casts dark bolts from 170 px; attacks on sight |
  | Flesh Golem | 59 | The south | Huge and slow; only fights back; hits hardest |
  | **Fallen King** | 64 | His throne in the castle (`RUINS`) | Field boss: 110,000 HP, dark bolts from 150 px, 30 min respawn, for a party of four at level 60 |

  The seventh field is **Petalfall** (Lv 60–70), a spring island in the open sea south-east of the meadow (`PETALFALL_ISLE`). `biomeAt` gives everything south-east of `SPRING_CORNER` (tile 320, 320) the spring sheets; there most broadleaf trees show their cherry-blossom variant (`BLOSSOM` in `decorSprites.ts`), the generator grows them on high ground where it would grow pines, and pink petals fall (`Weather`). The ferry path off the south road now runs on past Edda's pier to a pier on the meadow's east shore (Marlow, 1,200 Points, level 60) and one on Petalfall's west shore (Willow, free back). The Ogre Warlord's war camp is eight standing stones round a flagstone yard on the bare high ground (`WARLORD_CAMP`), with no other monster's home within 18 tiles so nobody drags him into their fight. No LPC palette has red skin, so the ogres are pale skin multiplied by a red `tint` per part (`ArtPart.tint`, applied in `composeParts`):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Moon Hare | 61 | Meadows by the pier | Only fights back; plain attacks often miss it |
  | Fox Spirit | 63 | North-west woods | Throws foxfire from 170 px; attacks on sight |
  | Crow Blade | 65 | The middle | Attacks anyone close |
  | Phantom Swordsman | 67 | The north-east | Tough; attacks anyone close |
  | Red Ogre | 69 | The south | Huge and slow; only fights back; hits hardest |
  | **Ogre Warlord** | 74 | His war camp on the high ground (`WARLORD_CAMP`) | Field boss: 170,000 HP, throws fire from 150 px, 30 min respawn, for a party of four at level 70 |

  The eighth field is **Ashpeak** (Lv 70–80), a volcanic island far out in the eastern sea (`ASHPEAK_ISLE`). The world grew from 512 to 640 tiles wide to fit it (`WORLD_TILES_W`); everything else keeps its exact place. Its hills are raised higher than the other islands' (`ashElevation`), so most of it is bare rock. `biomeAt` gives everything east of `ASH_LINE` (tile 512) the **ash** look: there are no ash sheets to download, so `makeAshSheets` (`decorSprites.ts`) makes them from the winter ones when the game starts, turning snow and ice to grey ash and bark, needles and berries to charcoal, but leaving the sea alone. Embers rise over it (`Weather`, kind `embers`) under a smoky red haze (`HAZE`, drawn like Ravenmoor's dusk by `WorldScene.overlay`). The ship leaves from Marlow's pier on the meadow's east shore (Dorian, 1,500 Points, level 70) to a pier on Ashpeak's west shore (Cassia, free back). The Cinder Colossus's crater is eight standing stones and four fires round dark flagstones in the middle of the island (`CINDER_CRATER`). The creatures are LPC character art and the Ghost sheet multiplied by fire colours (`tinted` in `monsterArt.ts`):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Ember Imp | 71 | The rock north of the pier | Quick; attacks anyone close |
  | Salamander | 73 | South-west slopes | Spits fire from 170 px; attacks on sight |
  | Obsidian Knight | 75 | Along the north | Tough; attacks anyone close |
  | Cinder Wraith | 77 | The hot rock in the east | Plain attacks often miss it; attacks anyone close |
  | Magma Golem | 79 | The south | Huge and slow; only fights back; hits hardest |
  | **Cinder Colossus** | 84 | His crater in the middle (`CINDER_CRATER`) | Field boss: 230,000 HP, throws fire from 150 px, 30 min respawn, for a party of four at level 80 |

  The ninth and tenth fields are **Sunscar** (Lv 80–90, `SUNSCAR_ISLE`, north of Ashpeak) and **Starfall** (Lv 90–100, `STARFALL_ISLE`, south of it), which take the cap to 100. In the far eastern sea, `biomeAt` gives everything north of `SAND_LINE` the **desert** look and everything south of `NIGHT_LINE` the **starlit** one. Both are made from the summer sheets by `makeIslandSheets` (`decorSprites.ts`, with Ashpeak's ash, through one `recolorSheet` helper): grass to sand and leaves to dry olive on Sunscar, grass and leaves to night violets and blues on Starfall, the sea left alone. Sand blows across Sunscar under a warm `DUST` overlay; starlight drifts up over Starfall under a deep blue `NIGHT` one. Both ships leave from Marlow's pier too (Soren, 1,800 Points, level 80; Lyra, 2,200 Points, level 90), and Nadia and Celeste sail back for free. The Dune King's temple (`SUN_TEMPLE`) and the Star Tyrant's altar (`STAR_ALTAR`, south of Starfall's lake) are kept clear of trees. All twelve creatures are LPC character art or the pack's Ghost and Bat sheets, multiplied by a colour (`tinted`). With the Golden Potion (below), on-level hunting costs about as many potions as Ashpeak with White Potions:

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Dune Stalker | 81 | Sunscar's south-west dunes | Only fights back; plain attacks often miss it |
  | Dust Djinn | 83 | Sunscar's north-west | Hurls searing bolts from 170 px; attacks on sight |
  | Tomb Warden | 85 | North of the temple | Tough; attacks anyone close |
  | Desert Raider | 87 | Sunscar's east | Quick; attacks anyone close |
  | Sand Golem | 89 | Sunscar's south | Huge and slow; only fights back; hits hardest |
  | **Dune King** | 94 | His temple (`SUN_TEMPLE`) | Field boss: 330,000 HP, throws fire from 150 px, for a party of four at level 90 |
  | Void Bat | 91 | Starfall's south-west | Quick; attacks anyone close |
  | Astral Seer | 93 | Starfall's north-west | Casts starlight from 170 px; attacks on sight |
  | Star Knight | 95 | North of the lake | Tough; attacks anyone close |
  | Night Wisp | 97 | The east shore | Plain attacks often miss it; attacks anyone close |
  | Crystal Golem | 99 | Starfall's south-east | Huge and slow; only fights back; hits hardest |
  | **Star Tyrant** | 104 | His altar (`STAR_ALTAR`) | Field boss: 450,000 HP, casts starlight from 150 px, for a party of four at level 100 |

- **The Golden Potion.** Bram sells it (300 Points): 600 HP, but only from level 70 (`lv` on a usable item is checked by `Combat.drink`, and Q skips potions you can't drink yet). The White Potion's fixed 250 HP had stopped keeping up with how hard the highest monsters hit.

- **Field boss.** The Pumpking is Dusk Hollow's boss, Ragnarok's MVP style: one at a time, 12,000 HP, breathes fire from 150 px, heals only slowly when left alone, and comes back 10 minutes after it falls. It's drawn bigger, with its name and health always showing. The whole town hears when it rises again and who brought it down. A level 20 Knight can just about beat it alone with plenty of potions; a party shares the EXP by damage. It always drops King's Candy (600 Points at Bram), often a good piece of gear, and very rarely the Moonblade or the Pumpking Card. The Orc Woods' Orc Warlord is the same kind of boss, bigger (24,000 HP, back after 15 minutes), with the Dragon Spear and his own card as the rare prizes. The Wildlands' Minotaur King is bigger again (45,000 HP, back after 20 minutes), with the legendary Sunfire Bow, Archmage Staff and his own card as the rare prizes, and other players free to attack whoever fights him. Frostfell's Frost Giant is bigger still (70,000 HP, back after 25 minutes), with the legendary Frost Scythe and his own card, Ravenmoor's Fallen King bigger again (110,000 HP, back after 30 minutes), with the legendary Fallen Crown (a helmet for anyone) and his own card, and Petalfall's Ogre Warlord the biggest yet (170,000 HP, back after 30 minutes), with the legendary Warlord's Helm (also for anyone) and his own card. Any monster can be a boss (`boss: true` in `MONSTERS`).
- **Dungeons.** Eleven, at least one under every land, all data in `DUNGEONS` (`shared/town.ts`): the Slime Cellar (Lv 6–12), the Hollow Burrows (14–22), the Goblin Warren (22–28), the Orc Caves (28–36), the Moonfang Den (37–45), the Frozen Crypt (46–54), the Shadow Vault (56–64), the Blossom Grotto (66–74), the Magma Depths (76–84), the Sunken Tomb (86–94) and the Void Rift (94–100). Each is two cave floors in an 80 x 112 zone nobody can walk to: the Orc Caves in a corner of the south-western sea, the rest side by side in the **underground band**, 256 rows added below the overworld (`OVERWORLD_H` 512; `WORLD_TILES_H` 768): two rows of 80 x 112 zones, at rows 528 (full) and 656 (the Goblin Warren and the Moonfang Den, with room for six more). The generator doesn't work out hills for the band, so the bigger world costs only a little more to build, and the outdoor camera stops at the overworld's edge. Each dungeon has its rooms and passages (the newer ones reuse three layouts, mirrored or flipped floor by floor), its portal points, its look underground (`biome`), its gloom (`shade`, `strength`) and, for some, falling weather (`weather`: embers in the Magma Depths, petals in the Blossom Grotto, stars in the Void Rift). `World.carveCaves` turns everything else in each zone to solid rock (`Floor.Void`), roughens the big rooms' edges, heaps boulders against their walls and scatters stones (passages stay four tiles wide and clear). Portals are `DOORS` made from each dungeon (`<id>-in`, `-out`, `-down`, `-up`) with `dir: -1` (walk into them any way) and a `portal` colour (`Town.portal` draws a glowing ring); trees and rocks keep clear of every portal in the overworld (`World.isReserved`). While you're in a zone the client keeps the camera inside it, draws only its chunks and ignores the sky's light (`WorldScene.updateIndoors`, generalised from the palace), and the minimap shows only that dungeon. Each is an ordinary field in `FIELDS` (not PVP) with five monsters and a boss with a slam and a blast, and a Dungeon Warden stands by each portal.
- **Boss attacks.** Every field boss has a `slam` (a circle round itself, when someone is close) and a `blast` (a circle under the furthest of the players who've hurt it, within `reach`), both `BossAttack`s in `shared/rpg.ts`. `Combat.bossAttacks` winds one up with a `warn` event (the client draws a red circle that fills in, `Fx.warn`), and `BOSS_WINDUP_MS` (1.3 s) later a `boom` lands on everyone still inside (hits with `aoe`, so no missile flies). The clocks start when it's first engaged; a frozen boss starts no new ones. Ranged bosses' plain attacks reach `BOSS_REACH` (300 px, past the longest bow), and bosses leash at 14 tiles instead of 6, so nobody can shoot one from where it can't answer or while it walks home.

- **Fighting.** You auto-attack once a second while the monster is in reach. Hits can miss (more often against higher levels), and 5 % are critical hits. The client only says what you're attacking and draws what the server reports: damage numbers, slashes, health bars.
- **Rewards.** EXP is shared by everyone who hurt the monster, by how much damage they did. Monsters more than 5 levels below you give less (down to 10 %). Monsters never drop money (see "Gattchaa Points"). Level-ups heal you fully, and every 10th level is announced in chat.
- **Healing.** Out of combat you regain HP and MP slowly. Sitting (X) is 3 times faster, and resting inside the walls doubles that again.
- **Fainting.** At 0 HP you faint and return to town fully healed. Novices lose no EXP; Knights, Mages and Archers lose 3 % of a level. Beaten by a player (the Battle Pit, a duel or a siege), you lose nothing.
- **Saving.** Signed-in players' progress is saved on every level-up and faint, every 30 s, and when they leave.
- **Server cost.** Monsters only think while a player is near their spawn area, and fight events go only to players close enough to see them. 20 bots fighting at once used about 5 % of one CPU core.
- **Testing.** Outside production (`NODE_ENV` not `production`), chat commands help: `/level 25` jumps to a level, `/item saber` (or `/item redPotion 20`, `/item hornetCard`, `/item moonblade +10`) adds items, `/points 1000` sets your Points (only on a server not linked to Gattchaa: the test wallet), `/job archer` turns you into a class (from level 10; `/job novice` goes back), `/title kingslayer` hands you a title, `/trial 2` jumps to a step of the Trial of Mastery (0 none, 1 asked, 2 proof given, 3 passed; `/job lordKnight` skips it), `/tp 362 82` takes you to a tile (there: Crownhold's gate), and `/siege on` starts a siege now (`/siege off` stops it, `/siege auto` goes back to the schedule). To test duels you need a second player (another window, or a bot). Shops need a signed-in seller (run the Gattchaa mock to sign in) and a second player to buy. `/help` lists every item id.

## Jobs and skills

TibiaME style: three jobs, each with its own weapons and skills on the number keys. The jobs are in `shared/rpg.ts` (`CLASSES`), the skills in `shared/skills.ts`.

- **The Job Master.** Orin stands just inside the south gate. From level 10 a Novice can become a Knight, Mage or Archer, for good. The job comes with its weapon, worn straight away (unless you already hold one the job can use): a Squire's Longsword, an Apprentice Staff or a Hunting Bow.

  | Job | Strengths | Weapons | Skills (keys 1, 2, 3) |
  | --- | --- | --- | --- |
  | Knight | Most HP and DEF | Swords, daggers | Bash (a heavy blow), Whirlwind (hits everything around you), Guard (DEF up for 20 s) |
  | Mage | Most MP and ATK, little HP | Staves (reach 150–170 px), daggers | Fire Bolt (from 220 px), Frost Nova (hits and freezes everything around you), Heal |
  | Archer | In between | Bows (reach 170–190 px, both hands: no shield), daggers | Double Shot, Arrow Rain (hits everything around the target), Eagle Eye (ATK and critical chance up for 20 s) |
  | Lord Knight (from Knight, level 50) | Knight, a step up | As Knight | Knight's three, plus Spiral Pierce (two thrusts), Brandish (hits everything around the target), Berserk (ATK and critical chance up) |
  | Wizard (from Mage, level 50) | Mage, a step up | As Mage | Mage's three, plus Lightning Bolt (from 230 px), Meteor Storm (around the target), Storm Gust (around the target, freezes) |
  | Hunter (from Archer, level 50) | Archer, a step up | As Archer | Archer's three, plus Falcon Strike (three dives from 240 px), Ankle Snare (holds the target), Sharp Shooting (always critical) |

- **Weapons.** Swords are for Novices and Knights, staves for Mages, bows for Archers; daggers for everyone. Bows and staves shoot from a distance: arrows and magic bolts fly to the target, and the damage shows when they land. Bram sells the three job weapons; the Recurve Bow, Gnarled Staff and Crystal Staff drop from Snapper Flowers.
- **Skill points.** One at the job change and one every level after (`skillPoints` in `shared/rpg.ts`). Spend them in the skills window (K): each skill goes up to level 10, getting stronger every level. First jobs have 3 skills; second jobs add 3 more on keys 4–6, and 51 points at level 60 can't max all six (by level 69, with 60 points, you can).
- **Second jobs.** From `SECOND_JOB_LEVEL` (50) Orin turns each first job into its second (`NEXT_JOBS`): Knight → Lord Knight (Spiral Pierce, Brandish, Berserk), Mage → Wizard (Lightning Bolt, Meteor Storm, Storm Gust), Archer → Hunter (Falcon Strike, Ankle Snare, Sharp Shooting). A second job is its own `ClassId` with `from` pointing at the first job: `jobLine` decides gear (`canWear`), and `skillsOf`/`hasSkill` give it both jobs' skills, so nothing learned is lost. Its stats grow a little faster, which makes the change a step up (`nextJob` in `Combat`). It needs the Trial of Mastery passed first (see below). `freezeMs` now works on any attack skill (Storm Gust, Ankle Snare), and `sureCrit` makes every hit critical (Sharp Shooting).
- **Third jobs.** From `THIRD_JOB_LEVEL` (80) a second job becomes its third (`NEXT_JOBS`): Lord Knight → Paladin (Holy Strike, Divine Shield, Judgement), Wizard → Archmage (Arcane Nova, Comet, Arcane Focus), Hunter → Ranger (Piercing Volley, Barrage, Hawk Eye), through a second Trial of Mastery. `from` now chains: `jobChain` lists a class and every job it grew out of, so `jobLine` (gear), `skillsOf` and `hasSkill` (all nine skills, keys 1–9) and `jobTier`/`jobLevel` work for any depth. Nine skills at level 10 is 90 points, and a level-100 character has 91. On a phone the skill bar wraps into two rows; on narrow desktops it moves to the bottom right, clear of the chat.
- **The Trial of Mastery.** The way to a second job (and later a third; `TRIALS` holds both, keyed by the job you have now: when, the proof and where it's from, and the Shade) (`shared/trial.ts`, `server/src/rooms/Trials.ts`). How far along a character is is `Trial` (none, asked, proven, passed), saved in `characters.trial` (migration v14) and sent in the sheet (`StatsMessage.trial`). From the trial's `ask` level (45, or 75) Orin asks for its `proof` (`trial` message, step `ask`, then `prove`: `Combat.askTrial`/`proveTrial` take it all at once). From its `at` level (50, or 80), step `go` teleports you to the **Isle of Trials** (`TRIAL_ISLE`, a small round island the generator raises far out in the western sea with no pier: `trialElevation` in `shared/world.ts`). There Vesna (NPC kind `trial`, message `trial:keeper`: `begin`, `quit`, `home`) raises your trial's `shade` with `Combat.raiseShade`: a monster with an `owner`, no group, no EXP or loot, that only its owner can strike (`strikeBlock`), that only hunts its owner, never heals, and goes after `TRIAL_MS` (3 minutes; `StatsMessage.trialLeft` drives the bar at the top of the screen, the siege bar's element). Beating it sets `Passed` and the `trialOver` hook brings you back to Orin after `TRIAL_HOME_MS`; falling to it costs no EXP; leaving the game or going home takes it away. `nextJob` refuses until `Passed`, then resets it. Shades are drawn from second-job gear, tinted violet and a little see-through (`shade` and `alpha` in `monsterArt.ts`).
- **Using skills.** Keys 1–6 or the skill buttons (bottom of the screen; above the chat on phones). Aimed skills use your target, or pick the nearest monster and walk into range first. Each skill costs MP and has a cooldown, shown as a curtain on its button, and there's a short pause (0.7 s) between any two skills. Skills never miss. Attack skills don't work inside the town.
- **Effects.** Frozen monsters turn icy blue and can't move or bite. Buffs make their skill button glow while they last.
- **Saving.** Learned skills are saved with your progress (migration v5). If saved skills ever add up to more points than your level gives, all the points come back to spend again.

## Items and equipment

Every item is in `shared/items.ts`: its stats, price, rarity, icon, and how it looks when worn. The server owns every bag; the client only asks ("wear slot 3", "pick up that") and draws the answer.

- **Equipment.** Eight slots: weapon, shield, head, armour, legs, feet, ring and amulet. Worn gear adds ATK, DEF, HP or MP, and some needs a minimum level. The first six slots show on your character for everyone (LPC armour and weapon art, recoloured iron, bronze or steel). A helmet replaces your hat, greaves your trousers, boots your shoes. Weapons are put away while you sit.
- **Rarity.** Common, Uncommon (green), Rare (blue), Epic (purple) and Legendary (orange). Rare finds get a chat line; a Legendary find is announced to the whole town. On the ground, rarer loot glows, and Legendary loot sends up a pillar of light.
- **Loot.** Each monster has a drop table in `shared/rpg.ts` (every entry rolled on its own): its own monster loot (Slime Jelly, Snake Scale, Wild Honey, Bloom Crystal), potions, and now and then a piece of gear. Loot lands on the ground around the monster. For 15 seconds only the player who did the most damage can take it (it looks faded to everyone else); then anyone can. It fades away after 90 seconds. Click it to walk over and pick it up.
- **Bag.** 30 slots. Potions and loot stack up to 99. Click an item for its details, double-click to wear or drink it. You can drop things on the ground, where anyone can pick them up.
- **Potions.** Red Potions heal 40 HP, Orange Potions 100 HP, White Potions 250 HP, one every 0.8 s, even mid-fight. Q drinks the smallest one that heals you fully.
- **The Outfitter.** Bram stands outside the south gate, across from Rowan. He sells potions and starter gear (Dagger, Short Sword, Wooden Shield, Leather Cap, Chain Coif, Leather Armour, Leather Pants and Boots, Copper Ring, Clover Charm) and buys anything with a price, with a one-click "sell all monster loot". Better gear only comes from monsters.
- **Dusk Hollow gear.** Level 12–20 drops, all visible on the character: Wizard Hat, Ranger Hood (hides your hair), Horned Helm, Greathelm, Guard Tabard, Sage Tabard, Kite Shield, Crusader Shield, Rapier, Knight's Blade, Great Bow, Ember Staff, and the Pumpking's Moonblade. Each monster also has its own loot to sell (Sticky Silk, Bat Fang, Rock Shard, Gazer Lens, Ectoplasm).
- **Orc Woods gear.** Level 22–30 drops: Scimitar, Katana, Composite Bow, Crossbow, Ring Staff, Diamond Staff, Round and Spartan Shields, Barbarian and Viking Helms, Scout Armour and Starry Cloak (both with a cape), Dark Plate, Steel Greaves and Sabatons, two rings and two amulets, and from the Orc Warlord the Warlord's Medal and the legendary Dragon Spear. **Spears** are a new weapon type (`spear` in `WEAPON_USERS`), for Knights only and two-handed: the Halberd and the Dragon Spear. Six more cards (Goblin, Orc Warrior, Orc Archer, Orc Skeleton, Orc Zombie and the legendary Orc Warlord Card) bring the total to 16.
- **Wildlands gear.** Level 32–40 drops: Long Spear and Trident (spears), Flame Blade, Longbow, Serpent Staff, Tower and Engrailed Shields, Armet, Celestial Hat, Close Helm, Wolfskin Vest, Mystic Robe, Golden Plate, Greaves and Sabatons, the Ring of the Wild and Wolf Fang Necklace, and from the Minotaur King the Minotaur Horn and the legendary Sunfire Bow and Archmage Staff. Bram sells White Potions (250 HP) for the Wildlands. Six more cards (Boarman, Lizardman, Werewolf, Troll, Vampire and the legendary Minotaur King Card) bring the total to 22.
- **Frostfell gear.** Level 42–48 drops: Ice Sword, Glacier Lance and the legendary Frost Scythe (spears), Frost and Glacier Bows, Winter and Aurora Staves, the Frost Shield, Snow Hood, Moon Hat and Valkyrie Helm (a helmet with wings), Fur Cloak, Winter Robe, Frost Plate, Frost Greaves and Sabatons, the Snowflake Pendant and Frost Ring, and from the Frost Giant his Tooth. LPC's "white" cloth is cream and its "ceramic" metal is tan, so the frost look is `sky` cloth and `silver` metal. Six more cards (Yeti, Ramhorn, Frost Shaman, Frost Wight, Frost Drake and the legendary Frost Giant Card) bring the total to 28.
- **Ravenmoor gear.** Level 52–58 drops: Gilded Blade, Dark Lance (a spear), Blood and Royal Bows, Bone and Soul Staves, the Ruin Shield, Bascinet, Shadow Hood, Night Hat, Shadow Cloak, Lich Robe, Dread Plate, the Bone Charm and Ring of Souls, and from the Fallen King his Seal and the legendary Fallen Crown. Six more cards (Wraith, Gargoyle, Dark Knight, Lich, Flesh Golem and the legendary Fallen King Card) bring the total to 34.
- **Petalfall gear.** Level 62–68 drops: Blossom Blade, Thunder Glaive (a spear), Petal and Ogre-Bone Bows, Foxfire and Storm Staves, the Jade Shield, Phantom Helm, Crow Mask, Blossom Hat, Crow Mantle (black leather with a pair of crow's wings), Blossom Robe, Warlord Plate, the Foxfire Charm and Moonstone Ring, and from the Ogre Warlord his Fang and the legendary Warlord's Helm. Six more cards (Moon Hare, Fox Spirit, Crow Blade, Phantom Swordsman, Red Ogre and the legendary Ogre Warlord Card) bring the total to 40.
- **Ashpeak gear.** Level 72–78 drops: Cinder Blade, Magma Lance (a spear), Ember and Obsidian Bows, Cinder and Magma Staves, the Obsidian Shield, Obsidian Helm, Ember Hood, Ashen Hood, Obsidian Plate, Cinder Robe, Ashen Leathers, the Ember Ring and Salamander Charm, and from the Cinder Colossus his Heart and the legendary Colossus Mantle. Six more cards (Ember Imp, Salamander, Obsidian Knight, Cinder Wraith, Magma Golem and the legendary Cinder Colossus Card) bring the total to 46.
- **Sunscar and Starfall gear.** Level 82–98 drops: Sun and Star Blades, Sun Spear and Void Lance, the Sand, Sunbeam, Moon and Starlight Bows, the Djinn, Sun, Seer's and Astral Staves, Sun and Star Shields, three helmets and three suits for each island, rings and amulets, and from the bosses the Sun Medallion and Tyrant's Star, and the legendary Sun Aegis (a shield that burns back) and Ring of the Fallen Star. Twelve more cards bring the total to 58.
- **Saving.** The bag and equipment are saved with the rest of your progress, plus right away after buying or finding something good.
- **Defence.** Damage is softened by defence rather than reduced by it (defence equal to the attack halves a hit), so armour always helps but never makes you untouchable.

## Monster cards

Ragnarok style: every monster very rarely drops its own card, and a card goes into a free card slot on equipment for good.

| Card | Dropped by | Goes into | Name it gives | Bonus | Chance |
| --- | --- | --- | --- | --- | --- |
| Slime Card | Slime | Armour | Bouncy | HP +30 | 1 in 1,250 |
| Grass Snake Card | Grass Snake | Boots | Slithering | Evade +8% (monsters miss more) | 1 in 1,250 |
| Hornet Card | Hornet | Weapon | Stinging | ATK +2, Critical +8% | 1 in 1,000 |
| Snapper Flower Card | Snapper Flower | Shield | Thorny | DEF +1, reflects 15% of each monster hit (at least 1) | 1 in about 830 |
| Grub Card | Grub | Legs | Silken | HP +40 | 1 in 1,000 |
| Night Bat Card | Night Bat | Amulet | Vampiric | 5% of the damage you deal heals you | 1 in 1,000 |
| Rock Worm Card | Rock Worm | Ring | Rocky | DEF +3 | 1 in 1,000 |
| Gazer Card | Gazer | Helmet | Gazing | ATK +3, MP +30 | 1 in 1,000 |
| Ghost Card | Ghost | Armour | Ghostly | DEF +1, Evade +6% | 1 in 1,000 |
| Pumpking Card | Pumpking | Weapon | Royal | ATK +10, Critical +6% (legendary) | 1 in 50 kills |

- **Card slots.** Most gear has one slot; the better weapons have two. Small dots in the corner of a bag cell show the slots: hollow when free, gold when a card is in. The Leather Cap, Leather Pants, Copper Ring and Clover Charm have none. Every kind of slot now has at least one card that fits it.
- **Putting a card in.** In the bag, pick the card and press "Put in gear" (or double-click it). The gear it can go into lights up, worn or carried; pick one and confirm. Cards never come back out.
- **Names.** Carded gear takes the card's word, Ragnarok style: Stinging Saber, Double Stinging Saber, Stinging Thorny… The bag shows each card and its bonus.
- **Finding one.** A card fresh from a monster is announced to the whole town. Picking up a card someone put down is not.
- **Selling.** Bram won't buy cards (other players will pay far more) or gear with cards in it (the cards would be lost). Dropping carded gear keeps the cards in it.
- Balance lives in two places: the card items at the bottom of `ITEMS` in `shared/items.ts`, and each monster's drop table in `shared/rpg.ts` (the card is the last entry).

## The Blacksmith: upgrades and auras

Hilda the Blacksmith works by her forge fire outside the south gate, west of Rowan. She upgrades gear from +0 to +10, Ragnarok style, except that a failed upgrade never breaks anything: it only drops the gear one level.

| Upgrade to | Chance | Fee | Uses |
| --- | --- | --- | --- |
| +1 to +4 | always works | 100, 200, 300, 400 Points | Iron Ingot |
| +5 | 90% | 600 Points | Iron Ingot |
| +6 | 75% | 900 Points | Mithril Ingot |
| +7 | 60% | 1,200 Points | Mithril Ingot |
| +8 | 45% | 1,600 Points | Mithril Ingot |
| +9 | 35% | 2,000 Points | Star Crystal |
| +10 | 25% | 2,500 Points | Star Crystal |

- **What it adds.** Weapons get ATK for every level: an eighth of their own ATK, at least 1 (Saber +2, Moonblade +4). Shields, helmets, armour, legs and boots get DEF +1 per level. Rings and amulets can't be upgraded. A worn upgrade counts straight away.
- **Ingots.** Hilda sells Iron Ingots (100 Points); monsters drop them too. Mithril Ingots drop in Dusk Hollow, the Orc Woods, the Wildlands, Frostfell, Ravenmoor, Petalfall, Ashpeak, Sunscar and Starfall, and rarely from Snapper Flowers. Star Crystals come from Gazers and Ghosts (about 1 in 200 to 250), Orc Skeletons and Orc Zombies (about 1 in 125 to 170), the Wildlands' monsters past the Boarmen (about 1 in 100 to 170), Frostfell's monsters (about 1 in 70 to 125), Ravenmoor's (about 1 in 60 to 85), Petalfall's (about 1 in 55 to 65), the Pumpking (one kill in two), and the Orc Warlord, Minotaur King, Frost Giant, Fallen King and Ogre Warlord (always). The Pumpking also always carries a Mithril Ingot or two. Ingots are kept out of Bram's "sell all monster loot".
- **The cost of luck.** Simulated over 20,000 tries, reaching +7 takes about 10 tries (6,000 Points, 4 Mithril), +9 about 29 tries (32,000 Points, 19 Mithril, 3 Star Crystals), and +10 about 74 tries (100,000 Points, 50 Mithril, 16 Star Crystals).
- **Names.** Upgraded gear goes first in the name: "+7 Double Stinging Saber". The bag shows the level in the item's corner and what the upgrades add. Upgrades stay on gear that's dropped and picked up again; Bram won't buy upgraded gear.
- **Auras.** Wear anything at +7 or higher and everyone sees an aura at your feet: a blue ring at +7, violet with rising sparks at +9, and gold with a column of light at +10. Legendary gear (or a legendary card in gear) gives an orange aura that ranks between +9 and +10. The best one you qualify for shows (`auraOf` in `shared/items.ts`), unless your shown title has its own. At night auras glow like the street lamps (a glow above the night tint).
- **News.** A success at +9 or +10 is announced to the whole town.
- Balance lives in `UPGRADE_TABLE`, `upgradeCost` and `upgradeStep` in `shared/items.ts`; the ingot drops are in each monster's table in `shared/rpg.ts`.

## Titles

Earned by doing things, one shown under your name. The list is `TITLES` in `shared/titles.ts`; each has a goal (level, kills of one monster or any, kinds of cards found, a legendary find, best upgrade, failed upgrades, opening a shop, or Pioneer), a rarity and sometimes an aura.

- **Deeds.** The server counts what each character does (`Deeds`: kills by monster, card kinds found fresh from monsters, legendary finds, best upgrade, failed upgrades, shop opened, Points earned in your shop) in `server/src/rooms/Titles.ts` and checks for new titles after each deed. Everyone who hurt a monster gets the kill. Deeds and titles are JSON columns on `characters` (migration v6), cleaned when loaded.
- **Earning.** A new title gives a banner over the head (`title` fx), a chat line, and town news for epic and legendary ones. Characters saved before titles existed get their level titles quietly on join.
- **Showing.** `title:show` picks an earned title; it syncs as `Player.title` and draws under the name in its rarity colour. A shown title with an aura (Kingslayer, Card Master, Pioneer, Giantslayer) replaces the gear aura (`Player.aura`).
- **Pioneer.** When a signed-in player reaches `LEVEL_CAP`, the room claims a place in the `pioneers` table (first `PIONEERS` = 10 accounts per cap, numbered in order) and grants the title. Raising the cap opens 10 new places.
- **The window.** T (or the medal button) lists every title by group with progress bars; a badge counts titles earned since you last looked. The server sends `titles` (earned, shown, progress) whenever something changes.

## Duels and the Arena

Player vs player by agreement only. The rules are in `shared/duels.ts`; the fighting is in `Combat` (the "duels" section), next to the monster fighting it reuses.

- **Challenges.** Clicking another player opens a card with "Challenge to a duel" (`duel:ask`). The other player gets a prompt and answers within 20 s (`duel:answer`). One challenge every 5 s, from within 8 tiles; nobody minding a shop, already in a duel or knocked out.
- **The duel.** `Player.duel` holds each duelist's opponent, so everyone draws their health bars. A 3 s countdown (`duel` fx), then auto-attacks and skills work on the opponent like on a monster, anywhere (even in town), at `PVP_DAMAGE` (half). No potions and no regen mid-duel. Area skills catch the opponent; freezes don't apply to players.
- **Endings.** 0 HP loses; giving up (`duel:quit`), leaving the game or fainting to a monster forfeits; 2 minutes or more than 16 tiles apart is a draw. Both are healed afterwards; nobody loses anything.
- **Ranked.** A duel is ranked when both stand in `ARENA` (the ring behind the café) at the start and both are signed in; leaving the ring then forfeits. Ratings are Elo (start 1,000, K 32) in the `arena` table (migration v7), and a ranked win is town news. Magnus the Arena Master (`arena:board`) shows the top 10, your place and your Glory; a ranked win earns `GLORY_DUEL_WIN` (3) Glory, once per `PVP_RECOUNT_MS` for the same pair of accounts.
- **Titles.** Deeds count duels fought, won, and won in the ring: Good Sport, Duelist, Gladiator.

## Gattchaa Points

The town has no currency of its own: every price is paid in the player's **Gattchaa Points**, which live in their Gattchaa Oripa account and are bought or earned on gattchaaoripa.com only. The rules are in `shared/points.ts`; the money moves through `server/src/points.ts`.

- **Never made in the game.** Monsters drop items and cards, never money; nobody buys anything back (no NPC selling at all); the castle's tribute is items. So grinding can't turn into real value.
- **What costs Points:** Bram's and Hilda's stock (`ITEMS[id].price`), the Blacksmith's fees (`upgradeCost(...).points`), ferry fares (`FERRY`), founding a guild (`GUILD_FOUND_POINTS`), castle guardians (`GUARDIAN_COST`, paid by the officer who hires), and other players' shops (a transfer from buyer to seller). The numbers are the old gold prices, one to one, and need a pricing review now that they're real Points.
- **The wallet** (`makeWallet`): linked to Gattchaa (`GATTCHAA_API_URL`), every move is a call to the API in `docs/gattchaa-town-api.md` (section 8): `GET users/{id}/points`, `POST points/charge`, `points/refund` and `points/transfer`, each with a unique `ref` so a retry never moves Points twice. Not linked outside production: a test wallet in `accounts.dev_points` (migration v16; `/points <n>` sets it), and a per-session one for test guests. Not linked in production: nothing can be bought.
- **Paying** (`WorldRoom.pay`): checks first (room in the bag, the ore, the post…), charges, then delivers, checking again; if delivery fails the charge is refunded (retried, and logged if it still fails). One payment at a time per player, so a double click never pays twice.
- **The balance** shows on the status panel and in shop windows (`StatsMessage.balance`, missing when it can't be read). The server asks Gattchaa on joining, after each payment or sale, and when a shop or NPC window opens (`points:refresh`, at most every 10 s).
- **Old gold** is gone: `characters.gold` is no longer read or written, and the gold that old sales left in the mail was deleted (migration v16). Nobody was given Points for it.

## The Battle Pit

Outside duels and sieges, players only fight in **the Battle Pit** (Ragnarok's PVP rooms): no monster land is PVP. The rules are in `shared/pvp.ts` (shared, so the client knows who can be clicked to attack); the fighting is in `Combat`, reusing the duel code (`foe`, `hurtFoe`, `PVP_DAMAGE`).

- **The place.** `BATTLE_PIT` (`shared/town.ts`) is a `CaveZone` like the dungeons (`CAVES` is every dungeon plus the pit), carved by `World.carveCaves` in a 48 x 48 corner of the far south-western sea: a gate hall, a passage and the pit (26 x 36) with pillars for cover. The doors `pit-in` (the red portal at `PIT_MOUTH`, between the Arena and the town wall) and `pit-out` (back from the gate hall). Two fields: `pit` (`pvp: true`, the pit itself) and `pit-gate` (safe). The client's zone code (camera, chunks, minimap blackout, overlay) treats it like a dungeon.
- **Who may hit whom.** `pvpBlock` says why not, or "": both players inside a field with `pvp: true`, both level `PVP_MIN_LEVEL` (20) or more, neither knocked out nor in a duel, not in the same party or guild. Clicking a fair-game player attacks at once. `target` accepts a player id when `foe` allows it; area skills only catch the player you're fighting.
- **Beaten.** `beaten`: nobody loses anything (`knockOut` without the EXP loss), and `Combat.wokeIn` sends them back to `PIT_MOUTH` when they get up (sieges send theirs to the camp). Leaving within `PVP_COMBAT_MS` (10 s) of another player's attack counts as being beaten by them (a dropped connection still gets its 20 s to come back first).
- **Glory.** A win that counts (the same winner and loser once per `PVP_RECOUNT_MS`, 10 minutes) fires the `pvpWin` hook: `GLORY_PIT_WIN` (2) Glory for a signed-in winner, in `accounts.glory` (migration v15). Magnus's Glory shop is `GLORY_SHOP` (`glory:buy` with an index; `Combat.grant` checks the bag before `db.spendGlory` takes the Glory). The Gladiator's Medal, Champion's Ring and Conqueror's Crest exist only there and have no sell price.
- **Titles.** Deed `pvpWins`: Raider (10), Pit Champion (50), Reaper (250), same counting rule.
- **Sable's board.** Sable the Pit Keeper (NPC kind `pit`, in the gate hall): `pit:board` sends the `PitBoard`. The `pit` table (migration v15) has all-time and this week's wins per account. The week is `weekOf` (Mondays at midnight, Batam time); a row from an older week starts its weekly count again on its next win. A new weekly leader with `TOP_FIGHTER_NEWS` (3) wins or more is town news. (Open PVP used to be in the Wildlands, with Outlaws and bounties; its old `wildlands` table is left untouched.)
- **On screen.** The minimap tints the pit red; going in shows a banner; the place reads "· PVP" in red; health bars show for everyone in the pit. A signpost by each path north marks the Wildlands (`WILD_CROSSINGS`), and one by the portal marks the Battle Pit.

## Parties

Ragnarok-style parties of up to `PARTY_MAX` (6). The rules are in `shared/party.ts`; who's with whom is `server/src/rooms/Parties.ts`; the sharing is in `Combat`.

- **Joining.** `party:invite` (the leader, or anyone not in a party) sends `party:ask`; `party:answer` yes starts a party with the inviter or joins theirs. `party:leave` and `party:kick` (leader only). The party id sits on each member's synced `Player.party`; nothing is saved, and leaving the game leaves the party (the leader passes to the next member; a party of one breaks up).
- **The panel.** Every `PARTY_UPDATE_MS` (1 s) and on every change, each member gets `party` (`PartyMessage`: every member's name, job, level, health and position, wherever they are) for the panel under the status and the green minimap dots. Party mates' names are green.
- **EXP.** In `Combat.reward`, the damage of a party's members is added up, and that share of the monster's EXP is split evenly by every member alive within `PARTY_SHARE_PX` (960 px) of it, hit or not, with `PARTY_BONUS` (+10 %) per member after the first (`partyShare`), and then each member's own `expFactor`. If those members are more than `PARTY_LEVEL_GAP` (15) levels apart, that party's kill goes by damage. Everyone sharing gets the kill deed.
- **Loot.** A drop carries its owner's party (`Drop.party`): the whole party may pick it up during the owner's 15 s.
- **PVP.** `pvpBlock` refuses a party mate ("They're in your party"); duels between them still work.
- **Chat.** `/p message` (or `/party`) goes only to the party (`ChatMessage.party`), works in production too, and isn't kept in the town's history.

## Guilds

Ragnarok-style guilds of up to `GUILD_MAX` (30), kept in the database. The rules are in `shared/guild.ts`; `server/src/rooms/Guilds.ts` runs them; the client has the guild window (`client/src/ui/guild.ts`, key G) and the Registrar's form (`dialog.ts`).

- **Saved.** Migration v10 adds `guilds` (name unique with `COLLATE NOCASE`, emblem, notice) and `guild_members` (one row per account: guild and rank, 0 member, 1 officer, 2 leader). Members are accounts, so guests can't found or join one. Deleting a guild deletes its members (foreign keys are on).
- **Founding.** `guild:found` next to Leopold (NPC kind `guild`): signed in, level `GUILD_FOUND_LV` (20), a name `cleanGuildName` accepts (3 to 16 letters or digits, spaces, ' or -, not only digits), a free name, an emblem (`isEmblem`: symbol × 16 + colour, one byte), and `GUILD_FOUND_POINTS` (10,000) charged through the wallet (`WorldRoom.pay`, which founds the guild only once the Points are taken, and refunds them if the name went meanwhile). Town news.
- **On heads.** While a member is here, their synced `Player.guild` (the name) and `Player.emblem` are set, for the line over their name (`PlayerSprite.setGuild`) and the player card. `pvpBlock` refuses a guild mate ("They're in your guild").
- **Messages.** `guild:invite` (leader or officer; the target must be signed in and in no guild) sends `guild:ask`; `guild:answer` joins. `guild:leave` (the leader only when alone, which closes the guild), `guild:kick` (an account id; officers only remove members), `guild:rank` and `guild:lead` (leader only), `guild:notice` (leader or officers), `guild:get` (a fresh list when the window opens). Every change sends each member here `guild` (`GuildMessage`: name, emblem, notice, your rank, and every member with level, job, rank, online and last seen).
- **Online.** Coming in and leaving tell the members who are here; taking over from another window says nothing. The notice greets members as they come in.
- **Chat.** `/g message` (or `/guild`) goes only to the guild members who are here (`ChatMessage.guild`), and isn't kept in the town's history.
- **History.** `guild_log` (migration v13) keeps the last `GUILD_LOG_MAX` (10) guardians hired, who hired them and the Points they paid (`db.logGuild`). (The old guild purse is gone: a pot of real Points held by the game would be custody of money. `guilds.purse` stays in the table, unused.)
- **The ranking.** `guild:board` next to Leopold sends `GuildBoard` (`db.guildBoard`): castles held, then `guilds.sieges`, then `guilds.crystals`, then the sum of members' levels, then the oldest. `Siege.captured` counts a crystal for the breaker's guild and `Siege.end` a siege for whoever holds the castle. The dialog redraws only the ranking when it arrives, so it doesn't disturb the founding form.

## Guild wars

Ragnarok's War of Emperium for one castle, **Crownhold**. The rules are in `shared/siege.ts`; `server/src/rooms/Siege.ts` runs the siege; `Combat` does the fighting.

- **The island.** `CASTLE_ISLE` (salt 9494) in the sea north-east of the Wildlands, summer green (`AUTUMN_TOP`: autumn only south of row 108). The long bridge is `PIERS.castle` (63 tiles, Floor.Pier), reached by a road from the top of the east path through the Wildlands. The castle (`CASTLE`) is `castle`/`castleTower` structure blocks: an outer wall with a west gate (vertical gates need room for the towers' faces: the opening is rows 76–83, walkable 80–83) and a keep (`KEEP`) whose gate faces east; flagstones inside, a red carpet to the crystal. The herald's camp (`CASTLE_CAMP`) is outside the gate. The field `crownhold` has no monsters but the crystal.
- **The crystal.** A monster (`crystal`, level 0: nobody misses; 60,000 HP, DEF 50, never moves or hits back; `boss` for the always-on bar, with its own news instead of the boss news). Its art is an item icon drawn large in a glow (`icon` in `MONSTER_ART`). `Combat.strikeBlock` refuses it outside a siege, to players without a guild, and to the holding guild (`Combat.castleGuild`); `hurt` checks it too, skills are refused before they cost MP, and area skills skip it. The last hit calls the `crystal` hook: `Siege.captured` saves the new holder, tells the town, and moves everyone else inside to the camp. It comes back after its `respawnMs` (10 s); a siege starting or ending mends it (`mendCastle`).
- **The schedule.** `siegeAt(now)` gives the siege on now, or the next (Wednesdays and Saturdays, 20:00–21:00 Batam time). `Siege.tick` starts and ends it, sets `Combat.siege`, and syncs the room state's `castle`, `castleEmblem`, `siege`, `siegeEnds` and `siegeNext` (for the siege bar, the banners and the Herald). `/siege on|off|auto` bends it for testing.
- **Fighting.** `pvpBlock(a, b, siege)`: during a siege, two players inside `CASTLE` may fight if both are in guilds (different ones, not party mates), at any level. `beaten` costs nothing (no EXP, no Glory, nothing on Sable's board) and remembers the player (`Combat.wokeIn`), so `revive` puts them at the camp (`campSpot`) instead of in town. `Siege.mayEnter` refuses moves into the castle by players without a guild during a siege (the client stops them too).
- **The end.** The holder is kept (table `castles`, migration v11: one row per castle, the guild or null, `ON DELETE SET NULL` so a closed guild leaves it without a lord; read again every 10 s). Online members of the holder get the title `castleLord` (goal kind `castle`, handed out like Pioneer, aura 34).
- **Guardians.** `GUARDIAN_POSTS` lists eight fixed posts (`castleKnight` 5,000 Points, `castleArcher` 4,000). `castle:guards` and `castle:hire` at the Herald: the leader or an officer of the holding guild, between sieges, pays with their own Gattchaa Points (`WorldRoom.pay`; the post is checked again once the Points are taken, and refunded if it filled meanwhile). Hired posts are saved as JSON on the castle's row (`castles.guardians`, migration v12) and spawn again when the server starts. A guardian is a monster with a `post` and no spawn group (`Combat.spawnGuardian`, sharing `addMob` with `spawn`): it only thinks during a siege, never wanders, hunts only `guardianFoe`s (another guild's members inside the walls), walks back to its post (`mendCastle` puts it there, healed, when a siege starts or ends), and `strikeBlock` covers it like the crystal. Being knocked out by one costs nothing, like a siege fight. When it falls, the `guardianDown` hook empties its post for good; a new holder (or none) clears them all (`Siege.read`). `Monster.hp` is 32 bits on the wire: bosses have more health than 16 bits hold.
- **The tribute.** `castle:tribute` at the Herald (NPC kind `castle`): members of the holding guild, once a day (`tributeDay`, table `tributes`), `TRIBUTE` (Mithril, a Star Crystal, White Potions, sometimes more, rarely a card, never Points) if 4 bag slots are free (`Combat.giveTribute`).

## Gattchaa shop data

The stalls, machines, Rooms tables, big-pull announcements, signing in and player shops use the **Gattchaa Town API**, which the gattchaaoripa.com project provides. The blueprint for building it is in [docs/gattchaa-town-api.md](docs/gattchaa-town-api.md). The game server never scrapes the website.

- Configure it in `server/.env.production` (see `server/.env.example`). Without `GATTCHAA_API_URL` the town still runs, but the shop panels only show links, and signing in and player shops are off.
- For local work without Laravel, run `npm run mock:gattchaa` next to `npm run dev`, with this `server/.env.development`:

  ```dotenv
  GATTCHAA_API_URL=http://localhost:8787/api/town/v1
  GATTCHAA_API_KEY=dev-key
  GATTCHAA_WEBHOOK_SECRET=dev-secret
  GATTCHAA_SIGNIN_URL=http://localhost:8787/town/enter
  ```

  "Sign in with Gattchaa" then shows the mock's page, where you pick a pretend seller. If your client isn't on `http://localhost:5174`, start the mock with `TOWN_ORIGIN=<your client address>`.

## Changing the art

`npm run fetch-assets` re-downloads everything listed in `scripts/fetch-assets.mjs` and regenerates the manifest, `shared/catalog.ts` and the credits.

- **Add a hairstyle or clothing item:** add its `sheet_definitions` path to `ITEMS`. Browse the options at <https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>.
- **Monsters:** `MONSTER_FILES` lists the sheets taken from "[LPC] Monsters" (OpenGameArt). `client/src/world/monsterArt.ts` says how each sheet is laid out.
- **Humanoid monsters** (goblins, orcs, skeletons, zombies) are put together from character art instead: `MOB_PARTS` in `fetch-assets` adds their heads, bodies and weapons (category `mob`, male body only, never in the character creator), and each monster in `monsterArt.ts` lists its `parts` (any manifest item, with colours). `composeParts` in `client/src/character.ts` builds the walk sheet the first time one appears. They stand still when idle, walk when they move, and lunge to attack (there are no attack frames). Their card pictures use the same sheet.
- **Equipment art:** `GEAR` lists the armour and weapon sheets. Items in `shared/items.ts` pick pieces by id and recolour them (`colors: { metal: "bronze" }`).
- **Bows:** LPC bows only walk in 128px frames. `fetch-assets` marks those layers `frame: 128`, and `client/src/character.ts` cuts the middle 64px out of each frame when it loads them.
- **Item icons:** every icon from Kyrise's 16x16 RPG Icon Pack (CC-BY 4.0) is in `client/public/assets/items/`; an item names one with `icon`. Items without one get an icon cut from their gear art. Monster cards are drawn in `client/src/character.ts`: a gold card with the monster's own sprite on it.
- **Seasons:** each island draws from its own season's LPC sheets (`terrain-winter.png`, `-autumn`, `-spring` and the matching trees and plants), picked per tile by `biomeAt`. To change the main island's season, swap `terrain_summer.png` / `trees_summer.png` in `WORLD_FILES`.

## License note

The art is CC-BY-SA / OGA-BY / GPL licensed (see each entry in `CREDITS.md`). The credits must stay reachable from the game; the login screen links to them. Your own code is yours to license as you like.
