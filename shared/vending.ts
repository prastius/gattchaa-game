// Player shops ("vending", Ragnarok style): a signed-in player sits down in
// the Market Square, names their shop, and sells two kinds of things:
//
//  - things from their bag (gear, monster cards, ingots…), for in-game gold.
//    The game hands over the item and the gold, even while the seller is away.
//  - the real cards they've listed on the Gattchaa marketplace. Those are only
//    ever bought on gattchaaoripa.com: in-game gold never buys a real card.
//
// A rug appears under the seller and a sign over their head. Rules here are
// shared by client and server.

import type { MarketListing } from "./gattchaa";
import { ITEMS, cleanStack, sellPrice, type ItemStack } from "./items";
import { NPCS } from "./npcs";
import { DOORS, MARKET, PROPS, TILE, inRect, propAnchor } from "./town";

export const SHOP_TITLE_MAX = 30;
/** Signs over the shops show this many characters; the shop panel shows the whole title. */
export const SIGN_CHARS = 18;
/** A shop stays open this long after its owner leaves the game ("offline vending"). */
export const SHOP_AWAY_HOURS = 24;
/**
 * Shops keep at least this far apart (px, an ellipse: wide, because signs are
 * wide) so their signs never overlap, unlike Ragnarok's famous sign pile-ups.
 */
export const SHOP_SPACING_X = 128;
export const SHOP_SPACING_Y = 72;
/** ...and this far from doors, shopkeepers and machines, so nobody has to click past a shop to reach them. */
export const SHOP_CLEARANCE = 64;
/** Shop ids: random, so they don't reveal anything about the seller. */
export const SHOP_ID_RE = /^[a-z0-9]{10}$/;
/** Different things one shop can sell from the bag (Ragnarok's Vending tops out at 12 too). */
export const SHOP_WARES = 12;
/** The most one item can cost, in gold. */
export const MAX_PRICE = 9_999_999;

/** One thing for sale from a seller's bag: what's left (`item.n`), the price of each, and how many have sold. */
export interface ShopWare {
  item: ItemStack;
  price: number;
  sold: number;
}

export const isPrice = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= MAX_PRICE;

/** A shop's saved wares, with anything broken dropped. Sold-out wares stay (n 0), so the numbering never shifts. */
export function cleanWares(raw: unknown): ShopWare[] {
  if (!Array.isArray(raw)) return [];
  const wares: ShopWare[] = [];
  for (const w of raw.slice(0, SHOP_WARES)) {
    const r = (w ?? {}) as { item?: { n?: unknown }; price?: unknown; sold?: unknown };
    const left = Math.floor(Number(r.item?.n));
    const item = cleanStack({ ...r.item, n: Math.max(1, left) });
    if (!item || !isPrice(r.price)) continue;
    wares.push({ item: { ...item, n: left > 0 ? item.n : 0 }, price: r.price, sold: Math.max(0, Math.floor(Number(r.sold)) || 0) });
  }
  return wares;
}

/** How many different things a shop still has in stock (shown on its sign). */
export const waresLeft = (wares: readonly ShopWare[]) => wares.filter((w) => w.item.n > 0).length;

/** "Iron Ingot ×5", or "+7 Saber". */
export const stackText = (name: string, n: number) => (n > 1 ? `${name} ×${n}` : name);

/** Gold, the way the game writes it: "12,500". */
export const goldText = (n: number) => Math.floor(n).toLocaleString("en-US");

/** What Bram the Outfitter would pay for one (0: he won't buy it), so sellers don't ask less by mistake. */
export const merchantPays = (s: ItemStack) => (s.cards || s.up ? 0 : sellPrice(ITEMS[s.id]));

export function sanitizeShopTitle(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\p{Cc}​‪-‮⁦-⁩]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SHOP_TITLE_MAX);
}

/** "Super long shop title here" -> "Super long shop ti…" for the sign. */
export function signText(title: string): string {
  const chars = [...title];
  return chars.length > SIGN_CHARS ? `${chars.slice(0, SIGN_CHARS - 1).join("").trimEnd()}…` : title;
}

/** Things a shop must keep clear of: doors, townspeople at their posts, machines, counters and tables. */
const KEEP_CLEAR: { x: number; y: number; what: string }[] = [
  ...DOORS.map((d) => ({ x: d.trigger.x + d.trigger.w / 2, y: d.trigger.y + d.trigger.h / 2, what: "the door" })),
  ...NPCS.filter((n) => !n.wander).map((n) => ({ x: n.x, y: n.y, what: n.name })),
  ...PROPS.filter((p) => p.tag).map((p) => {
    const kind = p.tag!.split(":")[0];
    const what = kind === "machine" ? "the oripa machines" : kind === "table" ? "the Rooms tables" : "the stalls";
    return { ...propAnchor(p), what };
  }),
];

/** Shops only open in the Market Square, so buyers know where to look. */
export const inShopZone = (x: number, y: number) => inRect(MARKET, x / TILE, y / TILE);

/**
 * Why a shop can't open with its seller's feet at (x, y), or undefined when it
 * can. In the Market Square, clear of doors and shopkeepers, and not crowding
 * another shop.
 */
export function shopSpotProblem(x: number, y: number, shops: Iterable<{ x: number; y: number; name: string }>): string | undefined {
  if (!inShopZone(x, y)) return "Shops can only open in the Market Square, south of the fountain plaza.";
  for (const k of KEEP_CLEAR) {
    if (Math.hypot(k.x - x, k.y - y) < SHOP_CLEARANCE) return `Too close to ${k.what}. Move a few steps away.`;
  }
  for (const s of shops) {
    if (((s.x - x) / SHOP_SPACING_X) ** 2 + ((s.y - y) / SHOP_SPACING_Y) ** 2 < 1) {
      return `Too close to ${s.name}'s shop: your signs would overlap. Move a few steps away.`;
    }
  }
  return undefined;
}

/** One thing to sell, picked from the bag when opening a shop. */
export interface WarePick {
  /** Bag slot. */
  slot: number;
  /** How many of that slot. */
  n: number;
  /** Gold each. */
  price: number;
}

/** client -> server: open your shop where you're standing, selling these things from your bag (and your Gattchaa cards). */
export interface ShopOpenMessage {
  title: string;
  wares?: WarePick[];
}

/**
 * client -> server: buy `n` of a shop's ware number `ware`. `item` and `price`
 * are what the buyer saw, so a sale never goes through on something else.
 */
export interface ShopBuyMessage {
  shop: string;
  ware: number;
  n: number;
  item: string;
  price: number;
}

/** server -> client: the answer to shop:open or shop:close. */
export interface ShopResult {
  ok: boolean;
  error?: string;
}

/** Synced shop, as the client sees it (state.shops, keyed by shop id). */
export interface PlayerShopView {
  name: string;
  look: string;
  title: string;
  /** Where the seller sits (feet), in pixels. */
  x: number;
  y: number;
  /** The owner's session id while they're in town, empty while they're away. */
  owner: string;
  /** Cards listed on the Gattchaa marketplace. */
  cards: number;
  /** Different things from the bag still for sale. */
  items: number;
  /** Bumped whenever the listings or the stock change, so open shop panels reload. */
  rev: number;
}

/** GET /api/shops/:id */
export interface PlayerShopDetails {
  id: string;
  name: string;
  title: string;
  /** Things from the seller's bag, for gold (numbered as in ShopBuyMessage.ware). */
  wares: ShopWare[];
  listings: MarketListing[];
  /** False when Gattchaa couldn't be reached and these are the last known listings. */
  fresh: boolean;
}

/** One thing for sale anywhere in the Market Square (Tina's "Find an item"). */
export interface MarketWare extends ShopWare {
  shop: string;
  /** Which of the shop's wares it is. */
  ware: number;
  seller: string;
  x: number;
  y: number;
}

/** GET /api/market: everything for sale in every shop, for gold. */
export interface MarketList {
  wares: MarketWare[];
}
