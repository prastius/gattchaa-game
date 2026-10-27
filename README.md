# My World

A browser-based multiplayer open world with customizable characters and live chat.

- **Client:** Phaser 4 + TypeScript + Vite
- **Server:** Colyseus 0.18 + TypeScript on Node.js
- **Art:** LPC (Liberated Pixel Cup) pixel art: 32 px tiles, ¾ top-down view, layered characters. See [CREDITS.md](CREDITS.md).

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
| X / chair button | Sit down where you stand; walking gets you up |
| V / Open shop | Open your shop where you stand in the Market Square (signed-in players); while it's open: see it, or close it |
| 1–9, 0 / smiley button | Emotes over your head: wave, happy, LOL, love, wow, sad, angry, nice, !, ? |
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

Accounts (players who signed in with Gattchaa), their characters' progress (class, level, EXP, HP/MP, gold) and open shops are kept in one SQLite file, `server/data/town.db`, using Node's built-in `node:sqlite`. There's no database server to run. Deploys and restarts leave the file alone; open shops come back after a restart. Back it up with a copy while the server is stopped, or live with `sqlite3 server/data/town.db ".backup town-backup.db"`. Set `DB_PATH` to keep it somewhere else.

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
  vending.ts      Player shop rules (where a shop may open) and messages
  rpg.ts          Leveling and fighting: classes, the EXP curve, monsters, fields, damage rules
server/       Colyseus server
  src/rooms/WorldRoom.ts   Joins, interest management, movement validation, chat, emotes, wardrobe, sitting, shops
  src/rooms/WorldState.ts  Synced state
  src/rooms/Combat.ts      Monsters (spawning, AI), auto-attacks, EXP, level-ups, knockouts
  src/db.ts                SQLite: accounts, sessions, characters, open shops
  src/api.ts               Sign-in with Gattchaa, shop details
  src/gattchaa.ts          Gattchaa Town API client + webhooks
  src/static.ts            Serves the built client: pre-compressed files, cache headers
client/       Phaser game
  src/main.ts              Character creator and sign-in, then boots Phaser; wardrobe panel
  src/auth.ts              Gattchaa sign-in (ticket -> session token)
  src/vending.ts           Player shops: open/close yours, load a shop's cards
  src/character.ts         Builds character sprite sheets (walk + sit) from recolored LPC layers
  src/PlayerSprite.ts      Avatar, walk/sit animation, name tag, chat bubble, emotes, health bar
  src/MonsterSprite.ts     Monster: animation, health bar, name on hover, target ring
  src/world/terrainTiles.ts  Corner autotiling + padded tile atlas
  src/world/decorSprites.ts  Trees, rocks, plants
  src/world/town.ts        Buildings and furniture, lit windows at night, bunting, live shop displays
  src/world/shops.ts       Player shops: rugs, signs, the away seller's look-alike
  src/world/daylight.ts    Day and night (Batam time), lamp and fire glow
  src/world/ambience.ts    Butterflies by day, fireflies at night
  src/world/monsterArt.ts  Monster sprite sheets and their animations
  src/world/fx.ts          Damage numbers, slashes, level-up light
  src/scenes/WorldScene.ts   Chunk streaming, water glints, input, camera, interpolation
  src/ui/                  Creator, chat, HUD + minimap + emote picker, status panel (HP/MP/EXP), NPC and shop panels
  public/assets/           Downloaded art + manifest (committed)
scripts/
  fetch-assets.mjs   Re-downloads the art from pinned commits and regenerates catalog + credits
  compress-dist.mjs  Writes Brotli and gzip copies of the built client (part of npm run build)
  bots.ts            Load-test bots
```

## How it works

- **Same world on both sides.** Client and server generate the same 384×384-tile island from one seed, so the map is never sent over the network. Terrain is stored per tile *corner*, and each tile picks its art from its four corners. That gives smooth grassy banks, water and dirt edges.
- **The town.** A walled town of 124×92 tiles in the middle of the island, with gates west, east and south. Gattchaa Palace (the store) stands against the north wall. Below it are the fountain plaza, the Rooms pavilion and the pack stalls. Townhouses fill the west and east quarters. A lakeside park with a campfire runs along the west wall, and the Collectors' Café and an orchard are on the east side. The Market Square, by the south gate, is where player shops gather.
- **Alive day and night.** Day and night follow Batam time. At night, lamps, the campfire, house windows and shop signs glow, and fireflies drift over the grass. By day, butterflies flit over the flowers and the water glints. These are cheap touches drawn only around the camera.
- **Crisp pixel art with no flicker.** The game renders at the screen's real pixel density with whole-number zoom, nearest-neighbor filtering and whole-pixel positions. Tiles come from an atlas with a 1 px padded border, so neighboring tiles can't bleed into each other while the camera moves.
- **Characters.** Each look is a short string such as `0.3.1.5.12.0.4.2.7.1.22`. The client stacks the LPC layers (shadow, body, head, shoes, legs, top, hair) and swaps the palette colors to the chosen skin, hair, eye and cloth colors. It makes one sprite sheet per distinct look and frees it when nobody on screen wears it.
- **Scales to 100+ players.** The server sends each client only the players within about one screen of them (Colyseus `StateView`), with positions as whole pixels.
- **Responsive movement.** Your character moves instantly on your screen. The server checks every move against the collision map and a speed budget, and snaps cheaters back. The budget tolerates messages that arrive in bursts (mobile networks, a busy server), so honest players never rubber-band; over any stretch longer than a second or two, speed stays capped at 1.25× walking speed.
- **Smooth other players.** Everyone else is drawn about 150 ms in the past and blended between timestamped server snapshots. The delay grows automatically on a bad connection. Press F3 to see it.
- **Doors.** The store interior is a separate area in a corner of the map. Walking into the door asks the server to move you; the server checks you're really at the door first.
- **Chat.** Your own messages appear instantly. The server cleans and rate-limits messages (5 per 5 s) and replays the last 50 to players who join. Chat is rendered as text, never HTML.
- **Emotes.** Ten Ragnarok-style emotes pop up over your head (number keys or the smiley button), one per second at most.
- **Reconnects.** A dropped connection keeps your character in the world for 20 s while the SDK reconnects automatically.
- **Accounts are optional.** Anyone can walk around and chat as a guest. **Sign in with Gattchaa** goes to gattchaaoripa.com, which sends the player back with a one-time ticket. The game swaps it for its own 30-day session, so passwords never reach the game. Signed-in players get their character back on any device. One window per account: opening a second one takes over.
- **Player shops.** Ragnarok-style vending: a signed-in player presses **Open shop** (V) in the Market Square, names their shop, and sits down on a rug with a sign over their head. Everyone can browse the cards they've listed on the Gattchaa marketplace. Each card links to its listing, so buying (and the money) stays on the website.
  - **Where:** only in the Market Square, and not right in front of staff or so close to another shop that the signs would overlap. The form says whether the spot is good before you open. Shops saved outside the square (from before this rule) close when the server starts.
  - **While it's open:** the seller stays seated, and signs stay lit at night.
  - **When the seller leaves:** a look-alike minds the shop for 24 hours.
  - **Finding shops:** Tina, the Market Keeper in the Market Square, lists every open shop with where it is, and you can browse them from her list. The minimap marks shops in orange.
  - **Updates:** listing changes arrive by webhook, so prices and card counts update within seconds.
  - **Server cost:** nothing between purchases. Shops only do work when opened, browsed or updated.

## Leveling and fighting

Ragnarok and TibiaME style: click a monster and your character fights it. Everything about a fight is decided on the server, and the numbers live in `shared/rpg.ts`.

- **Classes.** Everyone starts as a Novice. Knight, Mage and Archer will come with a job change at level 10. HP, MP, attack and defence grow by class as you level.
- **Levels.** The cap is `LEVEL_CAP` (50 for now). The EXP curve (`expToNext`) keeps going past the cap, so raising it is a one-line change. At the cap, EXP stops filling.
- **Fields.** Monsters live outside the walls. The town (and the palace) is always safe: monsters never come in, and nobody can attack from inside. The first field is the **South Meadow**, out of the south gate (Rowan the Gate Guard explains it):

  | Monster | Level | Where | Behaviour |
  | --- | --- | --- | --- |
  | Slime | 1 | By the road | Only fights back |
  | Grass Snake | 4 | West grass | Only fights back |
  | Hornet | 7 | East field | Attacks on sight |
  | Snapper Flower | 10 | By the lake | Rooted; bites anyone who comes close |

- **Fighting.** You auto-attack once a second while the monster is in reach. Hits can miss (more often against higher levels), and 5 % are critical hits. The client only says what you're attacking and draws what the server reports: damage numbers, slashes, health bars.
- **Rewards.** EXP is shared by everyone who hurt the monster, by how much damage they did. Monsters more than 5 levels below you give less (down to 10 %). Gold goes to whoever did the most damage. Level-ups heal you fully, and every 10th level is announced in chat.
- **Healing.** Out of combat you regain HP and MP slowly. Sitting (X) is 3 times faster, and resting inside the walls doubles that again.
- **Fainting.** At 0 HP you faint and return to town fully healed. Novices lose no EXP (the classes will lose a little).
- **Saving.** Signed-in players' progress is saved on every level-up and faint, every 30 s, and when they leave. Guests can fight too, but start over next visit.
- **Server cost.** Monsters only think while a player is near their spawn area, and fight events go only to players close enough to see them. 20 bots fighting at once used about 5 % of one CPU core.
- **Testing.** Outside production (`NODE_ENV` not `production`), type `/level 25` in chat to jump to a level.

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
- **Change the season:** swap `terrain_summer.png` / `trees_summer.png` for the spring, autumn or winter versions in the same repo.

## License note

The art is CC-BY-SA / OGA-BY / GPL licensed (see each entry in `CREDITS.md`). The credits must stay reachable from the game; the login screen links to them. Your own code is yours to license as you like.
