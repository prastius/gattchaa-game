# My World

A browser-based multiplayer open world with live chat.

- **Client:** Phaser 4 + TypeScript + Vite
- **Server:** Colyseus 0.18 + TypeScript on Node.js
- **Look:** top-down 2D with depth sorting, shadows and tall props for a "2.5D" feel

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

## Production

```bash
npm run build      # builds client/dist and server/build
npm start          # one port (2567) serves the game page and the WebSocket
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

PM2 settings are in `ecosystem.config.cjs`. A 1 vCPU / 1 GB VPS comfortably runs a starter world.

## Layout

```
shared/     Code used by both sides
  world.ts      Seeded world generator, collision, movement
  protocol.ts   Message types, name/chat sanitizing
server/     Colyseus server
  src/index.ts            HTTP + WebSocket server; serves client/dist in production
  src/rooms/WorldRoom.ts  Joins, movement validation, chat (history, rate limit)
  src/rooms/WorldState.ts Synced state (players)
client/     Phaser game
  src/main.ts             Login screen, then boots Phaser
  src/net.ts              Connection, message handlers, reconnect handling
  src/scenes/WorldScene.ts  Chunk streaming, input, interpolation
  src/PlayerSprite.ts     Avatar, name tag, chat bubble
  src/textures.ts         Procedural art (replace with real sprites any time)
  src/ui/                 Chat panel, HUD and minimap (HTML overlay)
```

## How it works

- **Same world on both sides.** Client and server generate the identical 512×512-tile island from one seed, so the map is never sent over the network. Change `WORLD_SEED` or the generator in `shared/world.ts` to get a new world.
- **Responsive movement.** The client moves its own player immediately and sends its position 15 times per second. The server checks each move against a speed budget and the collision map. If a move is invalid (speed hack, walking through water), the server snaps the player back.
- **Streaming.** The client only builds the ground and trees for chunks near the camera (32×32 tiles each), so a larger world costs no extra memory.
- **Chat.** Messages are sanitized and rate-limited (5 per 5 seconds) on the server, and the last 50 are replayed to players who join. The client renders chat as text only, never as HTML. Messages also show as speech bubbles above the speaker's head.
- **Reconnects.** A dropped connection keeps your character in the world for 20 seconds, and the SDK reconnects automatically.

## Next steps

1. **Art.** Load sprite sheets (for example from itch.io or Kenney) under the same texture keys used in `textures.ts`. Add autotiled coastlines.
2. **Interest management.** Use Colyseus `StateView` so each client only receives players near it. This matters past roughly 100 players per room.
3. **Accounts and persistence.** Use `@colyseus/auth` with Postgres or SQLite to save names, positions and inventory.
4. **Scaling out.** Add `@colyseus/redis-presence` and `redis-driver`, then raise PM2 instances or add more VPSs.
5. **Gameplay.** Add NPCs, a day/night cycle with Phaser 4 lighting, and interactable objects.
