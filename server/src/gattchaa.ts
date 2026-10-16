import crypto from "node:crypto";
import express, { type Application, type Request, type Response } from "express";
import { DEFAULT_SITE, type Announcement, type ShopProduct, type ShopRoom, type ShopSnapshot } from "../../shared/gattchaa";

// Client for the Gattchaa Town API (contract: docs/gattchaa-town-api.md).
//
//  - Pull: GET {API}/catalog and GET {API}/live, with an API key and ETags, so an
//    unchanged response costs the shop almost nothing.
//  - Push: the shop POSTs signed webhooks to /hooks/gattchaa for things that
//    should feel instant (big pulls, catalog or room changes).
//
// Without GATTCHAA_API_URL the feed stays off and makes no requests at all;
// the town still works, the shop dialogs just show menu links.

// Read at start-up (after Colyseus has loaded server/.env.<NODE_ENV>), not at import time.
let API = "";
let API_KEY = "";
let WEBHOOK_SECRET = "";
let SITE = DEFAULT_SITE;
function loadConfig() {
  API = (process.env.GATTCHAA_API_URL ?? "").replace(/\/+$/, "");
  API_KEY = process.env.GATTCHAA_API_KEY ?? "";
  WEBHOOK_SECRET = process.env.GATTCHAA_WEBHOOK_SECRET ?? "";
  SITE = (process.env.GATTCHAA_SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");
}

const CATALOG_EVERY_MS = 10 * 60_000; // webhooks make this a safety net
const LIVE_EVERY_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;
const WEBHOOK_TOLERANCE_S = 300;

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

interface ApiEvent {
  id: string;
  type: "purchase.highlight" | "catalog.updated" | "live.updated" | string;
  data?: {
    label?: string;
    message?: string;
    product?: { title?: string; image_url?: string; url?: string };
  };
}

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

  get enabled() {
    return API !== "";
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
    return { site: SITE, products: this.products, rooms: this.rooms, siteOnline: this.siteOnline, updatedAt: this.updatedAt };
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

  /** GET with API key + ETag. Resolves undefined when unchanged (304) or on failure. */
  private async get<T>(path: string): Promise<T | undefined> {
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${API_KEY}` };
    const etag = this.etags.get(path);
    if (etag) headers["If-None-Match"] = etag;
    try {
      const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 304) return undefined;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tag = res.headers.get("etag");
      if (tag) this.etags.set(path, tag);
      return (await res.json()) as T;
    } catch (err) {
      console.warn(`[gattchaa] GET ${path} failed: ${(err as Error).message} (keeping last data)`);
      return undefined;
    }
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
