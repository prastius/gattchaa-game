import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import { PLAYER_SPEED, World } from "../../../shared/world";
import { normalizeLook } from "../../../shared/appearance";
import {
  CHAT_HISTORY,
  VIEW_RADIUS,
  sanitizeChat,
  sanitizeName,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type JoinOptions,
  type LookMessage,
  type MoveMessage,
} from "../../../shared/protocol";
import { Player, WorldState } from "./WorldState";
import { NpcBrain } from "./NpcBrain";
import { feed } from "../gattchaa";
import type { Announcement, NpcSay } from "../../../shared/gattchaa";

// Generated once per process; every room instance shares the same map.
const world = new World();

const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_PER_WINDOW = 5;
const LOOK_COOLDOWN_MS = 1000;
const MIN_MOVE_INTERVAL_MS = 25; // ignore move floods above ~40 msg/s
const RECONNECT_SECONDS = 20;
const VIEW_UPDATE_MS = 200;
// Hysteresis so players near the edge of view don't flicker in and out.
const VIEW_ENTER_X = VIEW_RADIUS;
const VIEW_ENTER_Y = VIEW_RADIUS * 0.75;
const VIEW_EXIT_PAD = 200;
const NPC_TICK_MS = 100;

interface PlayerMeta {
  /** Exact position; the synced schema only carries whole pixels. */
  x: number;
  y: number;
  /** Movement budget in pixels; refills at slightly above PLAYER_SPEED. */
  allowance: number;
  lastMoveAt: number;
  lastLookAt: number;
  chatTimes: number[];
}

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 150;
  state = new WorldState();

  private meta = new Map<string, PlayerMeta>();
  private history: ChatMessage[] = [];
  private nextChatId = 1;
  private startedAt = Date.now();
  private brain!: NpcBrain;
  private stopAnnouncements?: () => void;

  /** Room clock for interpolation timestamps (fits uint32 for ~49 days). */
  private now = () => Date.now() - this.startedAt;

  messages = {
    move: (client: Client, msg: MoveMessage) => this.handleMove(client, msg),
    look: (client: Client, msg: LookMessage) => this.handleLook(client, msg),
    chat: (client: Client, msg: ChatSend) => this.handleChat(client, msg),
  };

  onCreate() {
    this.clock.setInterval(() => this.updateViews(), VIEW_UPDATE_MS);

    this.brain = new NpcBrain(world, feed, this.now, (msg: NpcSay) => this.broadcast("npc:say", msg));
    for (const [id, npc] of this.brain.npcs) this.state.npcs.set(id, npc);
    this.clock.setInterval(() => {
      this.brain.tick(NPC_TICK_MS);
      this.state.siteOnline = feed.online;
    }, NPC_TICK_MS);

    this.stopAnnouncements = feed.onAnnouncement((a: Announcement) => {
      this.broadcast("announce", a);
      this.brain.shout(a.title ? `Wow! ${a.message}` : a.message);
      this.publish(this.makeMessage("", a.label || "Gattchaa", a.message, true));
    });
  }

  onDispose() {
    this.stopAnnouncements?.();
  }

  onJoin(client: Client, options: JoinOptions) {
    const spawn = world.findSpawn();
    const player = new Player({
      name: sanitizeName(options?.name),
      look: normalizeLook(options?.look),
      x: spawn.x,
      y: spawn.y,
      ts: this.now(),
    });
    this.state.players.set(client.sessionId, player);
    this.meta.set(client.sessionId, { x: spawn.x, y: spawn.y, allowance: 0, lastMoveAt: Date.now(), lastLookAt: 0, chatTimes: [] });
    this.state.online = this.clients.length;

    client.view = new StateView();
    client.view.add(player);
    this.updateViews();

    client.send("chat:history", this.history);
    this.system(`${player.name} joined the world`);
  }

  async onDrop(client: Client) {
    // Unexpected disconnect: keep the player in the world for a while so a
    // flaky mobile connection can resume the same session.
    const player = this.state.players.get(client.sessionId);
    if (player) player.moving = false;
    const view = client.view;
    const resumed = await this.allowReconnection(client, RECONNECT_SECONDS);
    // Keep the interest-management view on the resumed connection.
    if (resumed && !resumed.view) resumed.view = view;
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    this.state.online = this.clients.length;
    if (player) this.system(`${player.name} left`);
  }

  /** Interest management: each client's view holds only the players near it. */
  private updateViews() {
    const players = [...this.state.players.entries()];
    for (const client of this.clients) {
      const view = client.view;
      const me = this.state.players.get(client.sessionId);
      if (!view || !me) continue;
      for (const [id, other] of players) {
        if (id === client.sessionId) continue;
        const dx = Math.abs(other.x - me.x);
        const dy = Math.abs(other.y - me.y);
        const visible = view.has(other);
        if (!visible && dx <= VIEW_ENTER_X && dy <= VIEW_ENTER_Y) view.add(other);
        else if (visible && (dx > VIEW_ENTER_X + VIEW_EXIT_PAD || dy > VIEW_ENTER_Y + VIEW_EXIT_PAD)) view.remove(other);
      }
    }
  }

  private handleMove(client: Client, msg: MoveMessage) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta || !msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    const now = Date.now();
    if (now - meta.lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
    const dt = Math.min(1000, now - meta.lastMoveAt) / 1000;
    meta.lastMoveAt = now;
    // Budget-based speed check tolerates bursty packets without allowing speed hacks.
    meta.allowance = Math.min(PLAYER_SPEED, meta.allowance + PLAYER_SPEED * dt * 1.25);

    // Validate against exact positions so sliding along a wall never rounds into it.
    const x0 = meta.x;
    const y0 = meta.y;
    const x1 = msg.x;
    const y1 = msg.y;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const pathOk =
      world.canTravel(x0, y0, x1, y1) ||
      // Clients slide along walls per axis, so also accept either L-shaped path.
      (world.canTravel(x0, y0, x1, y0) && world.canTravel(x1, y0, x1, y1)) ||
      (world.canTravel(x0, y0, x0, y1) && world.canTravel(x0, y1, x1, y1));

    if (dist > meta.allowance + 2 || !pathOk) {
      client.send("correct", { x: x0, y: y0 } satisfies CorrectMessage);
      return;
    }

    meta.allowance -= dist;
    meta.x = x1;
    meta.y = y1;
    player.x = Math.round(x1);
    player.y = Math.round(y1);
    player.ts = this.now();
    player.dir = Number.isInteger(msg.dir) && msg.dir >= 0 && msg.dir <= 3 ? msg.dir : player.dir;
    player.moving = Boolean(msg.moving);
  }

  private handleLook(client: Client, msg: LookMessage) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta) return;
    const now = Date.now();
    if (now - meta.lastLookAt < LOOK_COOLDOWN_MS) return;
    meta.lastLookAt = now;
    player.look = normalizeLook(msg?.look);
  }

  private handleChat(client: Client, msg: ChatSend) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta) return;

    const text = sanitizeChat(msg?.text);
    if (!text) return;

    const now = Date.now();
    meta.chatTimes = meta.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (meta.chatTimes.length >= CHAT_MAX_PER_WINDOW) {
      client.send("chat", this.makeMessage("", "System", "You're sending messages too fast.", true));
      return;
    }
    meta.chatTimes.push(now);

    this.publish(this.makeMessage(client.sessionId, player.name, text));
  }

  private system(text: string) {
    this.publish(this.makeMessage("", "System", text, true));
  }

  private publish(message: ChatMessage) {
    this.history.push(message);
    if (this.history.length > CHAT_HISTORY) this.history.shift();
    this.broadcast("chat", message);
  }

  private makeMessage(from: string, name: string, text: string, system = false): ChatMessage {
    return { id: this.nextChatId++, from, name, text, ts: Date.now(), ...(system && { system }) };
  }
}
