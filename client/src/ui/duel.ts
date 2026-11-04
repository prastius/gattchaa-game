import { CLASSES, isClassId } from "../../../shared/rpg";
import { emblemOf } from "../../../shared/guild";
import { RARITY } from "../../../shared/items";
import { TITLES, isTitleId, type TitleDef } from "../../../shared/titles";
import type { DuelAskEvent, DuelEndEvent, DuelStartEvent } from "../../../shared/duels";
import { OUTLAW_MS } from "../../../shared/pvp";
import type { Net } from "../net";
import type { ChatUI } from "./chat";
import { audio } from "../audio";

// Duels on screen: the card that opens when you click another player (with
// "Challenge to a duel", and "Attack" in the Wildlands), a challenge you
// receive (Accept or Decline), and the bar across the top while you fight.
// The server runs the duel itself.

const $ = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What the card shows about the player you clicked. */
export interface PlayerInfo {
  name: string;
  lv?: number;
  cls?: string;
  title?: string;
  outlaw?: boolean;
  /** Their guild ("" or missing: none) and its emblem. */
  guild?: string;
  emblem?: number;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class DuelUI {
  private card = $("player-card");
  private ask = $("duel-ask");
  private bar = $("duel-bar");
  private pending?: DuelAskEvent & { until: number };
  private duel?: DuelStartEvent & { startsAt: number; endsAt: number };
  private timer?: number;

  constructor(
    private net: Net,
    private chat: ChatUI,
  ) {
    net.onDuelAsk.add((ev) => this.showAsk(ev));
    net.onDuelStart.add((ev) => this.start(ev));
    net.onDuelEnd.add((ev) => this.end(ev));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeCard();
    });
  }

  /** Your opponent's session id while you're in a duel. */
  get opponent(): string | undefined {
    return this.duel?.opp;
  }

  /** The fighting has started (the countdown is over). */
  get fighting(): boolean {
    return Boolean(this.duel) && performance.now() >= this.duel!.startsAt;
  }

  // ------------------------------------------------------------------ the player card

  /** Someone else was clicked: who they are, a challenge button, (in the Wildlands) `attack` them, and a party invite (or why not). */
  openCard(id: string, p: PlayerInfo, attack?: () => void, party?: { go?: () => void; note: string }, guild?: { go?: () => void; note: string }) {
    this.card.replaceChildren();
    const head = el("div", "player-card-head");
    head.append(el("b", "", p.name));
    const close = el("button", "dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.closeCard());
    head.append(close);
    const cls = isClassId(p.cls) ? CLASSES[p.cls].name : "";
    const about = el("div", "player-card-about", [p.lv ? `Lv ${p.lv}` : "", cls].filter(Boolean).join(" "));
    if (isTitleId(p.title)) {
      const t = TITLES[p.title] as TitleDef;
      const tag = el("span", "player-card-title", t.name);
      tag.style.color = RARITY[t.tier].color;
      about.append(" · ", tag);
    }
    if (p.outlaw) about.append(" · ", el("span", "player-card-outlaw", "☠ Outlaw"));
    const guildLine: HTMLElement[] = [];
    if (p.guild) {
      const { symbol, color } = emblemOf(p.emblem ?? 0);
      const line = el("div", "player-card-guild", `${symbol} ${p.guild}`);
      line.style.color = color;
      guildLine.push(line);
    }
    const fight: HTMLElement[] = [];
    if (attack) {
      const button = el("button", "dialog-link player-card-attack", `⚔ Attack ${p.name}`);
      button.type = "button";
      button.addEventListener("click", () => {
        audio.blip();
        attack();
        this.closeCard();
      });
      fight.push(button, el("p", "player-card-note", `They aren't an Outlaw: attacking makes you one for ${OUTLAW_MS / 60_000} minutes. Beaten while you're an Outlaw, you lose EXP and a bounty from your gold.`));
    }
    const challenge = el("button", "dialog-link primary player-card-duel", "⚔ Challenge to a duel");
    challenge.type = "button";
    challenge.disabled = Boolean(this.duel);
    challenge.addEventListener("click", () => {
      audio.blip();
      this.net.askDuel(id);
      this.closeCard();
    });
    const note = el("p", "player-card-note", this.duel ? "Finish your duel first." : "In the Arena's ring, it counts for the ranking. Nobody loses anything.");
    const together: HTMLElement[] = [];
    if (party?.go) {
      const invite = el("button", "dialog-link player-card-party", "👥 Invite to party");
      invite.type = "button";
      invite.addEventListener("click", () => {
        audio.blip();
        party.go!();
        this.closeCard();
      });
      together.push(invite);
    }
    if (party) together.push(el("p", "player-card-note", party.note));
    if (guild?.go) {
      const invite = el("button", "dialog-link player-card-guild-invite", "🛡 Invite to guild");
      invite.type = "button";
      invite.addEventListener("click", () => {
        audio.blip();
        guild.go!();
        this.closeCard();
      });
      together.push(invite);
    }
    if (guild) together.push(el("p", "player-card-note", guild.note));
    this.card.append(head, about, ...guildLine, ...fight, challenge, note, ...together);
    this.card.hidden = false;
  }

  closeCard() {
    this.card.hidden = true;
  }

  get cardOpen() {
    return !this.card.hidden;
  }

  // ------------------------------------------------------------------ a challenge for you

  private showAsk(ev: DuelAskEvent) {
    this.pending = { ...ev, until: performance.now() + ev.ms };
    this.ask.replaceChildren();
    const cls = isClassId(ev.cls) ? ` ${CLASSES[ev.cls].name}` : "";
    const text = el("div", "duel-ask-text");
    text.append(el("b", "", `⚔ ${ev.name}`), ` (Lv ${ev.lv}${cls}) challenges you to a duel!`);
    const sub = el("div", "duel-ask-sub", ev.ranked ? "In the Arena's ring: it counts for the ranking." : "Just for fun: nobody loses anything.");
    const buttons = el("div", "duel-ask-buttons");
    const yes = el("button", "dialog-link primary", "Accept");
    const no = el("button", "dialog-link", "Decline");
    for (const [b, answer] of [[yes, true], [no, false]] as const) {
      b.type = "button";
      b.addEventListener("click", () => {
        audio.blip();
        this.net.answerDuel(ev.from, answer);
        this.pending = undefined;
        this.ask.hidden = true;
      });
    }
    buttons.append(yes, no);
    const left = el("div", "duel-ask-time");
    left.append(el("i"));
    this.ask.append(text, sub, buttons, left);
    this.ask.hidden = false;
    audio.card();
    this.run();
  }

  // ------------------------------------------------------------------ the duel itself

  private start(ev: DuelStartEvent) {
    const now = performance.now();
    this.duel = { ...ev, startsAt: now + ev.countdown, endsAt: now + ev.countdown + ev.ms };
    this.closeCard();
    this.pending = undefined;
    this.ask.hidden = true;
    this.bar.replaceChildren();
    const text = el("span", "duel-bar-text");
    const give = el("button", "duel-give-up", "Give up");
    give.type = "button";
    give.addEventListener("click", () => {
      audio.blip();
      this.net.quitDuel();
    });
    this.bar.append(text, give);
    this.bar.hidden = false;
    this.chat.addSystem(
      `Duel with ${ev.name}${ev.ranked ? " (ranked)" : ""}! Click them (or press Space) to attack, and use your skills. No potions. ${ev.ranked ? "Stay inside the ring." : "Don't wander off."}`,
    );
    this.run();
  }

  private end(ev: DuelEndEvent) {
    this.duel = undefined;
    this.bar.hidden = true;
    const head = ev.result === "win" ? "You won the duel!" : ev.result === "lose" ? "You lost the duel." : "The duel is a draw.";
    let rating = "";
    if (ev.rating) {
      const [before, after] = ev.rating;
      rating = ` Arena rating: ${after} (${after >= before ? "+" : ""}${after - before}).`;
    }
    this.chat.addSystem(`${head} ${ev.why}.${rating}`);
    if (ev.result === "win") audio.fanfare();
  }

  /** Counts down the challenge and the duel clock while either is on screen. */
  private run() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), 200);
    this.tick();
  }

  private tick() {
    const now = performance.now();
    const p = this.pending;
    if (p) {
      const left = p.until - now;
      if (left <= 0) {
        this.pending = undefined;
        this.ask.hidden = true;
      } else (this.ask.querySelector(".duel-ask-time i") as HTMLElement).style.width = `${(left / p.ms) * 100}%`;
    }
    const d = this.duel;
    if (d) {
      const text = this.bar.querySelector(".duel-bar-text")!;
      const tag = d.ranked ? " · Ranked" : "";
      text.textContent = now < d.startsAt ? `⚔ Duel with ${d.name}${tag} · starting in ${Math.ceil((d.startsAt - now) / 1000)}…` : `⚔ Duel with ${d.name}${tag} · ${clock(d.endsAt - now)}`;
    }
    if (!this.pending && !this.duel) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
