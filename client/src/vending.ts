import { Callbacks, type Room } from "@colyseus/sdk";
import { shopSpotProblem, type PlayerShopDetails, type PlayerShopView, type ShopOpenMessage, type ShopResult } from "../../shared/vending";
import type { Auth } from "./auth";
import { httpBase } from "./shop";

const DETAILS_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface ShopMap {
  get(id: string): PlayerShopView | undefined;
  forEach(fn: (shop: PlayerShopView, id: string) => void): void;
}

/**
 * Player shops as this client sees them: the synced list (state.shops, keyed by
 * shop id), opening and closing your own, and loading a shop's cards.
 */
export class Vending {
  /** A shop opened, closed or changed (title, owner, card count…). */
  readonly onChange = new Set<() => void>();
  private pending?: (r: ShopResult) => void;
  private cache = new Map<string, { rev: number; at: number; details: Promise<PlayerShopDetails | string> }>();

  constructor(
    private room: Room,
    readonly auth: Auth,
  ) {
    room.onMessage("shop:result", (r: ShopResult) => {
      const done = this.pending;
      this.pending = undefined;
      done?.(r);
    });
    const callbacks = Callbacks.get(room);
    const changed = () => {
      for (const fn of this.onChange) fn();
    };
    callbacks.onAdd("shops", (shop) => {
      callbacks.onChange(shop as object, changed);
      changed();
    });
    callbacks.onRemove("shops", changed);
  }

  private get map(): ShopMap | undefined {
    return (this.room.state as { shops?: ShopMap }).shops;
  }

  shop(id: string): PlayerShopView | undefined {
    return this.map?.get(id);
  }

  forEach(fn: (shop: PlayerShopView, id: string) => void) {
    this.map?.forEach(fn);
  }

  /** The id of the shop you're minding right now, if any. */
  get myShop(): string | undefined {
    let mine: string | undefined;
    this.forEach((s, id) => {
      if (s.owner === this.room.sessionId) mine = id;
    });
    return mine;
  }

  isMine(id: string): boolean {
    return this.shop(id)?.owner === this.room.sessionId;
  }

  /** Why your shop can't open at (x, y) right now (the server checks again), or undefined. */
  spotProblem(x: number, y: number): string | undefined {
    const shops: PlayerShopView[] = [];
    this.forEach((s) => shops.push(s));
    return shopSpotProblem(x, y, shops);
  }

  /** Opens your shop where you stand. Resolves to an error message, or undefined when it's open. */
  open(title: string): Promise<string | undefined> {
    return this.request("shop:open", { title } satisfies ShopOpenMessage);
  }

  close(): Promise<string | undefined> {
    return this.request("shop:close");
  }

  private request(type: string, msg?: unknown): Promise<string | undefined> {
    if (this.pending) return Promise.resolve("Just a moment…");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        resolve("The server didn't answer. Please try again.");
      }, REQUEST_TIMEOUT_MS);
      this.pending = (r) => {
        clearTimeout(timer);
        resolve(r.ok ? undefined : r.error || "That didn't work. Please try again.");
      };
      this.room.send(type, msg);
    });
  }

  /** A shop's cards (fetched again when its listings change), or an error message. */
  details(id: string): Promise<PlayerShopDetails | string> {
    const rev = this.shop(id)?.rev ?? -1;
    const hit = this.cache.get(id);
    if (hit && hit.rev === rev && Date.now() - hit.at < DETAILS_TTL_MS) return hit.details;
    const details = fetch(`${httpBase()}/api/shops/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as PlayerShopDetails & { error?: string };
        return res.ok ? body : body.error || "This shop has closed.";
      })
      .catch(() => "Couldn't load this shop. Check your connection.");
    this.cache.set(id, { rev, at: Date.now(), details });
    // Only keep what loaded; try again next time after an error.
    details.then((d) => typeof d === "string" && this.cache.get(id)?.details === details && this.cache.delete(id));
    return details;
  }
}
