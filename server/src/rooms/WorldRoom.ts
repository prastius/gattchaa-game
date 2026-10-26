import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import { PLAYER_SPEED, World } from "../../../shared/world";
import { normalizeLook } from "../../../shared/appearance";
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY,
  Dir,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  VIEW_RADIUS,
  sanitizeChat,
  sanitizeName,
  type AuthInfo,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type EmoteEvent,
  type EmoteMessage,
  type JoinOptions,
  type LookMessage,
  type MoveMessage,
  type SitMessage,
} from "../../../shared/protocol";
import { DOORS, placeName } from "../../../shared/town";
import type { DoorMessage } from "../../../shared/protocol";
import { SHOP_AWAY_HOURS, sanitizeShopTitle, shopSpotProblem, type ShopOpenMessage, type ShopResult } from "../../../shared/vending";
import { Player, PlayerShop, WorldState } from "./WorldState";
import { NpcBrain } from "./NpcBrain";
import { feed } from "../gattchaa";
import { db, type Account } from "../db";
import type { Announcement, NpcSay } from "../../../shared/gattchaa";

// Generated once per process; every room instance shares the same map.
const world = new World();

const LOOK_COOLDOWN_MS = 1000;
// Move messages: a token bucket, not a minimum gap. Networks (mobile, Wi-Fi)
// and a busy server deliver messages in bursts; dropping "too close together"
// messages made the server fall behind and rubber-band honest players.
const MOVE_RATE = 30; // msgs/s sustained (clients send 12)
const MOVE_BURST = 30; // ~2.5 s of normal sending can arrive at once
// Speed budget in pixels: refills at 1.25x walking speed, holds 1.5 s, and may
// go up to 1 s into debt so a delayed burst of honest moves is still accepted.
// Over any longer window, average speed stays capped at 1.25x.
const BUDGET_MAX = PLAYER_SPEED * 1.5;
const BUDGET_DEBT = PLAYER_SPEED;
const RECONNECT_SECONDS = 20;
const VIEW_UPDATE_MS = 200;
// Hysteresis so players near the edge of view don't flicker in and out.
const VIEW_ENTER_X = VIEW_RADIUS;
const VIEW_ENTER_Y = VIEW_RADIUS * 0.75;
const VIEW_EXIT_PAD = 200;
const NPC_TICK_MS = 100;
const PRESENCE_BATCH_MS = 3000;
const SIT_COOLDOWN_MS = 250; // the client waits 300 ms between toggles
const SHOP_SYNC_MS = 60_000;
/** Card counts on the signs are re-checked this often; listing webhooks update them sooner. */
const SHOP_RECOUNT_MS = 10 * 60_000;
const AWAY_MS = SHOP_AWAY_HOURS * 3_600_000;
/** "X opened a shop" goes to chat at most this often per seller, so reopening isn't spam. */
const OPEN_NEWS_EVERY_MS = 10 * 60_000;
const TAKEN_OVER = 4001;

/** After a restart nobody is in town yet, so every shop's away timer starts then (once per process). */
let shopsMarkedAway = false;

interface PlayerMeta {
  /** Exact position; the synced schema only carries whole pixels. */
  x: number;
  y: number;
  /** Movement budget in pixels; refills at slightly above PLAYER_SPEED. */
  allowance: number;
  lastMoveAt: number;
  /** Move-message rate limiter. */
  tokens: number;
  lastLookAt: number;
  lastChatAt: number;
  lastSitAt: number;
  lastEmoteAt: number;
  /** Signed in with Gattchaa. Guests can walk and chat, but can't own anything. */
  account?: Account;
  /** Id of the shop they're minding: they stay seated on its rug until they close it. */
  shop?: string;
  /** A shop:open request is waiting on Gattchaa. */
  opening?: boolean;
}

interface AuthData {
  account?: Account;
  /** A token was sent but didn't match a live session. */
  expired: boolean;
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
  private stopListings?: () => void;
  /** Owner of each open shop, by shop id. */
  private shopOwners = new Map<string, Account>();
  /** One town session per account (account id -> session id); a second window takes over. */
  private sessionOf = new Map<number, string>();
  private lastRecount = Date.now();
  private openNewsAt = new Map<number, number>();

  /** Room clock for interpolation timestamps (fits uint32 for ~49 days). */
  private now = () => Date.now() - this.startedAt;

  messages = {
    move: (client: Client, msg: MoveMessage) => this.handleMove(client, msg),
    look: (client: Client, msg: LookMessage) => this.handleLook(client, msg),
    chat: (client: Client, msg: ChatSend) => this.handleChat(client, msg),
    door: (client: Client, msg: DoorMessage) => this.handleDoor(client, msg),
    sit: (client: Client, msg: SitMessage) => this.handleSit(client, msg),
    emote: (client: Client, msg: EmoteMessage) => this.handleEmote(client, msg),
    "shop:open": (client: Client, msg: ShopOpenMessage) => {
      this.handleShopOpen(client, msg).catch((err) => {
        console.error("[shops] open failed:", err);
        client.send("shop:result", { ok: false, error: "Something went wrong. Please try again." } satisfies ShopResult);
      });
    },
    "shop:close": (client: Client) => this.handleShopClose(client),
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

    if (!shopsMarkedAway) {
      shopsMarkedAway = true;
      db.markShopsAway(Date.now() + AWAY_MS);
    }
    this.syncShops();
    this.clock.setInterval(() => this.syncShops(), SHOP_SYNC_MS);
    this.stopListings = feed.onListingsChanged((userId) => {
      for (const [id, owner] of this.shopOwners) if (owner.gattchaaId === userId) void this.recount(id, true);
    });
  }

  onDispose() {
    this.stopAnnouncements?.();
    this.stopListings?.();
  }

  /** Signed-in players bring a session token. Guests are welcome too (always truthy), they just can't own anything. */
  onAuth(_client: Client, options: JoinOptions): AuthData {
    const token = typeof options?.token === "string" ? options.token : "";
    const account = token ? db.accountForToken(token) : undefined;
    return { account, expired: token !== "" && !account };
  }

  onJoin(client: Client, options: JoinOptions) {
    const auth = client.auth as AuthData | undefined;
    const account = auth?.account;
    const name = sanitizeName(options?.name);
    const look = normalizeLook(options?.look);

    let shopId: string | undefined;
    if (account) {
      db.saveCharacter(account.id, name, look);
      Object.assign(account, { name, look });
      const previous = this.sessionOf.get(account.id);
      if (previous && previous !== client.sessionId) this.clients.getById(previous)?.leave(TAKEN_OVER, "You entered the town from another window.");
      this.sessionOf.set(account.id, client.sessionId);
      // Back to your shop if it's still open.
      shopId = this.shopOf(account.id);
    }

    const shop = shopId ? this.state.shops.get(shopId) : undefined;
    const spawn = shop ?? world.findSpawn();
    const player = new Player({ name, look, x: spawn.x, y: spawn.y, ts: this.now(), sit: Boolean(shop), dir: Dir.Down });
    this.state.players.set(client.sessionId, player);
    this.meta.set(client.sessionId, {
      x: spawn.x,
      y: spawn.y,
      allowance: 0,
      lastMoveAt: Date.now(),
      tokens: MOVE_BURST,
      lastLookAt: 0,
      lastChatAt: 0,
      lastSitAt: 0,
      lastEmoteAt: 0,
      account,
      shop: shop && shopId,
    });
    this.state.online = this.clients.length;

    if (account && shop) {
      Object.assign(shop, { owner: client.sessionId, name, look });
      db.setShopExpiry(account.id, null);
    }

    client.view = new StateView();
    client.view.add(player);
    this.updateViews();

    client.send("auth", { signedIn: Boolean(account), ...(auth?.expired && { expired: true }) } satisfies AuthInfo);
    client.send("chat:history", this.history);
    this.queuePresence("joined", player.name);
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
    const meta = this.meta.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    this.state.online = this.clients.length;
    const account = meta?.account;
    if (account) {
      if (this.sessionOf.get(account.id) === client.sessionId) this.sessionOf.delete(account.id);
      // Offline vending: the shop stays open, minded by the owner's look-alike, for a while.
      const shop = meta.shop ? this.state.shops.get(meta.shop) : undefined;
      if (shop && shop.owner === client.sessionId) {
        shop.owner = "";
        db.setShopExpiry(account.id, Date.now() + AWAY_MS);
      }
    }
    if (player) this.queuePresence("left", player.name);
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
    const dt = Math.min(2000, now - meta.lastMoveAt) / 1000;
    meta.lastMoveAt = now;
    meta.tokens = Math.min(MOVE_BURST, meta.tokens + dt * MOVE_RATE);
    if (meta.tokens < 1) return; // flooding: drop silently, the next move catches up
    meta.tokens -= 1;
    meta.allowance = Math.min(BUDGET_MAX, meta.allowance + PLAYER_SPEED * dt * 1.25);

    if (meta.shop) {
      // Minding a shop: stay on the rug until it's closed.
      client.send("correct", { x: meta.x, y: meta.y } satisfies CorrectMessage);
      return;
    }

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

    if (meta.allowance - dist < -BUDGET_DEBT - 2 || !pathOk) {
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
    player.sit = false; // walking (or even turning) gets you up
  }

  /** Teleports through a door, but only if the player is really standing at it. */
  private handleDoor(client: Client, msg: DoorMessage) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    const door = DOORS.find((d) => d.id === msg?.id);
    if (!player || !meta || !door || meta.shop) return;
    const t = door.trigger;
    const slack = 64; // the client may be ahead of us, or used the door from a step away
    if (meta.x < t.x - slack || meta.x > t.x + t.w + slack || meta.y < t.y - slack || meta.y > t.y + t.h + slack) return;

    meta.x = door.to.x;
    meta.y = door.to.y;
    meta.allowance = 0;
    meta.lastMoveAt = Date.now();
    player.x = door.to.x;
    player.y = door.to.y;
    player.dir = door.dir;
    player.moving = false;
    player.sit = false;
    player.ts = this.now();
    client.send("correct", { x: door.to.x, y: door.to.y, dir: door.dir } satisfies CorrectMessage);
    this.updateViews();
  }

  private handleLook(client: Client, msg: LookMessage) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta) return;
    const now = Date.now();
    if (now - meta.lastLookAt < LOOK_COOLDOWN_MS) return;
    meta.lastLookAt = now;
    player.look = normalizeLook(msg?.look);
    if (meta.account) {
      db.saveCharacter(meta.account.id, player.name, player.look);
      meta.account.look = player.look;
    }
    const shop = meta.shop ? this.state.shops.get(meta.shop) : undefined;
    if (shop) shop.look = player.look;
  }

  private handleSit(client: Client, msg: SitMessage) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta || meta.shop) return; // shopkeepers stay seated until they close
    const now = Date.now();
    if (now - meta.lastSitAt < SIT_COOLDOWN_MS) return;
    meta.lastSitAt = now;
    player.sit = Boolean(msg?.on);
    if (player.sit) player.moving = false;
  }

  /** Emotes go to everyone else (each client only draws the players it can see); the sender already shows it. */
  private handleEmote(client: Client, msg: EmoteMessage) {
    const meta = this.meta.get(client.sessionId);
    const e = msg?.e;
    if (!meta || !Number.isInteger(e) || e < 0 || e >= EMOTES.length) return;
    const now = Date.now();
    if (now - meta.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    meta.lastEmoteAt = now;
    this.broadcast("emote", { from: client.sessionId, e } satisfies EmoteEvent, { except: client });
  }

  private handleChat(client: Client, msg: ChatSend) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta) return;

    const text = sanitizeChat(msg?.text);
    if (!text) return;

    const now = Date.now();
    const wait = meta.lastChatAt + CHAT_COOLDOWN_MS - now;
    if (wait > 0) {
      client.send("chat", this.makeMessage("", "System", `Slow down: wait ${Math.ceil(wait / 1000)}s before chatting again.`, true));
      return;
    }
    meta.lastChatAt = now;

    this.publish(this.makeMessage(client.sessionId, player.name, text));
  }

  // ---------------------------------------------------------------- player shops

  /** The id of the shop this account has open, if any. */
  private shopOf(accountId: number): string | undefined {
    for (const [id, owner] of this.shopOwners) if (owner.id === accountId) return id;
    return undefined;
  }

  /** Every open shop except one, for the spacing rule. */
  private *otherShops(except?: string) {
    for (const [id, shop] of this.state.shops) if (id !== except) yield shop;
  }

  /**
   * Opens a shop right where the player stands: it shows their Gattchaa
   * marketplace listings, so they need at least one. Everything is checked
   * again after waiting for Gattchaa, since the town may have moved on meanwhile.
   */
  private async handleShopOpen(client: Client, msg: ShopOpenMessage) {
    const reply = (error?: string) => client.send("shop:result", (error ? { ok: false, error } : { ok: true }) satisfies ShopResult);
    const meta = this.meta.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!meta || !player || meta.opening) return;
    const account = meta.account;
    const problem = () => {
      if (!account) return "Sign in with Gattchaa to open a shop.";
      if (meta.shop || this.shopOf(account.id)) return "You already have a shop open. Close it first.";
      if (!feed.enabled) return "Player shops need the link to Gattchaa, which isn't set up on this server yet.";
      return shopSpotProblem(meta.x, meta.y, this.otherShops());
    };
    const before = problem();
    if (before || !account) return reply(before);

    meta.opening = true;
    let listings;
    try {
      listings = await feed.listings(account.gattchaaId);
    } finally {
      meta.opening = false;
    }
    if (this.meta.get(client.sessionId) !== meta) return; // left the town meanwhile
    if (!listings) return reply("Couldn't reach Gattchaa. Try again in a moment.");
    if (listings.length === 0) return reply("You haven't listed any cards on the Gattchaa marketplace yet. List some there first, then open your shop.");
    const after = problem();
    if (after) return reply(after);

    const title = sanitizeShopTitle(msg?.title) || `${player.name}'s cards`;
    const x = Math.round(meta.x);
    const y = Math.round(meta.y);
    let id: string;
    try {
      id = db.openShop(account.id, x, y, title);
    } catch {
      // This account opened a shop from another room a moment ago.
      return reply("You already have a shop open. Close it first.");
    }
    this.shopOwners.set(id, account);
    this.state.shops.set(id, new PlayerShop({ name: player.name, look: player.look, title, x, y, owner: client.sessionId, cards: listings.length, rev: 0 }));

    // Sit down on the rug, facing the street.
    meta.shop = id;
    meta.x = x;
    meta.y = y;
    meta.allowance = 0;
    Object.assign(player, { x, y, dir: Dir.Down, moving: false, sit: true, ts: this.now() });
    client.send("correct", { x, y } satisfies CorrectMessage);
    reply();

    const now = Date.now();
    if (now - (this.openNewsAt.get(account.id) ?? 0) > OPEN_NEWS_EVERY_MS) {
      this.openNewsAt.set(account.id, now);
      this.system(`${player.name} opened a shop in ${placeName(x, y)}: "${title}"`);
    }
  }

  private handleShopClose(client: Client) {
    const meta = this.meta.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!meta?.shop || !player) return;
    this.closeShop(meta.shop);
    client.send("shop:result", { ok: true } satisfies ShopResult);
  }

  private closeShop(id: string) {
    const owner = this.shopOwners.get(id);
    if (owner) db.closeShop(owner.id);
    this.dropShop(id);
  }

  /** Removes a shop from the town (not the database), standing its owner up if they're here. */
  private dropShop(id: string) {
    this.shopOwners.delete(id);
    this.state.shops.delete(id);
    for (const [sessionId, meta] of this.meta) {
      if (meta.shop !== id) continue;
      meta.shop = undefined;
      const player = this.state.players.get(sessionId);
      if (player) player.sit = false;
    }
  }

  /**
   * Closes shops whose owners have been away too long, and keeps the town in
   * step with the database (shops opened or closed by another room instance).
   */
  private syncShops() {
    const now = Date.now();
    for (const row of db.expiredShops(now)) db.closeShop(row.accountId);
    const rows = new Map(db.shops().map((r) => [r.id, r]));
    for (const id of [...this.shopOwners.keys()]) if (!rows.has(id)) this.dropShop(id);
    for (const [id, row] of rows) {
      if (this.shopOwners.has(id)) continue;
      const owner = db.account(row.accountId);
      if (!owner) {
        db.closeShop(row.accountId);
        continue;
      }
      this.shopOwners.set(id, owner);
      this.state.shops.set(
        id,
        new PlayerShop({ name: owner.name || owner.displayName, look: normalizeLook(owner.look), title: row.title, x: row.x, y: row.y, owner: "", cards: 0, rev: 0 }),
      );
      void this.recount(id);
    }
    if (now - this.lastRecount > SHOP_RECOUNT_MS) {
      this.lastRecount = now;
      for (const id of this.shopOwners.keys()) void this.recount(id);
    }
  }

  /** Refreshes the card count on a shop's sign; `changed` also makes open shop panels reload. */
  private async recount(id: string, changed = false) {
    const owner = this.shopOwners.get(id);
    if (!owner) return;
    const listings = await feed.listings(owner.gattchaaId);
    const shop = this.state.shops.get(id);
    if (!shop || !listings || this.shopOwners.get(id) !== owner) return;
    shop.cards = Math.min(listings.length, 65535);
    if (changed) shop.rev = (shop.rev + 1) % 65536;
  }

  // ---------------------------------------------------------------- chat

  /**
   * Join/leave notices are collected for a few seconds and posted as one line,
   * so a busy evening doesn't bury the chat in "X joined" spam.
   */
  private pendingPresence: Record<"joined" | "left", string[]> = { joined: [], left: [] };
  private presenceTimer = false;

  private queuePresence(what: "joined" | "left", name: string) {
    this.pendingPresence[what].push(name);
    if (this.presenceTimer) return;
    this.presenceTimer = true;
    this.clock.setTimeout(() => {
      this.presenceTimer = false;
      for (const kind of ["joined", "left"] as const) {
        const names = this.pendingPresence[kind];
        this.pendingPresence[kind] = [];
        if (names.length === 0) continue;
        const who =
          names.length === 1
            ? names[0]
            : names.length <= 3
              ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
              : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
        this.system(kind === "joined" ? `${who} joined the town` : `${who} left`);
      }
    }, PRESENCE_BATCH_MS);
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
