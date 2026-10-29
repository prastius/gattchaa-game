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

Accounts (players who signed in with Gattchaa), their characters' progress (class, level, EXP, HP/MP, gold, bag, equipment and skills), open shops with what they sell, and mail (gold and items waiting for a player who was away) are kept in one SQLite file, `server/data/town.db`, using Node's built-in `node:sqlite`. There's no database server to run. Deploys and restarts leave the file alone; open shops come back after a restart. Back it up with a copy while the server is stopped, or live with `sqlite3 server/data/town.db ".backup town-backup.db"`. Set `DB_PATH` to keep it somewhere else.

### Load testing

```bash
npm run bots -- http://localhost:2567 100     # or your VPS URL
```

This connects 100 bots that walk around (using the real collision code) and chat. It prints the server's CPU and memory every 5 seconds. Measured on a dev machine with 100 bots: 2–14 % of one CPU core, about 160 MB of RAM, and 0 rejected moves. A 1 vCPU / 1 GB VPS handles that.

## Layout

```
shared/       Code used by both client and server
  world.ts        Seeded island generator (corner-based terrain), decorations, collision
  town.ts         The town's layout: walls, quarters, buildings, props, doors, the park and the Market Square
  appearance.ts   Character look: encode/decode/validate, random looks
  catalog.ts      Generated list of hair/clothes/colour options
  protocol.ts     Message types, name/chat sanitizing
  vending.ts      Player shop rules (where a shop may open, what it sells for gold) and messages
  rpg.ts          Leveling and fighting: classes, the EXP curve, monsters (and their drops), fields, damage rules
  items.ts        Every item and monster card: stats, prices, rarity, icon, card slots, who may wear it and how it looks when worn; the Outfitter's stock; the Blacksmith's upgrade table and auras
  skills.ts       Class skills: what each does per level, MP, cooldowns, and how it looks
  titles.ts       Titles: how each is earned (deeds), its rarity and aura, and progress counting
  duels.ts        Duel rules (ranges, timers, PvP damage, the Arena ring) and the arena rating maths (Elo)
server/       Colyseus server
  src/rooms/WorldRoom.ts   Joins, interest management, movement validation, chat, emotes, wardrobe, sitting, shops, trading
  src/rooms/WorldState.ts  Synced state
  src/rooms/Combat.ts      Monsters (spawning, AI), auto-attacks, EXP, level-ups, knockouts, loot, using items, jobs and skills, upgrades, titles and duels
  src/rooms/Titles.ts      A character's deeds and titles (bookkeeping only)
  src/rooms/Inventory.ts   A character's bag and equipment
  src/rooms/Drops.ts       Items on the ground: first pick for the top fighter, then anyone; they fade after 90 s
  src/db.ts                SQLite: accounts, sessions, characters, open shops
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
  src/world/ambience.ts    Butterflies by day, fireflies at night
  src/world/monsterArt.ts  Monster sprite sheets and their animations; humanoid monsters' parts
  src/world/fx.ts          Damage numbers, slashes, level-up light, arrows and magic bolts, skill effects
  src/scenes/WorldScene.ts   Chunk streaming, water glints, input, camera, interpolation
  src/ui/                  Creator, chat, HUD + minimap + emote picker, status panel (HP/MP/EXP), bag, skills (bar and window), NPC and shop panels
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
- **Accounts are optional.** Anyone can walk around and chat as a guest. **Sign in with Gattchaa** goes to gattchaaoripa.com, which sends the player back with a one-time ticket. The game swaps it for its own 30-day session, so passwords never reach the game. Signed-in players get their character back on any device. One window per account: opening a second one takes over.
- **Player shops.** Ragnarok-style vending: a signed-in player presses **Open shop** (V) in the Market Square, names their shop, picks up to 12 things from their bag with a price in gold each, and sits down on a rug with a sign over their head. The shop also shows the cards they've listed on the Gattchaa marketplace; each links to its listing, so real cards (and real money) stay on the website. In-game gold never buys a real card.
  - **Stock:** the picked things leave the bag (`Combat.stockShop`) and are saved as JSON on the shop row (`shops.wares`, migration v8). Sold-out wares stay at 0 so their numbers never shift.
  - **Buying** (`shop:buy`): the buyer sends the ware number plus the item and price they saw; the room checks they're in the Market Square, can pay and have room, then `db.buyWare` takes the stock in one transaction. The sign's count (`PlayerShop.items`) and `rev` update, so open panels reload.
  - **Mail:** the seller is paid through the `mail` table (gold, or an item, plus a note). The room hands mail to whoever is in town: right after a sale, on joining, and every 5 s (for sales through another room, and for bags that were full). Delivery and deleting the mail happen in one transaction, so nothing arrives twice. Closing a shop (by hand, by expiry, or because it sold out) mails back what didn't sell.
  - **Search:** `GET /api/market` lists everything for gold in every shop; Tina's "Find an item" tab filters it.
  - **Where:** only in the Market Square, and not right in front of staff or so close to another shop that the signs would overlap. The form says whether the spot is good before you open. Shops saved outside the square (from before this rule) close when the server starts.
  - **While it's open:** the seller stays seated, and signs stay lit at night.
  - **When the seller leaves:** a look-alike minds the shop for 24 hours.
  - **Finding shops:** Tina, the Market Keeper in the Market Square, lists every open shop, and you can browse them from her list or search what's for sale. The minimap marks shops in orange.
  - **Updates:** listing changes arrive by webhook, so prices and card counts update within seconds.
  - **Server cost:** nothing between purchases, apart from one small mail query every 5 s. Shops only do work when opened, browsed, bought from or updated.

## Leveling and fighting

Ragnarok and TibiaME style: click a monster and your character fights it. Everything about a fight is decided on the server, and the numbers live in `shared/rpg.ts`.

- **Classes.** Everyone starts as a Novice; at level 10 the Job Master makes you a Knight, Mage or Archer (see below). HP, MP, attack and defence grow by class as you level.
- **Levels.** The cap is `LEVEL_CAP` (50 for now). The EXP curve (`expToNext`) is gentle through the Novice levels, then climbs to three times as much from the job change to level 13, so job levels take a few minutes each (about 4 at level 12, about 8 at level 18, 12 to 15 in the Orc Woods, fighting on-level monsters with plain attacks). It keeps going past the cap, so raising it is a one-line change. At the cap, EXP stops filling.
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
  | Orc Archer | 25 | North, along the town wall | Shoots arrows from 180 px; attacks on sight |
  | Orc Skeleton | 27 | West of the inlet | Attacks anyone close |
  | Orc Zombie | 29 | Far south | Very slow; hits hardest |
  | **Orc Warlord** | 33 | His camp where the west road ends (`ORC_CAMP`) | Field boss: 24,000 HP, 15 min respawn, for a party |

- **Field boss.** The Pumpking is Dusk Hollow's boss, Ragnarok's MVP style: one at a time, 12,000 HP, breathes fire from 150 px, heals only slowly when left alone, and comes back 10 minutes after it falls. It's drawn bigger, with its name and health always showing. The whole town hears when it rises again and who brought it down. A level 20 Knight can just about beat it alone with plenty of potions; a party shares the EXP by damage. It always drops King's Candy (600 gold at Bram), often a good piece of gear, and very rarely the Moonblade or the Pumpking Card. The Orc Woods' Orc Warlord is the same kind of boss, bigger (24,000 HP, back after 15 minutes), with the Dragon Spear and his own card as the rare prizes. Any monster can be a boss (`boss: true` in `MONSTERS`).

- **Fighting.** You auto-attack once a second while the monster is in reach. Hits can miss (more often against higher levels), and 5 % are critical hits. The client only says what you're attacking and draws what the server reports: damage numbers, slashes, health bars.
- **Rewards.** EXP is shared by everyone who hurt the monster, by how much damage they did. Monsters more than 5 levels below you give less (down to 10 %). Gold goes to whoever did the most damage. Level-ups heal you fully, and every 10th level is announced in chat.
- **Healing.** Out of combat you regain HP and MP slowly. Sitting (X) is 3 times faster, and resting inside the walls doubles that again.
- **Fainting.** At 0 HP you faint and return to town fully healed. Novices lose no EXP; Knights, Mages and Archers lose 3 % of a level.
- **Saving.** Signed-in players' progress is saved on every level-up and faint, every 30 s, and when they leave. Guests can fight too, but start over next visit.
- **Server cost.** Monsters only think while a player is near their spawn area, and fight events go only to players close enough to see them. 20 bots fighting at once used about 5 % of one CPU core.
- **Testing.** Outside production (`NODE_ENV` not `production`), chat commands help: `/level 25` jumps to a level, `/item saber` (or `/item redPotion 20`, `/item hornetCard`, `/item moonblade +10`) adds items, `/gold 1000` sets your gold, `/job archer` turns you into a class (from level 10; `/job novice` goes back), `/title kingslayer` hands you a title. To test duels you need a second player (another window, or a bot). Shops need a signed-in seller (run the Gattchaa mock to sign in) and a second player to buy. `/help` lists every item id.

## Jobs and skills

TibiaME style: three jobs, each with its own weapons and skills on the number keys. The jobs are in `shared/rpg.ts` (`CLASSES`), the skills in `shared/skills.ts`.

- **The Job Master.** Orin stands just inside the south gate. From level 10 a Novice can become a Knight, Mage or Archer, for good. The job comes with its weapon, worn straight away (unless you already hold one the job can use): a Squire's Longsword, an Apprentice Staff or a Hunting Bow.

  | Job | Strengths | Weapons | Skills (keys 1, 2, 3) |
  | --- | --- | --- | --- |
  | Knight | Most HP and DEF | Swords, daggers | Bash (a heavy blow), Whirlwind (hits everything around you), Guard (DEF up for 20 s) |
  | Mage | Most MP and ATK, little HP | Staves (reach 150–170 px), daggers | Fire Bolt (from 220 px), Frost Nova (hits and freezes everything around you), Heal |
  | Archer | In between | Bows (reach 170–190 px, both hands: no shield), daggers | Double Shot, Arrow Rain (hits everything around the target), Eagle Eye (ATK and critical chance up for 20 s) |

- **Weapons.** Swords are for Novices and Knights, staves for Mages, bows for Archers; daggers for everyone. Bows and staves shoot from a distance: arrows and magic bolts fly to the target, and the damage shows when they land. Bram sells the three job weapons; the Recurve Bow, Gnarled Staff and Crystal Staff drop from Snapper Flowers.
- **Skill points.** One at the job change and one every level after (`skillPoints` in `shared/rpg.ts`). Spend them in the skills window (K): each skill goes up to level 10, getting stronger every level. There are 3 skills per job so far; slots 4–6 wait for more.
- **Using skills.** Keys 1–6 or the skill buttons (bottom of the screen; above the chat on phones). Aimed skills use your target, or pick the nearest monster and walk into range first. Each skill costs MP and has a cooldown, shown as a curtain on its button, and there's a short pause (0.7 s) between any two skills. Skills never miss. Attack skills don't work inside the town.
- **Effects.** Frozen monsters turn icy blue and can't move or bite. Buffs make their skill button glow while they last.
- **Saving.** Learned skills are saved with your progress (migration v5). If saved skills ever add up to more points than your level gives, all the points come back to spend again.

## Items and equipment

Every item is in `shared/items.ts`: its stats, price, rarity, icon, and how it looks when worn. The server owns every bag; the client only asks ("wear slot 3", "pick up that") and draws the answer.

- **Equipment.** Eight slots: weapon, shield, head, armour, legs, feet, ring and amulet. Worn gear adds ATK, DEF, HP or MP, and some needs a minimum level. The first six slots show on your character for everyone (LPC armour and weapon art, recoloured iron, bronze or steel). A helmet replaces your hat, greaves your trousers, boots your shoes. Weapons are put away while you sit.
- **Rarity.** Common, Uncommon (green), Rare (blue), Epic (purple) and Legendary (orange). Rare finds get a chat line; a Legendary find is announced to the whole town. On the ground, rarer loot glows, and Legendary loot sends up a pillar of light.
- **Loot.** Each monster has a drop table in `shared/rpg.ts` (every entry rolled on its own): its own monster loot (Slime Jelly, Snake Scale, Wild Honey, Bloom Crystal), potions, and now and then a piece of gear. Loot lands on the ground around the monster. For 15 seconds only the player who did the most damage can take it (it looks faded to everyone else); then anyone can. It fades away after 90 seconds. Click it to walk over and pick it up.
- **Bag.** 30 slots. Potions and loot stack up to 99. Click an item for its details, double-click to wear or drink it. You can drop things on the ground, where anyone can pick them up.
- **Potions.** Red Potions heal 40 HP, Orange Potions 100 HP, one every 0.8 s, even mid-fight. Q drinks the smallest one that heals you fully.
- **The Outfitter.** Bram stands outside the south gate, across from Rowan. He sells potions and starter gear (Dagger, Short Sword, Wooden Shield, Leather Cap, Chain Coif, Leather Armour, Leather Pants and Boots, Copper Ring, Clover Charm) and buys anything with a price, with a one-click "sell all monster loot". Better gear only comes from monsters.
- **Dusk Hollow gear.** Level 12–20 drops, all visible on the character: Wizard Hat, Ranger Hood (hides your hair), Horned Helm, Greathelm, Guard Tabard, Sage Tabard, Kite Shield, Crusader Shield, Rapier, Knight's Blade, Great Bow, Ember Staff, and the Pumpking's Moonblade. Each monster also has its own loot to sell (Sticky Silk, Bat Fang, Rock Shard, Gazer Lens, Ectoplasm).
- **Orc Woods gear.** Level 22–30 drops: Scimitar, Katana, Composite Bow, Crossbow, Ring Staff, Diamond Staff, Round and Spartan Shields, Barbarian and Viking Helms, Scout Armour and Starry Cloak (both with a cape), Dark Plate, Steel Greaves and Sabatons, two rings and two amulets, and from the Orc Warlord the Warlord's Medal and the legendary Dragon Spear. **Spears** are a new weapon type (`spear` in `WEAPON_USERS`), for Knights only and two-handed: the Halberd and the Dragon Spear. Six more cards (Goblin, Orc Warrior, Orc Archer, Orc Skeleton, Orc Zombie and the legendary Orc Warlord Card) bring the total to 16.
- **Saving.** The bag and equipment are saved with the rest of your progress, plus right away after buying, selling or finding something good. Guests keep their bag until they leave.
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
| +1 to +4 | always works | 100, 200, 300, 400 gold | Iron Ingot |
| +5 | 90% | 600 gold | Iron Ingot |
| +6 | 75% | 900 gold | Mithril Ingot |
| +7 | 60% | 1,200 gold | Mithril Ingot |
| +8 | 45% | 1,600 gold | Mithril Ingot |
| +9 | 35% | 2,000 gold | Star Crystal |
| +10 | 25% | 2,500 gold | Star Crystal |

- **What it adds.** Weapons get ATK for every level: an eighth of their own ATK, at least 1 (Saber +2, Moonblade +4). Shields, helmets, armour, legs and boots get DEF +1 per level. Rings and amulets can't be upgraded. A worn upgrade counts straight away.
- **Ingots.** Hilda sells Iron Ingots (100 gold); monsters drop them too. Mithril Ingots drop in Dusk Hollow (Rock Worms most often) and rarely from Snapper Flowers. Star Crystals come from Gazers and Ghosts (about 1 in 200 to 250), Orc Skeletons and Orc Zombies (about 1 in 125 to 170), the Pumpking (one kill in two) and the Orc Warlord (always). The Pumpking also always carries a Mithril Ingot or two. Ingots are kept out of Bram's "sell all monster loot".
- **The cost of luck.** Simulated over 20,000 tries, reaching +7 takes about 10 tries (6,000 gold, 4 Mithril), +9 about 29 tries (32,000 gold, 19 Mithril, 3 Star Crystals), and +10 about 74 tries (100,000 gold, 50 Mithril, 16 Star Crystals).
- **Names.** Upgraded gear goes first in the name: "+7 Double Stinging Saber". The bag shows the level in the item's corner and what the upgrades add. Upgrades stay on gear that's dropped and picked up again; Bram won't buy upgraded gear.
- **Auras.** Wear anything at +7 or higher and everyone sees an aura at your feet: a blue ring at +7, violet with rising sparks at +9, and gold with a column of light at +10. Legendary gear (or a legendary card in gear) gives an orange aura that ranks between +9 and +10. The best one you qualify for shows (`auraOf` in `shared/items.ts`), unless your shown title has its own. At night auras glow like the street lamps (a glow above the night tint).
- **News.** A success at +9 or +10 is announced to the whole town.
- Balance lives in `UPGRADE_TABLE`, `upgradeCost` and `upgradeStep` in `shared/items.ts`; the ingot drops are in each monster's table in `shared/rpg.ts`.

## Titles

Earned by doing things, one shown under your name. The list is `TITLES` in `shared/titles.ts`; each has a goal (level, kills of one monster or any, kinds of cards found, a legendary find, best upgrade, failed upgrades, opening a shop, or Pioneer), a rarity and sometimes an aura.

- **Deeds.** The server counts what each character does (`Deeds`: kills by monster, card kinds found fresh from monsters, legendary finds, best upgrade, failed upgrades, shop opened, gold earned in your shop) in `server/src/rooms/Titles.ts` and checks for new titles after each deed. Everyone who hurt a monster gets the kill. Deeds and titles are JSON columns on `characters` (migration v6), cleaned when loaded.
- **Earning.** A new title gives a banner over the head (`title` fx), a chat line, and town news for epic and legendary ones. Characters saved before titles existed get their level titles quietly on join.
- **Showing.** `title:show` picks an earned title; it syncs as `Player.title` and draws under the name in its rarity colour. A shown title with an aura (Kingslayer, Card Master, Pioneer) replaces the gear aura (`Player.aura`).
- **Pioneer.** When a signed-in player reaches `LEVEL_CAP`, the room claims a place in the `pioneers` table (first `PIONEERS` = 10 accounts per cap, numbered in order) and grants the title. Raising the cap opens 10 new places.
- **The window.** T (or the medal button) lists every title by group with progress bars; a badge counts titles earned since you last looked. The server sends `titles` (earned, shown, progress) whenever something changes.

## Duels and the Arena

Player vs player by agreement only. The rules are in `shared/duels.ts`; the fighting is in `Combat` (the "duels" section), next to the monster fighting it reuses.

- **Challenges.** Clicking another player opens a card with "Challenge to a duel" (`duel:ask`). The other player gets a prompt and answers within 20 s (`duel:answer`). One challenge every 5 s, from within 8 tiles; nobody minding a shop, already in a duel or knocked out.
- **The duel.** `Player.duel` holds each duelist's opponent, so everyone draws their health bars. A 3 s countdown (`duel` fx), then auto-attacks and skills work on the opponent like on a monster, anywhere (even in town), at `PVP_DAMAGE` (half). No potions and no regen mid-duel. Area skills catch the opponent; freezes don't apply to players.
- **Endings.** 0 HP loses; giving up (`duel:quit`), leaving the game or fainting to a monster forfeits; 2 minutes or more than 16 tiles apart is a draw. Both are healed afterwards; nobody loses anything.
- **Ranked.** A duel is ranked when both stand in `ARENA` (the ring behind the café) at the start and both are signed in; leaving the ring then forfeits. Ratings are Elo (start 1,000, K 32) in the `arena` table (migration v7), and a ranked win is town news. Magnus the Arena Master (`arena:board`) shows the top 10 and your place.
- **Titles.** Deeds count duels fought, won, and won in the ring: Good Sport, Duelist, Gladiator.

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
- **Change the season:** swap `terrain_summer.png` / `trees_summer.png` for the spring, autumn or winter versions in the same repo.

## License note

The art is CC-BY-SA / OGA-BY / GPL licensed (see each entry in `CREDITS.md`). The credits must stay reachable from the game; the login screen links to them. Your own code is yours to license as you like.
