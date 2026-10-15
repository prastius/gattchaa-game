import { Room, type Client } from "colyseus";
import { PLAYER_SPEED, World } from "../../../shared/world";
import {
  CHAT_HISTORY,
  sanitizeChat,
  sanitizeName,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type JoinOptions,
  type MoveMessage,
} from "../../../shared/protocol";
import { Player, WorldState } from "./WorldState";

// Generated once per process; every room instance shares the same map.
const world = new World();

const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_PER_WINDOW = 5;
const RECONNECT_SECONDS = 20;

interface PlayerMeta {
  /** Movement budget in pixels; refills at slightly above PLAYER_SPEED. */
  allowance: number;
  lastMoveAt: number;
  chatTimes: number[];
}

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 100;
  state = new WorldState();

  private meta = new Map<string, PlayerMeta>();
  private history: ChatMessage[] = [];
  private nextChatId = 1;

  messages = {
    move: (client: Client, msg: MoveMessage) => this.handleMove(client, msg),
    chat: (client: Client, msg: ChatSend) => this.handleChat(client, msg),
  };

  onJoin(client: Client, options: JoinOptions) {
    const spawn = world.findSpawn();
    const player = new Player({
      name: sanitizeName(options?.name),
      x: spawn.x,
      y: spawn.y,
      hue: Math.floor(Math.random() * 360),
    });
    this.state.players.set(client.sessionId, player);
    this.meta.set(client.sessionId, { allowance: 0, lastMoveAt: Date.now(), chatTimes: [] });

    client.send("chat:history", this.history);
    this.system(`${player.name} joined the world`);
  }

  async onDrop(client: Client) {
    // Unexpected disconnect: keep the player in the world for a while so a
    // flaky mobile connection can resume the same session.
    const player = this.state.players.get(client.sessionId);
    if (player) player.moving = false;
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    if (player) this.system(`${player.name} left`);
  }

  private handleMove(client: Client, msg: MoveMessage) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta || !msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    const now = Date.now();
    const dt = Math.min(1000, now - meta.lastMoveAt) / 1000;
    meta.lastMoveAt = now;
    // Budget-based speed check tolerates bursty packets without allowing speed hacks.
    meta.allowance = Math.min(PLAYER_SPEED, meta.allowance + PLAYER_SPEED * dt * 1.25);

    const { x: x0, y: y0 } = player;
    const { x: x1, y: y1 } = msg;
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
    player.x = x1;
    player.y = y1;
    player.facing = msg.facing < 0 ? -1 : 1;
    player.moving = Boolean(msg.moving);
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
