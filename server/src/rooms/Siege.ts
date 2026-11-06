import type { MapSchema } from "@colyseus/schema";
import type { Player } from "./WorldState";
import type { Combat } from "./Combat";
import { db, type GuildRow } from "../db";
import { GuildRank, emblemOf } from "../../../shared/guild";
import { ITEMS, isItemId, type ItemId } from "../../../shared/items";
import { MONSTERS } from "../../../shared/rpg";
import { CASTLE_NAME, GUARDIAN_COST, GUARDIAN_POSTS, SIEGE_MS, TRIBUTE, campSpot, siegeAt, tributeDay, type CastleGuards, type TributeResult } from "../../../shared/siege";
import { CASTLE_CAMP, inCastle } from "../../../shared/town";

// Guild wars: Crownhold under siege twice a week (see shared/siege.ts). This
// keeps the schedule (and the test commands that bend it), who holds the
// castle (saved), who may step inside during a siege, what happens when the
// crystal breaks, the end of the siege, the daily tribute and the guardians.
// Combat runs the fighting itself; its `siege` and `castleGuild` are set from
// here.

const CASTLE_ID = "crownhold";
/** Who holds the castle is read again this often (a guild that closes leaves it without a lord). */
const READ_MS = 10_000;

export interface SiegeHooks {
  /** A line for the whole town. */
  news(text: string): void;
  notice(id: string, text: string): void;
  /** Moves a player somewhere else (the room fades them across). */
  move(id: string, x: number, y: number): void;
  accountOf(id: string): number | undefined;
  /** The purse changed: the members here get the news. */
  purseChanged(guild: number): void;
}

/** What the clients see of the castle (fields on the room's synced state). */
export interface CastleState {
  castle: string;
  castleEmblem: number;
  siege: boolean;
  siegeEnds: number;
  siegeNext: number;
}

const gold = (n: number) => n.toLocaleString("en-US");
const flag = (g: { name: string; emblem: number }) => `${emblemOf(g.emblem).symbol} ${g.name}`;

export class Siege {
  private on = false;
  /** Started or stopped by hand (testing), until `forcedEnds`. */
  private forced?: boolean;
  private forcedEnds = 0;
  private holder?: GuildRow;
  /** The posts with a guardian on them (saved). */
  private posts = new Set<number>();
  private readAt = 0;
  /** When each player was last told they can't go in (no spamming them while they push at the gate). */
  private toldAt = new Map<string, number>();

  constructor(
    private state: CastleState,
    private players: MapSchema<Player>,
    private combat: Combat,
    private hooks: SiegeHooks,
  ) {
    this.read(true);
    if (!this.holder) return;
    for (const post of db.castleGuardians(CASTLE_ID)) {
      if (!GUARDIAN_POSTS[post] || this.posts.has(post)) continue;
      this.posts.add(post);
      this.combat.spawnGuardian(post);
    }
  }

  /** The guild holding the castle, from the database. A new holder (or none) means the old guards leave. */
  private read(first = false) {
    const before = this.holder?.id;
    this.holder = db.castleHolder(CASTLE_ID);
    if (!first && this.holder?.id !== before) {
      this.posts.clear();
      this.combat.clearGuardians();
      db.setCastleGuardians(CASTLE_ID, []);
    }
    this.combat.castleGuild = this.holder?.name ?? "";
    this.state.castle = this.holder?.name ?? "";
    this.state.castleEmblem = this.holder?.emblem ?? 0;
  }

  tick(now: number) {
    if (now >= this.readAt) {
      this.readAt = now + READ_MS;
      this.read();
    }
    if (this.forced !== undefined && now >= this.forcedEnds) this.forced = undefined;
    const s = siegeAt(now);
    const on = this.forced ?? s.on;
    if (on && !this.on) this.start();
    else if (!on && this.on) this.end();
    this.state.siege = this.on;
    this.state.siegeEnds = this.on ? (this.forced ? this.forcedEnds : s.end) : 0;
    this.state.siegeNext = this.on ? 0 : this.forced === false ? siegeAt(Math.max(now, s.end)).start : s.start;
  }

  /** Testing: start or stop a siege now (it then runs an hour, or stays off until the next one); undefined goes back to the schedule. */
  force(on: boolean | undefined, now: number) {
    const s = siegeAt(now);
    this.forced = on;
    // Off stops the siege on now (a scheduled one stays off until its hour is up), never the next one.
    this.forcedEnds = on ? now + SIEGE_MS : on === false && s.on ? s.end : now;
    this.tick(now);
  }

  /** May `id` step from (x0, y0) to (x1, y1)? During a siege, only guild members go into the castle. */
  mayEnter(id: string, x0: number, y0: number, x1: number, y1: number): boolean {
    if (!this.on || !inCastle(x1, y1) || inCastle(x0, y0) || this.players.get(id)?.guild) return true;
    const now = Date.now();
    if (now - (this.toldAt.get(id) ?? 0) > 5000) {
      this.toldAt.set(id, now);
      this.hooks.notice(id, `${CASTLE_NAME} is under siege: only guild members may go in.`);
    }
    return false;
  }

  /** The crystal broke: the castle is the breaker's guild's, and everyone else inside is thrown out. */
  captured(by: string) {
    const p = this.players.get(by);
    const account = this.hooks.accountOf(by);
    const row = account === undefined ? undefined : db.guildOf(account);
    if (!p || !row) return;
    db.setCastleHolder(CASTLE_ID, row.id);
    db.addCrystal(row.id);
    this.read();
    this.hooks.news(`⚔ ${p.name} broke the crystal: ${flag(row)} takes ${CASTLE_NAME}!`);
    this.clear(row.name, `${CASTLE_NAME} fell to ${flag(row)}! You're thrown out of the castle.`);
  }

  /** Everyone inside the walls not in `keep` (a guild name; "" = nobody stays) goes out to the camp. */
  private clear(keep: string, why: string) {
    let n = 0;
    this.players.forEach((p, id) => {
      if (!inCastle(p.x, p.y) || (keep && p.guild === keep)) return;
      const spot = campSpot(CASTLE_CAMP, n++);
      this.hooks.move(id, spot.x, spot.y);
      this.hooks.notice(id, why);
    });
  }

  private start() {
    this.on = true;
    this.combat.siege = true;
    this.combat.mendCastle();
    this.read();
    this.hooks.news(`⚔ The siege of ${CASTLE_NAME} has begun! Guilds, to the castle: break the crystal and it's yours. ${this.holder ? `${flag(this.holder)} holds it.` : "Nobody holds it yet."}`);
    // Only guilds fight in a siege: anyone else inside steps out.
    let n = 0;
    this.players.forEach((p, id) => {
      if (!inCastle(p.x, p.y) || p.guild) return;
      const spot = campSpot(CASTLE_CAMP, n++);
      this.hooks.move(id, spot.x, spot.y);
      this.hooks.notice(id, `A siege has begun: only guild members may stay inside ${CASTLE_NAME}.`);
    });
  }

  private end() {
    this.on = false;
    this.combat.siege = false;
    this.combat.mendCastle();
    this.read();
    const h = this.holder;
    if (!h) return this.hooks.news(`🏰 The siege is over, and ${CASTLE_NAME} still has no lord.`);
    const won = db.addSiegeWin(h.id);
    this.hooks.news(`🏰 The siege is over: ${flag(h)} holds ${CASTLE_NAME}! Sieges won: ${won}.`);
    this.players.forEach((p, id) => {
      if (p.guild === h.name) this.combat.grantTitle(id, "castleLord");
    });
  }

  /** Why `id` can't hire a guardian right now ("": they can). */
  private hireBlock(id: string): string {
    const h = this.holder;
    if (!h) return `Nobody holds ${CASTLE_NAME} yet.`;
    const account = this.hooks.accountOf(id);
    const row = account === undefined ? undefined : db.guildOf(account);
    if (!row || row.id !== h.id) return `Only ${flag(h)}'s leader and officers can hire guardians here.`;
    if (row.rank < GuildRank.Officer) return "Only your guild's leader and officers can hire guardians.";
    if (this.on) return "Guardians can't be hired during a siege.";
    return "";
  }

  /** What's in the castle guild's purse, for its own members' eyes only. */
  private purse(id: string): number {
    const account = this.hooks.accountOf(id);
    const row = account === undefined ? undefined : db.guildOf(account);
    return row && row.id === this.holder?.id ? row.purse : 0;
  }

  /** The Herald's list of guardians, for `id`. */
  guards(id: string): CastleGuards {
    return { posts: [...this.posts].sort((a, b) => a - b), why: this.hireBlock(id), purse: this.purse(id) };
  }

  /** The leader or an officer of the castle's guild hires a guardian for a post, out of the guild's purse. */
  hire(id: string, post: number) {
    const p = GUARDIAN_POSTS[post];
    const h = this.holder;
    if (!p) return;
    const why = this.hireBlock(id);
    if (why || !h) return this.hooks.notice(id, why);
    if (this.posts.has(post)) return this.hooks.notice(id, "That post already has a guardian.");
    const name = MONSTERS[p.kind].name;
    const cost = GUARDIAN_COST[p.kind];
    const by = this.players.get(id)?.name ?? "Someone";
    if (!db.spendPurse(h.id, by, `hired a ${name}`, cost)) {
      return this.hooks.notice(id, `A ${name} costs ${gold(cost)} gold, and your guild's purse holds ${gold(this.purse(id))}. Any member can give gold from the guild window (G).`);
    }
    this.posts.add(post);
    db.setCastleGuardians(CASTLE_ID, [...this.posts]);
    this.combat.spawnGuardian(post);
    this.players.forEach((m, member) => {
      if (m.guild === h.name) this.hooks.notice(member, `🛡 ${by} hired a ${name} for the ${p.where.toLowerCase()}.`);
    });
    this.hooks.purseChanged(h.id);
  }

  /** A guardian fell: its post stays empty until someone hires another. */
  guardianDown(post: number) {
    this.posts.delete(post);
    db.setCastleGuardians(CASTLE_ID, [...this.posts]);
  }

  /** The Herald pays a member of the castle's guild their tribute, once a day. */
  tribute(id: string): TributeResult {
    const account = this.hooks.accountOf(id);
    const h = this.holder;
    if (!h) return { ok: false, text: `Nobody holds ${CASTLE_NAME} yet. Take it in a siege, and the tribute is your guild's.` };
    const row = account === undefined ? undefined : db.guildOf(account);
    if (!row || row.id !== h.id) return { ok: false, text: `The tribute belongs to ${flag(h)}, who hold ${CASTLE_NAME}. Take the castle from them in a siege!` };
    const day = tributeDay(Date.now());
    if (db.tributeDay(account!) === day) return { ok: false, text: "You've collected today's tribute. Come back tomorrow." };
    const coins = TRIBUTE.gold[0] + Math.floor(Math.random() * (TRIBUTE.gold[1] - TRIBUTE.gold[0] + 1));
    const items = TRIBUTE.items.filter(([it]) => isItemId(it)).map(([it, n]) => [it as ItemId, n] as [ItemId, number]);
    if (Math.random() < TRIBUTE.extraCrystal) items.push(["starCrystal", 1]);
    const cards = (Object.keys(ITEMS) as ItemId[]).filter((k) => ITEMS[k].kind === "card" && ITEMS[k].rarity !== "legendary");
    if (Math.random() < TRIBUTE.card) items.push([cards[Math.floor(Math.random() * cards.length)], 1]);
    if (!this.combat.giveTribute(id, coins, items, TRIBUTE.slots)) return { ok: false, text: `Make room in your bag first: the tribute needs ${TRIBUTE.slots} free slots.` };
    db.setTributeDay(account!, day);
    db.addToPurse(h.id, TRIBUTE.purse);
    this.hooks.purseChanged(h.id);
    const what = items.map(([it, n]) => (n > 1 ? `${ITEMS[it].name} ×${n}` : ITEMS[it].name)).join(", ");
    return { ok: true, text: `Today's tribute: ${gold(coins)} gold, ${what}. And ${gold(TRIBUTE.purse)} gold for your guild's purse.` };
  }
}
