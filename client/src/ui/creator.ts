import { CATALOG, type CatalogItem } from "../../../shared/catalog";
import {
  COLOR_FIELDS,
  ITEM_FIELDS,
  bodyName,
  encodeLook,
  fitToBody,
  isHidden,
  optionsFor,
  randomLook,
  type ColorField,
  type ItemField,
  type Look,
} from "../../../shared/appearance";
import { FRAME, WALK_COLS, composeCharacter, swatch } from "../character";

type Material = "body" | "hair" | "cloth" | "eye";

interface Row {
  label: string;
  style?: ItemField;
  color?: ColorField;
  material?: Material;
  note?: string;
}

const TABS: { id: string; label: string; rows: Row[] }[] = [
  {
    id: "body",
    label: "Body",
    rows: [
      { label: "Body" },
      { label: "Skin", color: "skin", material: "body" },
      { label: "Eyes", color: "eyes", material: "eye" },
    ],
  },
  {
    id: "hair",
    label: "Hair",
    rows: [
      { label: "Hairstyle", style: "hair", color: "hairColor", material: "hair" },
      { label: "Facial hair", style: "beard", note: "Uses your hair colour" },
    ],
  },
  {
    id: "outfit",
    label: "Outfit",
    rows: [
      { label: "Top", style: "top", color: "topColor", material: "cloth" },
      { label: "Bottom", style: "bottom", color: "bottomColor", material: "cloth" },
      { label: "Shoes", style: "shoes", color: "shoesColor", material: "cloth" },
    ],
  },
  {
    id: "extras",
    label: "Extras",
    rows: [
      { label: "Headwear", style: "hat", color: "hatColor", material: "cloth" },
      { label: "Glasses", style: "glasses" },
    ],
  },
];

const PREVIEW_DIRS = [2, 1, 0, 3]; // down, left, up, right
const prettyColor = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Character customisation panel with a live walking preview. */
export class CharacterCreator {
  private look: Look;
  private sheet = document.createElement("canvas");
  private preview: HTMLCanvasElement;
  private options: HTMLElement;
  private tabButtons: HTMLButtonElement[] = [];
  private tab = TABS[0].id;
  private dirIndex = 0;
  private frame = 0;
  private timer: number;
  private composeToken = 0;
  private refreshers: (() => void)[] = [];

  constructor(
    root: HTMLElement,
    initial: Look,
    private onChange?: (look: Look) => void,
  ) {
    this.look = fitToBody({ ...initial });
    root.replaceChildren();
    root.classList.add("creator");

    const left = el("div", "creator-preview");
    this.preview = document.createElement("canvas");
    this.preview.width = FRAME * 2;
    this.preview.height = FRAME * 2;
    this.preview.title = "Click to turn around";
    this.preview.addEventListener("click", () => this.turn());
    const actions = el("div", "creator-actions");
    actions.append(
      button("↻ Turn", () => this.turn()),
      button("🎲 Random", () => {
        this.look = randomLook(Math.random, this.look.body);
        this.changed(true);
      }),
    );
    left.append(this.preview, actions);

    const right = el("div", "creator-right");
    const tabs = el("div", "creator-tabs");
    tabs.setAttribute("role", "tablist");
    for (const t of TABS) {
      const b = button(t.label, () => {
        this.tab = t.id;
        this.renderOptions();
      });
      b.setAttribute("role", "tab");
      this.tabButtons.push(b);
      tabs.append(b);
    }
    this.options = el("div", "creator-options");
    right.append(tabs, this.options);

    root.append(left, right);
    this.renderOptions();
    this.timer = window.setInterval(() => this.tick(), 110);
    this.recompose();
  }

  get value(): Look {
    return { ...this.look };
  }

  get encoded(): string {
    return encodeLook(this.look);
  }

  destroy() {
    window.clearInterval(this.timer);
  }

  private turn() {
    this.dirIndex = (this.dirIndex + 1) % PREVIEW_DIRS.length;
  }

  /** `structural` = rows may appear/disappear (body switch, dress on/off). */
  private changed(structural = false) {
    if (structural) this.renderOptions();
    else for (const r of this.refreshers) r();
    this.recompose();
    this.onChange?.(this.value);
  }

  private async recompose() {
    const token = ++this.composeToken;
    const canvas = await composeCharacter(encodeLook(this.look));
    if (token !== this.composeToken) return; // a newer change won
    this.sheet = canvas;
    this.draw();
  }

  private tick() {
    this.frame = (this.frame + 1) % (WALK_COLS - 1);
    this.draw();
  }

  private draw() {
    const ctx = this.preview.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.preview.width, this.preview.height);
    const row = PREVIEW_DIRS[this.dirIndex];
    ctx.drawImage(this.sheet, (1 + this.frame) * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME * 2, FRAME * 2);
  }

  private renderOptions() {
    this.refreshers = [];
    this.tabButtons.forEach((b, i) => {
      const active = TABS[i].id === this.tab;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    const body = bodyName(this.look);
    const rows = TABS.find((t) => t.id === this.tab)!.rows.filter((r) => !r.style || optionsFor(r.style, body).length > 1);
    this.options.replaceChildren(...rows.map((r) => this.renderRow(r)));
  }

  private renderRow(row: Row): HTMLElement {
    const wrap = el("div", "creator-row");
    const head = el("div", "creator-row-head");
    const label = el("span", "creator-label");
    label.textContent = row.label;
    head.append(label);

    if (row.label === "Body") {
      head.append(
        this.stepper(
          "Body",
          () => (this.look.body === 0 ? "Masculine" : "Feminine"),
          (d) => {
            this.look.body = (this.look.body + d + CATALOG.bodies.length) % CATALOG.bodies.length;
            this.look = fitToBody(this.look);
            this.changed(true);
          },
        ),
      );
    } else if (row.style) {
      const field = row.style;
      const list: readonly CatalogItem[] = ITEM_FIELDS[field];
      head.append(
        this.stepper(
          row.label,
          () => list[this.look[field]]?.name ?? "",
          (d) => {
            const opts = optionsFor(field, bodyName(this.look));
            const at = Math.max(0, opts.indexOf(this.look[field]));
            const hadHides = !!list[this.look[field]]?.hides;
            this.look[field] = opts[(at + d + opts.length) % opts.length];
            this.changed(hadHides || !!list[this.look[field]]?.hides);
          },
        ),
      );
    }
    wrap.append(head);

    if (row.style && isHidden(this.look, row.style)) {
      wrap.classList.add("muted");
      wrap.append(note(`Covered by your ${row.style === "bottom" ? "dress" : "headwear"}`));
      return wrap;
    }

    if (row.color && row.material) wrap.append(this.swatches(row.label, row.color, row.material));
    if (row.note) wrap.append(note(row.note));
    return wrap;
  }

  private stepper(label: string, text: () => string, step: (d: number) => void): HTMLElement {
    const value = el("span", "creator-value");
    const s = el("div", "creator-stepper");
    s.append(button("‹", () => step(-1), `Previous ${label}`), value, button("›", () => step(1), `Next ${label}`));
    const refresh = () => (value.textContent = text());
    refresh();
    this.refreshers.push(refresh);
    return s;
  }

  private swatches(label: string, field: ColorField, material: Material): HTMLElement {
    const box = el("div", "creator-swatches");
    const buttons: HTMLButtonElement[] = [];
    (COLOR_FIELDS[field] as readonly string[]).forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.title = prettyColor(name);
      b.setAttribute("aria-label", `${label} ${prettyColor(name)}`);
      swatch(material, name).then((c) => (b.style.background = c));
      b.addEventListener("click", () => {
        this.look[field] = i;
        this.changed();
      });
      buttons.push(b);
      box.append(b);
    });
    const refresh = () => buttons.forEach((b, i) => b.classList.toggle("selected", i === this.look[field]));
    refresh();
    this.refreshers.push(refresh);
    return box;
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function note(text: string): HTMLElement {
  const n = el("p", "creator-note");
  n.textContent = text;
  return n;
}

function button(text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}
