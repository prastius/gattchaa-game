import { BAG_SIZE, ITEMS, RARITY, SLOTS, SLOT_NAMES, bonusText, sellPrice, type ItemStack, type Slot } from "../../../shared/items";
import { FRAME, composeCharacter, itemIcon } from "../character";
import type { Net } from "../net";
import { audio } from "../audio";

// The bag window (I): what you wear, what you carry, and your totals.
// Click an item for details and buttons; double-click wears or drinks it.

const $ = (id: string) => document.getElementById(id)!;

type Selection = { bag: number } | { gear: Slot };

interface Cell {
  el: HTMLButtonElement;
  icon: HTMLCanvasElement;
  count: HTMLSpanElement;
  /** Item id drawn right now, so unchanged cells aren't redrawn. */
  shown: string;
}

export class BagPanel {
  private root = $("bag");
  private gold = $("bag-gold");
  private stats = $("bag-stats");
  private detail = $("bag-detail");
  private portrait = $("bag-portrait") as HTMLCanvasElement;
  private bagCells: Cell[] = [];
  private gearCells = {} as Record<Slot, Cell>;
  private selected?: Selection;
  private portraitKey = "";
  private confirmDrop = false;
  private confirmTimer?: number;
  /** Your appearance key right now (look + gear), for the portrait. */
  appearance?: () => string;
  /** Your health right now, for the totals line. */
  health?: () => { hp: number; mhp: number };

  constructor(private net: Net) {
    const gear = $("bag-gear");
    for (const slot of SLOTS) {
      const cell = this.cell(SLOT_NAMES[slot]);
      cell.el.classList.add("slot-gear");
      cell.el.dataset.slot = slot;
      cell.el.addEventListener("click", () => this.select({ gear: slot }));
      cell.el.addEventListener("dblclick", () => this.primary({ gear: slot }));
      gear.append(cell.el);
      this.gearCells[slot] = cell;
    }
    const grid = $("bag-grid");
    for (let i = 0; i < BAG_SIZE; i++) {
      const cell = this.cell("");
      cell.el.addEventListener("click", () => this.select({ bag: i }));
      cell.el.addEventListener("dblclick", () => this.primary({ bag: i }));
      grid.append(cell.el);
      this.bagCells.push(cell);
    }
    $("bag-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    net.onBag.add(() => this.isOpen && this.render());
    net.onStats.add(() => this.isOpen && this.renderTotals());
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
    audio.blip();
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.selected = undefined;
  }

  /** Redraws the portrait and totals (HP changes, new gear on), while open. */
  tick() {
    if (!this.isOpen) return;
    this.renderTotals();
    this.renderPortrait();
  }

  private cell(placeholder: string): Cell {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "slot";
    const icon = document.createElement("canvas");
    icon.width = icon.height = 32;
    const count = document.createElement("span");
    count.className = "slot-count";
    el.append(icon, count);
    if (placeholder) {
      const label = document.createElement("span");
      label.className = "slot-label";
      label.textContent = placeholder;
      el.append(label);
    }
    return { el, icon, count, shown: "" };
  }

  private stackAt(sel: Selection): ItemStack | null | undefined {
    const b = this.net.bag;
    if (!b) return undefined;
    return "bag" in sel ? b.bag[sel.bag] : b.gear[sel.gear];
  }

  private select(sel: Selection) {
    const same = this.selected && JSON.stringify(this.selected) === JSON.stringify(sel);
    this.selected = this.stackAt(sel) && !same ? sel : undefined;
    this.confirmDrop = false;
    this.render();
  }

  /** Double-click: wear, drink, or take off. */
  private primary(sel: Selection) {
    const s = this.stackAt(sel);
    if (!s) return;
    if ("gear" in sel) this.net.unequip(sel.gear);
    else if (ITEMS[s.id].kind !== "loot") this.net.useItem(sel.bag);
    audio.blip();
  }

  private render() {
    const b = this.net.bag;
    if (!b) return;
    b.bag.forEach((s, i) => this.draw(this.bagCells[i], s ?? undefined, this.isSelected({ bag: i })));
    for (const slot of SLOTS) this.draw(this.gearCells[slot], b.gear[slot], this.isSelected({ gear: slot }));
    if (this.selected && !this.stackAt(this.selected)) this.selected = undefined;
    this.renderDetail();
    this.renderTotals();
    this.renderPortrait();
  }

  private isSelected(sel: Selection) {
    return Boolean(this.selected) && JSON.stringify(this.selected) === JSON.stringify(sel);
  }

  private draw(cell: Cell, s: ItemStack | undefined, selected: boolean) {
    const it = s && ITEMS[s.id];
    cell.el.classList.toggle("filled", Boolean(it));
    cell.el.classList.toggle("selected", selected);
    cell.el.dataset.rarity = it?.rarity ?? "";
    cell.el.title = it ? it.name : "";
    cell.count.textContent = s && s.n > 1 ? String(s.n) : "";
    const id = s?.id ?? "";
    if (cell.shown === id) return;
    cell.shown = id;
    const ctx = cell.icon.getContext("2d")!;
    ctx.clearRect(0, 0, 32, 32);
    if (!s) return;
    itemIcon(s.id).then((icon) => {
      if (cell.shown !== id) return;
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(icon, 0, 0);
    });
  }

  private renderTotals() {
    const st = this.net.stats;
    const h = this.health?.();
    this.gold.textContent = (st?.gold ?? 0).toLocaleString("en-US");
    const parts = [`ATK ${st?.atk ?? "–"}`, `DEF ${st?.def ?? "–"}`];
    if (h) parts.push(`HP ${h.hp}/${h.mhp}`);
    if (st) parts.push(`MP ${st.mp}/${st.mmp}`);
    this.stats.textContent = parts.join("  ·  ");
  }

  private renderPortrait() {
    const key = this.appearance?.() ?? "";
    if (!key || key === this.portraitKey) return;
    this.portraitKey = key;
    composeCharacter(key).then((sheet) => {
      if (this.portraitKey !== key) return;
      const ctx = this.portrait.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this.portrait.width, this.portrait.height);
      // Standing, facing down, at 1.5x: the middle of the frame, head to toe.
      ctx.drawImage(sheet, 8, 2 * FRAME + 4, 48, 58, 0, 1, 72, 87);
    });
  }

  private renderDetail() {
    this.detail.replaceChildren();
    const sel = this.selected;
    const s = sel && this.stackAt(sel);
    if (!sel || !s) {
      const hint = document.createElement("p");
      hint.className = "bag-hint";
      hint.textContent = matchMedia("(pointer: coarse)").matches
        ? "Tap an item to see it, then Wear or Drink. Monsters drop loot: tap it on the ground to pick it up."
        : "Click an item to see it. Double-click to wear or drink it. Monsters drop loot: click it on the ground to pick it up.";
      this.detail.append(hint);
      return;
    }
    const it = ITEMS[s.id];
    const name = document.createElement("div");
    name.className = "bag-name";
    name.style.color = RARITY[it.rarity].color;
    name.textContent = s.n > 1 ? `${it.name} ×${s.n}` : it.name;

    const meta = document.createElement("div");
    meta.className = "bag-meta";
    const kind = it.kind === "equip" ? SLOT_NAMES[it.slot!] : it.kind === "use" ? "Potion" : "Loot";
    meta.textContent = `${RARITY[it.rarity].name} · ${kind}`;
    if (it.lv && it.lv > 1) {
      const lv = document.createElement("span");
      const myLv = this.net.stats?.lv ?? 1;
      lv.className = myLv < it.lv ? "too-low" : "";
      lv.textContent = ` · Lv ${it.lv}+`;
      meta.append(lv);
    }

    const lines = [name, meta];
    const bonus = bonusText(it);
    if (bonus) lines.push(this.p("bag-bonus", bonus));
    lines.push(this.p("bag-desc", it.desc));
    const price = sellPrice(it);
    if (price > 0) lines.push(this.p("bag-price", `Merchants pay ${price} gold${s.n > 1 ? " each" : ""}.`));

    const buttons = document.createElement("div");
    buttons.className = "bag-actions";
    if ("gear" in sel) buttons.append(this.button("Take off", () => this.net.unequip(sel.gear), "primary"));
    else {
      if (it.kind === "equip") buttons.append(this.button("Wear", () => this.net.useItem(sel.bag), "primary"));
      if (it.kind === "use") buttons.append(this.button("Drink", () => this.net.useItem(sel.bag), "primary"));
      const drop = this.button(this.confirmDrop ? "Really drop?" : s.n > 1 ? "Drop all" : "Drop", () => {
        if (!this.confirmDrop) {
          this.confirmDrop = true;
          clearTimeout(this.confirmTimer);
          this.confirmTimer = window.setTimeout(() => {
            this.confirmDrop = false;
            if (this.isOpen) this.renderDetail();
          }, 3000);
          this.renderDetail();
          return;
        }
        this.confirmDrop = false;
        this.net.dropItem(sel.bag);
      }, "danger");
      buttons.append(drop);
    }
    this.detail.append(...lines, buttons);
  }

  private p(className: string, text: string) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
  }

  private button(label: string, onClick: () => void, variant: string) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bag-button ${variant}`;
    b.textContent = label;
    b.addEventListener("click", () => {
      audio.blip();
      onClick();
    });
    return b;
  }
}
