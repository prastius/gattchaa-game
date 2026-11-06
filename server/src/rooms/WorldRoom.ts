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
import type { DoorMessage, FerryMessage } from "../../../shared/protocol";
import { CLASSES, LEVEL_CAP, aClass, isClassId } from "../../../shared/rpg";
import { isSkillId } from "../../../shared/skills";
import { PIONEERS, TITLES, isTitleId, type TitleShowMessage } from "../../../shared/titles";
import type { ArenaBoard, DuelAnswerMessage, DuelAskMessage, DuelEndEvent } from "../../../shared/duels";
import { BAG_SIZE, ITEMS, MAX_STACK, OUTFITTER_STOCK, SMITH_STOCK, cleanUpgrade, isItemId, isSlot, itemName } from "../../../shared/items";
import { FERRY, NPCS, type NpcKind } from "../../../shared/npcs";
import { TOP_HUNTER_NEWS, weekEndsAt, weekOf, type WildBoard } from "../../../shared/pvp";
import {
  SHOP_AWAY_HOURS,
  SHOP_ID_RE,
  SHOP_WARES,
  goldText,
  inShopZone,
  isPrice,
  sanitizeShopTitle,
  shopSpotProblem,
  stackText,
  waresLeft,
  type ShopBuyMessage,
  type ShopOpenMessage,
  type ShopResult,
  type WarePick,
} from "../../../shared/vending";
import { Drop, Monster, Player, PlayerShop, WorldState } from "./WorldState";
import { NpcBrain } from "./NpcBrain";
import { Combat } from "./Combat";
import { Drops } from "./Drops";
import { Parties } from "./Parties";
import { Guilds } from "./Guilds";
import { Siege } from "./Siege";
import { CASTLE_CAMP } from "../../../shared/town";
import { CRYSTAL, campSpot, type TributeResult } from "../../../shared/siege";
import {
  GUILD_FOUND_GOLD,
  isGuildRank,
  type GuildAnswerMessage,
  type GuildBoard,
  type GuildFoundMessage,
  type GuildGiveMessage,
  type GuildInviteMessage,
  type GuildKickMessage,
  type GuildLeadMessage,
  type GuildNoticeMessage,
  type GuildRankMessage,
} from "../../../shared/guild";
import type { PartyAnswerMessage, PartyInviteMessage, PartyKickMessage } from "../../../shared/party";
import { feed } from "../gattchaa";
import { db, parseWares, type Account, type Mail, type Progress } from "../db";
import type { Announcement, MarketListing, NpcSay } from "../../../shared/gattchaa";

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
/** Mail (shop sales and leftovers) is handed out this often, for sales made in another room and for bags that were full. */
const MAIL_MS = 5000;
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
  /** Things from their shop still waiting because their bag is full (so they're told once, not every few seconds). */
  mailWaiting?: number;
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
  private parties!: Parties;
  private guilds!: Guilds;
  private siege!: Siege;
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
    ferry: (client: Client, msg: FerryMessage) => this.handleFerry(client, msg),
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
    "duel:ask": (client: Client, msg: DuelAskMessage) => {
      const to = typeof msg?.t === "string" ? msg.t.slice(0, 16) : "";
      if (!this.itemOk(client) || !this.state.players.has(to)) return;
      if (this.meta.get(client.sessionId)?.shop) return this.notice(client.sessionId, "You're minding your shop. Close it first to duel.");
      if (this.meta.get(to)?.shop) return this.notice(client.sessionId, "They're minding their shop right now.");
      this.combat.askDuel(client.sessionId, to);
    },
    "duel:answer": (client: Client, msg: DuelAnswerMessage) => {
      if (this.itemOk(client) && typeof msg?.from === "string") this.combat.answerDuel(client.sessionId, msg.from.slice(0, 16), msg.yes === true);
    },
    "duel:quit": (client: Client) => this.combat.quitDuel(client.sessionId),
    "party:invite": (client: Client, msg: PartyInviteMessage) => {
      const to = typeof msg?.t === "string" ? msg.t.slice(0, 16) : "";
      if (this.itemOk(client) && this.state.players.has(to)) this.parties.invite(client.sessionId, to);
    },
    "party:answer": (client: Client, msg: PartyAnswerMessage) => {
      if (this.itemOk(client) && typeof msg?.from === "string") this.parties.answer(client.sessionId, msg.from.slice(0, 16), msg.yes === true);
    },
    "party:leave": (client: Client) => {
      if (this.itemOk(client)) this.parties.leave(client.sessionId);
    },
    "party:kick": (client: Client, msg: PartyKickMessage) => {
      if (this.itemOk(client) && typeof msg?.t === "string") this.parties.remove(client.sessionId, msg.t.slice(0, 16));
    },
    "guild:found": (client: Client, msg: GuildFoundMessage) => {
      if (this.itemOk(client) && this.npcNear(client, msg?.npc, "guild")) this.guilds.found(client.sessionId, msg.name, msg.emblem);
    },
    "guild:invite": (client: Client, msg: GuildInviteMessage) => {
      const to = typeof msg?.t === "string" ? msg.t.slice(0, 16) : "";
      if (this.itemOk(client) && this.state.players.has(to)) this.guilds.invite(client.sessionId, to);
    },
    "guild:answer": (client: Client, msg: GuildAnswerMessage) => {
      if (this.itemOk(client) && typeof msg?.from === "string") this.guilds.answer(client.sessionId, msg.from.slice(0, 16), msg.yes === true);
    },
    "guild:leave": (client: Client) => {
      if (this.itemOk(client)) this.guilds.leave(client.sessionId);
    },
    "guild:kick": (client: Client, msg: GuildKickMessage) => {
      if (this.itemOk(client) && Number.isInteger(msg?.id)) this.guilds.kick(client.sessionId, msg.id);
    },
    "guild:rank": (client: Client, msg: GuildRankMessage) => {
      if (this.itemOk(client) && Number.isInteger(msg?.id) && isGuildRank(msg.rank)) this.guilds.setRank(client.sessionId, msg.id, msg.rank);
    },
    "guild:lead": (client: Client, msg: GuildLeadMessage) => {
      if (this.itemOk(client) && Number.isInteger(msg?.id)) this.guilds.lead(client.sessionId, msg.id);
    },
    "guild:notice": (client: Client, msg: GuildNoticeMessage) => {
      if (this.itemOk(client) && typeof msg?.text === "string") this.guilds.setNotice(client.sessionId, msg.text);
    },
    "guild:give": (client: Client, msg: GuildGiveMessage) => {
      if (this.itemOk(client)) this.guilds.give(client.sessionId, msg?.gold);
    },
    "guild:board": (client: Client, msg: { npc?: string }) => {
      if (!this.itemOk(client) || !this.npcNear(client, msg?.npc, "guild")) return;
      client.send("guild:board", db.guildBoard(10, this.meta.get(client.sessionId)?.account?.id) satisfies GuildBoard);
    },
    "guild:get": (client: Client) => {
      if (this.itemOk(client)) this.guilds.refresh(client.sessionId);
    },
    "castle:guards": (client: Client, msg: { npc?: string }) => {
      if (this.itemOk(client) && this.npcNear(client, msg?.npc, "castle")) client.send("castle:guards", this.siege.guards(client.sessionId));
    },
    "castle:hire": (client: Client, msg: { npc?: string; post?: number }) => {
      if (!this.itemOk(client) || !this.npcNear(client, msg?.npc, "castle") || !Number.isInteger(msg?.post)) return;
      this.siege.hire(client.sessionId, msg.post!);
      client.send("castle:guards", this.siege.guards(client.sessionId));
    },
    "castle:tribute": (client: Client, msg: { npc?: string }) => {
      if (this.itemOk(client) && this.npcNear(client, msg?.npc, "castle")) client.send("castle:tribute", this.siege.tribute(client.sessionId) satisfies TributeResult);
    },
    "arena:board": (client: Client, msg: { npc?: string }) => {
      if (!this.itemOk(client) || !this.npcNear(client, msg?.npc, "arena")) return;
      const account = this.meta.get(client.sessionId)?.account;
      client.send("arena:board", { ...db.arenaBoard(10, account?.id), saved: Boolean(account) } satisfies ArenaBoard);
    },
    "wild:board": (client: Client, msg: { npc?: string }) => {
      if (!this.itemOk(client) || !this.npcNear(client, msg?.npc, "bounty")) return;
      const account = this.meta.get(client.sessionId)?.account;
      const week = weekOf(Date.now());
      client.send("wild:board", {
        ...db.wildBoard(10, week, account?.id),
        wanted: this.combat
          .wanted()
          .slice(0, 10)
          .map((w) => (w.name === this.state.players.get(client.sessionId)?.name ? { ...w, you: true as const } : w)),
        resetAt: weekEndsAt(week),
        saved: Boolean(account),
      } satisfies WildBoard);
    },
    "title:show": (client: Client, msg: TitleShowMessage) => {
      const id = msg?.id;
      if (this.itemOk(client) && (id === "" || isTitleId(id))) this.combat.showTitle(client.sessionId, id);
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
    "shop:buy": (client: Client, msg: ShopBuyMessage) => this.handleShopBuy(client, msg),
  };

  onCreate() {
    this.clock.setInterval(() => this.updateViews(), VIEW_UPDATE_MS);

    this.brain = new NpcBrain(world, feed, this.now, (msg: NpcSay) => this.broadcast("npc:say", msg));
    for (const [id, npc] of this.brain.npcs) this.state.npcs.set(id, npc);
    this.parties = new Parties(this.state.players, {
      send: (id, type, msg) => this.clients.getById(id)?.send(type, msg),
      notice: (id, text) => this.notice(id, text),
    });
    this.guilds = new Guilds(this.state.players, {
      send: (id, type, msg) => this.clients.getById(id)?.send(type, msg),
      notice: (id, text) => this.notice(id, text),
      news: (text) => this.system(text),
      sessionOf: (accountId) => this.sessionOf.get(accountId),
      accountOf: (id) => this.meta.get(id)?.account?.id,
      pay: (id, gold, what) => this.combat.spend(id, gold, what),
      gave: (id, gold) => this.combat.gaveToGuild(id, gold),
    });
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
        // Crownhold's crystal has its own news (the siege tells it).
        if (def.id === CRYSTAL) return;
        if (event === "rise") return this.system(`👑 The ${def.name} has risen in the ${field}!`);
        const name = by && this.state.players.get(by)?.name;
        this.system(name ? `🏆 ${name} defeated the ${def.name}!` : `🏆 The ${def.name} has fallen!`);
      },
      pvpWin: (id, outlaw, bounty) => {
        const account = this.meta.get(id)?.account;
        const name = this.state.players.get(id)?.name;
        if (!account || !name) return;
        const r = db.wildWin(account.id, outlaw, bounty, weekOf(Date.now()));
        if (r.after === account.id && r.before !== account.id && r.weekWins >= TOP_HUNTER_NEWS) {
          this.system(`🏹 ${name} is now the Wildlands' top hunter this week, with ${r.weekWins} players beaten!`);
        }
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
      titles: (id, msg) => this.clients.getById(id)?.send("titles", msg),
      duelAsk: (to, ev) => this.clients.getById(to)?.send("duel:ask", ev),
      duelStart: (id, ev) => this.clients.getById(id)?.send("duel:start", ev),
      duelEnded: (d) => this.duelEnded(d),
      titleEarned: (id, title) => {
        const name = this.state.players.get(id)?.name;
        if (name && (title.tier === "epic" || title.tier === "legendary")) this.system(`🏅 ${name} earned the title "${title.name}"!`);
      },
      crystal: (by) => this.siege.captured(by),
      guardianDown: (post) => this.siege.guardianDown(post),
      reachedCap: (id, cap) => {
        // Pioneers are counted per account, so only signed-in players can be one.
        const account = this.meta.get(id)?.account;
        if (!account || this.sessionOf.get(account.id) !== id) return;
        const rank = db.claimPioneer(cap, account.id, PIONEERS);
        if (rank) this.combat.grantTitle(id, "pioneer");
      },
    });
    this.siege = new Siege(this.state, this.state.players, this.combat, {
      news: (text) => this.system(text),
      notice: (id, text) => this.notice(id, text),
      move: (id, x, y) => {
        const client = this.clients.getById(id);
        if (client) this.teleport(client, x, y, Dir.Right);
      },
      accountOf: (id) => this.meta.get(id)?.account?.id,
      purseChanged: (guild) => this.guilds.sendAll(guild),
    });
    this.clock.setInterval(() => {
      this.brain.tick(NPC_TICK_MS);
      this.combat.tick(NPC_TICK_MS);
      this.drops.tick(Date.now());
      this.parties.tick(Date.now());
      this.guilds.tick(Date.now());
      this.siege.tick(Date.now());
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
    this.clock.setInterval(() => {
      for (const accountId of db.mailboxes()) if (this.sessionOf.has(accountId)) this.deliver(accountId);
    }, MAIL_MS);
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
    this.guilds.enter(client.sessionId);

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
    // What your shop sold while you were away (after the history, so it isn't buried).
    if (account) this.deliver(account.id);
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
    this.parties.leave(client.sessionId, "gone");
    this.guilds.exit(client.sessionId);
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

    if (meta.allowance - dist < -BUDGET_DEBT - 2 || !pathOk || !this.siege.mayEnter(client.sessionId, x0, y0, x1, y1)) {
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

  /** Sails with the ferry captain you're standing with, if you can pay the fare. */
  private handleFerry(client: Client, msg: FerryMessage) {
    if (!this.itemOk(client) || this.meta.get(client.sessionId)?.shop) return;
    const npc = this.npcNear(client, msg?.npc, "ferry");
    const trip = npc && FERRY[npc.id];
    if (!trip || !this.combat.payFare(client.sessionId, trip.fare)) return;
    this.teleport(client, trip.to.x, trip.to.y, trip.dir);
    this.notice(client.sessionId, `You sail across the sea to ${trip.dest}.`);
  }

  /** Moves a player somewhere else entirely (doors, the ferry, back to town); the client fades across. */
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
    // (A player id is accepted only for your duel opponent, or someone fair game in the Wildlands.)
    this.combat.setTarget(client.sessionId, id);
  }

  /** Knocked out: back to town on your feet. */
  private handleRevive(client: Client) {
    if (!this.combat.revive(client.sessionId)) return;
    // Beaten in a siege: up again at the camp outside Crownhold's gate, not in town.
    const spawn = this.combat.wokeInSiege(client.sessionId) ? campSpot(CASTLE_CAMP, Math.floor(Math.random() * 32)) : world.findSpawn();
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

  private notice(id: string, text: string) {
    this.clients.getById(id)?.send("chat", this.makeMessage("", "System", text, true));
  }

  /** Tells both duelists how it went; a ranked win moves both ratings and is town news. */
  private duelEnded(d: { a: string; b: string; winner?: string; ranked: boolean; why: string }) {
    const name = (id: string) => this.state.players.get(id)?.name ?? "Someone";
    const account = (id: string) => {
      const acc = this.meta.get(id)?.account;
      return acc && this.sessionOf.get(acc.id) === id ? acc : undefined;
    };
    const loser = d.winner && (d.winner === d.a ? d.b : d.a);
    let ratings: { winner: [number, number]; loser: [number, number] } | undefined;
    const wAcc = d.winner && account(d.winner);
    const lAcc = loser && account(loser);
    if (d.ranked && wAcc && lAcc) ratings = db.arenaResult(wAcc.id, lAcc.id);
    // "Bo was beaten" reads "You were beaten" to Bo.
    const yours = (id: string) => {
      const n = name(id);
      if (d.why.startsWith(`${n} was `)) return `You were ${d.why.slice(n.length + 5)}`;
      return d.why.startsWith(`${n} `) ? `You ${d.why.slice(n.length + 1)}` : d.why;
    };
    for (const id of [d.a, d.b]) {
      const result = !d.winner ? "draw" : d.winner === id ? "win" : "lose";
      const rating = ratings && (result === "win" ? ratings.winner : ratings.loser);
      this.clients.getById(id)?.send("duel:end", { result, why: yours(id), ...(rating && { rating }) } satisfies DuelEndEvent);
    }
    if (d.winner && loser && ratings) {
      this.system(`⚔️ ${name(d.winner)} beat ${name(loser)} in the Arena! (rating ${ratings.winner[1]})`);
    }
  }

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
    const party = /^\/p(?:arty)? +(.+)$/i.exec(text);
    if (party) return this.partyChat(client, player.name, party[1]);
    const guild = /^\/g(?:uild)? +(.+)$/i.exec(text);
    if (guild) return this.guildChat(client, player.name, guild[1]);
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

  /** /p: a line for the speaker's party only (not kept in the town's chat history). */
  private partyChat(client: Client, name: string, text: string) {
    const meta = this.meta.get(client.sessionId);
    const members = this.parties.members(client.sessionId);
    if (!meta) return;
    if (!members.length) return client.send("chat", this.makeMessage("", "System", "You're not in a party. Click another player to invite them.", true));
    const now = Date.now();
    if (meta.lastChatAt + CHAT_COOLDOWN_MS > now) return;
    meta.lastChatAt = now;
    const msg: ChatMessage = { ...this.makeMessage(client.sessionId, name, text), party: true };
    for (const id of members) this.clients.getById(id)?.send("chat", msg);
  }

  /** /g: a line for the speaker's guild mates who are here (not kept in the town's chat history). */
  private guildChat(client: Client, name: string, text: string) {
    const meta = this.meta.get(client.sessionId);
    const members = this.guilds.members(client.sessionId);
    if (!meta) return;
    if (!members.length) return client.send("chat", this.makeMessage("", "System", `You're not in a guild. Leopold, by the fountain plaza, founds one for ${GUILD_FOUND_GOLD.toLocaleString("en-US")} gold.`, true));
    const now = Date.now();
    if (meta.lastChatAt + CHAT_COOLDOWN_MS > now) return;
    meta.lastChatAt = now;
    const msg: ChatMessage = { ...this.makeMessage(client.sessionId, name, text), guild: true };
    for (const id of members) this.clients.getById(id)?.send("chat", msg);
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

  /** The things picked from the bag for a new shop, if the message makes sense. */
  private warePicks(raw: unknown): WarePick[] | undefined {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > SHOP_WARES) return undefined;
    const picks: WarePick[] = [];
    for (const r of raw as Partial<WarePick>[]) {
      if (!this.bagSlot(r?.slot) || !Number.isInteger(r.n) || r.n! < 1 || r.n! > MAX_STACK || !isPrice(r.price)) return undefined;
      picks.push({ slot: r.slot, n: r.n!, price: r.price });
    }
    return picks;
  }

  /**
   * Opens a shop right where the player stands. It sells the things they
   * picked from their bag, for gold, and shows the cards they've listed on the
   * Gattchaa marketplace; it needs at least one of the two. Everything is
   * checked again after waiting for Gattchaa, since the town may have moved on.
   */
  private async handleShopOpen(client: Client, msg: ShopOpenMessage) {
    const reply = (error?: string) => client.send("shop:result", (error ? { ok: false, error } : { ok: true }) satisfies ShopResult);
    const meta = this.meta.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!meta || !player || meta.opening) return;
    const account = meta.account;
    const picks = this.warePicks(msg?.wares);
    if (!picks) return reply("Something's wrong with what you picked. Please pick again.");
    const problem = () => {
      if (!account) return "Sign in with Gattchaa to open a shop.";
      if (meta.shop || this.shopOf(account.id)) return "You already have a shop open. Close it first.";
      if (this.combat.inDuel(client.sessionId)) return "Finish your duel first.";
      if (player.dead) return "You can't open a shop right now.";
      if (!feed.enabled && picks.length === 0) return "Pick something from your bag to sell first.";
      return shopSpotProblem(meta.x, meta.y, this.otherShops());
    };
    const before = problem();
    if (before || !account) return reply(before);

    // The cards they've listed on Gattchaa (none when the link isn't set up).
    let listings: MarketListing[] | undefined = [];
    if (feed.enabled) {
      meta.opening = true;
      try {
        listings = await feed.listings(account.gattchaaId);
      } finally {
        meta.opening = false;
      }
      if (this.meta.get(client.sessionId) !== meta) return; // left the town meanwhile
    }
    if (picks.length === 0) {
      if (!listings) return reply("Couldn't reach Gattchaa. Try again in a moment.");
      if (listings.length === 0) return reply("Pick something from your bag to sell, or list cards on the Gattchaa marketplace first.");
    }
    const after = problem();
    if (after) return reply(after);

    const wares = this.combat.stockShop(client.sessionId, picks);
    if (typeof wares === "string") return reply(wares);
    const title = sanitizeShopTitle(msg?.title) || `${player.name}'s shop`;
    const x = Math.round(meta.x);
    const y = Math.round(meta.y);
    let id: string;
    try {
      id = db.openShop(account.id, x, y, title, wares);
    } catch {
      // This account opened a shop from another room a moment ago.
      this.combat.unstock(client.sessionId, wares);
      return reply("You already have a shop open. Close it first.");
    }
    this.shopOwners.set(id, account);
    this.state.shops.set(
      id,
      new PlayerShop({ name: player.name, look: player.look, title, x, y, owner: client.sessionId, cards: listings?.length ?? 0, items: waresLeft(wares), rev: 0 }),
    );
    this.combat.shopOpened(client.sessionId);

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

  /** Closes a shop for good: what it didn't sell goes back to its owner (now if they're here, or when they return). */
  private closeShop(id: string) {
    const owner = this.shopOwners.get(id);
    if (owner) db.closeShop(owner.id);
    this.dropShop(id);
    if (owner) this.deliver(owner.id);
  }

  /**
   * Buys from a player's shop, for gold. The buyer has to be in the Market
   * Square. The seller is paid by mail: straight away if they're here, or as
   * soon as they're back.
   */
  private handleShopBuy(client: Client, msg: ShopBuyMessage) {
    const id = client.sessionId;
    const meta = this.meta.get(id);
    const player = this.state.players.get(id);
    if (!this.itemOk(client) || !meta || !player) return;
    const shopId = typeof msg?.shop === "string" && SHOP_ID_RE.test(msg.shop) ? msg.shop : "";
    const shop = this.state.shops.get(shopId);
    const owner = this.shopOwners.get(shopId);
    if (!shop || !owner) return this.notice(id, "This shop has just closed.");
    if (!Number.isInteger(msg.ware) || !isItemId(msg.item) || !isPrice(msg.price)) return;
    if (meta.account?.id === owner.id) return this.notice(id, "That's your own shop!");
    if (!inShopZone(meta.x, meta.y)) return this.notice(id, "Come to the Market Square to buy.");
    const ware = parseWares(db.shop(shopId)?.wares)[msg.ware];
    if (!ware || ware.item.id !== msg.item || ware.price !== msg.price) return this.notice(id, "That's no longer for sale. Have another look.");
    if (ware.item.n <= 0) return this.notice(id, "Sold out!");
    const n = Math.min(ware.item.n, Number.isInteger(msg.n) && msg.n > 0 ? msg.n : 1);
    if (!this.combat.canBuy(id, { ...ware.item, n }, ware.price * n)) return;
    const sale = db.buyWare(shopId, msg.ware, n, { item: msg.item, price: msg.price }, player.name);
    if (typeof sale === "string") return this.notice(id, sale);
    this.combat.bought(id, sale.item, sale.gold);
    this.notice(id, `You bought ${stackText(itemName(sale.item), sale.item.n)} from ${shop.name} for ${goldText(sale.gold)} gold.`);
    shop.items = waresLeft(sale.wares);
    shop.rev = (shop.rev + 1) % 65536;
    this.deliver(sale.seller);
    // Sold out, with no Gattchaa cards to show either: the shop closes, Ragnarok style.
    if (shop.items === 0 && shop.cards === 0) {
      const seller = this.sessionOf.get(sale.seller);
      this.closeShop(shopId);
      if (seller) this.notice(seller, "🎉 Your shop sold out, so it has closed.");
    }
  }

  /**
   * Hands an account its mail if they're in this room: gold from their shop's
   * sales, and whatever it didn't sell. A full bag leaves items waiting.
   */
  private deliver(accountId: number) {
    const id = this.sessionOf.get(accountId);
    const meta = id ? this.meta.get(id) : undefined;
    if (!id || !meta) return;
    const sales: Mail[] = [];
    let back = 0;
    let waiting = 0;
    db.deliverMail(accountId, (m) => {
      if (!this.combat.receive(id, m)) {
        waiting++;
        return false;
      }
      if (m.gold > 0) sales.push(m);
      if (m.item) back++;
      return true;
    });
    if (sales.length || back) this.combat.flush(id);
    const gold = sales.reduce((sum, m) => sum + m.gold, 0);
    if (sales.length === 1) this.notice(id, `💰 ${sales[0].note} for ${goldText(gold)} gold.`);
    else if (sales.length > 1) this.notice(id, `💰 Your shop made ${sales.length} sales, for ${goldText(gold)} gold in all.`);
    if (back) this.notice(id, `📦 ${back === 1 ? "One thing" : `${back} things`} your shop didn't sell ${back === 1 ? "is" : "are"} back in your bag.`);
    if (waiting && waiting !== meta.mailWaiting) {
      this.notice(id, `📦 Your bag is full: ${waiting === 1 ? "one thing" : `${waiting} things`} from your shop ${waiting === 1 ? "is" : "are"} waiting. Make room and ${waiting === 1 ? "it comes" : "they come"} to you.`);
    }
    meta.mailWaiting = waiting;
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
      const items = waresLeft(parseWares(row.wares));
      const known = this.state.shops.get(id);
      if (known && this.shopOwners.has(id)) {
        // Something sold through another room.
        if (known.items !== items) Object.assign(known, { items, rev: (known.rev + 1) % 65536 });
        continue;
      }
      const owner = db.account(row.accountId);
      if (!owner) {
        db.closeShop(row.accountId);
        continue;
      }
      this.shopOwners.set(id, owner);
      this.state.shops.set(
        id,
        new PlayerShop({ name: owner.name || owner.displayName, look: normalizeLook(owner.look), title: row.title, x: row.x, y: row.y, owner: "", cards: 0, items, rev: 0 }),
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
    if (name === "tp") {
      // "/tp 397 80": to a tile (testing far-off places, like Crownhold).
      const [tx, ty] = text.split(" ").slice(1, 3).map(Number);
      const x = tx * 32 + 16;
      const y = ty * 32 + 16;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !world.canStand(x, y)) return reply("Test command: /tp <tile x> <tile y>, somewhere you can stand.");
      this.teleport(client, x, y, Dir.Down);
      return reply(`Test command: to ${tx}, ${ty}.`);
    }
    if (name === "siege" && ["on", "off", "auto"].includes(arg)) {
      this.siege.force(arg === "auto" ? undefined : arg === "on", Date.now());
      return reply(`Test command: siege ${arg === "auto" ? "back on the schedule" : arg}.`);
    }
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
    if (name === "title" && isTitleId(arg)) {
      this.combat.grantTitle(client.sessionId, arg);
      return reply(`Test command: you have the title "${TITLES[arg].name}". Show it from your titles (T).`);
    }
    if (name === "job" && isClassId(arg)) {
      this.combat.cheatJob(client.sessionId, arg);
      return reply(`Test command: job set to ${CLASSES[arg].name} (jobs need level 10).`);
    }
    reply(
      `Test commands: /level <1-${LEVEL_CAP}>, /item <id> [count or +upgrade], /gold <amount>, /siege <on|off|auto>, /tp <x> <y>, /job <novice|knight|mage|archer|lordKnight|wizard|hunter>, /title <id>. Item ids: ${Object.keys(ITEMS).join(", ")}. Title ids: ${Object.keys(TITLES).join(", ")}`,
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
