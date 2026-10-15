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
| Hold mouse / finger | Walk toward the pointer |
| Enter | Open chat, then Enter again to send. Esc cancels. |
| 👕 Wardrobe | Change your outfit at any time; everyone sees it |

## Production

```bash
npm run build      # builds client/dist and server/build
npm start          # one port (2567) serves the game page, assets and the WebSocket
```

### Deploying to a Linux VPS (terminal only)

Point a domain's DNS at the VPS, clone the repo there, then:

```bash
bash deploy/setup-ubuntu.sh play.example.com   # Node 24, PM2, nginx, HTTPS
bash deploy/update.sh                          # later: pull, rebuild, reload
```

Files in `deploy/`:

- `nginx.conf` is the reverse proxy, with WebSocket upgrade headers.
- `setup-ubuntu.sh` does the one-time install.
- `update.sh` redeploys.

PM2 settings are in `ecosystem.config.cjs`.

### Load testing

```bash
npm run bots -- http://localhost:2567 100     # or your VPS URL
```

This connects 100 bots that walk around (using the real collision code) and chat. It prints the server's CPU and memory every 5 seconds. Measured on a dev machine with 100 bots: 2–14 % of one CPU core, about 160 MB of RAM, and 0 rejected moves. A 1 vCPU / 1 GB VPS handles that.

## Layout

```
shared/       Code used by both client and server
  world.ts        Seeded island generator (corner-based terrain), decorations, collision
  appearance.ts   Character look: encode/decode/validate, random looks
  catalog.ts      Generated list of hair/clothes/colour options
  protocol.ts     Message types, name/chat sanitizing
server/       Colyseus server
  src/rooms/WorldRoom.ts   Joins, interest management, movement validation, chat, wardrobe
  src/rooms/WorldState.ts  Synced state
client/       Phaser game
  src/main.ts              Character creator, then boots Phaser; wardrobe panel
  src/character.ts         Builds character sprite sheets from recolored LPC layers
  src/PlayerSprite.ts      Avatar, walk animation, name tag, chat bubble
  src/world/terrainTiles.ts  Corner autotiling + padded tile atlas
  src/world/decorSprites.ts  Trees, rocks, plants
  src/scenes/WorldScene.ts   Chunk streaming, input, camera, interpolation
  src/ui/                  Creator, chat, HUD + minimap
  public/assets/           Downloaded art + manifest (committed)
scripts/
  fetch-assets.mjs   Re-downloads the art from pinned commits and regenerates catalog + credits
  bots.ts            Load-test bots
```

## How it works

- **Same world on both sides.** Client and server generate the same 384×384-tile island from one seed, so the map is never sent over the network. Terrain is stored per tile *corner*, and each tile picks its art from its four corners. That gives smooth grassy banks, water and dirt edges.
- **Crisp pixel art with no flicker.** The game renders at the screen's real pixel density with whole-number zoom, nearest-neighbor filtering and whole-pixel positions. Tiles come from an atlas with a 1 px padded border, so neighboring tiles can't bleed into each other while the camera moves.
- **Characters.** Each look is a short string such as `0.3.1.5.12.0.4.2.7.1.22`. The client stacks the LPC layers (shadow, body, head, shoes, legs, top, hair) and swaps the palette colors to the chosen skin, hair, eye and cloth colors. It makes one sprite sheet per distinct look and frees it when nobody on screen wears it.
- **Scales to 100+ players.** The server sends each client only the players within about one screen of them (Colyseus `StateView`), with positions as whole pixels.
- **Responsive movement.** Your character moves instantly on your screen. The server checks every move against a speed budget and the collision map, and snaps cheaters back.
- **Chat.** Your own messages appear instantly. The server cleans and rate-limits messages (5 per 5 s) and replays the last 50 to players who join. Chat is rendered as text, never HTML.
- **Reconnects.** A dropped connection keeps your character in the world for 20 s while the SDK reconnects automatically.

## Changing the art

`npm run fetch-assets` re-downloads everything listed in `scripts/fetch-assets.mjs` and regenerates the manifest, `shared/catalog.ts` and the credits.

- **Add a hairstyle or clothing item:** add its `sheet_definitions` path to `ITEMS`. Browse the options at <https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>.
- **Change the season:** swap `terrain_summer.png` / `trees_summer.png` for the spring, autumn or winter versions in the same repo.

## License note

The art is CC-BY-SA / OGA-BY / GPL licensed (see each entry in `CREDITS.md`). The credits must stay reachable from the game; the login screen links to them. Your own code is yours to license as you like.
