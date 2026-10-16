import { NPCS, npcProducts, type NpcDef } from "../../../shared/npcs";
import { MACHINES } from "../../../shared/town";
import {
  ROOM_MODES,
  formatRupiah,
  siteLink,
  tagLink,
  type ShopProduct,
  type ShopRoom,
} from "../../../shared/gattchaa";
import { FRAME, composeCharacter } from "../character";
import type { Shop } from "../shop";
import { audio } from "../audio";

// The panel that opens when you talk to someone or use a machine. Every
// button is a real link into gattchaaoripa.com (new tab), so buying, logging
// in and paying all happen on the actual site.

interface LinkSpec {
  label: string;
  path: string;
  hint?: string;
}

const LINKS: Record<string, LinkSpec[]> = {
  guide: [
    { label: "Open Gattchaa Oripa", path: "/", hint: "All packs & Kuji" },
    { label: "Daily login bonus", path: "/daily-login", hint: "Claim today's reward" },
    { label: "Rewards", path: "/rewards" },
    { label: "Campaigns", path: "/campaigns" },
    { label: "My inventory & pickup", path: "/inventory", hint: "Ship or pick up in Batam" },
    { label: "Sign in", path: "/login" },
    { label: "Create account", path: "/register" },
    { label: "About Gattchaa", path: "/about" },
  ],
  market: [
    { label: "Browse marketplace", path: "/marketplace", hint: "Single cards from collectors" },
    { label: "Want to Buy list", path: "/marketplace/wtb", hint: "Post what you're looking for" },
    { label: "Consign your cards", path: "/consignment", hint: "Let us sell them for you" },
    { label: "My inventory", path: "/inventory" },
  ],
  grading: [
    { label: "Grading prices", path: "/grading" },
    { label: "Request grading", path: "/grading/request" },
    { label: "Track a card", path: "/grading/track" },
    { label: "My gradings", path: "/grading/mine" },
  ],
  rooms: [{ label: "All rooms", path: "/rooms", hint: "Every open Sharing Pack & Packs Battle" }],
  pickup: [
    { label: "My inventory", path: "/inventory", hint: "Everything you've pulled" },
    { label: "Shipping", path: "/shipping", hint: "Get your cards delivered" },
    { label: "Store & pickup info", path: "/about", hint: "Gattchaa One, Batam Mall" },
    { label: "Sign in", path: "/login" },
  ],
};

const $ = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function external(a: HTMLAnchorElement, href: string) {
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

export class TownDialog {
  private root = $("dialog");
  private portrait = $("dialog-portrait") as HTMLCanvasElement;
  private nameEl = $("dialog-name");
  private titleEl = $("dialog-title");
  private textEl = $("dialog-text");
  private body = $("dialog-body");
  private actions = $("dialog-actions");
  private logo = new Image();
  private openTarget: string | undefined;
  private renderToken = 0;
  /** Where the conversation is happening; walking away closes it. */
  anchor = { x: 0, y: 0 };
  onClose?: () => void;

  constructor(private shop: Shop) {
    this.logo.src = `${import.meta.env.BASE_URL}assets/gattchaa/logo-64.png`;
    $("dialog-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    // Live data changes (stock, seats) refresh whatever is open.
    shop.onChange(() => this.openTarget && this.render(this.openTarget, false));
  }

  get isOpen() {
    return !this.root.hidden;
  }

  get target() {
    return this.openTarget;
  }

  open(target: string, at: { x: number; y: number }) {
    this.anchor = at;
    audio.blip();
    this.render(target, true);
    this.root.hidden = false;
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.openTarget = undefined;
    this.onClose?.();
  }

  // ------------------------------------------------------------------ content

  private render(target: string, fresh: boolean) {
    this.openTarget = target;
    const [kind, id] = target.split(":");
    const token = ++this.renderToken;
    const keepScroll = fresh ? 0 : this.body.scrollTop;
    this.body.replaceChildren();
    this.actions.replaceChildren();

    if (kind === "npc") {
      const npc = NPCS.find((n) => n.id === id);
      if (!npc) return this.close();
      this.header(npc.name, npc.title || "Local", token, npc.look);
      if (fresh) this.say(npc.greeting);
      this.npcBody(npc);
    } else if (kind === "machine") {
      const m = MACHINES.find((mm) => mm.id === id);
      if (!m) return this.close();
      this.header(`${m.label} machine`, "Oripa machine", token);
      if (fresh) this.say("Pick a pack to open it on Gattchaa Oripa. Your pulls show up in your inventory there.");
      this.products(this.shop.data.products.filter((p) => m.match.test(p.category)), `machine-${id}`);
    } else if (kind === "table") {
      const host = NPCS.find((n) => n.kind === "rooms")!;
      this.header(host.name, host.title, token, host.look);
      if (fresh) this.say("Pull up a stool! These are the rooms open right now. Join one on Gattchaa and open packs together.");
      this.rooms(Number(id));
      this.links(LINKS.rooms, "rooms-table");
    }
    this.body.scrollTop = keepScroll;
  }

  private npcBody(npc: NpcDef) {
    const from = `npc-${npc.id}`;
    switch (npc.kind) {
      case "shop":
      case "kuji":
        this.products(npcProducts(npc, this.shop.data.products), from);
        break;
      case "rooms":
        this.rooms();
        this.links(LINKS.rooms, from);
        break;
      case "crier": {
        const fresh = this.shop.data.products.filter((p) => !p.soldOut).slice(0, 6);
        this.section("Fresh on Gattchaa");
        this.products(fresh, from, false);
        break;
      }
      case "guide":
        if (this.shop.data.siteOnline > 0) this.section(`${this.shop.data.siteOnline} collectors on Gattchaa right now`);
        this.links(LINKS.guide, from);
        break;
      case "market":
      case "grading":
      case "pickup":
        this.links(LINKS[npc.kind], from);
        break;
      default:
        break;
    }
  }

  private header(name: string, title: string, token: number, look?: string) {
    this.nameEl.textContent = name;
    this.titleEl.textContent = title;
    const ctx = this.portrait.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.portrait.width, this.portrait.height);
    if (!look) {
      const draw = () => ctx.drawImage(this.logo, 4, 4, 56, 56 * (this.logo.height / this.logo.width || 1));
      if (this.logo.complete) draw();
      else this.logo.onload = draw;
      return;
    }
    composeCharacter(look).then((sheet) => {
      if (token !== this.renderToken) return;
      // Head and shoulders from the "standing, facing down" frame.
      ctx.drawImage(sheet, 16, 2 * FRAME + 8, 32, 32, 0, 0, 64, 64);
    });
  }

  private say(text: string) {
    this.textEl.textContent = text;
    this.textEl.classList.remove("typing");
    void this.textEl.offsetWidth; // restart the fade-in
    this.textEl.classList.add("typing");
  }

  private section(text: string) {
    this.body.append(el("p", "dialog-section", text));
  }

  private products(list: ShopProduct[], from: string, sortSoldOutLast = true) {
    if (list.length === 0) {
      this.body.append(el("p", "dialog-empty", this.emptyText("Nothing in stock here right now. Check back soon!")));
      this.links([{ label: "See everything on Gattchaa", path: "/" }], from);
      return;
    }
    const items = sortSoldOutLast ? [...list].sort((a, b) => Number(a.soldOut) - Number(b.soldOut)) : list;
    const grid = el("div", "product-grid");
    for (const p of items) {
      const card = external(el("a", `product${p.soldOut ? " sold-out" : ""}`), tagLink(p.url, from));
      const img = el("img");
      img.loading = "lazy";
      img.alt = "";
      if (p.imageUrl) img.src = p.imageUrl;
      const pic = el("div", "product-pic");
      pic.append(img);
      if (p.soldOut) pic.append(el("span", "chip chip-dark", "Sold out"));
      else if (p.label) pic.append(el("span", "chip", p.label));
      else if (p.hot) pic.append(el("span", "chip", "Hot"));
      const price = el("div", "product-price", formatRupiah(p.price));
      if (p.was) price.append(el("s", "", formatRupiah(p.was)));
      card.append(pic, el("div", "product-title", p.title), el("div", "product-cat", p.category), price);
      grid.append(card);
    }
    this.body.append(grid);
  }

  /** What to say when a list is empty: still loading, shop not connected, or really empty. */
  private emptyText(reallyEmpty: string): string {
    if (!this.shop.loaded) return "Loading…";
    if (!this.shop.data.live) return "Live stock will show here soon. For now, have a look on Gattchaa Oripa!";
    return this.shop.data.updatedAt ? reallyEmpty : "Loading…";
  }

  private rooms(highlight?: number) {
    const rooms = this.shop.openRooms;
    if (rooms.length === 0) {
      this.body.append(el("p", "dialog-empty", this.emptyText("No open rooms right now. Start one from any pack page!")));
      return;
    }
    const ordered = highlight !== undefined && rooms[highlight] ? [rooms[highlight], ...rooms.filter((_, i) => i !== highlight)] : rooms;
    const list = el("div", "room-list");
    ordered.slice(0, 12).forEach((r: ShopRoom, i) => {
      const row = external(
        el("a", `room${i === 0 && highlight !== undefined ? " highlight" : ""}`),
        tagLink(r.url, "rooms"),
      );
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      if (r.product.imageUrl) img.src = r.product.imageUrl;
      const info = el("div", "room-info");
      info.append(el("span", `chip ${r.mode === "packs_battle" ? "chip-battle" : ""}`, ROOM_MODES[r.mode] ?? r.mode), el("div", "room-title", r.product.title));
      const seats = el("div", "room-seats");
      const bar = el("div", "seat-bar");
      const fill = el("div", "seat-fill");
      fill.style.width = `${Math.round((r.taken / Math.max(1, r.seats)) * 100)}%`;
      bar.append(fill);
      seats.append(bar, el("span", "", `${r.taken}/${r.seats} seats · ${formatRupiah(r.seatPrice)} per seat`));
      info.append(seats);
      row.append(img, info, el("span", "room-join", "Join"));
      list.append(row);
    });
    this.body.append(list);
  }

  private links(links: LinkSpec[], from: string) {
    for (const l of links) {
      const a = external(el("a", "dialog-link"), siteLink(this.shop.site, l.path, from));
      a.append(el("span", "", l.label));
      if (l.hint) a.append(el("small", "", l.hint));
      this.actions.append(a);
    }
  }
}
