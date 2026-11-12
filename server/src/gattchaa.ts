import crypto from "node:crypto";
import express, { type Application, type Request, type Response } from "express";
import { DEFAULT_SITE, type Announcement, type MarketListing, type ShopProduct, type ShopRoom, type ShopSnapshot } from "../../shared/gattchaa";

// Client for the Gattchaa Town API (contract: docs/gattchaa-town-api.md).
//
//  - Pull: GET {API}/catalog and GET {API}/live, with an API key and ETags, so an
//    unchanged response costs the shop almost nothing.
//  - Push: the shop POSTs signed webhooks to /hooks/gattchaa for things that
//    should feel instant (big pulls, catalog or room changes).
//  - Accounts: players sign in on gattchaaoripa.com, which sends them back with a
//    one-time ticket we redeem here; player shops show each seller's listings.
//
// Without GATTCHAA_API_URL the feed stays off and makes no requests at all;
// the town still works, the shop dialogs just show menu links.
//
// API only, never scraping: this file is the only place the game server talks
// to Gattchaa, and every request goes to the Town API (GATTCHAA_API_URL, which
// must end in /api/town/v1) with the API key. No web page of gattchaaoripa.com
// is ever fetched or parsed, in development or in production. Players' browsers
// only open links to the site and show the images the API names.

// Read at start-up (after Colyseus has loaded server/.env.<NODE_ENV>), not at import time.
let API = "";
let API_KEY = "";
let WEBHOOK_SECRET = "";
let SITE = DEFAULT_SITE;
let SIGNIN_URL = "";
/** Whether a URL is the Town API (…/api/town/v1), and in production over HTTPS: anything else is refused. */
export function isTownApi(url: string, production = process.env.NODE_ENV === "production"): boolean {
  try {
    const u = new URL(url);
    if (production && u.protocol !== "https:") return false;
    return (u.protocol === "https:" || u.protocol === "http:") && /\/api\/town\/v1$/.test(u.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

function loadConfig() {
  API = (process.env.GATTCHAA_API_URL ?? "").replace(/\/+$/, "");
  if (API && !isTownApi(API)) {
    // Never pointed at a website page: the game reads the Town API and nothing else.
    console.error(`[gattchaa] GATTCHAA_API_URL must be the Town API (https://…/api/town/v1), not "${API}". The Gattchaa link stays off.`);
    API = "";
  }
  API_KEY = process.env.GATTCHAA_API_KEY ?? "";
  WEBHOOK_SECRET = process.env.GATTCHAA_WEBHOOK_SECRET ?? "";
  SITE = (process.env.GATTCHAA_SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");
  SIGNIN_URL = process.env.GATTCHAA_SIGNIN_URL || `${SITE}/town/enter`;
}

const CATALOG_EVERY_MS = 10 * 60_000; // webhooks make this a safety net
const LIVE_EVERY_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;
const WEBHOOK_TOLERANCE_S = 300;
/** Seller listings are re-checked (with an ETag) at most this often; webhooks clear it sooner. */
const LISTINGS_TTL_MS = 60_000;
const MAX_LISTINGS = 60;

// ------------------------------------------------------------------ API shapes

interface ApiProduct {
  id: number;
  slug: string;
  title: string;
  category: string;
  type: string;
  price: number;
  original_price: number | null;
  label: string | null;
  is_hot: boolean;
  is_sold_out: boolean;
  image_url: string;
  url: string;
}

interface ApiRoom {
  code: string | null;
  mode: string;
  status: string | null;
  seats: number;
  taken_seats: number;
  seat_price: number;
  cards_per_seat: number;
  fill_expires_at: string | null;
  url: string;
  product: { slug: string; title: string; image_url: string };
}

interface ApiListing {
  id: number | string;
  title: string;
  image_url: string;
  price: number;
  condition?: string | null;
  grade?: string | null;
  category?: string | null;
  url: string;
}

interface ApiEvent {
  id: string;
  type: "purchase.highlight" | "catalog.updated" | "live.updated" | "listing.updated" | string;
  data?: {
    label?: string;
    message?: string;
    product?: { title?: string; image_url?: string; url?: string };
    /** listing.updated: whose listings changed. */
    user_id?: string | number;
  };
}

/** A Gattchaa user, from a redeemed sign-in ticket. */
/** How a Points move went: done (with the payer's balance after it, when Gattchaa says), not enough Points, or Gattchaa unreachable. */
export type PointsResult = { ok: true; points?: number } | { ok: false; why: "short" | "offline"; points?: number };

export interface GattchaaUser {
  id: string;
  displayName: string;
}

type Fetched = { body: unknown; etag?: string } | "not-modified" | undefined;

/** Only plain http(s) links ever reach players (no javascript: URLs). */
function safeUrl(raw: unknown): string {
  const s = String(raw ?? "");
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const text = (raw: unknown, max: number) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function toProduct(p: ApiProduct): ShopProduct {
  const price = Math.max(0, Number(p.price) || 0);
  const was = Number(p.original_price) > price ? Number(p.original_price) : undefined;
  return {
    id: Number(p.id),
    slug: text(p.slug, 200),
    title: text(p.title, 160),
    category: text(p.category, 60),
    type: text(p.type, 40),
    price,
    ...(was && { was }),
    ...(p.label && { label: text(p.label, 30) }),
    hot: Boolean(p.is_hot),
    soldOut: Boolean(p.is_sold_out),
    imageUrl: safeUrl(p.image_url),
    url: safeUrl(p.url),
  };
}

function toListing(l: ApiListing): MarketListing {
  return {
    id: text(l.id, 40),
    title: text(l.title, 160),
    imageUrl: safeUrl(l.image_url),
    price: Math.max(0, Math.round(Number(l.price) || 0)),
    ...(l.condition && { condition: text(l.condition, 40) }),
    ...(l.grade && { grade: text(l.grade, 40) }),
    ...(l.category && { category: text(l.category, 60) }),
    url: safeUrl(l.url),
  };
}

function toRoom(r: ApiRoom): ShopRoom {
  return {
    code: r.code ? text(r.code, 40) : null,
    mode: text(r.mode, 30),
    status: r.status ? text(r.status, 30) : null,
    seats: Math.max(0, Number(r.seats) || 0),
    taken: Math.max(0, Number(r.taken_seats) || 0),
    seatPrice: Math.max(0, Number(r.seat_price) || 0),
    cardsPerSeat: Math.max(0, Number(r.cards_per_seat) || 0),
    expiresAt: r.fill_expires_at ? text(r.fill_expires_at, 40) : null,
    url: safeUrl(r.url),
    product: { slug: text(r.product?.slug, 200), title: text(r.product?.title, 160), imageUrl: safeUrl(r.product?.image_url) },
  };
}

// ------------------------------------------------------------------ feed

export class GattchaaFeed {
  private products: ShopProduct[] = [];
  private rooms: ShopRoom[] = [];
  private siteOnline = 0;
  private updatedAt = 0;
  private etags = new Map<string, string>();
  private seenEvents = new Set<string>();
  private pending = new Map<string, NodeJS.Timeout>();
  private listeners = new Set<(a: Announcement) => void>();
  private listingCache = new Map<string, { at: number; etag?: string; listings: MarketListing[] }>();
  private listingFetches = new Map<string, Promise<MarketListing[] | undefined>>();
  private listingListeners = new Set<(userId: string) => void>();

  get enabled() {
    return API !== "";
  }

  /** Where "Sign in with Gattchaa" sends players; empty when the API isn't configured. */
  get signInUrl() {
    return this.enabled ? SIGNIN_URL : "";
  }

  start() {
    loadConfig();
    if (!this.enabled) {
      console.log("[gattchaa] GATTCHAA_API_URL not set: shop feed off (no requests to the shop).");
      return;
    }
    if (!API_KEY) console.warn("[gattchaa] GATTCHAA_API_KEY is empty; the API will probably refuse requests.");
    this.refreshCatalog();
    this.refreshLive();
    setInterval(() => this.refreshCatalog(), CATALOG_EVERY_MS).unref();
    setInterval(() => this.refreshLive(), LIVE_EVERY_MS).unref();
  }

  onAnnouncement(fn: (a: Announcement) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): ShopSnapshot {
    return { live: this.enabled, site: SITE, products: this.products, rooms: this.rooms, siteOnline: this.siteOnline, updatedAt: this.updatedAt };
  }

  get online() {
    return this.siteOnline;
  }

  get liveProducts() {
    return this.products;
  }

  get liveRooms() {
    return this.rooms;
  }

  onListingsChanged(fn: (userId: string) => void): () => void {
    this.listingListeners.add(fn);
    return () => this.listingListeners.delete(fn);
  }

  /** GET with the API key, revalidating with an ETag when given one. Undefined on failure. */
  private async fetchJson(path: string, etag?: string): Promise<Fetched> {
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${API_KEY}` };
    if (etag) headers["If-None-Match"] = etag;
    try {
      const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 304) return "not-modified";
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { body: await res.json(), etag: res.headers.get("etag") ?? undefined };
    } catch (err) {
      console.warn(`[gattchaa] GET ${path} failed: ${(err as Error).message} (keeping last data)`);
      return undefined;
    }
  }

  /** GET with API key + ETag. Resolves undefined when unchanged (304) or on failure. */
  private async get<T>(path: string): Promise<T | undefined> {
    const res = await this.fetchJson(path, this.etags.get(path));
    if (!res || res === "not-modified") return undefined;
    if (res.etag) this.etags.set(path, res.etag);
    return res.body as T;
  }

  /**
   * Swaps a one-time sign-in ticket for the Gattchaa user it was made for.
   * Null when the ticket is unknown, used or expired; throws when Gattchaa can't be reached.
   */
  async redeemTicket(ticket: string): Promise<GattchaaUser | null> {
    if (!this.enabled) throw new Error("Gattchaa API not configured");
    const res = await fetch(`${API}/tickets/redeem`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ ticket }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410 || res.status === 422) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { user_id?: unknown; display_name?: unknown } } | null;
    const id = text(body?.data?.user_id, 40);
    return id ? { id, displayName: text(body?.data?.display_name, 40) || "Collector" } : null;
  }

  // ---------------------------------------------------------------- Points (see shared/points.ts)

  /** A user's Points balance. Undefined when Gattchaa can't be reached. */
  async points(userId: string): Promise<number | undefined> {
    const res = await this.fetchJson(`/users/${encodeURIComponent(userId)}/points`);
    const n = res && res !== "not-modified" ? (res.body as { data?: { points?: unknown } } | null)?.data?.points : undefined;
    return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
  }

  /**
   * Moves Points: `charge` takes them from a user (a purchase), `refund` gives back what a
   * charge took (it couldn't be delivered), `transfer` pays one user from another (a player
   * shop). Every call has a unique `ref`, so a retry never moves Points twice.
   */
  async movePoints(
    kind: "charge" | "refund" | "transfer",
    body: { user_id?: string; from_user_id?: string; to_user_id?: string; amount: number; reason: string; ref: string; charge_ref?: string },
  ): Promise<PointsResult> {
    if (!this.enabled) return { ok: false, why: "offline" };
    try {
      const res = await fetch(`${API}/points/${kind}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => null)) as { data?: { points?: unknown; from_points?: unknown } } | null;
      const left = json?.data?.points ?? json?.data?.from_points;
      const points = typeof left === "number" ? left : undefined;
      if (res.status === 409) return { ok: false, why: "short", points };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, points };
    } catch (err) {
      console.warn(`[gattchaa] POST /points/${kind} failed: ${(err as Error).message}`);
      return { ok: false, why: "offline" };
    }
  }

  /**
   * A seller's marketplace listings. Cached for a minute, then revalidated with an
   * ETag; one request per seller at a time. When Gattchaa can't be reached: the
   * last known listings, or undefined if there are none.
   */
  listings(userId: string): Promise<MarketListing[] | undefined> {
    const cached = this.listingCache.get(userId);
    if (cached && Date.now() - cached.at < LISTINGS_TTL_MS) return Promise.resolve(cached.listings);
    if (!this.enabled) return Promise.resolve(cached?.listings);
    let pending = this.listingFetches.get(userId);
    if (!pending) {
      pending = this.fetchListings(userId).finally(() => this.listingFetches.delete(userId));
      this.listingFetches.set(userId, pending);
    }
    return pending;
  }

  private async fetchListings(userId: string): Promise<MarketListing[] | undefined> {
    const cached = this.listingCache.get(userId);
    const res = await this.fetchJson(`/users/${encodeURIComponent(userId)}/listings`, cached?.etag);
    if (res === "not-modified" && cached) {
      cached.at = Date.now();
      return cached.listings;
    }
    const data = res && res !== "not-modified" ? (res.body as { data?: ApiListing[] } | null)?.data : undefined;
    if (!res || res === "not-modified" || !Array.isArray(data)) return cached?.listings;
    const listings = data.map(toListing).filter((l) => l.title && l.url).slice(0, MAX_LISTINGS);
    if (this.listingCache.size >= 500) this.listingCache.clear(); // far more sellers than a town has; just bounds memory
    this.listingCache.set(userId, { at: Date.now(), etag: res.etag, listings });
    return listings;
  }

  private async refreshCatalog() {
    const body = await this.get<{ data?: ApiProduct[] }>("/catalog");
    if (!body || !Array.isArray(body.data)) return;
    this.products = body.data.map(toProduct).filter((p) => p.slug && p.url);
    this.updatedAt = Date.now();
  }

  private async refreshLive() {
    const body = await this.get<{ data?: { rooms?: ApiRoom[]; online?: number } }>("/live");
    if (!body?.data) return;
    if (Array.isArray(body.data.rooms)) this.rooms = body.data.rooms.map(toRoom).filter((r) => r.url);
    this.siteOnline = Math.max(0, Number(body.data.online) || 0);
    this.updatedAt = Date.now();
  }

  /** Coalesces bursts of webhooks (e.g. 20 seats sold in a second) into one fetch. */
  private soon(key: string, fn: () => void) {
    if (this.pending.has(key)) return;
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        fn();
      }, 1500),
    );
  }

  handleEvent(e: ApiEvent) {
    const id = text(e.id, 80);
    if (!id || this.seenEvents.has(id)) return; // the shop may retry deliveries
    this.seenEvents.add(id);
    if (this.seenEvents.size > 1000) this.seenEvents = new Set([...this.seenEvents].slice(-500));

    switch (e.type) {
      case "catalog.updated":
        this.soon("catalog", () => this.refreshCatalog());
        break;
      case "live.updated":
        this.soon("live", () => this.refreshLive());
        break;
      case "purchase.highlight": {
        const message = text(e.data?.message, 200);
        if (!message) return;
        const a: Announcement = {
          label: text(e.data?.label, 60) || "Gattchaa",
          message,
          title: text(e.data?.product?.title, 120) || undefined,
          imageUrl: safeUrl(e.data?.product?.image_url) || undefined,
          url: safeUrl(e.data?.product?.url) || undefined,
        };
        for (const fn of this.listeners) fn(a);
        break;
      }
      case "listing.updated": {
        const userId = text(e.data?.user_id, 40);
        if (!userId) return;
        const cached = this.listingCache.get(userId);
        if (cached) cached.at = 0; // the next read revalidates
        this.soon(`listings:${userId}`, () => {
          for (const fn of this.listingListeners) fn(userId);
        });
        break;
      }
      default:
        break; // unknown events are ignored, so the shop can add more later
    }
  }
}

export const feed = new GattchaaFeed();

/** Checks `X-Gattchaa-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">`. */
export function verifySignature(header: string, body: Buffer, secret: string, nowS = Date.now() / 1000): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!secret || !Number.isFinite(t) || Math.abs(nowS - t) > WEBHOOK_TOLERANCE_S || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(body).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}

// ------------------------------------------------------------------ HTTP routes

export function registerGattchaaRoutes(app: Application) {
  // Clients read the cached snapshot from us; they never talk to the shop's API.
  app.get("/api/gattchaa/shop", (_req: Request, res: Response) => {
    res.set("Access-Control-Allow-Origin", "*").set("Cache-Control", "public, max-age=15").json(feed.snapshot());
  });

  app.post("/hooks/gattchaa", express.raw({ type: "application/json", limit: "64kb" }), (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySignature(String(req.get("x-gattchaa-signature") ?? ""), body, WEBHOOK_SECRET)) {
      res.status(401).json({ error: "bad signature" });
      return;
    }
    try {
      feed.handleEvent(JSON.parse(body.toString("utf8")) as ApiEvent);
    } catch {
      res.status(400).json({ error: "bad json" });
      return;
    }
    res.status(204).end();
  });
}
