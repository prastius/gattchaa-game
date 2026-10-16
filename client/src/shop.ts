import { DEFAULT_SITE, type ShopRoom, type ShopSnapshot } from "../../shared/gattchaa";

/** Game server's HTTP origin (dev: Vite on :5173, game server on :2567). */
export function httpBase(): string {
  if (import.meta.env.VITE_SERVER_URL) return String(import.meta.env.VITE_SERVER_URL).replace(/\/+$/, "");
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

const REFRESH_MS = 30_000;

/** Latest shop data, refreshed in the background. */
export class Shop {
  data: ShopSnapshot = { site: DEFAULT_SITE, products: [], rooms: [], siteOnline: 0, updatedAt: 0 };
  private listeners = new Set<(s: ShopSnapshot) => void>();

  constructor() {
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  }

  get site() {
    return this.data.site;
  }

  onChange(fn: (s: ShopSnapshot) => void) {
    this.listeners.add(fn);
    if (this.data.updatedAt) fn(this.data);
  }

  /** Rooms people can still join, fullest first (closest to starting). */
  get openRooms(): ShopRoom[] {
    return this.data.rooms
      .filter((r) => r.taken < r.seats && r.status !== "resolving")
      .sort((a, b) => b.taken / b.seats - a.taken / a.seats || a.seatPrice - b.seatPrice);
  }

  async refresh() {
    try {
      const res = await fetch(`${httpBase()}/api/gattchaa/shop`);
      if (!res.ok) return;
      const data = (await res.json()) as ShopSnapshot;
      if (!Array.isArray(data.products)) return;
      this.data = data;
      for (const fn of this.listeners) fn(data);
    } catch {
      /* keep the last data; the town still works without it */
    }
  }
}
