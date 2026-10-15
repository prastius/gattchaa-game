// Load test: connects N bot players that wander around and chat.
//
//   npx tsx scripts/bots.ts [serverUrl] [count]
//   npx tsx scripts/bots.ts http://localhost:2567 100
//
// Bots move exactly like real clients (same collision code, same send rate), so
// the server does real validation work. Prints a summary every 5 seconds.

import { Client, type Room } from "@colyseus/sdk";
import { PLAYER_SPEED, World } from "../shared/world";
import { Dir, NET_SEND_HZ, ROOM_NAME } from "../shared/protocol";
import { encodeLook, randomLook as randomAppearance } from "../shared/appearance";

const url = process.argv[2] ?? "http://localhost:2567";
const count = Number(process.argv[3] ?? 50);
const world = new World();

const LINES = ["hello!", "anyone here?", "nice trees", "where is the lake?", "brb", "lol", "this place is huge", "hi everyone 👋"];

const stats = { joined: 0, failed: 0, corrections: 0, chatsIn: 0, moves: 0, dropped: 0, maxVisible: 0 };

function randomLook(): string {
  return encodeLook(randomAppearance());
}

async function runBot(i: number) {
  let room: Room;
  try {
    room = await new Client(url).joinOrCreate(ROOM_NAME, { name: `Bot${String(i).padStart(3, "0")}`, look: randomLook() });
  } catch (err) {
    stats.failed++;
    console.error(`bot ${i} failed to join:`, (err as Error).message);
    return;
  }
  stats.joined++;

  let x = 0;
  let y = 0;
  let ready = false;
  let heading = Math.random() * Math.PI * 2;
  let walking = true;

  room.onMessage("chat:history", () => {});
  room.onMessage("chat", () => stats.chatsIn++);
  room.onMessage("correct", (p: { x: number; y: number }) => {
    stats.corrections++;
    x = p.x;
    y = p.y;
  });
  room.onDrop(() => stats.dropped++);

  const waitForSelf = setInterval(() => {
    const me = (room.state as any)?.players?.get(room.sessionId);
    if (me) {
      x = me.x;
      y = me.y;
      ready = true;
      clearInterval(waitForSelf);
    }
  }, 50);

  const dt = 1000 / NET_SEND_HZ;
  setInterval(() => {
    if (!ready) return;
    if (Math.random() < 0.02) walking = !walking;
    if (Math.random() < 0.05) heading += (Math.random() - 0.5) * 2;
    if (walking) {
      const step = (PLAYER_SPEED * 0.9 * dt) / 1000;
      const next = world.move(x, y, Math.cos(heading) * step, Math.sin(heading) * step);
      if (next.x === x && next.y === y) heading += Math.PI / 2 + Math.random();
      x = next.x;
      y = next.y;
    }
    const dx = Math.cos(heading);
    const dy = Math.sin(heading);
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    room.send("move", { x, y, dir, moving: walking });
    stats.moves++;
    const visible = (room.state as any)?.players?.size ?? 0;
    if (visible > stats.maxVisible) stats.maxVisible = visible;
  }, dt);

  setInterval(() => {
    if (Math.random() < 0.3) room.send("chat", { text: LINES[Math.floor(Math.random() * LINES.length)] });
  }, 15000 + Math.random() * 15000);
}

async function main() {
  console.log(`Connecting ${count} bots to ${url}…`);
  for (let i = 0; i < count; i++) {
    runBot(i);
    await new Promise((r) => setTimeout(r, 40)); // stagger joins
  }
  setInterval(async () => {
    let health = "";
    try {
      health = JSON.stringify(await (await fetch(`${url}/health`)).json());
    } catch {
      health = "(health unavailable)";
    }
    console.log(
      `joined=${stats.joined} failed=${stats.failed} moves=${stats.moves} corrections=${stats.corrections} chatsIn=${stats.chatsIn} drops=${stats.dropped} maxVisible=${stats.maxVisible} server=${health}`,
    );
  }, 5000);
}

main();
