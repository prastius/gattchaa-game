// Live data from gattchaaoripa.com, as the game server relays it to clients.

export const DEFAULT_SITE = "https://gattchaaoripa.com";

export interface ShopProduct {
  id: number;
  title: string;
  slug: string;
  /** Path under the site's /storage/, e.g. "products/foo.webp". */
  image: string;
  price: number;
  /** Original price when discounted. */
  was?: number;
  category: string;
  /** "pack_opening", "oripa_kuji", "kuji"… */
  type: string;
  label?: string;
  hot: boolean;
  soldOut: boolean;
}

export interface ShopRoom {
  code: string | null;
  mode: "sharing_pack" | "packs_battle" | string;
  seats: number;
  taken: number;
  seatPrice: number;
  cardsPerSeat: number;
  status: string | null;
  expiresAt: string | null;
  product: { title: string; slug: string; image: string };
}

export interface ShopSnapshot {
  site: string;
  products: ShopProduct[];
  rooms: ShopRoom[];
  /** People browsing the website right now. */
  siteOnline: number;
  updatedAt: number;
}

/** server -> client: a purchase or big pull on the website. */
export interface Announcement {
  label: string;
  message: string;
  title?: string;
  /** Storage path of the product image. */
  image?: string;
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

/** Site link tagged with where in town it came from, so the shop can measure the game's traffic. */
export function siteLink(site: string, path: string, from: string, params: Record<string, string> = {}): string {
  const url = new URL(path, site);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("utm_source", "gattchaa_town");
  url.searchParams.set("utm_medium", "game");
  url.searchParams.set("utm_content", from);
  return url.toString();
}

export const productLink = (site: string, p: { slug: string }, from: string, params?: Record<string, string>) =>
  siteLink(site, `/gacha/${encodeURIComponent(p.slug)}`, from, params);

export const formatRupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
