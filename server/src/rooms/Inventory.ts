import {
  BAG_SIZE,
  ITEMS,
  SLOTS,
  canInsert,
  cleanCards,
  gearBonus,
  gearString,
  isItemId,
  stackLimit,
  type BagMessage,
  type ItemId,
  type ItemStack,
  type Slot,
} from "../../../shared/items";

const parse = (json: string | null | undefined): unknown => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

/** A saved stack, if it still makes sense (the item exists, the count fits, the cards belong). */
function readStack(raw: unknown): ItemStack | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, n, cards } = raw as { id?: unknown; n?: unknown; cards?: unknown };
  if (!isItemId(id)) return null;
  const count = Math.min(stackLimit(ITEMS[id]), Math.floor(Number(n)));
  if (!(count >= 1)) return null;
  const c = cleanCards(id, cards);
  return c ? { id, n: count, cards: c } : { id, n: count };
}

/** Where a piece of equipment is: a bag slot, or worn. */
export type GearAt = { bag: number } | { gear: Slot };

/**
 * A character's bag and what they're wearing. Only bookkeeping: Combat
 * decides who may do what (alive, level, near a merchant…).
 */
export class Inventory {
  bag: (ItemStack | null)[] = new Array<ItemStack | null>(BAG_SIZE).fill(null);
  gear: Partial<Record<Slot, ItemStack>> = {};

  /** From the saved JSON. Anything unknown or broken is dropped rather than trusted. */
  static load(bagJson: string | null | undefined, gearJson: string | null | undefined): Inventory {
    const inv = new Inventory();
    const bag = parse(bagJson);
    if (Array.isArray(bag)) bag.slice(0, BAG_SIZE).forEach((raw, i) => (inv.bag[i] = readStack(raw)));
    const gear = parse(gearJson) as Record<string, unknown> | null;
    if (gear && typeof gear === "object") {
      for (const slot of SLOTS) {
        const s = readStack(gear[slot]);
        if (s && ITEMS[s.id].slot === slot) inv.gear[slot] = { ...s, n: 1 };
      }
    }
    return inv;
  }

  /** For the database (null when empty). */
  save(): { bag: string | null; gear: string | null } {
    const bag = this.bag.some(Boolean) ? JSON.stringify(this.bag) : null;
    const gear = Object.keys(this.gear).length ? JSON.stringify(this.gear) : null;
    return { bag, gear };
  }

  message(): BagMessage {
    return { bag: this.bag, gear: this.gear };
  }

  bonus() {
    return gearBonus(this.gear);
  }

  /** What others see you wearing. */
  visible(): string {
    return gearString(this.gear);
  }

  count(id: ItemId): number {
    let n = 0;
    for (const s of this.bag) if (s?.id === id) n += s.n;
    return n;
  }

  /** How many of `n` would fit. */
  room(id: ItemId, n: number): number {
    const limit = stackLimit(ITEMS[id]);
    let fits = 0;
    for (const s of this.bag) {
      if (!s) fits += limit;
      else if (s.id === id) fits += limit - s.n;
      if (fits >= n) return n;
    }
    return fits;
  }

  /** Adds up to `n` (topping up stacks first, then empty slots). Returns how many went in. */
  add(id: ItemId, n: number, cards?: ItemId[]): number {
    const limit = stackLimit(ITEMS[id]);
    let left = n;
    for (const s of this.bag) {
      if (left <= 0) break;
      if (s?.id !== id || s.n >= limit) continue;
      const k = Math.min(left, limit - s.n);
      s.n += k;
      left -= k;
    }
    for (let i = 0; i < this.bag.length && left > 0; i++) {
      if (this.bag[i]) continue;
      const k = Math.min(left, limit);
      this.bag[i] = cards?.length ? { id, n: k, cards: [...cards] } : { id, n: k };
      left -= k;
    }
    return n - left;
  }

  /** Takes up to `n` from one bag slot. */
  take(slot: number, n: number): ItemStack | undefined {
    const s = this.bag[slot];
    if (!s || !(n >= 1)) return undefined;
    const k = Math.min(s.n, Math.floor(n));
    s.n -= k;
    if (s.n <= 0) this.bag[slot] = null;
    return s.cards ? { id: s.id, n: k, cards: s.cards } : { id: s.id, n: k };
  }

  /** The equipment at a place (bag slot or worn), if there is any. */
  gearAt(at: GearAt): ItemStack | undefined {
    const s = "bag" in at ? this.bag[at.bag] : this.gear[at.gear];
    return s && ITEMS[s.id].kind === "equip" ? s : undefined;
  }

  /** Puts one card from a bag slot into a piece of equipment, for good. Returns it, or undefined if it won't go. */
  insert(cardSlot: number, at: GearAt): ItemStack | undefined {
    const card = this.bag[cardSlot];
    const target = this.gearAt(at);
    if (!card || !target || !canInsert(ITEMS[card.id], target)) return undefined;
    this.take(cardSlot, 1);
    target.cards = [...(target.cards ?? []), card.id];
    return target;
  }

  /** Wears the item in a bag slot, swapping out whatever was worn there. */
  equip(slot: number): ItemStack | undefined {
    const s = this.bag[slot];
    const at = s && ITEMS[s.id].slot;
    if (!s || !at) return undefined;
    this.bag[slot] = this.gear[at] ?? null;
    this.gear[at] = s;
    return s;
  }

  /** Takes off what's worn in a slot, into the first free bag slot. False if the bag is full. */
  unequip(at: Slot): boolean {
    const s = this.gear[at];
    if (!s) return true;
    const free = this.bag.indexOf(null);
    if (free < 0) return false;
    this.bag[free] = s;
    delete this.gear[at];
    return true;
  }
}
