import { CLASSES, isClassId } from "../../../shared/rpg";
import { CASTLE_NAME } from "../../../shared/siege";
import {
  GUILD_FOUND_GOLD,
  GUILD_FOUND_LV,
  GUILD_GIFT_MIN,
  GUILD_MAX,
  GUILD_NOTICE_MAX,
  GuildRank,
  RANK_NAMES,
  emblemOf,
  type GuildAskEvent,
  type GuildMember,
  type GuildMessage,
} from "../../../shared/guild";
import type { Net } from "../net";
import { audio } from "../audio";

// The guild window (G): your guild's emblem and name, its record in the guild
// wars, its notice, its purse and history, and every member (who's online,
// their level and job, their rank, what they gave), with what your rank lets
// you do: invite from a player's card, remove, appoint officers, hand the
// guild over, change the notice, leave. Also the invite you get from a guild.

const $ = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const gold = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "5 min ago", "3 h ago", "2 days ago". */
function agoText(ms: number): string {
  const min = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const seenText = (m: GuildMember) => (m.online ? "online" : agoText(m.seen));

export class GuildUI {
  private root = $("guild");
  private list = $("guild-list");
  private head = $("guild-count");
  private ask = $("guild-ask");
  private guild: GuildMessage | null = null;
  private pending?: GuildAskEvent & { until: number };
  private timer?: number;
  /** Editing the notice right now (so a refresh doesn't throw away what you're typing). */
  private editing = false;
  /** What you've typed as a gift to the purse, and the box you type it in. */
  private gift = "";
  private giftBox?: HTMLInputElement;
  /** A button waiting for its second click ("Sure?"), and when that runs out. */
  private confirm?: { key: string; until: number };

  constructor(private net: Net) {
    $("guild-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    net.onGuild.add((g) => {
      this.guild = g;
      if (!g) this.editing = false;
      if (this.isOpen && !this.editing && document.activeElement !== this.giftBox) this.render();
    });
    net.onGuildAsk.add((ev) => this.showAsk(ev));
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** Your guild's name, if you're in one. */
  get name(): string | undefined {
    return this.guild?.name;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.root.hidden = false;
    audio.blip();
    this.render();
    // Levels and who's online change all the time: ask for a fresh list.
    this.net.getGuild();
  }

  close() {
    this.root.hidden = true;
    this.editing = false;
    this.confirm = undefined;
    this.gift = "";
  }

  /**
   * What the card of another player offers: a guild invite, or why not (or
   * nothing to say, when you're not in a guild). `theirs` is their guild's name.
   */
  inviteFor(id: string, theirs: string | undefined): { go?: () => void; note: string } | undefined {
    const g = this.guild;
    if (!g) return undefined;
    if (theirs === g.name) return { note: `In your guild, ${g.name}.` };
    if (g.rank < GuildRank.Officer) return undefined;
    if (theirs) return { note: "They're in another guild." };
    if (g.members.length >= GUILD_MAX) return { note: `Your guild is full (${GUILD_MAX}).` };
    return { go: () => this.net.inviteGuild(id), note: `${g.name} has ${g.members.length} of ${GUILD_MAX}. Guests need to sign in to join.` };
  }

  private render() {
    const g = this.guild;
    this.list.replaceChildren();
    if (!g) {
      this.head.textContent = "";
      this.list.append(
        el("p", "skills-hint", "You're not in a guild."),
        el(
          "p",
          "skills-hint",
          `Ask a guild's leader or an officer to invite you, or found your own: Leopold, the Guild Registrar on the main street just east of the fountain plaza, founds one for ${GUILD_FOUND_GOLD.toLocaleString("en-US")} gold from level ${GUILD_FOUND_LV}.`,
        ),
        el("p", "skills-hint", "Guild mates wear their guild's name and emblem over their heads, talk on their own chat (/g), and never fight each other in the Wildlands."),
      );
      return;
    }
    const online = g.members.filter((m) => m.online).length;
    this.head.textContent = `${g.members.length} / ${GUILD_MAX} · ${online} online`;

    const { symbol, color } = emblemOf(g.emblem);
    const banner = el("div", "guild-banner");
    const mark = el("span", "guild-emblem", symbol);
    mark.style.color = color;
    mark.style.borderColor = color;
    const title = el("div", "guild-title");
    const name = el("b", "", g.name);
    name.style.color = color;
    title.append(name, el("small", "", g.rank === GuildRank.Leader ? "You lead the guild" : g.rank === GuildRank.Officer ? "You're an officer" : "You're a member"));
    const holds = (this.net.room.state as { castle?: string }).castle === g.name;
    const wars = [holds && `🏰 Holds ${CASTLE_NAME}`, g.sieges > 0 && `${plural(g.sieges, "siege")} won`, g.crystals > 0 && `${plural(g.crystals, "crystal")} broken`].filter(Boolean);
    if (wars.length) title.append(el("small", "", wars.join(" · ")));
    banner.append(mark, title);
    this.list.append(banner);

    this.list.append(this.noticeBox(g));
    this.list.append(this.purseBox(g));

    this.list.append(el("p", "titles-group", "Members"));
    for (const m of g.members) this.list.append(this.memberRow(g, m));

    const foot = el("div", "guild-foot");
    const alone = g.members.length === 1;
    if (g.rank === GuildRank.Leader && !alone) {
      foot.append(el("p", "skills-hint", "You lead the guild. To leave, make another member the leader first."));
    } else {
      foot.append(this.confirmButton(alone ? "close" : "leave", alone ? "Close the guild" : "Leave the guild", "guild-leave", () => this.net.leaveGuild()));
      if (alone && g.purse > 0) foot.append(el("p", "skills-hint", `Closing the guild loses the ${gold(g.purse)} gold in its purse.`));
    }
    foot.append(el("p", "skills-hint", "Type /g and a message to talk to everyone in your guild who's online."));
    this.list.append(foot);
  }

  private noticeBox(g: GuildMessage): HTMLElement {
    const box = el("div", "guild-notice");
    const canEdit = g.rank >= GuildRank.Officer;
    if (this.editing && canEdit) {
      const input = el("textarea", "guild-notice-input");
      input.maxLength = GUILD_NOTICE_MAX;
      input.rows = 3;
      input.value = g.notice;
      input.placeholder = "A message for every member: when you meet, who to ask, what's next…";
      const save = el("button", "title-hide", "Save");
      save.type = "button";
      save.addEventListener("click", () => {
        audio.blip();
        this.editing = false;
        this.net.setGuildNotice(input.value);
        this.render();
      });
      const cancel = el("button", "title-hide", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => {
        this.editing = false;
        this.render();
      });
      const row = el("div", "guild-notice-buttons");
      row.append(save, cancel);
      box.append(input, row);
      queueMicrotask(() => input.focus());
      return box;
    }
    box.append(el("p", g.notice ? "guild-notice-text" : "guild-notice-text empty", g.notice || "No notice yet."));
    if (canEdit) {
      const edit = el("button", "title-hide", g.notice ? "Change" : "Write one");
      edit.type = "button";
      edit.addEventListener("click", () => {
        audio.blip();
        this.editing = true;
        this.render();
      });
      box.append(edit);
    }
    return box;
  }

  /** The purse: what's in it, the box to give gold, and where the gold went. */
  private purseBox(g: GuildMessage): HTMLElement {
    const box = el("div", "guild-purse");
    const head = el("div", "guild-purse-head");
    head.append(el("span", "", "Guild purse"), el("b", "", `${gold(g.purse)} gold`));
    const input = el("input", "guild-give-input");
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.placeholder = `Gold to give (${GUILD_GIFT_MIN}+)`;
    input.value = this.gift;
    this.giftBox = input;
    const give = this.confirmButton("give", "Give", "title-hide", () => {
      this.net.giveGuild(Number(this.gift));
      this.gift = "";
      this.render();
    }, "A gift to the purse is the guild's for good: nobody can take it back out");
    const check = () => {
      const n = Number(this.gift);
      give.disabled = n < GUILD_GIFT_MIN || n > (this.net.stats?.gold ?? 0);
    };
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 12);
      this.gift = input.value;
      check();
    });
    check();
    const row = el("div", "guild-give");
    row.append(input, give);
    box.append(head, row, el("p", "skills-hint", "The purse pays for castle guardians, and nobody can take gold back out of it."));
    if (g.log.length) {
      const log = el("ul", "guild-log");
      for (const l of g.log) {
        const line = el("li");
        const what = el("span", "", `${l.who} ${l.what}`);
        what.title = agoText(l.at);
        line.append(what, el("b", l.gold > 0 ? "in" : "", `${l.gold > 0 ? "+" : "−"}${gold(Math.abs(l.gold))}`));
        log.append(line);
      }
      box.append(log);
    }
    return box;
  }

  private memberRow(g: GuildMessage, m: GuildMember): HTMLElement {
    const row = el("div", `guild-member${m.online ? " online" : ""}${m.id === g.me ? " me" : ""}`);
    const who = el("div", "guild-who");
    const line = el("div", "guild-name");
    line.append(el("i", "guild-dot"), el("span", "", `${m.rank === GuildRank.Leader ? "♛ " : m.rank === GuildRank.Officer ? "✦ " : ""}${m.name}`));
    const cls = isClassId(m.cls) ? CLASSES[m.cls].name : "";
    who.append(line, el("small", "", `Lv ${m.lv}${cls ? ` ${cls}` : ""} · ${RANK_NAMES[m.rank]} · ${seenText(m)}${m.given ? ` · gave ${gold(m.given)}` : ""}`));
    row.append(who);
    if (m.id === g.me) return row;
    const acts = el("div", "guild-acts");
    if (g.rank === GuildRank.Leader) {
      if (m.rank === GuildRank.Member) acts.append(this.act("Officer", `Make ${m.name} an officer: they can invite and remove members, and change the notice`, () => this.net.setGuildRank(m.id, GuildRank.Officer)));
      else acts.append(this.act("Member", `Make ${m.name} a member again`, () => this.net.setGuildRank(m.id, GuildRank.Member)));
      acts.append(this.confirmButton(`lead:${m.id}`, "Leader", "guild-act", () => this.net.passGuild(m.id), `Hand the guild to ${m.name} (you become an officer)`));
    }
    if (g.rank > m.rank && g.rank >= GuildRank.Officer) acts.append(this.confirmButton(`kick:${m.id}`, "×", "guild-act guild-kick", () => this.net.kickGuild(m.id), `Remove ${m.name} from the guild`));
    if (acts.childElementCount) row.append(acts);
    return row;
  }

  private act(label: string, hint: string, go: () => void): HTMLButtonElement {
    const b = el("button", "guild-act", label);
    b.type = "button";
    b.title = hint;
    b.addEventListener("click", () => {
      audio.blip();
      go();
    });
    return b;
  }

  /** A button that needs a second click within a few seconds ("Sure?"), for things that are hard to undo. */
  private confirmButton(key: string, label: string, className: string, go: () => void, hint?: string): HTMLButtonElement {
    const armed = this.confirm?.key === key && this.confirm.until > performance.now();
    const b = el("button", `${className}${armed ? " armed" : ""}`, armed ? "Sure?" : label);
    b.type = "button";
    if (hint) b.title = hint;
    b.addEventListener("click", () => {
      audio.blip();
      if (this.confirm?.key === key && this.confirm.until > performance.now()) {
        this.confirm = undefined;
        go();
        return;
      }
      this.confirm = { key, until: performance.now() + 3000 };
      this.render();
      window.setTimeout(() => {
        if (this.confirm?.key === key && this.confirm.until <= performance.now()) {
          this.confirm = undefined;
          if (this.isOpen && !this.editing) this.render();
        }
      }, 3100);
    });
    return b;
  }

  // ------------------------------------------------------------------ an invite for you

  private showAsk(ev: GuildAskEvent) {
    this.pending = { ...ev, until: performance.now() + ev.ms };
    this.ask.replaceChildren();
    const { symbol, color } = emblemOf(ev.emblem);
    const text = el("div", "duel-ask-text");
    const guild = el("b", "", `${symbol} ${ev.guild}`);
    guild.style.color = color;
    text.append(el("b", "", ev.name), " invites you to join ", guild, ` (${ev.size}/${GUILD_MAX})!`);
    const sub = el("div", "duel-ask-sub", "A guild is for good: its name and emblem go over your head, you get guild chat (/g), and guild mates never fight in the Wildlands.");
    const buttons = el("div", "duel-ask-buttons");
    const yes = el("button", "dialog-link primary", "Join");
    const no = el("button", "dialog-link", "No thanks");
    for (const [b, answer] of [[yes, true], [no, false]] as const) {
      b.type = "button";
      b.addEventListener("click", () => {
        audio.blip();
        this.net.answerGuild(ev.from, answer);
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
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 200);
  }

  private tick() {
    const p = this.pending;
    const left = p ? p.until - performance.now() : 0;
    if (!p || left <= 0) {
      this.pending = undefined;
      this.ask.hidden = true;
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    (this.ask.querySelector(".duel-ask-time i") as HTMLElement).style.width = `${(left / p.ms) * 100}%`;
  }
}
