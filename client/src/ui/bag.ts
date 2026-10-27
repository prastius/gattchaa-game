import {
  BAG_SIZE,
  ITEMS,
  RARITY,
  SLOTS,
  SLOT_NAMES,
  bonusText,
  canInsert,
  cardFits,
  gearBonus,
  itemName,
  sellPrice,
  type ItemDef,
  type ItemStack,
  type Slot,
} from "../../../shared/items";
import { CRIT_CHANCE } from "../../../shared/rpg";
import { FRAME, composeCharacter, itemIcon } from "../character";
import type { Net } from "../net";
import { audio } from "../audio";

// The bag window (I): what you wear, what you carry, and your totals.
// Click an item for details and buttons; double-click wears or drinks it.
// A monster card goes into equipment in two steps: pick the card, then the
// lit-up piece of gear it should go into.

const $ = (id: string) => document.getElementById(id)!;

type Selection = { bag: number } | { gear: Slot };

interface Cell {
  el: HTMLButtonElement;
  icon: HTMLCanvasElement;
  count: HTMLSpanElement;
  /** One dot per card slot: filled when a card is in it. */
  dots: HTMLSpanElement;
  /** Item id drawn right now, so unchanged cells aren't redrawn. */
  shown: string;
}

/** Every card that could ever go into this kind of equipment (none yet for some slots). */
const cardsFor = (it: ItemDef) => Object.values(ITEMS).filter((c) => cardFits(c, it));

export class BagPanel {
  private root = $("bag");
  private gold = $("bag-gold");
  private stats = $("bag-stats");
  private detail = $("bag-detail");
  private portrait = $("bag-portrait") as HTMLCanvasElement;
  private bagCells: Cell[] = [];
  private gearCells = {} as Record<Slot, Cell>;
  private selected?: Selection;
  /** Putting the card in this bag slot into equipment; `target` once the gear is picked. */
  private inserting?: { card: number; target?: Selection };
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
      if (e.key !== "Escape" || !this.isOpen) return;
      if (this.inserting) this.cancelInsert();
      else this.close();
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
    this.inserting = undefined;
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
    const dots = document.createElement("span");
    dots.className = "slot-dots";
    el.append(icon, count, dots);
    if (placeholder) {
      const label = document.createElement("span");
      label.className = "slot-label";
      label.textContent = placeholder;
      el.append(label);
    }
    return { el, icon, count, dots, shown: "" };
  }

  private stackAt(sel: Selection): ItemStack | null | undefined {
    const b = this.net.bag;
    if (!b) return undefined;
    return "bag" in sel ? b.bag[sel.bag] : b.gear[sel.gear];
  }

  /** The card being put into gear right now, if it's still in the bag. */
  private insertingCard(): ItemStack | undefined {
    const s = this.inserting && this.net.bag?.bag[this.inserting.card];
    return s && ITEMS[s.id].kind === "card" ? s : undefined;
  }

  /** Whether the card being put in could go into what's at `sel`. */
  private canTake(sel: Selection): boolean {
    const card = this.insertingCard();
    const s = this.stackAt(sel);
    return Boolean(card && s && canInsert(ITEMS[card.id], s));
  }

  /** Everything (worn first) that this card could go into right now. */
  private targetsFor(card: ItemStack): Selection[] {
    const b = this.net.bag;
    if (!b) return [];
    const c = ITEMS[card.id];
    const worn = SLOTS.filter((slot) => b.gear[slot] && canInsert(c, b.gear[slot]!)).map((slot) => ({ gear: slot }));
    const carried = b.bag.flatMap((s, i) => (s && canInsert(c, s) ? [{ bag: i }] : []));
    return [...worn, ...carried];
  }

  private select(sel: Selection) {
    if (this.inserting && !this.inserting.target && this.canTake(sel)) {
      this.inserting.target = sel;
      audio.blip();
      this.render();
      return;
    }
    this.inserting = undefined;
    const same = this.isSelected(sel);
    this.selected = this.stackAt(sel) && !same ? sel : undefined;
    this.confirmDrop = false;
    this.render();
  }

  /** Double-click: wear, drink, take off, or start putting a card in. */
  private primary(sel: Selection) {
    const s = this.stackAt(sel);
    if (!s || this.inserting) return;
    const kind = ITEMS[s.id].kind;
    if ("gear" in sel) this.net.unequip(sel.gear);
    else if (kind === "card") return this.startInsert(sel.bag);
    else if (kind !== "loot") this.net.useItem(sel.bag);
    audio.blip();
  }

  private startInsert(card: number) {
    const s = this.net.bag?.bag[card];
    if (!s || this.targetsFor(s).length === 0) return;
    this.inserting = { card };
    this.selected = { bag: card };
    audio.blip();
    this.render();
  }

  private cancelInsert() {
    this.inserting = undefined;
    this.render();
  }

  private render() {
    const b = this.net.bag;
    if (!b) return;
    if (this.inserting && !this.insertingCard()) this.inserting = undefined;
    const choosing = Boolean(this.inserting && !this.inserting.target);
    this.root.classList.toggle("choosing", choosing);
    const mark = (cell: Cell, sel: Selection) => {
      cell.el.classList.toggle("can-take", choosing && this.canTake(sel));
      cell.el.classList.toggle("target", Boolean(this.inserting?.target) && JSON.stringify(this.inserting!.target) === JSON.stringify(sel));
    };
    b.bag.forEach((s, i) => {
      this.draw(this.bagCells[i], s ?? undefined, this.isSelected({ bag: i }));
      mark(this.bagCells[i], { bag: i });
    });
    for (const slot of SLOTS) {
      this.draw(this.gearCells[slot], b.gear[slot], this.isSelected({ gear: slot }));
      mark(this.gearCells[slot], { gear: slot });
    }
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
    cell.el.title = s ? itemName(s) : "";
    cell.count.textContent = s && s.n > 1 ? String(s.n) : "";
    const slots = it?.slots ?? 0;
    const used = s?.cards?.length ?? 0;
    cell.dots.replaceChildren(
      ...Array.from({ length: slots }, (_, i) => {
        const dot = document.createElement("i");
        if (i < used) dot.className = "on";
        return dot;
      }),
    );
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
    // What the cards add on top.
    const bonus = gearBonus(this.net.bag?.gear ?? {});
    if (bonus.crit) parts.push(`Crit ${Math.round(CRIT_CHANCE * 100) + bonus.crit}%`);
    if (bonus.flee) parts.push(`Evade ${bonus.flee}%`);
    if (bonus.reflect) parts.push(`Thorns ${bonus.reflect}%`);
    // Each part stays on one line; the line breaks between them.
    this.stats.textContent = parts.map((part) => part.replaceAll(" ", " ")).join("  ·  ");
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
    if (this.inserting) return this.renderInsert();
    const sel = this.selected;
    const s = sel && this.stackAt(sel);
    if (!sel || !s) {
      const touch = matchMedia("(pointer: coarse)").matches;
      this.detail.append(
        this.p(
          "bag-hint",
          touch
            ? "Tap an item to see it, then Wear or Drink. Monsters drop loot: tap it on the ground to pick it up."
            : "Click an item to see it. Double-click to wear or drink it. Monsters drop loot: click it on the ground to pick it up.",
        ),
      );
      return;
    }
    const it = ITEMS[s.id];
    const name = this.title(s.n > 1 ? `${it.name} ×${s.n}` : itemName(s), it);

    const meta = document.createElement("div");
    meta.className = "bag-meta";
    const kind =
      it.kind === "equip" ? SLOT_NAMES[it.slot!] : it.kind === "use" ? "Potion" : it.kind === "card" ? `Card · goes into ${(it.fits ?? []).map((f) => SLOT_NAMES[f]).join(" or ")}` : "Loot";
    meta.textContent = `${RARITY[it.rarity].name} · ${kind}`;
    if (it.lv && it.lv > 1) {
      const lv = document.createElement("span");
      const myLv = this.net.stats?.lv ?? 1;
      lv.className = myLv < it.lv ? "too-low" : "";
      lv.textContent = ` · Lv ${it.lv}+`;
      meta.append(lv);
    }

    const lines: HTMLElement[] = [name, meta];
    const bonus = bonusText(it);
    if (bonus) lines.push(this.p("bag-bonus", bonus));
    if (it.slots) lines.push(this.cardList(s, it));
    lines.push(this.p("bag-desc", it.desc));
    const price = sellPrice(it);
    if (s.cards) lines.push(this.p("bag-price", "Merchants won't buy it: the cards would be lost."));
    else if (price > 0) lines.push(this.p("bag-price", `Merchants pay ${price} gold${s.n > 1 ? " each" : ""}.`));

    const buttons = document.createElement("div");
    buttons.className = "bag-actions";
    if ("gear" in sel) buttons.append(this.button("Take off", () => this.net.unequip(sel.gear), "primary"));
    else {
      if (it.kind === "equip") buttons.append(this.button("Wear", () => this.net.useItem(sel.bag), "primary"));
      if (it.kind === "use") buttons.append(this.button("Drink", () => this.net.useItem(sel.bag), "primary"));
      if (it.kind === "card") {
        const put = this.button("Put in gear", () => this.startInsert(sel.bag), "primary");
        if (this.targetsFor(s).length === 0) {
          put.disabled = true;
          lines.push(this.p("bag-hint", `You have no ${(it.fits ?? []).map((f) => SLOT_NAMES[f].toLowerCase()).join(" or ")} with a free card slot.`));
        }
        buttons.append(put);
      }
      buttons.append(this.dropButton(sel.bag, s));
    }
    this.detail.append(...lines, buttons);
  }

  /** The card slots of a piece of equipment: what's in them, and what's free. */
  private cardList(s: ItemStack, it: ItemDef): HTMLElement {
    const list = document.createElement("div");
    list.className = "bag-cards";
    const cards = s.cards ?? [];
    for (let i = 0; i < (it.slots ?? 0); i++) {
      const row = document.createElement("div");
      const card = cards[i];
      row.className = card ? "bag-card" : "bag-card empty";
      if (card) {
        const icon = document.createElement("canvas");
        icon.width = icon.height = 32;
        itemIcon(card).then((c) => icon.getContext("2d")!.drawImage(c, 0, 0));
        const c = ITEMS[card];
        const text = document.createElement("span");
        const b = document.createElement("b");
        b.textContent = c.name;
        text.append(b, ` · ${bonusText(c)}`);
        row.append(icon, text);
      } else {
        const fits = cardsFor(it);
        row.textContent = fits.length ? "Empty card slot" : "Empty card slot · no card fits here yet";
      }
      list.append(row);
    }
    return list;
  }

  /** Step two and three of putting a card in: pick the gear, then say yes. */
  private renderInsert() {
    const ins = this.inserting!;
    const card = this.insertingCard()!;
    const c = ITEMS[card.id];
    const where = (c.fits ?? []).map((f) => SLOT_NAMES[f].toLowerCase()).join(" or ");
    const buttons = document.createElement("div");
    buttons.className = "bag-actions";
    const target = ins.target && this.stackAt(ins.target);
    if (!ins.target || !target) {
      this.detail.append(
        this.title(c.name, c),
        this.p("bag-desc", `Choose the ${where} for your ${c.name}. Gear with a free card slot is lit up.`),
        this.p("bag-bonus", bonusText(c)),
      );
      buttons.append(this.button("Cancel", () => this.cancelInsert(), "secondary"));
      this.detail.append(buttons);
      return;
    }
    const after = { ...target, cards: [...(target.cards ?? []), card.id] };
    this.detail.append(
      this.title(itemName(after), ITEMS[target.id]),
      this.p("bag-desc", `Put the ${c.name} into your ${itemName(target)}? Cards can't be taken out again.`),
      this.p("bag-bonus", `Adds ${bonusText(c)}`),
    );
    const at = ins.target;
    buttons.append(
      this.button("Put it in", () => {
        this.net.insertCard(ins.card, at);
        this.inserting = undefined;
        this.selected = at;
        this.render();
      }, "primary"),
      this.button("Cancel", () => this.cancelInsert(), "secondary"),
    );
    this.detail.append(buttons);
  }

  private dropButton(slot: number, s: ItemStack) {
    return this.button(this.confirmDrop ? "Really drop?" : s.n > 1 ? "Drop all" : "Drop", () => {
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
      this.net.dropItem(slot);
    }, "danger");
  }

  private title(text: string, it: ItemDef) {
    const name = document.createElement("div");
    name.className = "bag-name";
    name.style.color = RARITY[it.rarity].color;
    name.textContent = text;
    return name;
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
