import { FERRY, NPCS, npcProducts, type NpcDef } from "../../../shared/npcs";
import { MACHINES, placeName } from "../../../shared/town";
import {
  ROOM_MODES,
  formatRupiah,
  siteLink,
  tagLink,
  type ShopProduct,
  type ShopRoom,
} from "../../../shared/gattchaa";
import {
  MAX_PRICE,
  SHOP_AWAY_HOURS,
  SHOP_TITLE_MAX,
  SHOP_WARES,
  goldText,
  inShopZone,
  isPrice,
  merchantPays,
  signText,
  type MarketWare,
  type PlayerShopDetails,
  type PlayerShopView,
  type ShopWare,
  type WarePick,
} from "../../../shared/vending";
import {
  AURA_LEVELS,
  ITEMS,
  MAX_UPGRADE,
  OUTFITTER_STOCK,
  RARITY,
  SLOTS,
  SLOT_NAMES,
  SMITH_STOCK,
  bonusText,
  canUpgrade,
  itemName,
  sellPrice,
  upgradeCost,
  upgradeStep,
  wearersText,
  withArticle,
  type ItemDef,
  type ItemId,
  type ItemStack,
  type Slot,
} from "../../../shared/items";
import { CLASSES, JOBS, JOB_LEVEL, JOB_WEAPON, SECOND_JOBS, SECOND_JOB_LEVEL, aClass, isClassId, statsFor, type ClassId } from "../../../shared/rpg";
import { skillsOf } from "../../../shared/skills";
import { PVP_DAMAGE, RATING_START, type ArenaBoard } from "../../../shared/duels";
import type { WildBoard } from "../../../shared/pvp";
import { FRAME, composeCharacter, itemIcon } from "../character";
import type { Shop } from "../shop";
import type { Vending } from "../vending";
import type { Net } from "../net";
import { audio } from "../audio";

// The panel that opens when you talk to someone, use a machine or visit a
// player's shop. Every link goes to gattchaaoripa.com (new tab), so buying
// real cards, logging in and paying all happen on the actual site. In-game
// things (gear, ingots, monster cards) are bought here with in-game gold.

/** Tina's "Find an item" shows this many results at most (search to narrow it down). */
const MARKET_ROWS = 40;

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
  /** Which side of the Blacksmith's window is showing. */
  private smithTab: "upgrade" | "buy" = "upgrade";
  /** How your last upgrade went, shown at the top of her window. */
  private forgeNote?: { ok: boolean; up: number; item: string };
  /** The Arena Master's ranking, as of the last time you asked. */
  private board?: ArenaBoard;
  /** Sable's board, and which part of it you're reading. */
  private wild?: WildBoard;
  private wildTab: "wanted" | "week" | "all" = "wanted";
  /** Which side of the Market Keeper's window is showing, and what you searched for. */
  private keeperTab: "shops" | "find" = "shops";
  private marketQuery = "";
  /** Your gold when the open player shop was drawn (its Buy buttons depend on it). */
  private shownGold = -1;
  /** The panel being drawn was just opened (not a refresh). */
  private renderFresh = false;
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
    // Gold and bag changes redraw a merchant's counter and the forge; a new job redraws the Job Master.
    const trade = () => {
      if (this.openKind === "outfitter" || this.openKind === "jobs" || this.openKind === "smith") this.render(this.openTarget!, false);
    };
    net.onBag.add(trade);
    net.onStats.add(trade);
    // Your gold decides which Buy buttons work in a player's shop.
    net.onStats.add(() => {
      const target = this.openTarget;
      if (this.isOpen && target?.startsWith("shop:") && (this.net.stats?.gold ?? 0) !== this.shownGold) this.render(target, false);
    });
    net.onArenaBoard.add((b) => {
      this.board = b;
      if (this.openKind === "arena") this.render(this.openTarget!, false);
    });
    net.onWildBoard.add((b) => {
      this.wild = b;
      if (this.openKind === "bounty") this.render(this.openTarget!, false);
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  get target() {
    return this.openTarget;
  }

  /** The kind of NPC you're talking to, if it's an NPC. */
  private get openKind() {
    return this.isOpen && this.openTarget ? NPCS.find((n) => `npc:${n.id}` === this.openTarget)?.kind : undefined;
  }

  /** The Blacksmith just finished with your gear. */
  forged(ok: boolean, up: number, item: string) {
    this.forgeNote = { ok, up, item };
    if (this.openKind === "smith") this.render(this.openTarget!, false);
  }

  open(target: string, at: { x: number; y: number }) {
    this.anchor = at;
    this.backTo = undefined;
    this.tradeTab = "buy";
    this.smithTab = "upgrade";
    this.keeperTab = "shops";
    this.marketQuery = "";
    this.forgeNote = undefined;
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
    // Don't wipe a search being typed; the results are fetched fresh on the next search anyway.
    if (target === "npc:keeper" && this.keeperTab === "find") return;
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
      this.renderFresh = fresh;
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
      case "smith":
        this.forge(npc);
        break;
      case "arena":
        this.arena(npc);
        break;
      case "ferry":
        this.ferry(npc);
        break;
      case "bounty":
        this.hunters(npc);
        break;
      case "keeper":
        this.body.append(this.tabs(npc, [["shops", "Shops"], ["find", "Find an item"]], this.keeperTab, (tab) => (this.keeperTab = tab), this.net.stats?.gold ?? 0));
        if (this.keeperTab === "find") this.marketFind();
        else this.shopList();
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
      const next = SECOND_JOBS[st.cls];
      if (next) return this.secondJob(npc, st.cls, next, lv);
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

  // ------------------------------------------------------------------ the Bounty Hunter

  /** Sable's board: who's an Outlaw right now (and their bounty), and the best hunters this week and of all time. */
  private hunters(npc: NpcDef) {
    if (!this.wild || this.renderFresh) this.net.wildBoard(npc.id);
    this.body.append(
      this.tabs(npc, [["wanted", "Most wanted"], ["week", "This week"], ["all", "All time"]], this.wildTab, (tab) => {
        this.wildTab = tab;
        this.net.wildBoard(npc.id);
      }, this.net.stats?.gold ?? 0),
    );
    const b = this.wild;
    if (!b) return void this.body.append(el("p", "dialog-empty", "Reading the board…"));
    if (this.wildTab === "wanted") {
      if (!b.wanted.length) {
        this.body.append(el("p", "dialog-empty", "No Outlaws right now. The Wildlands are quiet… for now."));
      } else {
        const list = el("ol", "arena-board wanted-board");
        for (const w of b.wanted) {
          const s = Math.ceil(w.ms / 1000);
          const row = el("li", w.you ? "me" : "");
          row.append(
            el("span", "wanted-skull", "☠"),
            el("span", "arena-name", `${w.name} · Lv ${w.lv}`),
            el("span", "arena-rating", `${goldText(w.bounty)} gold`),
            el("span", "arena-wl", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`),
          );
          list.append(row);
        }
        this.body.append(list);
      }
      this.body.append(el("p", "dialog-note", "Beat an Outlaw in the Wildlands and their bounty is yours: 5% of their gold, at most 5,000. Hunting Outlaws never makes you one."));
      return;
    }
    const rows = this.wildTab === "week" ? b.week : b.all;
    const mine = this.wildTab === "week" ? b.me?.week : b.me?.all;
    if (!b.saved) this.body.append(el("p", "dialog-note", "Sign in with Gattchaa to get your name on the board."));
    else if (mine) this.body.append(el("p", "arena-me", `You: #${mine.rank} · ${mine.wins} beaten · ${mine.bounties} Outlaw${mine.bounties === 1 ? "" : "s"} (${goldText(mine.gold)} gold in bounties)`));
    else this.body.append(el("p", "dialog-empty", this.wildTab === "week" ? "You haven't beaten anyone up there this week." : "You haven't beaten anyone up there yet."));
    this.section(this.wildTab === "week" ? "Top hunters this week" : "Top hunters of all time");
    if (!rows.length) this.body.append(el("p", "dialog-empty", this.wildTab === "week" ? "Nobody yet this week. The board is yours for the taking!" : "Nobody yet. Be the first!"));
    else {
      const list = el("ol", "arena-board");
      rows.forEach((r, i) => {
        const row = el("li", mine && r.name === mine.name && mine.rank === i + 1 ? "me" : "");
        row.append(el("span", "arena-rank", `${i + 1}`), el("span", "arena-name", r.name), el("span", "arena-rating", `${r.wins} beaten`), el("span", "arena-wl", `${r.bounties} ☠`));
        list.append(row);
      });
      this.body.append(list);
    }
    const days = Math.max(1, Math.ceil((b.resetAt - Date.now()) / 86_400_000));
    this.body.append(
      el(
        "p",
        "dialog-note",
        `${this.wildTab === "week" ? `The weekly board starts again every Monday (in ${days} day${days === 1 ? "" : "s"}). ` : ""}Only signed-in players are ranked, and beating the same player again only counts once every 10 minutes. ☠ counts the Outlaws among them.`,
      ),
    );
  }

  // ------------------------------------------------------------------ the ferry

  /** Sail to the other shore: the fare, and a word of warning for anyone not ready for it yet. */
  private ferry(npc: NpcDef) {
    const trip = FERRY[npc.id];
    if (!trip) return;
    const lv = this.net.stats?.lv ?? 1;
    const gold = this.net.stats?.gold ?? 0;
    if (trip.lv && lv < trip.lv) {
      this.body.append(el("p", "dialog-note", `${trip.dest} is for level ${trip.lv} and up, and you're level ${lv}. Its monsters will make short work of you!`));
    }
    this.button(`Sail to ${trip.dest}`, trip.fare ? `${goldText(trip.fare)} gold · you have ${goldText(gold)}` : "Free of charge", () => {
      this.net.ferry(npc.id);
      if (gold >= trip.fare) this.close();
    }, "primary");
  }

  /** A Knight, Mage or Archer: what their second job is like, and (from level 50) the step up. */
  private secondJob(npc: NpcDef, cls: ClassId, next: ClassId, lv: number) {
    const c = CLASSES[next];
    if (this.jobConfirm === next) {
      this.body.append(el("p", "job-confirm", `Become ${aClass(next)}? You keep everything you've learned, and there's no going back.`));
      this.button(`Yes, make me ${aClass(next)}`, "Three new skills on keys 4 to 6", () => {
        this.jobConfirm = undefined;
        this.net.chooseJob(npc.id, next);
      }, "primary");
      this.button("Let me think again", undefined, () => {
        this.jobConfirm = undefined;
        this.render(`npc:${npc.id}`, false);
      });
      return;
    }
    const ready = lv >= SECOND_JOB_LEVEL;
    this.body.append(
      el(
        "p",
        "dialog-note",
        ready
          ? `You've come a long way, ${CLASSES[cls].name}. You're ready for your second job.`
          : `You're level ${lv}. At level ${SECOND_JOB_LEVEL}, come back and I'll make you ${aClass(next)}. Frostfell, across the sea, is the place to get there.`,
      ),
    );
    const at = Math.max(lv, SECOND_JOB_LEVEL);
    const now = statsFor(cls, at);
    const then = statsFor(next, at);
    const card = el("div", `job-card job-${next}`);
    card.append(
      el("div", "job-name", c.name),
      el("p", "job-blurb", c.blurb),
      el("div", "job-stats", `At level ${at}: HP ${then.maxHp} (+${then.maxHp - now.maxHp}) · MP ${then.maxMp} (+${then.maxMp - now.maxMp}) · ATK ${then.atk} (+${then.atk - now.atk}) · DEF ${then.def} (+${then.def - now.def})`),
      el("div", "job-skills", `Keeps your ${CLASSES[cls].name} skills and gear, and adds: ${skillsOf(next).filter((k) => k.cls === next).map((k) => k.name).join(", ")}`),
    );
    const b = el("button", "job-choose", ready ? `Become ${aClass(next)}` : `Level ${SECOND_JOB_LEVEL} needed`);
    b.type = "button";
    b.disabled = !ready;
    b.addEventListener("click", () => {
      audio.blip();
      this.jobConfirm = next;
      this.render(`npc:${npc.id}`, false);
      this.body.scrollTop = 0;
    });
    card.append(b);
    const cards = el("div", "job-cards");
    cards.append(card);
    this.body.append(cards);
    this.button("Open my skills", "K", () => this.openSkills?.());
  }

  // ------------------------------------------------------------------ the Arena Master

  /** How duels work, your record, and the ten best. */
  private arena(npc: NpcDef) {
    if (!this.board || this.renderFresh) this.net.arenaBoard(npc.id);
    const half = Math.round((1 - PVP_DAMAGE) * 100);
    this.section("How duels work");
    const rules = el("ul", "arena-rules");
    for (const line of [
      "Click (or tap) another player and choose Challenge to a duel. They have 20 seconds to accept.",
      `After 3, 2, 1 you fight until one of you drops. Player hits do ${half}% less damage, so use your skills. No potions.`,
      "Fight inside this ring, both signed in, and it counts for the ranking: the winner takes rating points from the loser. Step out of the ring and you lose.",
      "Anywhere else a duel is just for fun. Either way, you're both healed afterwards, and nobody loses EXP or items.",
    ]) rules.append(el("li", "", line));
    this.body.append(rules);

    const b = this.board;
    this.section("Your record");
    if (!b) this.body.append(el("p", "dialog-empty", "Fetching the ranking…"));
    else if (!b.saved) this.body.append(el("p", "dialog-empty", "Guests can duel, but only signed-in players are ranked."));
    else if (!b.me) this.body.append(el("p", "dialog-empty", `No ranked duels yet. Everyone starts at ${RATING_START}.`));
    else this.body.append(el("p", "arena-me", `#${b.me.rank} · rating ${b.me.rating} · ${b.me.wins} won, ${b.me.losses} lost`));

    this.section("The ten best");
    if (b && b.top.length === 0) this.body.append(el("p", "dialog-empty", "Nobody yet. Be the first to win on the sand!"));
    else if (b) {
      const list = el("ol", "arena-board");
      b.top.forEach((r, i) => {
        const row = el("li", r.name === b.me?.name && b.me.rank === i + 1 ? "me" : "");
        row.append(el("span", "arena-rank", `${i + 1}`), el("span", "arena-name", r.name), el("span", "arena-rating", String(r.rating)), el("span", "arena-wl", `${r.wins}–${r.losses}`));
        list.append(row);
      });
      this.body.append(list);
    }
  }

  // ------------------------------------------------------------------ the Blacksmith

  /** Upgrade what you wear or carry, or buy Iron Ingots. */
  private forge(npc: NpcDef) {
    const gold = this.net.stats?.gold ?? 0;
    this.body.append(this.tabs(npc, [["upgrade", "Upgrade"], ["buy", "Buy ingots"]], this.smithTab, (tab) => (this.smithTab = tab), gold));
    if (this.smithTab === "buy") {
      const list = el("div", "ware-list");
      for (const id of SMITH_STOCK) list.append(this.forSale(npc, id, gold));
      this.body.append(list, el("p", "dialog-note", "Mithril Ingots and Star Crystals aren't for sale: monsters in Dusk Hollow drop them, and the Pumpking always carries some."));
      return;
    }

    const note = this.forgeNote;
    if (note) {
      this.body.append(
        el("p", `forge-note ${note.ok ? "ok" : "fail"}`, note.ok ? `Success! Your ${note.item} is now +${note.up}.` : `It failed: your ${note.item} went down to +${note.up}.`),
      );
    }
    const bag = this.net.bag;
    const count = (id: ItemId) => (bag?.bag ?? []).reduce((n, s) => n + (s?.id === id ? s.n : 0), 0);
    const ores: ItemId[] = ["ironIngot", "mithril", "starCrystal"];
    this.body.append(el("div", "forge-ores", `Your ingots: ${ores.map((id) => `${ITEMS[id].name} ×${count(id)}`).join(" · ")}`));

    // What you wear first, then the bag.
    const pieces: { s: ItemStack; at: { gear: Slot } | { bag: number } }[] = [];
    for (const slot of SLOTS) {
      const s = bag?.gear[slot];
      if (s && canUpgrade(ITEMS[s.id])) pieces.push({ s, at: { gear: slot } });
    }
    bag?.bag.forEach((s, i) => {
      if (s && canUpgrade(ITEMS[s.id])) pieces.push({ s, at: { bag: i } });
    });
    const list = el("div", "ware-list forge-list");
    for (const { s, at } of pieces) {
      const it = ITEMS[s.id];
      const up = s.up ?? 0;
      const step = upgradeStep(it);
      const each = step.atk ? `ATK +${step.atk}` : `DEF +${step.def}`;
      const worn = "gear" in at ? "Worn · " : "";
      if (up >= MAX_UPGRADE) {
        list.append(this.ware(it, `${worn}Fully upgraded (${each} ×${up})`, [this.wareButton(`+${MAX_UPGRADE}`, false, () => {})], itemName(s)));
        continue;
      }
      const cost = upgradeCost(up + 1);
      const ready = gold >= cost.gold && count(cost.ore) > 0;
      const info = `${worn}To +${up + 1}: ${Math.round(cost.chance * 100)}% · ${cost.gold} gold + ${ITEMS[cost.ore].name} · each upgrade ${each}`;
      list.append(this.ware(it, info, [this.wareButton(`Upgrade to +${up + 1}`, ready, () => this.net.upgrade(npc.id, at))], itemName(s)));
    }
    if (pieces.length === 0) this.body.append(el("p", "dialog-empty", "You have nothing I can upgrade. Bring me a weapon, a shield, a helmet, armour, legs or boots."));
    else this.body.append(list);
    const chances = Array.from({ length: MAX_UPGRADE - 4 }, (_, i) => `+${i + 5} ${Math.round(upgradeCost(i + 5).chance * 100)}%`).join(" · ");
    this.body.append(
      el("p", "dialog-note", `Up to +4 always works. After that: ${chances}. A failed upgrade drops it one level; it never breaks. Rings and amulets can't be upgraded.`),
      el("p", "dialog-note", `Wear gear at +${AURA_LEVELS[0]} or higher and you get an aura: blue at +${AURA_LEVELS[0]}, violet at +${AURA_LEVELS[1]}, gold at +${AURA_LEVELS[2]}.`),
    );
  }

  /** Tabs across the top of a merchant's window, with your gold at the end. */
  private tabs<T extends string>(npc: NpcDef, tabs: [T, string][], current: T, pick: (tab: T) => void, gold: number) {
    const row = el("div", "trade-tabs");
    for (const [tab, label] of tabs) {
      const b = el("button", `trade-tab${current === tab ? " on" : ""}`, label);
      b.type = "button";
      b.addEventListener("click", () => {
        if (current === tab) return;
        pick(tab);
        audio.blip();
        this.render(`npc:${npc.id}`, false);
        this.body.scrollTop = 0;
      });
      row.append(b);
    }
    const purse = el("span", "gold trade-gold");
    purse.append(el("span", "coin"), el("span", "", gold.toLocaleString("en-US")));
    row.append(purse);
    return row;
  }

  // ------------------------------------------------------------------ NPC merchants (in-game gold)

  /** A merchant's counter: buy their stock, or sell them what's in your bag. */
  private counter(npc: NpcDef) {
    const gold = this.net.stats?.gold ?? 0;
    this.body.append(this.tabs(npc, [["buy", "Buy"], ["sell", "Sell"]], this.tradeTab, (tab) => (this.tradeTab = tab), gold));
    if (this.tradeTab === "buy") this.wares(npc, gold);
    else this.buyBack(npc);
  }

  private wares(npc: NpcDef, gold: number) {
    const list = el("div", "ware-list");
    for (const id of OUTFITTER_STOCK) list.append(this.forSale(npc, id, gold));
    this.body.append(list);
  }

  /** One thing a merchant sells, with Buy (and ×10 for things that stack). */
  private forSale(npc: NpcDef, id: ItemId, gold: number) {
    const it = ITEMS[id];
    const price = it.price ?? 0;
    const buttons: HTMLButtonElement[] = [this.wareButton(`Buy · ${price}`, gold >= price, () => this.net.buy(npc.id, id, 1))];
    if (it.kind === "use" || it.kind === "material") buttons.push(this.wareButton(`×10 · ${price * 10}`, gold >= price * 10, () => this.net.buy(npc.id, id, 10)));
    return this.ware(it, this.wareInfo(it), buttons);
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
      if (s.cards || s.up) {
        // Selling it would throw the cards (or the upgrades) away; Bram won't do that to you.
        list.append(this.ware(it, `${s.cards ? "Has cards in it" : "Upgraded"}: not for sale`, [this.wareButton(`Sell · ${price}`, false, () => {})], itemName(s)));
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
    if (it.kind === "card" && it.fits) parts.push(`goes in: ${it.fits.map((s) => SLOT_NAMES[s].toLowerCase()).join(", ")}`);
    return parts.join(" · ");
  }

  /** What one particular piece is like: the item, plus what its upgrades add. */
  private stackInfo(s: ItemStack): string {
    const it = ITEMS[s.id];
    if (!s.up) return this.wareInfo(it);
    const step = upgradeStep(it);
    return `${this.wareInfo(it)} · upgrades add ${step.atk ? `ATK +${step.atk * s.up}` : `DEF +${step.def * s.up}`}`;
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
    return s ? `${s.name}|${s.look}|${s.title}|${s.owner}|${s.cards}|${s.items}|${s.rev}` : "";
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
    shops.sort((a, b) => Number(b.shop.owner !== "") - Number(a.shop.owner !== "") || b.shop.items + b.shop.cards - (a.shop.items + a.shop.cards));
    this.section(`${shops.length} shop${shops.length === 1 ? "" : "s"} open`);
    const list = el("div", "room-list");
    for (const { id, shop } of shops) {
      const row = el("button", "room shop-row");
      row.type = "button";
      const info = el("div", "room-info");
      const what = [shop.items && `${shop.items} for gold`, shop.cards && `${shop.cards} card${shop.cards === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "sold out";
      info.append(el("div", "room-title", shop.title), el("div", "room-seats", `${shop.name} · ${what} · ${shop.owner ? "here now" : "away"}`));
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

  /** Tina's "Find an item": everything for gold in every shop, cheapest first, with a search box. */
  private marketFind() {
    const token = this.renderToken;
    const input = el("input", "market-search");
    input.type = "search";
    input.placeholder = "Search: Mithril, Saber, Slime Card…";
    input.value = this.marketQuery;
    input.autocomplete = "off";
    input.enterKeyHint = "search";
    input.setAttribute("aria-label", "Search the shops");
    const status = el("p", "dialog-empty", "Looking around the square…");
    const results = el("div", "ware-list");
    this.body.append(input, status, results);
    let wares: MarketWare[] | undefined;
    const draw = () => {
      if (!wares) return;
      const q = this.marketQuery.trim().toLowerCase();
      const hits = wares
        .filter((w) => !q || itemName(w.item).toLowerCase().includes(q))
        .sort((a, b) => ITEMS[a.item.id].name.localeCompare(ITEMS[b.item.id].name) || a.price - b.price);
      status.textContent =
        wares.length === 0 ? "Nobody is selling anything for gold right now." : hits.length === 0 ? `Nobody is selling “${this.marketQuery.trim()}” right now.` : "";
      status.hidden = !status.textContent;
      results.replaceChildren();
      for (const w of hits.slice(0, MARKET_ROWS)) {
        const visit = el("button", "ware-button", "Visit");
        visit.type = "button";
        visit.addEventListener("click", () => {
          audio.blip();
          this.backTo = this.openTarget;
          this.render(`shop:${w.shop}`, true);
        });
        const info = `${goldText(w.price)} gold${w.item.n > 1 ? ` each · ${w.item.n} left` : ""} · ${w.seller}'s shop`;
        results.append(this.ware(ITEMS[w.item.id], info, [visit], itemName(w.item)));
      }
      if (hits.length > MARKET_ROWS) results.append(el("p", "dialog-note", `…and ${hits.length - MARKET_ROWS} more. Search to narrow it down.`));
    };
    input.addEventListener("input", () => {
      this.marketQuery = input.value;
      draw();
    });
    this.vending.market().then((m) => {
      if (token !== this.renderToken) return;
      if (typeof m === "string") status.textContent = m;
      else {
        wares = m.wares;
        draw();
      }
    });
    if (matchMedia("(pointer: fine)").matches) setTimeout(() => token === this.renderToken && input.focus(), 30);
  }

  /** "Open shop": the form to open yours right where you stand, or how to get one. */
  private vendPanel(fresh: boolean, token: number) {
    const mine = this.vending.myShop;
    if (mine) return this.shopPanel(mine, fresh, token);
    this.header("Open a shop", "Player shops", token);
    const say = (text: string) => fresh && this.say(text);

    if (!this.vending.auth.signedIn) {
      say("Anyone signed in with Gattchaa can sit down in the Market Square and open a shop: sell things from your bag for gold, and show the cards you've listed on the Gattchaa marketplace.");
      this.signInButton("You'll come straight back to town");
      this.links(LINKS.sell, "vend");
      return;
    }
    say(`Find a free spot in the Market Square and open your shop! Sell things from your bag for gold; the cards you've listed on the Gattchaa marketplace show up too. It stays open for ${SHOP_AWAY_HOURS} hours after you leave town.`);

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
    const sign = el("small", "shop-form-hint", "Leave it empty for “your name's shop”.");
    input.addEventListener("input", () => {
      const title = input.value.trim();
      sign.textContent = title ? `Your sign: ${signText(title)}` : "Leave it empty for “your name's shop”.";
    });
    const picks = new Map<number, { n: number; price: string }>();
    const picker = this.warePicker(picks);
    const submit = el("button", "shop-form-submit", "Open shop here");
    submit.type = "submit";
    const error = el("p", "shop-form-error");
    error.setAttribute("role", "alert");
    form.append(label, sign, picker, spot, submit, error);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";
      const bag = this.net.bag?.bag ?? [];
      const wares: WarePick[] = [];
      for (const [slot, p] of picks) {
        const s = bag[slot];
        const price = Number(p.price);
        if (!s) return void (error.textContent = "Something you picked isn't in your bag any more. Please pick again.");
        if (!isPrice(price)) return void (error.textContent = `Set a price for your ${itemName(s)}: 1 to ${goldText(MAX_PRICE)} gold.`);
        if (!(Number.isInteger(p.n) && p.n >= 1 && p.n <= s.n)) return void (error.textContent = `How many ${ITEMS[s.id].name}? You have ${s.n}.`);
        wares.push({ slot, n: p.n, price });
      }
      submit.disabled = true;
      submit.textContent = "Opening…";
      const failed = await this.vending.open(input.value, wares);
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

  /** What's in your bag, each thing a tap away from going in your shop with a price. */
  private warePicker(picks: Map<number, { n: number; price: string }>) {
    const box = el("div", "pick-box");
    box.append(el("div", "shop-form-label", "Sell from your bag, for gold"));
    const count = el("small", "shop-form-hint");
    const recount = () =>
      (count.textContent = picks.size
        ? `${picks.size} of ${SHOP_WARES} picked. They leave your bag until they sell; whatever doesn't sell comes back when your shop closes.`
        : `Pick up to ${SHOP_WARES} things. Pick nothing to show only your Gattchaa cards.`);
    recount();
    box.append(count);
    const list = el("div", "ware-list");
    (this.net.bag?.bag ?? []).forEach((s, slot) => {
      if (!s) return;
      const it = ITEMS[s.id];
      const pays = merchantPays(s);
      const fields = el("div", "pick-fields");
      fields.hidden = true;
      const field = (text: string, input: HTMLInputElement) => {
        const l = el("label", "pick-field", text);
        l.append(input);
        fields.append(l);
        return input;
      };
      const number = (max: number) => {
        const i = el("input");
        i.type = "number";
        i.inputMode = "numeric";
        i.min = "1";
        i.max = String(max);
        i.step = "1";
        return i;
      };
      const price = field("Gold each", number(MAX_PRICE));
      price.placeholder = "Price";
      const qty = s.n > 1 ? field(`How many (of ${s.n})`, number(s.n)) : undefined;
      if (qty) qty.value = String(s.n);
      const warn = el("small", "pick-warn");
      fields.append(warn);
      const update = () => {
        const p = picks.get(slot);
        if (p) Object.assign(p, { price: price.value, n: qty ? Number(qty.value) : 1 });
        const asked = Number(price.value);
        warn.textContent = pays && asked > 0 && asked < pays ? `Careful: Bram the Outfitter pays ${pays} gold for one of these.` : "";
      };
      price.addEventListener("input", update);
      qty?.addEventListener("input", update);

      const toggle = el("button", "ware-button pick-toggle", "Sell");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        if (picks.has(slot)) picks.delete(slot);
        else if (picks.size < SHOP_WARES) picks.set(slot, { n: s.n, price: "" });
        else return;
        audio.blip();
        const on = picks.has(slot);
        if (on) update();
        fields.hidden = !on;
        toggle.textContent = on ? "✓ Selling" : "Sell";
        toggle.classList.toggle("on", on);
        recount();
        if (on && matchMedia("(pointer: fine)").matches) price.focus();
      });
      const info = [s.n > 1 ? `×${s.n}` : "", this.stackInfo(s), pays ? `Bram pays ${pays}` : ""].filter(Boolean).join(" · ");
      const pick = el("div", "pick");
      pick.append(this.ware(it, info, [toggle], itemName(s)), fields);
      list.append(pick);
    });
    if (list.childElementCount === 0) box.append(el("p", "dialog-empty", "Your bag is empty."));
    else box.append(list);
    box.append(el("small", "shop-form-hint", "Gear you're wearing isn't listed: take it off in your bag (I) first."));
    return box;
  }

  /** A player's shop: things for gold, and their Gattchaa cards (each a link to buy it on the site). */
  private shopPanel(id: string, fresh: boolean, token: number) {
    this.shownShop = this.shopState(id);
    this.shownGold = this.net.stats?.gold ?? 0;
    const shop = this.vending.shop(id);
    if (this.backTo) this.button("← Back", undefined, () => this.backTo && this.render(this.backTo, true));
    if (!shop) {
      this.header("Shop closed", "Player shops", token);
      this.say("This shop has just closed. Tina, the Market Keeper in the Market Square, knows which shops are still open.");
      return;
    }
    const mine = this.vending.isMine(id);
    const where = placeName(shop.x, shop.y);
    this.header(shop.name, mine ? `Your shop · ${where}` : `Player shop · ${shop.owner ? "seller is here" : "seller is away"} · ${where}`, token, shop.look);
    if (fresh) this.say(`“${shop.title}”`);

    const loading = el("p", "dialog-empty", "Loading…");
    this.body.append(loading);
    const keepScroll = this.keepScroll;
    this.vending.details(id).then((d) => {
      if (token !== this.renderToken) return;
      loading.remove();
      if (typeof d === "string") this.body.append(el("p", "dialog-empty", d));
      else this.shopGoods(d, id, mine);
      this.body.scrollTop = keepScroll;
    });

    if (mine) {
      this.links([{ label: "Manage my Gattchaa listings", path: "/inventory", hint: "Changes show up here" }], `shop-${id}`);
      this.button("Close shop", "What didn't sell goes back in your bag", async (btn) => {
        btn.disabled = true;
        const failed = await this.vending.close();
        if (failed) btn.disabled = false;
        else this.close();
      }, "danger");
    }
  }

  /** What a player's shop sells: things for gold first, then their real cards on Gattchaa. */
  private shopGoods(d: PlayerShopDetails, id: string, mine: boolean) {
    const wares = d.wares.map((w, i) => ({ w, i })).filter(({ w }) => mine || w.item.n > 0);
    if (wares.length) this.goldWares(id, wares, mine);
    if (d.listings.length) this.listings(d, id, wares.length > 0);
    if (wares.length || d.listings.length) return;
    const empty = !d.fresh
      ? "Gattchaa isn't answering right now, so this shop's cards can't be shown. Try again in a moment."
      : mine
        ? "Nothing for sale right now. Close your shop and open it again with things from your bag, or list cards on Gattchaa."
        : "Sold out! Check back later.";
    this.body.append(el("p", "dialog-empty", empty));
  }

  /** Things from the seller's bag, for in-game gold. */
  private goldWares(shopId: string, wares: { w: ShopWare; i: number }[], mine: boolean) {
    const gold = this.net.stats?.gold ?? 0;
    const head = el("div", "shop-head");
    head.append(el("span", "dialog-section", mine ? "Your things for gold" : "For gold"));
    if (!mine) {
      const purse = el("span", "gold trade-gold");
      purse.append(el("span", "coin"), el("span", "", goldText(gold)));
      head.append(purse);
    }
    this.body.append(head);
    const at = this.selfPosition?.();
    const here = !at || inShopZone(at.x, at.y);
    const list = el("div", "ware-list");
    for (const { w, i } of wares) {
      const it = ITEMS[w.item.id];
      const left = w.item.n;
      const about = this.stackInfo(w.item);
      const buttons: HTMLButtonElement[] = [];
      let info: string;
      if (mine) info = `${left ? `${left} left` : "Sold out"}${w.sold ? ` · ${w.sold} sold` : ""} · ${goldText(w.price)} gold${left > 1 ? " each" : ""}`;
      else {
        info = `${left > 1 ? `${left} left · ` : ""}${about}`;
        buttons.push(this.wareButton(`Buy · ${goldText(w.price)}`, here && gold >= w.price, () => this.vending.buy(shopId, i, w, 1)));
        if (left > 1) buttons.push(this.wareButton(`All ${left} · ${goldText(w.price * left)}`, here && gold >= w.price * left, () => this.vending.buy(shopId, i, w, left)));
      }
      list.append(this.ware(it, info, buttons, itemName(w.item)));
    }
    this.body.append(list);
    if (mine) {
      const earned = wares.reduce((sum, { w }) => sum + w.sold * w.price, 0);
      this.body.append(
        el("p", "dialog-note", earned ? `Sold so far: ${goldText(earned)} gold, already in your purse.` : "When something sells, the gold goes straight into your purse, even while you're away."),
      );
    } else if (!here) this.body.append(el("p", "dialog-note", "Come to the Market Square to buy."));
  }

  /** The seller's real cards, listed on the Gattchaa marketplace: bought on the site, never with gold. */
  private listings(d: PlayerShopDetails, stall: string, afterWares: boolean) {
    this.section(afterWares ? "Real cards on Gattchaa · paid on gattchaaoripa.com, not with gold" : "Cards on Gattchaa");
    if (!d.fresh) this.section("Gattchaa isn't answering right now, so these may be out of date.");
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
