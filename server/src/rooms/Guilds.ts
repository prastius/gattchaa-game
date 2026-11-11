import type { MapSchema } from "@colyseus/schema";
import type { Player } from "./WorldState";
import { db } from "../db";
import {
  GUILD_FOUND_GOLD,
  GUILD_FOUND_LV,
  GUILD_GIFT_MIN,
  GUILD_INVITE_MS,
  GUILD_MAX,
  GuildRank,
  cleanGuildName,
  cleanNotice,
  emblemOf,
  isEmblem,
  sortMembers,
  type GuildAskEvent,
  type GuildMessage,
} from "../../../shared/guild";

// Guilds: founding one, invites, ranks, leaving and removing, the notice, gifts
// to the purse, and who's online. The database holds every guild and its
// members (accounts); this keeps track of the members who are here right now,
// puts the guild's name and emblem on their synced Player (for the names over
// heads, and so guild mates never fight in the Battle Pit), and sends each of
// them the guild window's contents whenever something changes.

export interface GuildHooks {
  send(id: string, type: string, msg: unknown): void;
  notice(id: string, text: string): void;
  /** A line for the whole town. */
  news(text: string): void;
  /** The session an account is playing right now, if any. */
  sessionOf(accountId: number): string | undefined;
  /** The account a session belongs to (guests have none). */
  accountOf(id: string): number | undefined;
  /** Takes gold for `what`; false (having said why) if they can't pay. */
  pay(id: string, gold: number, what: string): boolean;
  /** Someone gave gold to their guild's purse. */
  gave(id: string, gold: number): void;
}

export class Guilds {
  /** Members here right now: session -> their guild. */
  private here = new Map<string, number>();
  /** Invites waiting for an answer, by whoever was invited. */
  private invites = new Map<string, { from: string; guild: number; until: number }>();

  constructor(
    private players: MapSchema<Player>,
    private hooks: GuildHooks,
  ) {}

  /** Everyone of a guild who's here (session ids). */
  private online(guild: number): string[] {
    return [...this.here].filter(([, g]) => g === guild).map(([id]) => id);
  }

  /** Online guild mates of a session (them included), for guild chat. */
  members(id: string): string[] {
    const g = this.here.get(id);
    return g === undefined ? [] : this.online(g);
  }

  /** Someone came into town: their guild on their name, the window filled in, the others told. */
  enter(id: string) {
    const account = this.hooks.accountOf(id);
    const row = account === undefined ? undefined : db.guildOf(account);
    const p = this.players.get(id);
    if (!row || !p) return this.hooks.send(id, "guild", null);
    // Taking over from another window isn't coming online.
    const twin = [...this.here.keys()].some((s) => s !== id && this.hooks.accountOf(s) === account);
    this.here.set(id, row.id);
    p.guild = row.name;
    p.emblem = row.emblem;
    if (!twin) for (const m of this.online(row.id)) if (m !== id) this.hooks.notice(m, `🛡 ${p.name} is online.`);
    if (row.notice) this.hooks.notice(id, `🛡 ${row.name}: ${row.notice}`);
    this.sendAll(row.id);
  }

  /** Someone left the game. */
  exit(id: string) {
    this.invites.delete(id);
    for (const [to, inv] of this.invites) if (inv.from === id) this.invites.delete(to);
    const g = this.here.get(id);
    if (g === undefined) return;
    // A window closed because the same player came in from another one: they're still here.
    const account = this.hooks.accountOf(id);
    const replaced = account !== undefined && this.hooks.sessionOf(account) !== id;
    this.here.delete(id);
    const name = this.players.get(id)?.name ?? "Someone";
    if (!replaced) for (const m of this.online(g)) this.hooks.notice(m, `🛡 ${name} went offline.`);
    this.sendAll(g);
  }

  /** At the Registrar: a new guild, with `id` as its leader. */
  found(id: string, rawName: unknown, emblem: unknown) {
    const p = this.players.get(id);
    const account = this.hooks.accountOf(id);
    if (!p) return;
    if (account === undefined) return this.hooks.notice(id, "Sign in to found a guild: a guild belongs to its members' accounts.");
    if (this.here.has(id)) return this.hooks.notice(id, "You're in a guild already. Leave it first.");
    if (p.lv < GUILD_FOUND_LV) return this.hooks.notice(id, `You need to be level ${GUILD_FOUND_LV} to found a guild.`);
    const name = cleanGuildName(rawName);
    if (!name) return this.hooks.notice(id, "That can't be a guild name: 3 to 16 letters, digits, spaces, ' or -, not only digits.");
    if (!isEmblem(emblem)) return;
    if (db.guildNameTaken(name)) return this.hooks.notice(id, `There's already a guild called ${name}.`);
    if (!this.hooks.pay(id, GUILD_FOUND_GOLD, "Founding a guild")) return;
    const g = db.createGuild(name, emblem, account);
    if (g === undefined) return this.hooks.notice(id, `There's already a guild called ${name}.`);
    this.here.set(id, g);
    p.guild = name;
    p.emblem = emblem;
    this.hooks.notice(id, `You founded ${name}! Click other players to invite them, open your guild with G, and type /g to talk to it.`);
    this.hooks.news(`🛡 ${p.name} founded the guild ${emblemOf(emblem).symbol} ${name}!`);
    this.sendAll(g);
  }

  /** `from` (the leader or an officer) invites `to`. */
  invite(from: string, to: string) {
    const a = this.players.get(from);
    const b = this.players.get(to);
    if (!a || !b || from === to) return;
    const g = this.here.get(from);
    const me = this.mine(from);
    if (g === undefined || !me) return this.hooks.notice(from, "You're not in a guild. Found one at the Guild Registrar.");
    if (me.rank < GuildRank.Officer) return this.hooks.notice(from, "Only your guild's leader and officers can invite players.");
    if (this.here.get(to) === g) return this.hooks.notice(from, `${b.name} is already in your guild.`);
    if (this.here.has(to)) return this.hooks.notice(from, `${b.name} is already in a guild.`);
    if (this.hooks.accountOf(to) === undefined) return this.hooks.notice(from, `${b.name} is playing as a guest: they need to sign in to join a guild.`);
    if (db.guildSize(g) >= GUILD_MAX) return this.hooks.notice(from, `Your guild is full: ${GUILD_MAX} is the most.`);
    const waiting = this.invites.get(to);
    if (waiting?.from === from && waiting.until > Date.now()) return this.hooks.notice(from, `You've already invited ${b.name}. Give them a moment.`);
    const row = db.guild(g)!;
    this.invites.set(to, { from, guild: g, until: Date.now() + GUILD_INVITE_MS });
    this.hooks.send(to, "guild:ask", { from, name: a.name, guild: row.name, emblem: row.emblem, size: db.guildSize(g), ms: GUILD_INVITE_MS } satisfies GuildAskEvent);
    this.hooks.notice(from, `You invited ${b.name} to ${row.name}.`);
  }

  /** `id` answers `from`'s invite. */
  answer(id: string, from: string, yes: boolean) {
    const inv = this.invites.get(id);
    if (!inv || inv.from !== from) return;
    this.invites.delete(id);
    const me = this.players.get(id);
    const account = this.hooks.accountOf(id);
    if (!me || account === undefined) return;
    const row = db.guild(inv.guild);
    if (!row || Date.now() > inv.until) return this.hooks.notice(id, "That invite has run out.");
    const host = this.players.get(from);
    if (!yes) return host && this.hooks.notice(from, `${me.name} said no to ${row.name}.`);
    if (this.here.has(id)) return this.hooks.notice(id, "Leave your guild first.");
    if (db.guildSize(row.id) >= GUILD_MAX) return this.hooks.notice(id, `${row.name} is full.`);
    db.joinGuild(row.id, account);
    this.here.set(id, row.id);
    me.guild = row.name;
    me.emblem = row.emblem;
    for (const m of this.online(row.id)) {
      this.hooks.notice(m, m === id ? `You joined ${row.name}! Open it with G, and type /g and a message to talk to it.` : `🛡 ${me.name} joined the guild.`);
    }
    if (row.notice) this.hooks.notice(id, `🛡 ${row.name}: ${row.notice}`);
    this.sendAll(row.id);
  }

  /** `id` leaves their guild. The leader may only leave last, which closes the guild. */
  leave(id: string) {
    const me = this.mine(id);
    const g = this.here.get(id);
    if (!me || g === undefined) return;
    const row = db.guild(g)!;
    const size = db.guildSize(g);
    if (me.rank === GuildRank.Leader && size > 1) return this.hooks.notice(id, "You lead the guild: make someone else the leader first, or remove everyone to close it.");
    db.leaveGuild(me.accountId);
    this.out(id);
    if (size <= 1) {
      db.deleteGuild(g);
      this.hooks.notice(id, `You closed ${row.name}.`);
      return;
    }
    this.hooks.notice(id, `You left ${row.name}.`);
    const name = this.players.get(id)?.name ?? "Someone";
    for (const m of this.online(g)) this.hooks.notice(m, `🛡 ${name} left the guild.`);
    this.sendAll(g);
  }

  /** The leader removes anyone; an officer removes members. Works on members who aren't here too. */
  kick(by: string, accountId: number) {
    const me = this.mine(by);
    const g = this.here.get(by);
    if (!me || g === undefined || accountId === me.accountId) return;
    const them = db.guildMembers(g).find((m) => m.accountId === accountId);
    if (!them) return;
    if (me.rank < GuildRank.Officer || them.rank >= me.rank) return this.hooks.notice(by, `You can't remove ${them.name}.`);
    db.leaveGuild(accountId);
    const s = this.hooks.sessionOf(accountId);
    if (s && this.here.get(s) === g) {
      this.out(s);
      this.hooks.notice(s, `You were removed from ${db.guild(g)!.name}.`);
    }
    for (const m of this.online(g)) this.hooks.notice(m, `🛡 ${them.name} was removed from the guild.`);
    this.sendAll(g);
  }

  /** The leader makes a member an officer, or an officer a member again. */
  setRank(by: string, accountId: number, rank: GuildRank) {
    const me = this.mine(by);
    const g = this.here.get(by);
    if (!me || g === undefined || me.rank !== GuildRank.Leader || rank === GuildRank.Leader) return;
    const them = db.guildMembers(g).find((m) => m.accountId === accountId);
    if (!them || them.rank === GuildRank.Leader || them.rank === rank) return;
    db.setGuildRank(accountId, rank);
    for (const m of this.online(g)) this.hooks.notice(m, `🛡 ${them.name} is ${rank === GuildRank.Officer ? "now an officer" : "a member again"}.`);
    this.sendAll(g);
  }

  /** The leader hands the guild to another member, and becomes an officer. */
  lead(by: string, accountId: number) {
    const me = this.mine(by);
    const g = this.here.get(by);
    if (!me || g === undefined || me.rank !== GuildRank.Leader || accountId === me.accountId) return;
    const them = db.guildMembers(g).find((m) => m.accountId === accountId);
    if (!them) return;
    db.passGuild(me.accountId, accountId);
    for (const m of this.online(g)) this.hooks.notice(m, `🛡 ${them.name} leads the guild now.`);
    this.sendAll(g);
  }

  /** The leader or an officer sets the notice every member sees. */
  setNotice(by: string, raw: unknown) {
    const me = this.mine(by);
    const g = this.here.get(by);
    if (!me || g === undefined) return;
    if (me.rank < GuildRank.Officer) return this.hooks.notice(by, "Only your guild's leader and officers can change the notice.");
    const text = cleanNotice(raw);
    db.setGuildNotice(g, text);
    const name = this.players.get(by)?.name ?? "";
    for (const m of this.online(g)) this.hooks.notice(m, text ? `🛡 ${name} set the guild notice: ${text}` : `🛡 ${name} cleared the guild notice.`);
    this.sendAll(g);
  }

  /** A member gives gold to the purse. It's the guild's now: gold never comes back out, except to pay for what the guild needs. */
  give(id: string, gold: unknown) {
    const g = this.here.get(id);
    const account = this.hooks.accountOf(id);
    const p = this.players.get(id);
    if (g === undefined || account === undefined || !p) return this.hooks.notice(id, "You're not in a guild.");
    if (!Number.isSafeInteger(gold) || (gold as number) < GUILD_GIFT_MIN) return this.hooks.notice(id, `The smallest gift is ${GUILD_GIFT_MIN} gold.`);
    const amount = gold as number;
    if (!this.hooks.pay(id, amount, "That gift")) return;
    db.giveToPurse(g, account, p.name, amount);
    this.hooks.gave(id, amount);
    for (const m of this.online(g)) this.hooks.notice(m, `🛡 ${p.name} gave ${amount.toLocaleString("en-US")} gold to the guild's purse.`);
    this.sendAll(g);
  }

  /** The guild window was opened: fresh contents (levels change all the time). */
  refresh(id: string) {
    const g = this.here.get(id);
    if (g === undefined) return this.hooks.send(id, "guild", null);
    this.hooks.send(id, "guild", this.message(g, id));
  }

  /** Invites run out. */
  tick(now: number) {
    for (const [to, inv] of this.invites) if (now > inv.until) this.invites.delete(to);
  }

  // ---------------------------------------------------------------- inside

  /** Your own row in your guild. */
  private mine(id: string) {
    const g = this.here.get(id);
    const account = this.hooks.accountOf(id);
    if (g === undefined || account === undefined) return undefined;
    return db.guildMembers(g).find((m) => m.accountId === account);
  }

  /** Off the guild's books here: no name over the head, no window. */
  private out(id: string) {
    this.here.delete(id);
    const p = this.players.get(id);
    if (p) {
      p.guild = "";
      p.emblem = 0;
    }
    this.hooks.send(id, "guild", null);
  }

  private message(g: number, to: string): GuildMessage | null {
    const row = db.guild(g);
    const account = this.hooks.accountOf(to);
    if (!row || account === undefined) return null;
    const members = db.guildMembers(g).map((m) => {
      const s = this.hooks.sessionOf(m.accountId);
      const p = s && this.here.get(s) === g ? this.players.get(s) : undefined;
      return { id: m.accountId, name: p?.name ?? m.name, cls: p?.cls ?? m.cls, lv: p?.lv ?? m.lv, rank: m.rank, online: Boolean(p), seen: p ? 0 : m.seen, given: m.given };
    });
    const me = members.find((m) => m.id === account);
    return {
      id: row.id,
      name: row.name,
      emblem: row.emblem,
      notice: row.notice,
      me: account,
      rank: me?.rank ?? GuildRank.Member,
      purse: row.purse,
      log: db.purseLog(g),
      sieges: row.sieges,
      crystals: row.crystals,
      members: sortMembers(members),
    };
  }

  /** Every member who's here gets the window's contents. */
  sendAll(g: number) {
    for (const m of this.online(g)) this.hooks.send(m, "guild", this.message(g, m));
  }
}
