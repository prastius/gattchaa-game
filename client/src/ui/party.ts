import { CLASSES, isClassId } from "../../../shared/rpg";
import { PARTY_MAX, type PartyAskEvent, type PartyMessage } from "../../../shared/party";
import type { Net } from "../net";
import { audio } from "../audio";

// Your party on screen: the members under your status (name, level and job,
// a health bar, a crown on the leader), Leave and (for the leader) remove
// buttons, and the invite you get from someone else (Accept or Decline).

const $ = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class PartyUI {
  private panel = $("party");
  private ask = $("party-ask");
  private party: PartyMessage | null = null;
  private pending?: PartyAskEvent & { until: number };
  private timer?: number;
  /** Party members moved or changed: the minimap and the name colours follow. */
  onChange?: (party: PartyMessage | null) => void;

  constructor(private net: Net) {
    net.onParty.add((p) => this.set(p));
    net.onPartyAsk.add((ev) => this.showAsk(ev));
  }

  /** Your party's id, if you're in one. */
  get id(): string | undefined {
    return this.party?.id;
  }

  get isLeader(): boolean {
    return this.party?.leader === this.net.sessionId;
  }

  get size(): number {
    return this.party?.members.length ?? 0;
  }

  /** Everyone else in your party, and where they are. */
  get others() {
    return this.party?.members.filter((m) => m.id !== this.net.sessionId) ?? [];
  }

  isMember(id: string): boolean {
    return Boolean(this.party?.members.some((m) => m.id === id));
  }

  /**
   * What the card of another player offers: an invite, or why not. `theirs`
   * is their party (from the synced state).
   */
  inviteFor(id: string, theirs: string | undefined): { go?: () => void; note: string } {
    if (this.isMember(id)) return { note: "In your party." };
    if (this.party && !this.isLeader) return { note: "Only your party's leader can invite players." };
    if (this.size >= PARTY_MAX) return { note: `Your party is full (${PARTY_MAX}).` };
    if (theirs) return { note: "They're already in a party." };
    return {
      go: () => this.net.inviteParty(id),
      note: this.party ? `Your party has ${this.size} of ${PARTY_MAX}.` : "Hunt together: monster EXP is shared, and so is the loot.",
    };
  }

  private set(p: PartyMessage | null) {
    this.party = p;
    this.render();
    this.onChange?.(p);
  }

  private render() {
    const p = this.party;
    this.panel.hidden = !p;
    if (!p) return;
    this.panel.replaceChildren();
    const head = el("div", "party-head");
    head.append(el("span", "party-title", `Party · ${p.members.length}/${PARTY_MAX}`));
    const leave = el("button", "party-leave", "Leave");
    leave.type = "button";
    leave.title = "Leave the party";
    leave.addEventListener("click", () => {
      audio.blip();
      this.net.leaveParty();
    });
    head.append(leave);
    this.panel.append(head);
    for (const m of p.members) {
      const row = el("div", `party-member${m.id === this.net.sessionId ? " me" : ""}${m.dead ? " down" : ""}`);
      const name = el("div", "party-name");
      name.append(el("span", "", `${m.id === p.leader ? "♛ " : ""}${m.name}`));
      const cls = isClassId(m.cls) ? CLASSES[m.cls].name : "";
      name.append(el("small", "", `Lv ${m.lv}${cls ? ` ${cls}` : ""}`));
      if (this.isLeader && m.id !== this.net.sessionId) {
        const kick = el("button", "party-kick", "×");
        kick.type = "button";
        kick.title = `Remove ${m.name} from the party`;
        kick.addEventListener("click", () => {
          audio.blip();
          this.net.kickParty(m.id);
        });
        name.append(kick);
      }
      const bar = el("div", "bar bar-hp party-hp");
      const fill = el("i");
      fill.style.width = `${m.mhp ? Math.round((m.hp / m.mhp) * 100) : 0}%`;
      bar.append(fill);
      row.append(name, bar);
      this.panel.append(row);
    }
  }

  // ------------------------------------------------------------------ an invite for you

  private showAsk(ev: PartyAskEvent) {
    this.pending = { ...ev, until: performance.now() + ev.ms };
    this.ask.replaceChildren();
    const cls = isClassId(ev.cls) ? ` ${CLASSES[ev.cls].name}` : "";
    const text = el("div", "duel-ask-text");
    text.append(el("b", "", `👥 ${ev.name}`), ` (Lv ${ev.lv}${cls}) invites you to ${ev.size > 1 ? `their party (${ev.size}/${PARTY_MAX})` : "a party"}!`);
    const sub = el("div", "duel-ask-sub", "In a party, monster EXP is shared by everyone close by, and you can pick up each other's loot.");
    const buttons = el("div", "duel-ask-buttons");
    const yes = el("button", "dialog-link primary", "Join");
    const no = el("button", "dialog-link", "No thanks");
    for (const [b, answer] of [[yes, true], [no, false]] as const) {
      b.type = "button";
      b.addEventListener("click", () => {
        audio.blip();
        this.net.answerParty(ev.from, answer);
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
