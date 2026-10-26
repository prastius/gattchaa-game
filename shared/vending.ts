// Player shops ("vending", Ragnarok style): a signed-in player sits down in
// the Market Square, names their shop, and everyone can browse the cards they've
// listed on the Gattchaa marketplace. A rug appears under them and a sign over
// their head. Buying always happens on gattchaaoripa.com, so the game never
// handles money. Rules here are shared by client and server.

import type { MarketListing } from "./gattchaa";
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

/** client -> server: open your shop where you're standing. */
export interface ShopOpenMessage {
  title: string;
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
  cards: number;
  rev: number;
}

/** GET /api/shops/:id */
export interface PlayerShopDetails {
  id: string;
  name: string;
  title: string;
  listings: MarketListing[];
  /** False when Gattchaa couldn't be reached and these are the last known listings. */
  fresh: boolean;
}
