import type { Application, Request, Response } from "express";
import sharp from "sharp";
import { DEFAULT_SITE, type Announcement, type ShopProduct, type ShopRoom, type ShopSnapshot } from "../../shared/gattchaa";

// Mirrors public data from gattchaaoripa.com: the product list (embedded in the
// home page's Inertia props), open rooms (/rooms/state) and recent purchases
// (/site-activity). Everything is cached, so players never hit the shop
// directly and the game keeps working (with the last data) if the site is down.

export const SITE = (process.env.GATTCHAA_URL || DEFAULT_SITE).replace(/\/+$/, "");

const PRODUCTS_EVERY_MS = 5 * 60_000;
const LIVE_EVERY_MS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;
const UA = "GattchaaTown/1.0 (+game server)";

interface RawProduct {
  id: number;
  title: string;
  slug: string;
  image_path: string;
  price: number;
  discount_price: number;
  current_price: number;
  type: string;
  custom_label: string | null;
  is_hot: number | boolean;
  is_closed: boolean;
  is_sold_out: boolean;
  category?: { title: string };
}

interface RawRoom {
  code: string | null;
  mode: string;
  seats: number;
  taken_seats: number;
  seat_price: number;
  cards_per_seat: number;
  status: string | null;
  fill_expires_at: string | null;
  product: { title: string; slug: string; image_path: string; is_closed: boolean };
}

interface RawNotification {
  id: number | string;
  label: string;
  message: string;
  product_title?: string;
  product_image?: string;
  product_url?: string;
}

async function fetchText(path: string, accept = "text/html"): Promise<string> {
  const res = await fetch(`${SITE}${path}`, {
    headers: { Accept: accept, "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

function decodeEntities(s: string): string {
  return s.replace(/&(quot|amp|lt|gt|#0?39|#x27);/g, (m) => ({ "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">" })[m] ?? "'");
}

/** Accepts "products/x.webp" or a full storage URL on the site; anything else is dropped. */
export function storagePath(raw: unknown): string | undefined {
  let p = String(raw ?? "");
  const prefix = `${SITE}/storage/`;
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  else if (p.startsWith("/storage/")) p = p.slice("/storage/".length);
  return /^[a-z0-9_\-/]+\.(webp|png|jpe?g)$/i.test(p) && !p.includes("..") ? p : undefined;
}

function toProduct(p: RawProduct): ShopProduct {
  const price = Number(p.current_price) || Number(p.price) || 0;
  const was = Number(p.price) > price ? Number(p.price) : undefined;
  return {
    id: Number(p.id),
    title: String(p.title).trim().replace(/\s+/g, " "),
    slug: String(p.slug),
    image: storagePath(p.image_path) ?? "",
    price,
    ...(was && { was }),
    category: p.category?.title ?? "",
    type: String(p.type ?? ""),
    ...(p.custom_label && { label: String(p.custom_label) }),
    hot: Boolean(p.is_hot),
    soldOut: Boolean(p.is_sold_out),
  };
}

function toRoom(r: RawRoom): ShopRoom {
  return {
    code: r.code,
    mode: r.mode,
    seats: Number(r.seats) || 0,
    taken: Number(r.taken_seats) || 0,
    seatPrice: Number(r.seat_price) || 0,
    cardsPerSeat: Number(r.cards_per_seat) || 0,
    status: r.status,
    expiresAt: r.fill_expires_at,
    product: { title: String(r.product?.title ?? ""), slug: String(r.product?.slug ?? ""), image: storagePath(r.product?.image_path) ?? "" },
  };
}

export class GattchaaFeed {
  private products: ShopProduct[] = [];
  private rooms: ShopRoom[] = [];
  private siteOnline = 0;
  private updatedAt = 0;
  private seen = new Set<string>();
  private primed = false;
  private timers: NodeJS.Timeout[] = [];
  private listeners = new Set<(a: Announcement) => void>();

  start() {
    const products = () => this.refreshProducts().catch((err) => console.warn("[gattchaa] products:", err.message));
    const live = () => this.refreshLive().catch((err) => console.warn("[gattchaa] live:", err.message));
    products();
    live();
    this.timers.push(setInterval(products, PRODUCTS_EVERY_MS), setInterval(live, LIVE_EVERY_MS));
    for (const t of this.timers) t.unref();
  }

  onAnnouncement(fn: (a: Announcement) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): ShopSnapshot {
    return { site: SITE, products: this.products, rooms: this.rooms, siteOnline: this.siteOnline, updatedAt: this.updatedAt };
  }

  get online() {
    return this.siteOnline;
  }

  /** Products currently on sale (not closed), in the site's own order. */
  get liveProducts() {
    return this.products;
  }

  get liveRooms() {
    return this.rooms;
  }

  private async refreshProducts() {
    const html = await fetchText("/");
    const m = html.match(/data-page="([^"]*)"/);
    if (!m) throw new Error("no Inertia page data on the home page");
    const page = JSON.parse(decodeEntities(m[1])) as { props?: { products?: RawProduct[] } };
    const raw = page.props?.products;
    if (!Array.isArray(raw)) throw new Error("home page has no product list");
    this.products = raw.filter((p) => p && p.slug && !p.is_closed).map(toProduct);
    this.updatedAt = Date.now();
  }

  private async refreshLive() {
    const [rooms, activity] = await Promise.allSettled([
      fetchText("/rooms/state", "application/json").then((t) => JSON.parse(t) as { rooms?: RawRoom[] }),
      fetchText("/site-activity", "application/json").then(
        (t) => JSON.parse(t) as { online_count?: number; purchase_notifications?: RawNotification[] },
      ),
    ]);

    if (rooms.status === "fulfilled" && Array.isArray(rooms.value.rooms)) {
      this.rooms = rooms.value.rooms.filter((r) => r?.product?.slug && !r.product.is_closed).map(toRoom);
    }

    if (activity.status === "fulfilled") {
      this.siteOnline = Math.max(0, Number(activity.value.online_count) || 0);
      const fresh: Announcement[] = [];
      for (const n of activity.value.purchase_notifications ?? []) {
        const key = String(n.id);
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        // The first poll only learns what was already there; no replaying old news on restart.
        if (!this.primed) continue;
        // Only links back into the shop itself.
        const raw = String(n.product_url ?? "");
        const url = raw.startsWith(`${SITE}/`) ? raw : /^\/[^/]/.test(raw) ? `${SITE}${raw}` : undefined;
        fresh.push({
          label: String(n.label ?? "").slice(0, 60),
          message: String(n.message ?? "").slice(0, 200),
          title: n.product_title ? String(n.product_title).slice(0, 120) : undefined,
          image: storagePath(n.product_image),
          url,
        });
      }
      this.primed = true;
      if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-500));
      for (const a of fresh) for (const fn of this.listeners) fn(a);
    }
    if (rooms.status === "rejected") throw rooms.reason;
    if (activity.status === "rejected") throw activity.reason;
  }
}

export const feed = new GattchaaFeed();

// ------------------------------------------------------------------ HTTP routes

const THUMB_SIZES = new Set([64, 128, 256]);
const MAX_CACHED = 400;
const thumbs = new Map<string, Promise<Buffer>>();

/** Downloads a product image once and serves small WebP thumbnails (with CORS, so WebGL can use them). */
function thumbnail(path: string, size: number): Promise<Buffer> {
  const key = `${size}:${path}`;
  let p = thumbs.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${SITE}/storage/${path}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const input = Buffer.from(await res.arrayBuffer());
      return sharp(input).resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    })();
    p.catch(() => thumbs.delete(key)); // retry later
    thumbs.set(key, p);
    if (thumbs.size > MAX_CACHED) thumbs.delete(thumbs.keys().next().value!);
  }
  return p;
}

export function registerGattchaaRoutes(app: Application) {
  const cors = (res: Response) => res.set("Access-Control-Allow-Origin", "*");

  app.get("/api/gattchaa/shop", (_req: Request, res: Response) => {
    cors(res).set("Cache-Control", "public, max-age=15").json(feed.snapshot());
  });

  app.get("/api/gattchaa/img", async (req: Request, res: Response) => {
    cors(res);
    const path = storagePath(req.query.p);
    const size = Number(req.query.s) || 128;
    if (!path || !THUMB_SIZES.has(size)) {
      res.status(400).end();
      return;
    }
    try {
      const buf = await thumbnail(path, size);
      res.set("Content-Type", "image/webp").set("Cache-Control", "public, max-age=86400").send(buf);
    } catch {
      res.status(502).end();
    }
  });
}
