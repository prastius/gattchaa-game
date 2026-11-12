import crypto from "node:crypto";
import { db, type Account } from "./db";
import { feed, type PointsResult } from "./gattchaa";

// The wallet: how the game reads and moves a player's Gattchaa Points (see
// shared/points.ts). Points live in the player's Gattchaa Oripa account, so
// every move is a call to the Gattchaa API, made with a unique reference so a
// retry never charges twice.
//
//  - Linked to Gattchaa (GATTCHAA_API_URL set): the real thing.
//  - Not linked, outside production: a local test wallet in the database
//    (accounts.dev_points; `/points <n>` sets it), and for guests on a test
//    server, a balance kept only for the session.
//  - Not linked, in production: nothing can be bought; Points show as unknown.

export interface Wallet {
  /** Where the Points come from, for the logs. */
  readonly kind: "gattchaa" | "local" | "offline";
  /** The balance now; undefined when it can't be read. */
  balance(account: Account | undefined, session: string): Promise<number | undefined>;
  /** Takes `amount` for `reason`. The result says why not, if not, and the balance after when known. */
  charge(account: Account | undefined, session: string, amount: number, reason: string): Promise<Charged>;
  /** Gives back what a charge took (it couldn't be delivered). */
  refund(account: Account | undefined, session: string, charge: Charged & { ok: true }, reason: string): Promise<void>;
  /** Pays `amount` from one player to another (a sale in a player shop). */
  transfer(from: Account, to: Account | { id: number; gattchaaId: string }, amount: number, reason: string): Promise<PointsResult>;
  /** Testing only: sets a balance (local wallet). */
  set?(account: Account | undefined, session: string, points: number): void;
}

export type Charged = (PointsResult & { ok: true; ref: string; amount: number }) | (PointsResult & { ok: false });

const ref = () => crypto.randomUUID();

class GattchaaWallet implements Wallet {
  readonly kind = "gattchaa";
  balance(account: Account | undefined) {
    return account ? feed.points(account.gattchaaId) : Promise.resolve(undefined);
  }
  async charge(account: Account | undefined, _session: string, amount: number, reason: string): Promise<Charged> {
    if (!account) return { ok: false, why: "offline" };
    const r = ref();
    const res = await feed.movePoints("charge", { user_id: account.gattchaaId, amount, reason, ref: r });
    return res.ok ? { ...res, ref: r, amount } : res;
  }
  async refund(account: Account | undefined, _session: string, charge: Charged & { ok: true }, reason: string) {
    if (!account) return;
    // A refund that fails is retried a few times: the player paid for something they didn't get.
    for (let i = 0; i < 3; i++) {
      const res = await feed.movePoints("refund", { user_id: account.gattchaaId, amount: charge.amount, reason, ref: `${charge.ref}-refund`, charge_ref: charge.ref });
      if (res.ok) return;
      await new Promise((r) => setTimeout(r, 2_000 * (i + 1)));
    }
    console.error(`[points] refund failed: account ${account.id}, ${charge.amount} Points, charge ${charge.ref} (${reason})`);
  }
  transfer(from: Account, to: { gattchaaId: string }, amount: number, reason: string) {
    return feed.movePoints("transfer", { from_user_id: from.gattchaaId, to_user_id: to.gattchaaId, amount, reason, ref: ref() });
  }
}

/** Testing without Gattchaa: balances in the database (accounts) or for the session (guests on a test server). */
class LocalWallet implements Wallet {
  readonly kind = "local";
  private guests = new Map<string, number>();
  private get(account: Account | undefined, session: string) {
    return account ? db.devPoints(account.id) : (this.guests.get(session) ?? 0);
  }
  set(account: Account | undefined, session: string, points: number) {
    const n = Math.max(0, Math.floor(points));
    if (account) db.setDevPoints(account.id, n);
    else this.guests.set(session, n);
  }
  balance(account: Account | undefined, session: string) {
    return Promise.resolve(this.get(account, session));
  }
  async charge(account: Account | undefined, session: string, amount: number): Promise<Charged> {
    const have = this.get(account, session);
    if (have < amount) return { ok: false, why: "short", points: have };
    this.set(account, session, have - amount);
    return { ok: true, points: have - amount, ref: ref(), amount };
  }
  async refund(account: Account | undefined, session: string, charge: Charged & { ok: true }) {
    this.set(account, session, this.get(account, session) + charge.amount);
  }
  async transfer(from: Account, to: { id: number }, amount: number): Promise<PointsResult> {
    const have = db.devPoints(from.id);
    if (have < amount) return { ok: false, why: "short", points: have };
    db.setDevPoints(from.id, have - amount);
    db.setDevPoints(to.id, db.devPoints(to.id) + amount);
    return { ok: true, points: have - amount };
  }
}

class OfflineWallet implements Wallet {
  readonly kind = "offline";
  balance() {
    return Promise.resolve(undefined);
  }
  charge(): Promise<Charged> {
    return Promise.resolve({ ok: false, why: "offline" });
  }
  refund() {
    return Promise.resolve();
  }
  transfer(): Promise<PointsResult> {
    return Promise.resolve({ ok: false, why: "offline" });
  }
}

/** The wallet for this server (decided once, after the config has loaded). */
export function makeWallet(): Wallet {
  if (feed.enabled) return new GattchaaWallet();
  return process.env.NODE_ENV === "production" ? new OfflineWallet() : new LocalWallet();
}
