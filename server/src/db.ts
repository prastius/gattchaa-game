import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Saved game data, in one SQLite file: no database server to run, and a backup
// is a copy of the file. Holds Gattchaa-linked accounts, their sign-in
// sessions, their characters' progress, and the player shops open in town.
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
];

const ACCOUNT_COLS = "id, gattchaa_id AS gattchaaId, display_name AS displayName, name, look";
const PROGRESS_COLS = "class AS cls, level AS lv, exp, hp, mp, gold, bag, gear";
const SHOP_COLS = "account_id AS accountId, id, x, y, title, opened_at AS openedAt, expires_at AS expiresAt";

/** Sessions are stored hashed: a leaked database file doesn't sign anyone in. */
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

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
        `INSERT INTO characters (account_id, class, level, exp, hp, mp, gold, bag, gear, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET class = excluded.class, level = excluded.level, exp = excluded.exp,
           hp = excluded.hp, mp = excluded.mp, gold = excluded.gold, bag = excluded.bag, gear = excluded.gear,
           updated_at = excluded.updated_at`,
      )
      .run(accountId, p.cls, p.lv, p.exp, p.hp, p.mp, p.gold, p.bag, p.gear, Date.now());
  }

  // ------------------------------------------------------------ shops

  shops(): ShopRow[] {
    return this.db.prepare(`SELECT ${SHOP_COLS} FROM shops`).all() as unknown as ShopRow[];
  }

  shop(id: string): ShopRow | undefined {
    return this.db.prepare(`SELECT ${SHOP_COLS} FROM shops WHERE id = ?`).get(id) as ShopRow | undefined;
  }

  /** Opens a shop with its seller at (x, y); returns its new id. Throws if the account already has one. */
  openShop(accountId: number, x: number, y: number, title: string): string {
    const id = newShopId();
    this.db
      .prepare("INSERT INTO shops (account_id, id, x, y, title, opened_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NULL)")
      .run(accountId, id, Math.round(x), Math.round(y), title, Date.now());
    return id;
  }

  closeShop(accountId: number) {
    this.db.prepare("DELETE FROM shops WHERE account_id = ?").run(accountId);
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
