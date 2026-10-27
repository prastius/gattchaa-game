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
  type CardInsertMessage,
  type JobMessage,
  type SkillLearnMessage,
  type SkillUseMessage,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type EmoteEvent,
  type EmoteMessage,
  type FxEvent,
  type ItemDropMessage,
  type ItemUseMessage,
  type JoinOptions,
  type LookMessage,
  type MoveMessage,
  type NpcBuyMessage,
  type NpcSellMessage,
  type PickupMessage,
  type SitMessage,
  type TargetMessage,
  type UnequipMessage,
  type UpgradeMessage,
} from "../../../shared/protocol";
import { DOORS, placeName } from "../../../shared/town";
import type { DoorMessage } from "../../../shared/protocol";
import { CLASSES, LEVEL_CAP, aClass, isClassId } from "../../../shared/rpg";
import { isSkillId } from "../../../shared/skills";
import { BAG_SIZE, ITEMS, OUTFITTER_STOCK, SMITH_STOCK, cleanUpgrade, isItemId, isSlot } from "../../../shared/items";
import { NPCS, type NpcKind } from "../../../shared/npcs";
import { SHOP_AWAY_HOURS, inShopZone, sanitizeShopTitle, shopSpotProblem, type ShopOpenMessage, type ShopResult } from "../../../shared/vending";
import { Drop, Monster, Player, PlayerShop, WorldState } from "./WorldState";
import { NpcBrain } from "./NpcBrain";
import { Combat } from "./Combat";
import { Drops } from "./Drops";
import { feed } from "../gattchaa";
import { db, type Account, type Progress } from "../db";
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
/** Fights are sent to players this close (px, per axis): everyone who has the fighters in view. */
const FX_X = VIEW_ENTER_X + VIEW_EXIT_PAD;
const FX_Y = VIEW_ENTER_Y + VIEW_EXIT_PAD;
// Bag actions (use, wear, pick up, buy…): a token bucket, so quick clicking works but flooding doesn't.
const ITEM_RATE = 8;
const ITEM_BURST = 12;
/** How close (px) you must stand to an NPC merchant to trade. */
const TRADE_RANGE = 160;

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
  itemTokens: number;
  lastItemAt: number;
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
  private combat!: Combat;
  private drops!: Drops;
  /** Fight events waiting to go out, per session; sent once per tick. */
  private fx = new Map<string, FxEvent[]>();
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
    target: (client: Client, msg: TargetMessage) => this.handleTarget(client, msg),
    revive: (client: Client) => this.handleRevive(client),
    "item:use": (client: Client, msg: ItemUseMessage) => {
      if (this.itemOk(client) && this.bagSlot(msg?.slot)) this.combat.useItem(client.sessionId, msg.slot);
    },
    "item:unequip": (client: Client, msg: UnequipMessage) => {
      if (this.itemOk(client) && isSlot(msg?.slot)) this.combat.unequip(client.sessionId, msg.slot);
    },
    "item:drop": (client: Client, msg: ItemDropMessage) => {
      if (!this.itemOk(client) || !this.bagSlot(msg?.slot) || this.meta.get(client.sessionId)?.shop) return;
      this.combat.dropItem(client.sessionId, msg.slot, Number.isInteger(msg.n) ? msg.n! : Infinity);
    },
    "item:card": (client: Client, msg: CardInsertMessage) => {
      if (!this.itemOk(client) || !this.bagSlot(msg?.card)) return;
      const at = this.bagSlot(msg.bag) ? { bag: msg.bag } : isSlot(msg.gear) ? { gear: msg.gear } : undefined;
      if (at) this.combat.insertCard(client.sessionId, msg.card, at);
    },
    "item:pickup": (client: Client, msg: PickupMessage) => {
      if (this.itemOk(client) && typeof msg?.id === "string") this.combat.pickup(client.sessionId, msg.id.slice(0, 16));
    },
    "smith:upgrade": (client: Client, msg: UpgradeMessage) => {
      if (!this.itemOk(client) || !this.npcNear(client, msg?.npc, "smith")) return;
      const at = this.bagSlot(msg.bag) ? { bag: msg.bag } : isSlot(msg.gear) ? { gear: msg.gear } : undefined;
      if (at) this.combat.upgrade(client.sessionId, at);
    },
    job: (client: Client, msg: JobMessage) => {
      if (this.itemOk(client) && this.npcNear(client, msg?.npc, "jobs") && isClassId(msg.cls)) this.combat.changeJob(client.sessionId, msg.cls);
    },
    "skill:learn": (client: Client, msg: SkillLearnMessage) => {
      if (this.itemOk(client) && isSkillId(msg?.id)) this.combat.learnSkill(client.sessionId, msg.id);
    },
    "skill:use": (client: Client, msg: SkillUseMessage) => {
      if (!this.itemOk(client) || !isSkillId(msg?.id)) return;
      this.combat.useSkill(client.sessionId, msg.id, typeof msg.t === "string" ? msg.t.slice(0, 16) : undefined);
    },
    "npc:buy": (client: Client, msg: NpcBuyMessage) => this.handleBuy(client, msg),
    "npc:sell": (client: Client, msg: NpcSellMessage) => this.handleSell(client, msg),
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
    this.drops = new Drops(this.state.drops, world, (drop) => {
      for (const client of this.clients) if (client.view?.has(drop)) client.view.remove(drop);
    });
    this.combat = new Combat(world, this.state.monsters, this.drops, this.now, {
      emit: (x, y, ev) => {
        for (const [id, meta] of this.meta) if (Math.abs(meta.x - x) <= FX_X && Math.abs(meta.y - y) <= FX_Y) this.queueFx(id, ev);
      },
      tell: (id, ev) => this.queueFx(id, ev),
      sheet: (id, sheet) => this.clients.getById(id)?.send("me", sheet),
      bag: (id, bag) => this.clients.getById(id)?.send("bag", bag),
      notice: (id, text) => this.clients.getById(id)?.send("chat", this.makeMessage("", "System", text, true)),
      save: (id, progress) => this.saveProgress(id, progress),
      despawn: (mob) => {
        // Out of every view first, or the views would keep holding it.
        for (const client of this.clients) if (client.view?.has(mob)) client.view.remove(mob);
      },
      levelUp: (id, lv) => {
        const name = this.state.players.get(id)?.name;
        if (name && lv % 10 === 0) this.system(`${name} reached level ${lv}!`);
      },
      boss: (def, event, field, by) => {
        if (event === "rise") return this.system(`👑 The ${def.name} has risen in the ${field}!`);
        const name = by && this.state.players.get(by)?.name;
        this.system(name ? `🏆 ${name} defeated the ${def.name}!` : `🏆 The ${def.name} has fallen!`);
      },
      jobChange: (id, cls) => {
        const name = this.state.players.get(id)?.name;
        if (name) this.system(`🎉 ${name} became ${aClass(cls)}!`);
      },
      found: (id, item) => {
        const name = this.state.players.get(id)?.name;
        if (name) this.system(item.kind === "card" ? `🃏 ${name} found a ${item.name}!` : `✨ ${name} found the legendary ${item.name}!`);
      },
      upgraded: (id, item, up) => {
        const name = this.state.players.get(id)?.name;
        if (name) this.system(`🔨 ${name} upgraded a ${item} to +${up}!`);
      },
    });
    this.clock.setInterval(() => {
      this.brain.tick(NPC_TICK_MS);
      this.combat.tick(NPC_TICK_MS);
      this.drops.tick(Date.now());
      this.flushFx();
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
      // Shops opened before they were limited to the Market Square close.
      for (const row of db.shops()) if (!inShopZone(row.x, row.y)) db.closeShop(row.accountId);
    }
    this.syncShops();
    this.clock.setInterval(() => this.syncShops(), SHOP_SYNC_MS);
    this.stopListings = feed.onListingsChanged((userId) => {
      for (const [id, owner] of this.shopOwners) if (owner.gattchaaId === userId) void this.recount(id, true);
    });
  }

  onDispose() {
    this.combat.saveAll();
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
      if (previous && previous !== client.sessionId) {
        // Save the other window's progress first, so this one picks it up.
        this.combat.flush(previous);
        this.clients.getById(previous)?.leave(TAKEN_OVER, "You entered the town from another window.");
      }
      this.sessionOf.set(account.id, client.sessionId);
      // Back to your shop if it's still open.
      shopId = this.shopOf(account.id);
    }

    const shop = shopId ? this.state.shops.get(shopId) : undefined;
    const spawn = shop ?? world.findSpawn();
    const player = new Player({ name, look, x: spawn.x, y: spawn.y, ts: this.now(), sit: Boolean(shop), dir: Dir.Down });
    this.state.players.set(client.sessionId, player);
    const meta: PlayerMeta = {
      x: spawn.x,
      y: spawn.y,
      allowance: 0,
      lastMoveAt: Date.now(),
      tokens: MOVE_BURST,
      lastLookAt: 0,
      lastChatAt: 0,
      lastSitAt: 0,
      lastEmoteAt: 0,
      itemTokens: ITEM_BURST,
      lastItemAt: Date.now(),
      account,
      shop: shop && shopId,
    };
    this.meta.set(client.sessionId, meta);
    this.combat.join(client.sessionId, player, meta, account && db.progress(account.id), Boolean(account));
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
    // First, while the session still owns its account (progress is saved under it).
    this.combat.leave(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    this.state.online = this.clients.length;
    this.fx.delete(client.sessionId);
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

  /** Interest management: each client's view holds only the players, monsters and items near it. */
  private updateViews() {
    const players = [...this.state.players.entries()];
    const monsters = [...this.state.monsters.values()];
    const drops = [...this.state.drops.values()];
    for (const client of this.clients) {
      const view = client.view;
      const me = this.state.players.get(client.sessionId);
      if (!view || !me) continue;
      const near = (other: Player | Monster | Drop) => {
        const dx = Math.abs(other.x - me.x);
        const dy = Math.abs(other.y - me.y);
        const visible = view.has(other);
        if (!visible && dx <= VIEW_ENTER_X && dy <= VIEW_ENTER_Y) view.add(other);
        else if (visible && (dx > VIEW_ENTER_X + VIEW_EXIT_PAD || dy > VIEW_ENTER_Y + VIEW_EXIT_PAD)) view.remove(other);
      };
      for (const [id, other] of players) if (id !== client.sessionId) near(other);
      for (const mob of monsters) near(mob);
      for (const drop of drops) near(drop);
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

    if (meta.shop || player.dead) {
      // Minding a shop (stay on the rug until it's closed), or knocked out.
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
    if (!player || !meta || !door || meta.shop || player.dead) return;
    const t = door.trigger;
    const slack = 64; // the client may be ahead of us, or used the door from a step away
    if (meta.x < t.x - slack || meta.x > t.x + t.w + slack || meta.y < t.y - slack || meta.y > t.y + t.h + slack) return;
    this.teleport(client, door.to.x, door.to.y, door.dir);
  }

  /** Moves a player somewhere else entirely (doors, back to town); the client fades across. */
  private teleport(client: Client, x: number, y: number, dir: number) {
    const player = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!player || !meta) return;
    meta.x = x;
    meta.y = y;
    meta.allowance = 0;
    meta.lastMoveAt = Date.now();
    Object.assign(player, { x, y, dir, moving: false, sit: false, ts: this.now() });
    client.send("correct", { x, y, dir } satisfies CorrectMessage);
    this.updateViews();
  }

  // ---------------------------------------------------------------- fighting

  private handleTarget(client: Client, msg: TargetMessage) {
    const meta = this.meta.get(client.sessionId);
    if (!meta || meta.shop) return;
    const id = typeof msg?.id === "string" ? msg.id.slice(0, 16) : "";
    this.combat.setTarget(client.sessionId, id);
  }

  /** Knocked out: back to town on your feet. */
  private handleRevive(client: Client) {
    if (!this.combat.revive(client.sessionId)) return;
    const spawn = world.findSpawn();
    this.teleport(client, spawn.x, spawn.y, Dir.Down);
  }

  // ---------------------------------------------------------------- items

  /** Rate limit for bag actions. */
  private itemOk(client: Client): boolean {
    const meta = this.meta.get(client.sessionId);
    if (!meta) return false;
    const now = Date.now();
    meta.itemTokens = Math.min(ITEM_BURST, meta.itemTokens + ((now - meta.lastItemAt) / 1000) * ITEM_RATE);
    meta.lastItemAt = now;
    if (meta.itemTokens < 1) return false;
    meta.itemTokens -= 1;
    return true;
  }

  private bagSlot = (slot: unknown): slot is number => Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < BAG_SIZE;

  /** The NPC of that kind, if you're standing with them. */
  private npcNear(client: Client, npcId: unknown, kind: NpcKind) {
    const meta = this.meta.get(client.sessionId);
    const def = NPCS.find((n) => n.id === npcId);
    const npc = def && this.state.npcs.get(def.id);
    if (!meta || !def || !npc || def.kind !== kind) return undefined;
    if (Math.hypot(npc.x - meta.x, npc.y - meta.y) > TRADE_RANGE) return undefined;
    return def;
  }

  private merchant(client: Client, npcId: unknown) {
    return this.npcNear(client, npcId, "outfitter");
  }

  /** The Outfitter sells his stock, the Blacksmith her ingots. */
  private handleBuy(client: Client, msg: NpcBuyMessage) {
    if (!this.itemOk(client)) return;
    const stock = this.merchant(client, msg?.npc) ? OUTFITTER_STOCK : this.npcNear(client, msg?.npc, "smith") ? SMITH_STOCK : undefined;
    const id = msg?.item;
    if (!stock || !isItemId(id) || !stock.includes(id)) return;
    this.combat.buy(client.sessionId, id, Number(msg.n));
  }

  private handleSell(client: Client, msg: NpcSellMessage) {
    if (!this.itemOk(client) || !this.merchant(client, msg?.npc)) return;
    if ("loot" in msg) this.combat.sell(client.sessionId, -1, 0);
    else if (this.bagSlot(msg.slot)) this.combat.sell(client.sessionId, msg.slot, Number.isInteger(msg.n) && msg.n > 0 ? msg.n : 1);
  }

  private queueFx(id: string, ev: FxEvent) {
    let list = this.fx.get(id);
    if (!list) this.fx.set(id, (list = []));
    list.push(ev);
  }

  private flushFx() {
    for (const [id, list] of this.fx) this.clients.getById(id)?.send("fx", list);
    this.fx.clear();
  }

  /** Saves under the account, unless another window has taken it over since. */
  private saveProgress(id: string, progress: Progress) {
    const account = this.meta.get(id)?.account;
    if (account && this.sessionOf.get(account.id) === id) db.saveProgress(account.id, progress);
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
    if (!player || !meta || meta.shop || player.dead) return; // shopkeepers stay seated until they close
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
    if (text.startsWith("/")) return this.command(client, text);

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

  /** Chat commands. Only for testing, so they're off in production. */
  private command(client: Client, text: string) {
    const reply = (line: string) => client.send("chat", this.makeMessage("", "System", line, true));
    if (process.env.NODE_ENV === "production") return reply("Unknown command.");
    const [name, arg] = text.slice(1).split(" ");
    const n = Number(arg);
    if (name === "level" && Number.isFinite(n)) {
      const lv = Math.min(LEVEL_CAP, Math.max(1, Math.floor(n)));
      this.combat.cheatLevel(client.sessionId, lv);
      return reply(`Test command: you are now level ${lv}.`);
    }
    if (name === "item" && isItemId(arg)) {
      // "/item saber +7": already upgraded.
      const extra = text.split(" ")[2] ?? "1";
      const up = extra.startsWith("+") ? cleanUpgrade(arg, extra.slice(1)) : undefined;
      const count = extra.startsWith("+") ? 1 : Number(extra);
      this.combat.cheatItem(client.sessionId, arg, Number.isFinite(count) ? count : 1, up);
      return reply(`Test command: added ${up ? `+${up} ` : ""}${ITEMS[arg].name}.`);
    }
    if (name === "gold" && Number.isFinite(n)) {
      this.combat.cheatGold(client.sessionId, n);
      return reply(`Test command: you now have ${Math.max(0, Math.floor(n))} gold.`);
    }
    if (name === "job" && isClassId(arg)) {
      this.combat.cheatJob(client.sessionId, arg);
      return reply(`Test command: job set to ${CLASSES[arg].name} (jobs need level 10).`);
    }
    reply(
      `Test commands: /level <1-${LEVEL_CAP}>, /item <id> [count or +upgrade], /gold <amount>, /job <novice|knight|mage|archer>. Item ids: ${Object.keys(ITEMS).join(", ")}`,
    );
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
