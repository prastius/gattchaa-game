// Live shop data from the Gattchaa Town API (see docs/gattchaa-town-api.md),
// as the game server relays it to clients.

export const DEFAULT_SITE = "https://gattchaaoripa.com";

export interface ShopProduct {
  id: number;
  slug: string;
  title: string;
  category: string;
  /** "pack_opening", "oripa_kuji", "kuji"… */
  type: string;
  price: number;
  /** Original price when discounted. */
  was?: number;
  label?: string;
  hot: boolean;
  soldOut: boolean;
  /** Small square thumbnail (served by the shop with CORS for the game). */
  imageUrl: string;
  /** Product page on the shop. */
  url: string;
}

export interface ShopRoom {
  code: string | null;
  mode: "sharing_pack" | "packs_battle" | string;
  status: string | null;
  seats: number;
  taken: number;
  seatPrice: number;
  cardsPerSeat: number;
  expiresAt: string | null;
  url: string;
  product: { slug: string; title: string; imageUrl: string };
}

export interface ShopSnapshot {
  /** Base URL for menu links (daily login, marketplace…). */
  site: string;
  products: ShopProduct[];
  rooms: ShopRoom[];
  /** People browsing the website right now. */
  siteOnline: number;
  updatedAt: number;
}

/** server -> client: a highlighted purchase or big pull on the website. */
export interface Announcement {
  label: string;
  message: string;
  title?: string;
  imageUrl?: string;
  url?: string;
}

/** server -> client: an NPC says something (speech bubble). */
export interface NpcSay {
  id: string;
  text: string;
}

export const ROOM_MODES: Record<string, string> = {
  sharing_pack: "Sharing Pack",
  packs_battle: "Packs Battle",
};

/** Adds tracking parameters so the shop can measure traffic coming from the game. */
export function tagLink(href: string, from: string, params: Record<string, string> = {}): string {
  const url = new URL(href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("utm_source", "gattchaa_town");
  url.searchParams.set("utm_medium", "game");
  url.searchParams.set("utm_content", from);
  return url.toString();
}

/** A page on the shop by path, e.g. "/daily-login". */
export const siteLink = (site: string, path: string, from: string, params?: Record<string, string>) =>
  tagLink(new URL(path, site).toString(), from, params);

export const formatRupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
