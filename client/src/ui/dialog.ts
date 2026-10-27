import { NPCS, npcProducts, type NpcDef } from "../../../shared/npcs";
import { MACHINES, placeName } from "../../../shared/town";
import {
  ROOM_MODES,
  formatRupiah,
  siteLink,
  tagLink,
  type ShopProduct,
  type ShopRoom,
} from "../../../shared/gattchaa";
import { SHOP_AWAY_HOURS, SHOP_TITLE_MAX, signText, type PlayerShopDetails, type PlayerShopView } from "../../../shared/vending";
import { ITEMS, OUTFITTER_STOCK, RARITY, bonusText, itemName, sellPrice, wearersText, withArticle, type ItemDef, type ItemId } from "../../../shared/items";
import { CLASSES, JOBS, JOB_LEVEL, JOB_WEAPON, aClass, isClassId, statsFor, type ClassId } from "../../../shared/rpg";
import { skillsOf } from "../../../shared/skills";
import { FRAME, composeCharacter, itemIcon } from "../character";
import type { Shop } from "../shop";
import type { Vending } from "../vending";
import type { Net } from "../net";
import { audio } from "../audio";

// The panel that opens when you talk to someone, use a machine or visit a
// player's shop. Every link goes to gattchaaoripa.com (new tab), so buying,
// logging in and paying all happen on the actual site.

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
  sell: [
    { label: "List cards for sale", path: "/inventory", hint: "Listed cards show up in your shop" },
    { label: "The marketplace", path: "/marketplace" },
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
  private keepScroll = 0;
  /** What the open shop panel shows, so unrelated updates don't redraw it. */
  private shownShop = "";
  /** Shop panels opened from the Market Keeper's list get a way back to it. */
  private backTo?: string;
  /** Re-checks the spot under your feet while the open-a-shop form is up. */
  private spotTimer?: number;
  /** Which side of a merchant's counter is showing. */
  private tradeTab: "buy" | "sell" = "buy";
  /** The job you picked at the Job Master, waiting for "yes". */
  private jobConfirm?: ClassId;
  /** Opens the skills window (from the Job Master). */
  openSkills?: () => void;
  /** Where the conversation is happening; walking away closes it. */
  anchor = { x: 0, y: 0 };
  /** Where your character stands right now (set by the game scene). */
  selfPosition?: () => { x: number; y: number } | undefined;
  onClose?: () => void;

  constructor(
    private shop: Shop,
    private vending: Vending,
    private net: Net,
  ) {
    this.logo.src = `${import.meta.env.BASE_URL}assets/gattchaa/logo-64.png`;
    $("dialog-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    // Live data changes (stock, seats, shops opening) refresh whatever is open.
    shop.onChange(() => this.refresh(false));
    vending.onChange.add(() => this.refresh(true));
    // Gold and bag changes redraw a merchant's counter; a new job redraws the Job Master.
    const trade = () => {
      const kind = this.isOpen && this.openTarget ? NPCS.find((n) => `npc:${n.id}` === this.openTarget)?.kind : undefined;
      if (kind === "outfitter" || kind === "jobs") this.render(this.openTarget!, false);
    };
    net.onBag.add(trade);
    net.onStats.add(trade);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  get target() {
    return this.openTarget;
  }

  open(target: string, at: { x: number; y: number }) {
    this.anchor = at;
    this.backTo = undefined;
    this.tradeTab = "buy";
    this.jobConfirm = undefined;
    audio.blip();
    this.render(target, true);
    this.root.hidden = false;
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.openTarget = undefined;
    clearInterval(this.spotTimer);
    this.onClose?.();
  }

  // ------------------------------------------------------------------ content

  /** Redraws the open panel after a data update it shows (Gattchaa stock, or player shops). */
  private refresh(playerShops: boolean) {
    const target = this.openTarget;
    if (!target || !this.isOpen) return;
    const [kind, id] = target.split(":");
    const shops = kind === "vend" || kind === "shop" || target === "npc:keeper";
    if (shops !== playerShops) return;
    if (kind === "vend") {
      // Never wipe a half-typed shop title: only move on once your shop is open.
      const mine = this.vending.myShop;
      if (mine) this.render(`shop:${mine}`, true);
      return;
    }
    if (kind === "shop" && this.shopState(id) === this.shownShop) return;
    this.render(target, false);
  }

  private render(target: string, fresh: boolean) {
    this.openTarget = target;
    const [kind, id] = target.split(":");
    const token = ++this.renderToken;
    clearInterval(this.spotTimer);
    const keepScroll = fresh ? 0 : this.body.scrollTop;
    this.keepScroll = keepScroll;
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
    } else if (kind === "vend") {
      this.vendPanel(fresh, token);
    } else if (kind === "shop") {
      this.shopPanel(id, fresh, token);
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
      case "outfitter":
        this.counter(npc);
        break;
      case "jobs":
        this.jobs(npc);
        break;
      case "keeper":
        this.shopList();
        if (!this.vending.auth.signedIn) this.signInButton("Sign in to open your own shop");
        else if (!this.vending.myShop) this.button("Open my shop", "Pick a spot in this square (V)", () => this.render("vend", true), "primary");
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ the Job Master

  /** Knight, Mage or Archer: what each is like, and (from level 10) the choice, for good. */
  private jobs(npc: NpcDef) {
    const st = this.net.stats;
    const lv = st?.lv ?? 1;
    if (st && st.cls !== "novice" && isClassId(st.cls)) {
      this.body.append(el("p", "dialog-empty", `You are ${aClass(st.cls)} now. Every level brings a skill point: spend them in your skills (K).`));
      this.button("Open my skills", "K", () => this.openSkills?.(), "primary");
      return;
    }
    const pick = this.jobConfirm;
    if (pick) {
      const gift = JOB_WEAPON[pick];
      this.body.append(el("p", "job-confirm", `Become ${aClass(pick)}? A job is for life: you can't change it later.`));
      this.button(`Yes, make me ${aClass(pick)}`, gift ? `You get ${withArticle(ITEMS[gift].name)}` : undefined, () => {
        this.jobConfirm = undefined;
        this.net.chooseJob(npc.id, pick);
      }, "primary");
      this.button("Let me think again", undefined, () => {
        this.jobConfirm = undefined;
        this.render(`npc:${npc.id}`, false);
      });
      return;
    }
    const ready = lv >= JOB_LEVEL;
    if (!ready) this.body.append(el("p", "dialog-note", `You're level ${lv}. Come back at level ${JOB_LEVEL}: the South Meadow outside the gate is the place to train.`));
    const at = Math.max(lv, JOB_LEVEL);
    const cards = el("div", "job-cards");
    for (const id of JOBS) {
      const c = CLASSES[id];
      const s = statsFor(id, at);
      const card = el("div", `job-card job-${id}`);
      card.append(
        el("div", "job-name", c.name),
        el("p", "job-blurb", c.blurb),
        el("div", "job-stats", `At level ${at}: HP ${s.maxHp} · MP ${s.maxMp} · ATK ${s.atk} · DEF ${s.def}`),
        el("div", "job-skills", `Skills: ${skillsOf(id).map((k) => k.name).join(", ")}`),
      );
      const gift = JOB_WEAPON[id];
      if (gift) card.append(el("div", "job-gift", `Starts with ${withArticle(ITEMS[gift].name)} (${wearersText(ITEMS[gift]).toLowerCase() || "anyone"})`));
      const b = el("button", "job-choose", ready ? `Become ${aClass(id)}` : `Level ${JOB_LEVEL} needed`);
      b.type = "button";
      b.disabled = !ready;
      b.addEventListener("click", () => {
        audio.blip();
        this.jobConfirm = id;
        this.render(`npc:${npc.id}`, false);
        this.body.scrollTop = 0;
      });
      card.append(b);
      cards.append(card);
    }
    this.body.append(cards);
  }

  // ------------------------------------------------------------------ NPC merchants (in-game gold)

  /** A merchant's counter: buy their stock, or sell them what's in your bag. */
  private counter(npc: NpcDef) {
    const gold = this.net.stats?.gold ?? 0;
    const tabs = el("div", "trade-tabs");
    for (const [tab, label] of [["buy", "Buy"], ["sell", "Sell"]] as const) {
      const b = el("button", `trade-tab${this.tradeTab === tab ? " on" : ""}`, label);
      b.type = "button";
      b.addEventListener("click", () => {
        if (this.tradeTab === tab) return;
        this.tradeTab = tab;
        audio.blip();
        this.render(`npc:${npc.id}`, false);
        this.body.scrollTop = 0;
      });
      tabs.append(b);
    }
    const purse = el("span", "gold trade-gold");
    purse.append(el("span", "coin"), el("span", "", gold.toLocaleString("en-US")));
    tabs.append(purse);
    this.body.append(tabs);
    if (this.tradeTab === "buy") this.wares(npc, gold);
    else this.buyBack(npc);
  }

  private wares(npc: NpcDef, gold: number) {
    const list = el("div", "ware-list");
    for (const id of OUTFITTER_STOCK) {
      const it = ITEMS[id];
      const price = it.price ?? 0;
      const buttons: HTMLButtonElement[] = [this.wareButton(`Buy · ${price}`, gold >= price, () => this.net.buy(npc.id, id, 1))];
      if (it.kind === "use") buttons.push(this.wareButton(`×10 · ${price * 10}`, gold >= price * 10, () => this.net.buy(npc.id, id, 10)));
      list.append(this.ware(it, this.wareInfo(it), buttons));
    }
    this.body.append(list);
  }

  private buyBack(npc: NpcDef) {
    const bag = this.net.bag?.bag ?? [];
    let lootGold = 0;
    let lootCount = 0;
    for (const s of bag) {
      if (!s || ITEMS[s.id].kind !== "loot") continue;
      lootGold += sellPrice(ITEMS[s.id]) * s.n;
      lootCount += s.n;
    }
    if (lootCount > 0) {
      const all = el("button", "dialog-link primary sell-all");
      all.type = "button";
      all.append(el("span", "", `Sell all monster loot · +${lootGold} gold`), el("small", "", `${lootCount} item${lootCount === 1 ? "" : "s"}: jelly, scales, honey and the like`));
      all.addEventListener("click", () => {
        audio.coin();
        this.net.sellLoot(npc.id);
      });
      this.body.append(all);
    }
    const list = el("div", "ware-list");
    let cards = false;
    bag.forEach((s, slot) => {
      if (!s) return;
      const it = ITEMS[s.id];
      const price = sellPrice(it);
      cards ||= it.kind === "card";
      if (price <= 0) return;
      if (s.cards) {
        // Selling it would throw the cards away; Bram won't do that to you.
        list.append(this.ware(it, "Has cards in it: not for sale", [this.wareButton(`Sell · ${price}`, false, () => {})], itemName(s)));
        return;
      }
      const buttons = [this.wareButton(`Sell · ${price}`, true, () => this.net.sell(npc.id, slot, 1))];
      if (s.n > 1) buttons.push(this.wareButton(`All · ${price * s.n}`, true, () => this.net.sell(npc.id, slot, s.n)));
      list.append(this.ware(it, `${s.n > 1 ? `×${s.n} · ` : ""}${this.wareInfo(it)}`, buttons));
    });
    if (list.childElementCount === 0) {
      this.body.append(el("p", "dialog-empty", "Nothing in your bag to sell. Monsters outside the gate drop loot I'll gladly buy!"));
    } else this.body.append(list);
    this.body.append(el("p", "dialog-note", "Worn equipment isn't for sale: take it off in your bag (I) first."));
    if (cards) this.body.append(el("p", "dialog-note", "Monster cards? Keep those! Put them into your gear, or hold on to them: other adventurers will pay far more than I can."));
  }

  private wareInfo(it: ItemDef): string {
    const parts = [bonusText(it) || it.desc];
    if (it.lv && it.lv > 1) parts.unshift(`Lv ${it.lv}+`);
    const who = wearersText(it);
    if (who) parts.unshift(who);
    return parts.join(" · ");
  }

  private ware(it: ItemDef, info: string, buttons: HTMLButtonElement[], title = it.name) {
    const row = el("div", "ware");
    const icon = el("canvas", "ware-icon");
    icon.width = icon.height = 32;
    itemIcon(it.id as ItemId).then((c) => icon.getContext("2d")!.drawImage(c, 0, 0));
    const text = el("div", "ware-text");
    const name = el("div", "ware-name", title);
    name.style.color = RARITY[it.rarity].color;
    text.append(name, el("div", "ware-info", info));
    const actions = el("div", "ware-actions");
    actions.append(...buttons);
    row.append(icon, text, actions);
    return row;
  }

  private wareButton(label: string, enabled: boolean, onClick: () => void) {
    const b = el("button", "ware-button", label);
    b.type = "button";
    b.disabled = !enabled;
    b.addEventListener("click", () => {
      audio.coin();
      onClick();
    });
    return b;
  }

  // ------------------------------------------------------------------ player shops

  /** Everything the panel for a shop shows, as one string ("" once it's closed). */
  private shopState(id: string): string {
    const s = this.vending.shop(id);
    return s ? `${s.name}|${s.look}|${s.title}|${s.owner}|${s.cards}|${s.rev}` : "";
  }

  /** The Market Keeper's board: every open shop and where it is, browsable from right there. */
  private shopList() {
    const shops: { id: string; shop: PlayerShopView }[] = [];
    this.vending.forEach((shop, id) => shops.push({ id, shop }));
    if (shops.length === 0) {
      this.body.append(el("p", "dialog-empty", "No shops are open right now. Be the first: find a spot in the Market Square and press Open shop (V)!"));
      return;
    }
    // Sellers who are here first (you can chat with them), then the biggest shops.
    shops.sort((a, b) => Number(b.shop.owner !== "") - Number(a.shop.owner !== "") || b.shop.cards - a.shop.cards);
    this.section(`${shops.length} shop${shops.length === 1 ? "" : "s"} open`);
    const list = el("div", "room-list");
    for (const { id, shop } of shops) {
      const row = el("button", "room shop-row");
      row.type = "button";
      const info = el("div", "room-info");
      const cards = `${shop.cards} card${shop.cards === 1 ? "" : "s"}`;
      const where = placeName(shop.x, shop.y);
      info.append(el("div", "room-title", shop.title), el("div", "room-seats", `${shop.name} · ${cards} · ${shop.owner ? "here now" : "away"} · ${where}`));
      row.append(el("span", `shop-dot${shop.owner ? " on" : ""}`), info, el("span", "room-join", "Browse"));
      row.addEventListener("click", () => {
        this.backTo = this.openTarget;
        audio.blip();
        this.render(`shop:${id}`, true);
      });
      list.append(row);
    }
    this.body.append(list);
  }

  /** "Open shop": the form to open yours right where you stand, or how to get one. */
  private vendPanel(fresh: boolean, token: number) {
    const mine = this.vending.myShop;
    if (mine) return this.shopPanel(mine, fresh, token);
    this.header("Open a shop", "Player shops", token);
    const say = (text: string) => fresh && this.say(text);

    if (!this.vending.auth.signedIn) {
      say("Anyone signed in with Gattchaa can sit down in the Market Square and open a shop. It shows the cards you've listed on the Gattchaa marketplace, and buyers pay on gattchaaoripa.com.");
      this.signInButton("You'll come straight back to town");
      this.links(LINKS.sell, "vend");
      return;
    }
    say(`Find a free spot in the Market Square and open your shop! It shows the cards you've listed on the Gattchaa marketplace, and stays open for ${SHOP_AWAY_HOURS} hours after you leave town.`);

    // Whether this spot is allowed, checked again as you move (the server has the final say).
    const spot = el("p", "shop-spot");
    const checkSpot = () => {
      const at = this.selfPosition?.();
      const problem = at ? this.vending.spotProblem(at.x, at.y) : undefined;
      spot.textContent = problem ?? (at ? `Good spot: ${placeName(at.x, at.y)}.` : "");
      spot.classList.toggle("bad", Boolean(problem));
    };
    checkSpot();
    this.spotTimer = window.setInterval(checkSpot, 400);

    const form = el("form", "shop-form");
    const label = el("label", "shop-form-label", "Shop title");
    const input = el("input");
    input.maxLength = SHOP_TITLE_MAX;
    input.placeholder = "e.g. Cheap Pokémon SR!";
    input.autocomplete = "off";
    input.enterKeyHint = "go";
    label.append(input);
    const sign = el("small", "shop-form-hint", "Leave it empty for “your name's cards”.");
    input.addEventListener("input", () => {
      const title = input.value.trim();
      sign.textContent = title ? `Your sign: ${signText(title)}` : "Leave it empty for “your name's cards”.";
    });
    const submit = el("button", "shop-form-submit", "Open shop here");
    submit.type = "submit";
    const error = el("p", "shop-form-error");
    error.setAttribute("role", "alert");
    form.append(label, sign, spot, submit, error);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = "Opening…";
      error.textContent = "";
      const failed = await this.vending.open(input.value);
      if (token !== this.renderToken) return; // the shop appeared and the panel already moved on
      if (failed) {
        submit.disabled = false;
        submit.textContent = "Open shop here";
        error.textContent = failed;
        return;
      }
      // Open: the shop arrives with the next state update, and refresh() shows it.
      const opened = this.vending.myShop;
      if (opened) this.render(`shop:${opened}`, true);
    });
    this.body.append(form);
    this.links(LINKS.sell, "vend");
    // Ready to type on desktop (on phones the keyboard would cover the panel).
    if (fresh && matchMedia("(pointer: fine)").matches) setTimeout(() => input.focus(), 30);
  }

  /** A player's shop: their cards, each one a link to buy it on Gattchaa. */
  private shopPanel(id: string, fresh: boolean, token: number) {
    this.shownShop = this.shopState(id);
    const shop = this.vending.shop(id);
    if (this.backTo) this.button("← All shops", undefined, () => this.backTo && this.render(this.backTo, true));
    if (!shop) {
      this.header("Shop closed", "Player shops", token);
      this.say("This shop has just closed. Tina, the Market Keeper in the Market Square, knows which shops are still open.");
      return;
    }
    const mine = this.vending.isMine(id);
    const where = placeName(shop.x, shop.y);
    this.header(shop.name, mine ? `Your shop · ${where}` : `Player shop · ${shop.owner ? "seller is here" : "seller is away"} · ${where}`, token, shop.look);
    if (fresh) this.say(`“${shop.title}”`);

    const loading = el("p", "dialog-empty", "Loading cards…");
    this.body.append(loading);
    const keepScroll = this.keepScroll;
    this.vending.details(id).then((d) => {
      if (token !== this.renderToken) return;
      loading.remove();
      if (typeof d === "string") this.body.append(el("p", "dialog-empty", d));
      else this.listings(d, id, mine);
      this.body.scrollTop = keepScroll;
    });

    if (mine) {
      this.links([{ label: "Manage my listings", path: "/inventory", hint: "Changes show up here" }], `shop-${id}`);
      this.button("Close shop", "Stand up and roll up your rug", async (btn) => {
        btn.disabled = true;
        const failed = await this.vending.close();
        if (failed) btn.disabled = false;
        else this.close();
      }, "danger");
    }
  }

  private listings(d: PlayerShopDetails, stall: string, mine: boolean) {
    if (!d.fresh) this.section("Gattchaa isn't answering right now, so these may be out of date.");
    if (d.listings.length === 0) {
      this.body.append(el("p", "dialog-empty", mine ? "You have no cards listed right now. List some on Gattchaa and they'll show up here." : "Sold out! Check back later."));
      return;
    }
    const grid = el("div", "product-grid");
    for (const l of d.listings) {
      const card = external(el("a", "product"), tagLink(l.url, `shop-${stall}`));
      const img = el("img");
      img.loading = "lazy";
      img.alt = "";
      if (l.imageUrl) img.src = l.imageUrl;
      const pic = el("div", "product-pic");
      pic.append(img);
      if (l.grade) pic.append(el("span", "chip", l.grade));
      const meta = [l.condition, l.category].filter(Boolean).join(" · ");
      card.append(pic, el("div", "product-title", l.title), el("div", "product-cat", meta), el("div", "product-price", formatRupiah(l.price)));
      grid.append(card);
    }
    this.body.append(grid, el("p", "dialog-note", "You buy on gattchaaoripa.com, so payment and delivery are handled by Gattchaa."));
  }

  private signInButton(hint: string) {
    this.button("Sign in with Gattchaa", hint, () => {
      location.href = this.vending.auth.signInUrl;
    }, "primary");
  }

  private button(label: string, hint: string | undefined, onClick: (btn: HTMLButtonElement) => void, variant = "") {
    const b = el("button", `dialog-link${variant ? ` ${variant}` : ""}`);
    b.type = "button";
    b.append(el("span", "", label));
    if (hint) b.append(el("small", "", hint));
    b.addEventListener("click", () => onClick(b));
    this.actions.append(b);
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
