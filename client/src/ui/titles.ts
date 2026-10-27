import { RARITY } from "../../../shared/items";
import { TITLES, TITLE_GROUPS, type TitleDef, type TitleId } from "../../../shared/titles";
import type { Net } from "../net";
import { audio } from "../audio";

// The titles window (T): every title there is, the ones you've earned, and how
// far along the rest are. Pick one to show under your name; the server checks
// it's really yours.

const $ = (id: string) => document.getElementById(id)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ALL = Object.values(TITLES) as (TitleDef & { id: TitleId })[];

export class TitlesUI {
  private root = $("titles");
  private list = $("titles-list");
  private head = $("titles-earned");
  /** How many titles you had when you last looked (undefined until the first word from the server). */
  private known?: number;
  private unseen = 0;
  /** Titles earned since the window was last opened (for the HUD badge). */
  onUnseen?: (n: number) => void;

  constructor(private net: Net) {
    $("titles-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    net.onTitles.add((t) => {
      if (this.known !== undefined && t.earned.length > this.known && !this.isOpen) {
        this.unseen += t.earned.length - this.known;
        this.onUnseen?.(this.unseen);
      }
      this.known = t.earned.length;
      if (this.isOpen) this.render();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.root.hidden = false;
    this.unseen = 0;
    this.onUnseen?.(0);
    audio.blip();
    this.render();
  }

  close() {
    this.root.hidden = true;
  }

  private render() {
    const t = this.net.titles;
    const keep = this.root.scrollTop;
    this.list.replaceChildren();
    if (!t) {
      this.head.textContent = "";
      this.list.append(el("p", "skills-hint", "Loading your titles…"));
      return;
    }
    this.head.textContent = `${t.earned.length} / ${ALL.length} earned`;

    const shown = el("div", "titles-shown");
    const def = t.shown ? (TITLES[t.shown] as TitleDef) : undefined;
    if (def) {
      const name = el("b", "", def.name);
      name.style.color = RARITY[def.tier].color;
      shown.append("Under your name: ", name);
      shown.append(this.button("Hide", () => this.net.showTitle(""), "title-hide"));
    } else {
      shown.append(t.earned.length ? "No title under your name. Pick one below." : "Earn titles by leveling, hunting, finding cards and upgrading gear. Show one under your name for everyone to see.");
    }
    this.list.append(shown);

    for (const group of TITLE_GROUPS) {
      this.list.append(el("h3", "titles-group", group));
      for (const title of ALL.filter((x) => x.group === group)) this.list.append(this.row(title, t.earned.includes(title.id), t.shown === title.id, t.progress[title.id]));
    }
    this.root.scrollTop = keep;
  }

  private row(title: TitleDef & { id: TitleId }, earned: boolean, shown: boolean, progress?: [number, number]) {
    const row = el("div", `title-row${earned ? "" : " locked"}`);
    const text = el("div", "skill-text");
    const name = el("div", "skill-name");
    const label = el("span", "", title.name);
    label.style.color = RARITY[title.tier].color;
    name.append(label, el("span", "skill-level", RARITY[title.tier].name));
    text.append(name, el("div", "", title.how));
    if (title.aura) text.append(el("div", "title-aura", "Comes with its own aura while you show it."));
    if (!earned && progress && title.goal.kind !== "pioneer" && progress[1] > 1) {
      const [done, need] = progress;
      const bar = el("div", "title-bar");
      const fill = el("i");
      fill.style.width = `${Math.round((done / need) * 100)}%`;
      bar.append(fill);
      text.append(bar, el("div", "title-count", `${done.toLocaleString("en-US")} / ${need.toLocaleString("en-US")}`));
    }
    row.append(text);
    if (earned) row.append(this.button(shown ? "Showing" : "Show", () => this.net.showTitle(title.id), "skill-learn", shown));
    return row;
  }

  private button(label: string, onClick: () => void, className: string, disabled = false) {
    const b = el("button", className, label);
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", () => {
      audio.blip();
      onClick();
    });
    return b;
  }
}
