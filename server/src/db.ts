import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RATING_START, ratingChange, type ArenaRow } from "../../shared/duels";
import { cleanStack, itemName, type ItemStack } from "../../shared/items";
import { cleanWares, stackText, type ShopWare } from "../../shared/vending";
import type { WildBoard, WildRow } from "../../shared/pvp";
import type { GuildRank } from "../../shared/guild";

// Saved game data, in one SQLite file: no database server to run, and a backup
// is a copy of the file. Holds Gattchaa-linked accounts, their sign-in
// sessions, their characters' progress, the player shops open in town (and
// what they sell), mail: gold and items waiting for their owner, and guilds.
//
// Default file: server/data/town.db (same relative path from src/ and build/).
// DB_PATH overrides it. Live backup: sqlite3 server/data/town.db ".backup town-backup.db"

const SESSION_DAYS = 30;

export interface Account {
  id: number;
  gattchaaId: string;
  displayName: string;
  /** Character name and look last used in town ("" until the first visit). */
  name: string;
  look: string;
}

export interface ShopRow {
  accountId: number;
  /** Random public id (SHOP_ID_RE), used in links and the synced state. */
  id: string;
  /** Where the seller sits (feet), in pixels. */
  x: number;
  y: number;
  title: string;
  openedAt: number;
  /** When the shop closes because its owner is away; null while they're in town. */
  expiresAt: number | null;
  /** Things from the bag for gold, as JSON (null = cards only). */
  wares: string | null;
}

/** Gold or an item waiting for an account: a sale while they were away, or their shop's leftovers. */
export interface Mail {
  id: number;
  gold: number;
  item: ItemStack | null;
  /** A sale: "Mira bought Iron Ingot ×5" ("" for leftovers). */
  note: string;
}

/** What buying from a shop did: the buyer gets `item`, the seller (an account) `gold`. */
export interface Sale {
  item: ItemStack;
  gold: number;
  seller: number;
  /** What's left in the shop afterwards. */
  wares: ShopWare[];
}

/** A guild, and someone's place in it. */
export interface GuildRow {
  id: number;
  name: string;
  emblem: number;
  notice: string;
}
export interface GuildMemberRow {
  accountId: number;
  name: string;
  cls: string;
  lv: number;
  rank: GuildRank;
  /** When they were last in town or last saved (ms). */
  seen: number;
}

/** A character's progress: class, level and what they carry. */
export interface Progress {
  cls: string;
  lv: number;
  exp: number;
  /** null = full (a fresh character, or saved at full health). */
  hp: number | null;
  mp: number | null;
  gold: number;
  /** The bag and worn equipment as JSON (null = nothing yet). Checked item by item when loaded. */
  bag: string | null;
  gear: string | null;
  /** Learned skills and their levels as JSON (null = none). Checked against the class and level when loaded. */
  skills: string | null;
  /** What they've done (kills, cards found, upgrades…) and their titles, as JSON (null = nothing yet). */
  deeds: string | null;
  titles: string | null;
}

/** Each entry upgrades the schema by one version (PRAGMA user_version). Append only. */
const MIGRATIONS = [
  `CREATE TABLE accounts (
     id INTEGER PRIMARY KEY,
     gattchaa_id TEXT NOT NULL UNIQUE,
     display_name TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     look TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     seen_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_account ON sessions(account_id);
   CREATE TABLE shops (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     stall TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL,
     opened_at INTEGER NOT NULL,
     expires_at INTEGER
   );`,
  // v2: shops open anywhere in town instead of on numbered mats, so they keep a position.
  `DROP TABLE shops;
   CREATE TABLE shops (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     id TEXT NOT NULL UNIQUE,
     x INTEGER NOT NULL,
     y INTEGER NOT NULL,
     title TEXT NOT NULL,
     opened_at INTEGER NOT NULL,
     expires_at INTEGER
   );`,
  // v3: leveling. One character per account.
  `CREATE TABLE characters (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     class TEXT NOT NULL DEFAULT 'novice',
     level INTEGER NOT NULL DEFAULT 1,
     exp INTEGER NOT NULL DEFAULT 0,
     hp INTEGER,
     mp INTEGER,
     gold INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   );`,
  // v4: items. The bag and equipment are small JSON documents.
  `ALTER TABLE characters ADD COLUMN bag TEXT;
   ALTER TABLE characters ADD COLUMN gear TEXT;`,
  // v5: jobs and skills. Skill levels are a small JSON document.
  `ALTER TABLE characters ADD COLUMN skills TEXT;`,
  // v6: titles. Deeds and titles are small JSON documents; pioneers are the
  // first few accounts to reach each level cap, numbered in order.
  `ALTER TABLE characters ADD COLUMN deeds TEXT;
   ALTER TABLE characters ADD COLUMN titles TEXT;
   CREATE TABLE pioneers (
     cap INTEGER NOT NULL,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     rank INTEGER NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (cap, account_id)
   );`,
  // v7: the arena ranking, one row per account after its first ranked duel.
  `CREATE TABLE arena (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     rating INTEGER NOT NULL,
     wins INTEGER NOT NULL DEFAULT 0,
     losses INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX arena_rating ON arena (rating DESC);`,
  // v8: shops sell things from the bag for gold. The stock is a small JSON
  // document on the shop; mail holds what's owed to someone who isn't here.
  `ALTER TABLE shops ADD COLUMN wares TEXT;
   CREATE TABLE mail (
     id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     gold INTEGER NOT NULL DEFAULT 0,
     item TEXT,
     note TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL
   );
   CREATE INDEX mail_account ON mail (account_id);`,
  // v9: Sable's board in the Wildlands: players beaten (all time, and this week), Outlaws among them, bounty gold.
  `CREATE TABLE wildlands (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     wins INTEGER NOT NULL DEFAULT 0,
     bounties INTEGER NOT NULL DEFAULT 0,
     gold INTEGER NOT NULL DEFAULT 0,
     week INTEGER NOT NULL DEFAULT 0,
     week_wins INTEGER NOT NULL DEFAULT 0,
     week_bounties INTEGER NOT NULL DEFAULT 0,
     week_gold INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX wildlands_wins ON wildlands (wins DESC);
   CREATE INDEX wildlands_week ON wildlands (week, week_wins DESC);`,
  // v10: guilds. Names are unique whatever their case; a member is an account,
  // in one guild at most, with a rank (0 member, 1 officer, 2 leader).
  `CREATE TABLE guilds (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     emblem INTEGER NOT NULL DEFAULT 0,
     notice TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE guild_members (
     account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
     rank INTEGER NOT NULL DEFAULT 0,
     joined_at INTEGER NOT NULL
   );
   CREATE INDEX guild_members_guild ON guild_members (guild_id);`,
];

const ACCOUNT_COLS = "id, gattchaa_id AS gattchaaId, display_name AS displayName, name, look";
const PROGRESS_COLS = "class AS cls, level AS lv, exp, hp, mp, gold, bag, gear, skills, deeds, titles";
const SHOP_COLS = "account_id AS accountId, id, x, y, title, opened_at AS openedAt, expires_at AS expiresAt, wares";

/** Sessions are stored hashed: a leaked database file doesn't sign anyone in. */
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const parse = (json: string | null | undefined): unknown => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};
/** A shop's saved stock. */
export const parseWares = (json: string | null | undefined) => cleanWares(parse(json));

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const newShopId = () => Array.from({ length: 10 }, () => ID_CHARS[crypto.randomInt(ID_CHARS.length)]).join("");

export class Db {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;");
    this.migrate();
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }

  private migrate() {
    const { user_version } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = user_version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ------------------------------------------------------------ accounts

  /** Finds or creates the account for a Gattchaa user and starts a session. Returns the session token. */
  signIn(gattchaaId: string, displayName: string): { account: Account; token: string } {
    const now = Date.now();
    const token = crypto.randomBytes(32).toString("base64url");
    return this.transaction(() => {
      const account = this.db
        .prepare(
          `INSERT INTO accounts (gattchaa_id, display_name, created_at, seen_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(gattchaa_id) DO UPDATE SET display_name = excluded.display_name, seen_at = excluded.seen_at
           RETURNING ${ACCOUNT_COLS}`,
        )
        .get(gattchaaId, displayName, now, now) as unknown as Account;
      this.db
        .prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)")
        .run(hashToken(token), account.id, now + SESSION_DAYS * 86_400_000);
      return { account, token };
    });
  }

  accountForToken(token: string): Account | undefined {
    if (!token || token.length > 100) return undefined;
    return this.db
      .prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = (SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ?)`)
      .get(hashToken(token), Date.now()) as Account | undefined;
  }

  account(id: number): Account | undefined {
    return this.db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = ?`).get(id) as Account | undefined;
  }

  signOut(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }

  saveCharacter(accountId: number, name: string, look: string) {
    this.db.prepare("UPDATE accounts SET name = ?, look = ?, seen_at = ? WHERE id = ?").run(name, look, Date.now(), accountId);
  }

  // ------------------------------------------------------------ characters

  /** Saved progress, or undefined for an account that has never fought. */
  progress(accountId: number): Progress | undefined {
    return this.db.prepare(`SELECT ${PROGRESS_COLS} FROM characters WHERE account_id = ?`).get(accountId) as Progress | undefined;
  }

  saveProgress(accountId: number, p: Progress) {
    this.db
      .prepare(
        `INSERT INTO characters (account_id, class, level, exp, hp, mp, gold, bag, gear, skills, deeds, titles, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET class = excluded.class, level = excluded.level, exp = excluded.exp,
           hp = excluded.hp, mp = excluded.mp, gold = excluded.gold, bag = excluded.bag, gear = excluded.gear,
           skills = excluded.skills, deeds = excluded.deeds, titles = excluded.titles, updated_at = excluded.updated_at`,
      )
      .run(accountId, p.cls, p.lv, p.exp, p.hp, p.mp, p.gold, p.bag, p.gear, p.skills, p.deeds, p.titles, Date.now());
  }

  // ------------------------------------------------------------ the arena

  /** A ranked duel's result: the winner takes rating points from the loser. Returns [before, after] for each. */
  arenaResult(winnerId: number, loserId: number): { winner: [number, number]; loser: [number, number] } {
    return this.transaction(() => {
      const rating = (id: number) =>
        (this.db.prepare("SELECT rating FROM arena WHERE account_id = ?").get(id) as { rating: number } | undefined)?.rating ?? RATING_START;
      const w = rating(winnerId);
      const l = rating(loserId);
      const change = ratingChange(w, l);
      const upsert = this.db.prepare(
        `INSERT INTO arena (account_id, rating, wins, losses, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET rating = excluded.rating, wins = wins + excluded.wins,
           losses = losses + excluded.losses, updated_at = excluded.updated_at`,
      );
      const now = Date.now();
      upsert.run(winnerId, w + change, 1, 0, now);
      upsert.run(loserId, Math.max(0, l - change), 0, 1, now);
      return { winner: [w, w + change], loser: [l, Math.max(0, l - change)] };
    });
  }

  /** The best `n` in the arena, and (for a signed-in player) their own line and place. */
  arenaBoard(n: number, accountId?: number): { top: ArenaRow[]; me?: ArenaRow & { rank: number } } {
    const cols = "COALESCE(NULLIF(a.name, ''), a.display_name) AS name, r.rating, r.wins, r.losses";
    const top = this.db
      .prepare(`SELECT ${cols} FROM arena r JOIN accounts a ON a.id = r.account_id ORDER BY r.rating DESC, r.wins DESC, r.updated_at ASC LIMIT ?`)
      .all(n) as unknown as ArenaRow[];
    if (accountId === undefined) return { top };
    const mine = this.db.prepare(`SELECT ${cols} FROM arena r JOIN accounts a ON a.id = r.account_id WHERE r.account_id = ?`).get(accountId) as
      | ArenaRow
      | undefined;
    if (!mine) return { top };
    const { above } = this.db.prepare("SELECT COUNT(*) AS above FROM arena WHERE rating > ?").get(mine.rating) as { above: number };
    return { top, me: { ...mine, rank: above + 1 } };
  }

  // ------------------------------------------------------------ the Wildlands

  /**
   * A player beaten in the Wildlands (one that counts: the same pair only once
   * in a while). A new week starts the weekly count again. Returns the week's
   * leader before and after, and the winner's wins this week.
   */
  wildWin(accountId: number, outlaw: boolean, bounty: number, week: number): { before?: number; after?: number; weekWins: number } {
    return this.transaction(() => {
      const leader = () =>
        (this.db.prepare("SELECT account_id AS id FROM wildlands WHERE week = ? ORDER BY week_wins DESC, week_bounties DESC, updated_at ASC LIMIT 1").get(week) as
          | { id: number }
          | undefined)?.id;
      const before = leader();
      const b = outlaw ? 1 : 0;
      this.db
        .prepare(
          `INSERT INTO wildlands (account_id, wins, bounties, gold, week, week_wins, week_bounties, week_gold, updated_at) VALUES (?, 1, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET wins = wins + 1, bounties = bounties + excluded.bounties, gold = gold + excluded.gold,
             week_wins = CASE WHEN week = excluded.week THEN week_wins + 1 ELSE 1 END,
             week_bounties = CASE WHEN week = excluded.week THEN week_bounties ELSE 0 END + excluded.week_bounties,
             week_gold = CASE WHEN week = excluded.week THEN week_gold ELSE 0 END + excluded.week_gold,
             week = excluded.week, updated_at = excluded.updated_at`,
        )
        .run(accountId, b, bounty, week, b, bounty, Date.now());
      const { weekWins } = this.db.prepare("SELECT week_wins AS weekWins FROM wildlands WHERE account_id = ?").get(accountId) as { weekWins: number };
      return { before, after: leader(), weekWins };
    });
  }

  /** The best `n` hunters this week and of all time, and (for a signed-in player) their own lines and places. */
  wildBoard(n: number, week: number, accountId?: number): Pick<WildBoard, "week" | "all" | "me"> {
    const name = "COALESCE(NULLIF(a.name, ''), a.display_name) AS name";
    const allCols = `${name}, w.wins, w.bounties, w.gold`;
    const weekCols = `${name}, w.week_wins AS wins, w.week_bounties AS bounties, w.week_gold AS gold`;
    const from = "FROM wildlands w JOIN accounts a ON a.id = w.account_id";
    const all = this.db.prepare(`SELECT ${allCols} ${from} ORDER BY w.wins DESC, w.bounties DESC, w.updated_at ASC LIMIT ?`).all(n) as unknown as WildRow[];
    const weekly = this.db
      .prepare(`SELECT ${weekCols} ${from} WHERE w.week = ? ORDER BY w.week_wins DESC, w.week_bounties DESC, w.updated_at ASC LIMIT ?`)
      .all(week, n) as unknown as WildRow[];
    if (accountId === undefined) return { week: weekly, all };
    // Your place counts everyone the board puts ahead of you, with the same tie-breaks.
    const me: NonNullable<WildBoard["me"]> = {};
    const mine = this.db.prepare(`SELECT ${allCols}, w.updated_at AS at ${from} WHERE w.account_id = ?`).get(accountId) as (WildRow & { at: number }) | undefined;
    if (mine) {
      const { above } = this.db
        .prepare("SELECT COUNT(*) AS above FROM wildlands WHERE wins > ? OR (wins = ? AND (bounties > ? OR (bounties = ? AND updated_at < ?)))")
        .get(mine.wins, mine.wins, mine.bounties, mine.bounties, mine.at) as { above: number };
      const { at: _, ...row } = mine;
      me.all = { ...row, rank: above + 1 };
    }
    const mineWeek = this.db.prepare(`SELECT ${weekCols}, w.updated_at AS at ${from} WHERE w.account_id = ? AND w.week = ?`).get(accountId, week) as
      | (WildRow & { at: number })
      | undefined;
    if (mineWeek) {
      const { above } = this.db
        .prepare(
          "SELECT COUNT(*) AS above FROM wildlands WHERE week = ? AND (week_wins > ? OR (week_wins = ? AND (week_bounties > ? OR (week_bounties = ? AND updated_at < ?))))",
        )
        .get(week, mineWeek.wins, mineWeek.wins, mineWeek.bounties, mineWeek.bounties, mineWeek.at) as { above: number };
      const { at: _, ...row } = mineWeek;
      me.week = { ...row, rank: above + 1 };
    }
    return { week: weekly, all, me };
  }

  /**
   * Makes an account one of the first `max` to reach a level cap, if there's
   * still room. Returns its place (1 = first), or undefined when the places are taken.
   */
  claimPioneer(cap: number, accountId: number, max: number): number | undefined {
    return this.transaction(() => {
      const mine = this.db.prepare("SELECT rank FROM pioneers WHERE cap = ? AND account_id = ?").get(cap, accountId) as { rank: number } | undefined;
      if (mine) return mine.rank;
      const { n } = this.db.prepare("SELECT COUNT(*) AS n FROM pioneers WHERE cap = ?").get(cap) as { n: number };
      if (n >= max) return undefined;
      this.db.prepare("INSERT INTO pioneers (cap, account_id, rank, at) VALUES (?, ?, ?, ?)").run(cap, accountId, n + 1, Date.now());
      return n + 1;
    });
  }

  // ------------------------------------------------------------ shops

  // ---------------------------------------------------------------- guilds

  /** The guild an account is in, and its rank there. */
  guildOf(accountId: number): (GuildRow & { rank: GuildRank }) | undefined {
    return this.db
      .prepare("SELECT g.id, g.name, g.emblem, g.notice, m.rank FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.account_id = ?")
      .get(accountId) as (GuildRow & { rank: GuildRank }) | undefined;
  }

  guild(id: number): GuildRow | undefined {
    return this.db.prepare("SELECT id, name, emblem, notice FROM guilds WHERE id = ?").get(id) as GuildRow | undefined;
  }

  /** Is this name taken (whatever its case)? */
  guildNameTaken(name: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM guilds WHERE name = ?").get(name));
  }

  /** A new guild, with its founder as leader. Undefined if the name was taken in the meantime. */
  createGuild(name: string, emblem: number, founder: number): number | undefined {
    return this.transaction(() => {
      if (this.guildNameTaken(name)) return undefined;
      const now = Date.now();
      const id = Number(this.db.prepare("INSERT INTO guilds (name, emblem, notice, created_at) VALUES (?, ?, '', ?)").run(name, emblem, now).lastInsertRowid);
      this.db.prepare("INSERT INTO guild_members (account_id, guild_id, rank, joined_at) VALUES (?, ?, 2, ?)").run(founder, id, now);
      return id;
    });
  }

  /** Everyone in a guild, with their character's name, job, level and when they were last seen. */
  guildMembers(guildId: number): GuildMemberRow[] {
    return this.db
      .prepare(
        `SELECT m.account_id AS accountId, a.name, COALESCE(c.class, 'novice') AS cls, COALESCE(c.level, 1) AS lv, m.rank,
                MAX(a.seen_at, COALESCE(c.updated_at, 0)) AS seen
           FROM guild_members m JOIN accounts a ON a.id = m.account_id LEFT JOIN characters c ON c.account_id = m.account_id
          WHERE m.guild_id = ?`,
      )
      .all(guildId) as unknown as GuildMemberRow[];
  }

  guildSize(guildId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?").get(guildId) as { n: number }).n;
  }

  joinGuild(guildId: number, accountId: number) {
    this.db.prepare("INSERT INTO guild_members (account_id, guild_id, rank, joined_at) VALUES (?, ?, 0, ?)").run(accountId, guildId, Date.now());
  }

  leaveGuild(accountId: number) {
    this.db.prepare("DELETE FROM guild_members WHERE account_id = ?").run(accountId);
  }

  setGuildRank(accountId: number, rank: GuildRank) {
    this.db.prepare("UPDATE guild_members SET rank = ? WHERE account_id = ?").run(rank, accountId);
  }

  /** The leader hands over: they become an officer, the other the leader. */
  passGuild(from: number, to: number) {
    this.transaction(() => {
      this.db.prepare("UPDATE guild_members SET rank = 1 WHERE account_id = ?").run(from);
      this.db.prepare("UPDATE guild_members SET rank = 2 WHERE account_id = ?").run(to);
    });
  }

  setGuildNotice(guildId: number, notice: string) {
    this.db.prepare("UPDATE guilds SET notice = ? WHERE id = ?").run(notice, guildId);
  }

  /** The guild is gone (its members with it). */
  deleteGuild(guildId: number) {
    this.db.prepare("DELETE FROM guilds WHERE id = ?").run(guildId);
  }

  shops(): ShopRow[] {
    return this.db.prepare(`SELECT ${SHOP_COLS} FROM shops`).all() as unknown as ShopRow[];
  }

  shop(id: string): ShopRow | undefined {
    return this.db.prepare(`SELECT ${SHOP_COLS} FROM shops WHERE id = ?`).get(id) as ShopRow | undefined;
  }

  /** Opens a shop with its seller at (x, y), selling `wares`; returns its new id. Throws if the account already has one. */
  openShop(accountId: number, x: number, y: number, title: string, wares: ShopWare[] = []): string {
    const id = newShopId();
    this.db
      .prepare("INSERT INTO shops (account_id, id, x, y, title, opened_at, expires_at, wares) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
      .run(accountId, id, Math.round(x), Math.round(y), title, Date.now(), wares.length ? JSON.stringify(wares) : null);
    return id;
  }

  /** Closes an account's shop. Whatever didn't sell goes back to the seller as mail. */
  closeShop(accountId: number) {
    this.transaction(() => {
      const row = this.db.prepare("SELECT wares FROM shops WHERE account_id = ?").get(accountId) as { wares: string | null } | undefined;
      for (const w of parseWares(row?.wares)) if (w.item.n > 0) this.addMail(accountId, { item: w.item });
      this.db.prepare("DELETE FROM shops WHERE account_id = ?").run(accountId);
    });
  }

  /**
   * Buys up to `n` of ware number `ware` from a shop, if it's still there at
   * the price the buyer saw. The seller's gold goes to their mail. Check the
   * buyer can pay and carry it first, then hand it over.
   */
  buyWare(shopId: string, ware: number, n: number, seen: { item: string; price: number }, buyer: string): Sale | string {
    return this.transaction(() => {
      const row = this.shop(shopId);
      if (!row) return "This shop has just closed.";
      const wares = parseWares(row.wares);
      const w = wares[ware];
      if (!w || w.item.id !== seen.item || w.price !== seen.price) return "That's no longer for sale. Have another look.";
      if (w.item.n <= 0) return "Sold out!";
      const k = Math.min(Math.max(1, Math.floor(n)), w.item.n);
      const gold = w.price * k;
      const item = { ...w.item, n: k };
      w.item.n -= k;
      w.sold += k;
      this.db.prepare("UPDATE shops SET wares = ? WHERE account_id = ?").run(JSON.stringify(wares), row.accountId);
      this.addMail(row.accountId, { gold, note: `${buyer} bought ${stackText(itemName(item), k)}` });
      return { item, gold, seller: row.accountId, wares };
    });
  }

  // ------------------------------------------------------------ mail

  private addMail(accountId: number, m: { gold?: number; item?: ItemStack; note?: string }) {
    this.db
      .prepare("INSERT INTO mail (account_id, gold, item, note, at) VALUES (?, ?, ?, ?, ?)")
      .run(accountId, m.gold ?? 0, m.item ? JSON.stringify(m.item) : null, m.note ?? "", Date.now());
  }

  /** Accounts with mail waiting. */
  mailboxes(): number[] {
    return (this.db.prepare("SELECT DISTINCT account_id AS id FROM mail").all() as { id: number }[]).map((r) => r.id);
  }

  /**
   * Hands an account its mail, oldest first: `take` gives each one to the
   * player and says whether it fit (a full bag leaves items waiting). Taken
   * mail is deleted in the same transaction, so nothing arrives twice.
   */
  deliverMail(accountId: number, take: (m: Mail) => boolean): Mail[] {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT id, gold, item, note FROM mail WHERE account_id = ? ORDER BY id").all(accountId) as {
        id: number;
        gold: number;
        item: string | null;
        note: string;
      }[];
      const taken: Mail[] = [];
      const del = this.db.prepare("DELETE FROM mail WHERE id = ?");
      for (const r of rows) {
        const item = r.item ? cleanStack(parse(r.item)) : null;
        const m: Mail = { id: r.id, gold: Math.max(0, r.gold), item, note: r.note };
        // An item that no longer exists in the game is dropped rather than kept forever.
        if (r.item && !item && m.gold === 0) {
          del.run(r.id);
          continue;
        }
        if (!take(m)) continue;
        del.run(r.id);
        taken.push(m);
      }
      return taken;
    });
  }

  /** null while the owner is in town; otherwise when the shop closes. */
  setShopExpiry(accountId: number, expiresAt: number | null) {
    this.db.prepare("UPDATE shops SET expires_at = ? WHERE account_id = ?").run(expiresAt, accountId);
  }

  /** After a restart nobody is in town yet: every shop's away timer starts now. */
  markShopsAway(expiresAt: number) {
    this.db.prepare("UPDATE shops SET expires_at = ? WHERE expires_at IS NULL").run(expiresAt);
  }

  expiredShops(now: number): ShopRow[] {
    return this.db.prepare(`SELECT ${SHOP_COLS} FROM shops WHERE expires_at IS NOT NULL AND expires_at <= ?`).all(now) as unknown as ShopRow[];
  }
}

export const db = new Db(process.env.DB_PATH || fileURLToPath(new URL("../data/town.db", import.meta.url)));
