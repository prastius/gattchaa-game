import Phaser from "phaser";
import { Dir } from "../../../shared/protocol";
import { signText, type PlayerShopView } from "../../../shared/vending";
import { PlayerSprite, type CharacterTextures } from "../PlayerSprite";
import type { Vending } from "../vending";
import type { Hotspot } from "./town";

// Player shops in town: under each seller a woven rug with their goods laid
// out on it (little sacks for things from the bag, cards for Gattchaa cards),
// over them a sign (Ragnarok style, lit at night like a shopfront), and, while
// the owner is away, their look-alike minding the shop.

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
/** Rugs come in a few colours (picked from the shop id) so a busy square looks lively. */
const RUG_COLORS = [0xb83b2e, 0x2e78a6, 0xc7801c, 0x5f8f45, 0x84559a, 0x1f7a6d];
const CARD_COLORS = [0xeb8224, 0x3b82f6, 0xef4444, 0x10b981, 0xa855f7, 0xf2c14e];
const RUG_DEPTH = -0.9; // on the ground, under everyone
const SIGN_DEPTH = 1e6 - 7; // above the night tint, so signs stay readable
/** Bottom of the sign, relative to the seller's feet (just over a seated head and name). */
const SIGN_BOTTOM = -64;
const SIGN_H = 15;
/** Sellers' chat bubbles go this much higher, above their sign. */
export const SELLER_BUBBLE_LIFT = 20;

interface OpenShop {
  x: number;
  y: number;
  /** The rug and the cards on it. */
  rug: Phaser.GameObjects.Graphics;
  sign: Phaser.GameObjects.Container;
  /** Sign area in world pixels (for clicks). */
  signRect: Phaser.Geom.Rectangle;
  /** What the rug and sign were drawn from; redrawn when it changes. */
  drawn: string;
  /** The owner's look-alike, while they're away. */
  keeper?: PlayerSprite;
  keeperName?: string;
}

/** A small stable number from a shop id, for picking colours. */
const seedOf = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);

export class Shops {
  private open = new Map<string, OpenShop>();
  private spots: Hotspot[] = [];

  constructor(
    private scene: Phaser.Scene,
    private textures: CharacterTextures,
    private textRes: () => number,
  ) {}

  /** Open shops you can browse, for the scene's E / tap handling. */
  get hotspots(): readonly Hotspot[] {
    return this.spots;
  }

  /** Brings the town in line with the synced shops. Cheap: only redraws what changed. */
  sync(vending: Vending) {
    const seen = new Set<string>();
    vending.forEach((shop, id) => {
      seen.add(id);
      const mine = vending.isMine(id);
      const drawn = `${shop.title}|${shop.cards}|${shop.items}|${mine}|${shop.x},${shop.y}`;
      let open = this.open.get(id);
      if (!open || open.drawn !== drawn) {
        open?.sign.destroy();
        open?.rug.destroy();
        open?.keeper?.destroy();
        const { sign, rect } = this.sign(shop, mine);
        open = { x: shop.x, y: shop.y, rug: this.rug(id, shop), sign, signRect: rect, drawn };
        this.open.set(id, open);
      }
      // While the owner is away, their look-alike sits in; when they're here, they sit there themselves.
      const away = shop.owner === "";
      if (open.keeper && (!away || open.keeperName !== shop.name)) {
        open.keeper.destroy();
        open.keeper = undefined;
      }
      if (away && !open.keeper) {
        open.keeper = new PlayerSprite(this.scene, this.textures, shop.x, shop.y, `${shop.name} · away`, shop.look, { textRes: this.textRes });
        open.keeper.dir = Dir.Down;
        open.keeper.sitting = true;
        open.keeperName = shop.name;
      }
      open.keeper?.setLook(shop.look);
    });
    for (const [id, open] of this.open) {
      if (seen.has(id)) continue;
      open.sign.destroy();
      open.rug.destroy();
      open.keeper?.destroy();
      this.open.delete(id);
    }
    this.spots = [...this.open].map(([id, open]) => this.hotspot(id, open, vending));
  }

  private hotspot(id: string, open: OpenShop, vending: Vending): Hotspot {
    // The sign and the seller under it.
    const r = open.signRect;
    const left = Math.min(r.x, open.x - 16);
    const right = Math.max(r.right, open.x + 16);
    const title = vending.shop(id)?.title ?? "";
    return {
      id: `shop:${id}`,
      target: `shop:${id}`,
      x: open.x,
      y: open.y,
      hit: new Phaser.Geom.Rectangle(left, r.y, right - left, open.y + 8 - r.y),
      label: vending.isMine(id) ? "Your shop" : `Browse "${signText(title)}"`,
    };
  }

  /** A woven rug with a fringe at both ends, and a few goods laid out either side of the seller. */
  private rug(id: string, shop: PlayerShopView): Phaser.GameObjects.Graphics {
    const seed = seedOf(id);
    const w = 56;
    const h = 24;
    const x = shop.x - w / 2;
    const y = shop.y - 13;
    const g = this.scene.add.graphics().setDepth(RUG_DEPTH);
    g.fillStyle(0x000000, 0.2).fillRoundedRect(x + 1, y + 2, w, h, 3);
    g.fillStyle(RUG_COLORS[seed % RUG_COLORS.length], 1).fillRoundedRect(x, y, w, h, 3);
    g.fillStyle(0xffffff, 0.13);
    for (let i = 5; i < w - 4; i += 6) g.fillRect(x + i, y + 2, 2, h - 4);
    g.lineStyle(2, 0xf3e3c0, 0.9).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 2);
    g.fillStyle(0xf3e3c0, 0.9);
    for (let i = 3; i < h - 2; i += 3) {
      g.fillRect(x - 3, y + i, 3, 1);
      g.fillRect(x + w, y + i, 3, 1);
    }
    // Sacks and cards take turns when a shop sells both.
    const spots = [-22, -15, 15, 22].slice(0, Math.min(4, Math.max(1, shop.items + shop.cards)));
    spots.forEach((dx, i) => {
      const cx = shop.x + dx - 4;
      const cy = shop.y - 9 + (i % 2) * 2;
      const sack = shop.items > 0 && (shop.cards === 0 || i % 2 === 0);
      if (sack) {
        g.fillStyle(0x1d1a16, 0.35).fillEllipse(cx + 5, cy + 8, 10, 8);
        g.fillStyle(0x9a6a3a, 1).fillEllipse(cx + 4, cy + 7, 10, 9);
        g.fillStyle(0xc28d55, 1).fillEllipse(cx + 3, cy + 6, 5, 4);
        g.fillStyle(0x6e4823, 1).fillRect(cx + 2, cy + 1, 5, 2);
        g.fillStyle(0xf2c14e, 1).fillCircle(cx + 4, cy + 1, 1.5);
        return;
      }
      g.fillStyle(0x1d1a16, 0.35).fillRect(cx + 1, cy + 1, 8, 11);
      g.fillStyle(0xffffff, 1).fillRect(cx, cy, 8, 11);
      g.fillStyle(CARD_COLORS[(seed + i) % CARD_COLORS.length], 1).fillRect(cx + 1, cy + 1, 6, 6);
      g.fillStyle(0xd9d2c5, 1).fillRect(cx + 1, cy + 8, 6, 2);
    });
    return g;
  }

  /** The shop sign: an icon (a card, or a coin for a shop selling only for gold), the title (shortened), and how many things are for sale. */
  private sign(shop: PlayerShopView, mine: boolean) {
    const res = this.textRes();
    const title = this.scene.add
      .text(0, 0, signText(shop.title), { fontFamily: FONT, fontSize: "9px", fontStyle: "bold", color: "#1d1a16" })
      .setResolution(res)
      .setOrigin(0, 0.5);
    const count = this.scene.add
      .text(0, 0, String(shop.items + shop.cards), { fontFamily: FONT, fontSize: "8px", fontStyle: "bold", color: "#ffffff" })
      .setResolution(res)
      .setOrigin(0.5, 0.5);
    const pad = 4;
    const icon = 9;
    const gap = 3;
    const pill = Math.max(12, Math.ceil(count.width) + 6);
    // Even width, whole pixels: crisp edges at any zoom.
    const w = Math.ceil((pad + icon + gap + Math.ceil(title.width) + gap + pill + pad) / 2) * 2;
    const h = SIGN_H;
    const left = -w / 2;
    const top = -h;

    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.3).fillRoundedRect(left + 1, top + 1, w, h, 5);
    g.fillStyle(mine ? 0xffefd9 : 0xfffcf6, 1).fillRoundedRect(left, top, w, h, 5);
    g.lineStyle(1, 0xeb8224, 1).strokeRoundedRect(left + 0.5, top + 0.5, w - 1, h - 1, 5);
    const ix = left + pad;
    const iy = top + (h - icon) / 2;
    if (shop.cards === 0 && shop.items > 0) {
      // A gold coin.
      g.fillStyle(0xb9791c, 1).fillCircle(ix + icon / 2, iy + icon / 2, icon / 2);
      g.fillStyle(0xf2c14e, 1).fillCircle(ix + icon / 2 - 0.5, iy + icon / 2 - 0.5, icon / 2 - 1);
      g.fillStyle(0xfff2b0, 1).fillCircle(ix + icon / 2 - 1.5, iy + icon / 2 - 1.5, 1.2);
    } else {
      // A little card on an orange tile.
      g.fillStyle(0xeb8224, 1).fillRoundedRect(ix, iy, icon, icon, 2);
      g.fillStyle(0xffffff, 1).fillRect(ix + 2.5, iy + 1.5, 4, 6);
    }
    const px = w / 2 - pad - pill;
    g.fillStyle(0x1d1a16, 1).fillRoundedRect(px, top + 3, pill, h - 6, 4.5);
    title.setPosition(ix + icon + gap, top + h / 2);
    count.setPosition(px + pill / 2, top + h / 2);

    const y = shop.y + SIGN_BOTTOM;
    const sign = this.scene.add.container(shop.x, y, [g, title, count]).setDepth(SIGN_DEPTH);
    return { sign, rect: new Phaser.Geom.Rectangle(shop.x + left, y + top, w, h) };
  }
}
