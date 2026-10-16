import Phaser from "phaser";
import { DOORS, MACHINES, PROPS, STORE_ROOM, TOWN_AREA, inRect, propAnchor, type Prop, type PropType } from "../../../shared/town";
import { NPCS, npcProducts } from "../../../shared/npcs";
import { ROOM_MODES, type ShopProduct, type ShopRoom, type ShopSnapshot } from "../../../shared/gattchaa";
import { FLOOR_TEX } from "./terrainTiles";

// Renders Gattchaa Town's buildings and furniture (LPC Revised art) and keeps
// the "live" bits in sync with the shop: packs on the stall counters, a pack
// in each machine window, and open rooms above the tables.

const TOWN = `${import.meta.env.BASE_URL}assets/town/`;
const BRAND = `${import.meta.env.BASE_URL}assets/gattchaa/`;

const SHEETS = {
  houseA: "town-house-a",
  houseB: "town-house-b",
  houseC: "town-house-c",
  fountain: "town-fountain",
  vending: "town-vending",
  counter: "town-counter",
  cardTable: "town-card-table",
  lamps: "town-lamps",
  planter: "town-planter",
  barrel: "town-barrel",
  crate: "town-crate",
  stools: "town-stools",
  cabinet: "town-cabinet",
  floorLamps: "town-floor-lamps",
  posters: "town-posters",
  logo: "gattchaa-logo-sign",
  logoBig: "gattchaa-logo-64",
} as const;

type Rect = readonly [x: number, y: number, w: number, h: number];
interface Art {
  tex: string;
  rects: Rect[];
  /** Nudge the sprite's bottom edge relative to the footprint (px). */
  dy?: number;
}

// Rectangles measured from each sheet's alpha channel.
const ART: Record<PropType, Art> = {
  store: { tex: SHEETS.houseA, rects: [[24, 0, 208, 201]], dy: 4 },
  kujiHouse: { tex: SHEETS.houseB, rects: [[23, 0, 144, 192]] },
  gradingHouse: { tex: SHEETS.houseC, rects: [[0, 0, 160, 160]], dy: 4 },
  fountain: { tex: SHEETS.fountain, rects: [[0, 0, 64, 80]], dy: 6 },
  machine: { tex: SHEETS.vending, rects: [[16, 0, 32, 64], [112, 0, 32, 64]], dy: 2 },
  counter: { tex: SHEETS.counter, rects: [[96, 140, 96, 46]], dy: 4 },
  cardTable: { tex: SHEETS.cardTable, rects: [[32, 0, 64, 48]], dy: 8 },
  lamp: { tex: SHEETS.lamps, rects: [[7, 4, 18, 80], [39, 4, 18, 80]], dy: -2 },
  pottedTree: { tex: SHEETS.planter, rects: [[128, 10, 32, 74]], dy: -2 },
  barrels: { tex: SHEETS.barrel, rects: [[96, 2, 48, 61]], dy: -2 },
  barrel: { tex: SHEETS.barrel, rects: [[2, 10, 28, 37], [34, 10, 28, 38]], dy: -2 },
  crate: { tex: SHEETS.crate, rects: [[69, 37, 22, 24], [69, 101, 22, 24]], dy: -3 },
  stool: { tex: SHEETS.stools, rects: [0, 1, 2, 3, 4, 5, 6, 7].map((i): Rect => [4 + i * 32, 0, 24, 32]), dy: -4 },
  // Bookcases full of colourful boxes: booster-box shelves.
  shelf: { tex: SHEETS.cabinet, rects: [[64, 101, 32, 68], [96, 101, 32, 68]], dy: 2 },
  floorLamp: { tex: SHEETS.floorLamps, rects: [[4, 2, 24, 49]], dy: -2 },
};

// Only the illustrated posters (the sheet also has blank paper).
const POSTERS: Rect[] = [[3, 39, 24, 36], [67, 35, 27, 40], [39, 35, 18, 24], [135, 67, 18, 24]];

export function preloadTown(scene: Phaser.Scene) {
  const files: Record<string, string> = {
    [SHEETS.houseA]: "house-a.png",
    [SHEETS.houseB]: "house-b.png",
    [SHEETS.houseC]: "house-c.png",
    [SHEETS.fountain]: "fountain.png",
    [SHEETS.vending]: "vending.png",
    [SHEETS.counter]: "counter.png",
    [SHEETS.cardTable]: "card-table.png",
    [SHEETS.lamps]: "lamps.png",
    [SHEETS.planter]: "planter.png",
    [SHEETS.barrel]: "barrel.png",
    [SHEETS.crate]: "crate.png",
    [SHEETS.stools]: "stools.png",
    [SHEETS.cabinet]: "cabinet.png",
    [SHEETS.floorLamps]: "floor-lamps.png",
    [SHEETS.posters]: "posters.png",
    [FLOOR_TEX.wall]: "wall-brick.png",
    [FLOOR_TEX.herringbone]: "floor-herringbone.png",
    [FLOOR_TEX.diamond]: "floor-diamond.png",
  };
  for (const [key, file] of Object.entries(files)) scene.load.image(key, `${TOWN}${file}`);
  scene.load.image(SHEETS.logo, `${BRAND}logo-sign.png`);
  scene.load.image(SHEETS.logoBig, `${BRAND}logo-64.png`);
}

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";

/** Something in town the player can walk up to and use. */
export interface Hotspot {
  id: string;
  /** "npc:<id>", "machine:<id>", "table:<n>" or "door:<id>". */
  target: string;
  x: number;
  y: number;
  /** Clickable area in world pixels. */
  hit: Phaser.Geom.Rectangle;
  label: string;
}

interface LiveSlot {
  x: number;
  y: number;
  size: number;
  depth: number;
  image?: Phaser.GameObjects.Image;
  key?: string;
}

export class Town {
  readonly hotspots: Hotspot[] = [];
  /** Outdoor lamp heads, for the night glow. */
  readonly lights: { x: number; y: number }[] = [];
  private stallSlots = new Map<string, LiveSlot[]>();
  private machineSlots: { id: string; slot: LiveSlot }[] = [];
  private tableLabels = new Map<number, Phaser.GameObjects.Text>();
  private fountain = { x: 0, y: 0 };

  constructor(
    private scene: Phaser.Scene,
    private textRes: number,
  ) {
    for (const art of Object.values(ART)) {
      const tex = scene.textures.get(art.tex);
      art.rects.forEach((r, i) => {
        const name = `${r[0]},${r[1]},${i}`;
        if (!tex.has(name)) tex.add(name, 0, r[0], r[1], r[2], r[3]);
      });
    }
    const posters = scene.textures.get(SHEETS.posters);
    POSTERS.forEach((r, i) => posters.add(`poster:${i}`, 0, r[0], r[1], r[2], r[3]));
    for (const p of PROPS) this.place(p);
    this.decorate();
    this.decorateInterior();
    for (const d of DOORS) {
      const t = d.trigger;
      this.hotspots.push({
        id: `door:${d.id}`,
        target: `door:${d.id}`,
        x: t.x + t.w / 2,
        y: t.y + t.h / 2,
        hit: new Phaser.Geom.Rectangle(t.x - 8, t.y - 40, t.w + 16, t.h + 40),
        label: d.label,
      });
    }
  }

  get fountainPosition() {
    return this.fountain;
  }

  private place(p: Prop) {
    const art = ART[p.type];
    const { x, y } = propAnchor(p);
    const variant = (p.variant ?? 0) % art.rects.length;
    const r = art.rects[variant];
    const by = y + (art.dy ?? 0);
    this.scene.add.image(x, by, art.tex, `${r[0]},${r[1]},${variant}`).setOrigin(0.5, 1).setDepth(by);

    const [kind, id] = (p.tag ?? "").split(":");
    if (p.type === "fountain") this.fountain = { x, y: by - 40 };
    if (p.type === "lamp") this.lights.push({ x, y: by - 70 });

    if (kind === "machine") {
      const m = MACHINES.find((mm) => mm.id === id)!;
      // The machine's glass front shows its featured pack.
      this.machineSlots.push({ id, slot: { x: x - 2, y: by - 34, size: 18, depth: by + 0.5 } });
      this.hotspots.push({
        id: `machine:${id}`,
        target: `machine:${id}`,
        x,
        y,
        hit: new Phaser.Geom.Rectangle(x - 16, by - 66, 32, 66),
        label: `${m.label} machine`,
      });
    } else if (kind === "stall") {
      const npc = NPCS.find((n) => n.id === id)!;
      this.sign(x, by - 98, npc.title.toUpperCase(), by - 60, 8);
      // Three packs on display across the counter top.
      this.stallSlots.set(
        id,
        [-30, 0, 30].map((dx) => ({ x: x + dx, y: by - 31, size: 18, depth: by + 0.5 })),
      );
      // Clicking the counter talks to whoever runs the stall.
      this.hotspots.push({
        id: `counter:${id}`,
        target: `npc:${id}`,
        x: npc.x,
        y: npc.y,
        hit: new Phaser.Geom.Rectangle(x - 48, by - 46, 96, 46),
        label: `Talk to ${npc.name}`,
      });
    } else if (kind === "table") {
      const n = Number(id);
      const label = this.scene.add
        .text(x, by - 50, "", {
          fontFamily: FONT,
          fontSize: "8px",
          color: "#ffe2b8",
          align: "center",
          backgroundColor: "rgba(19,19,19,0.78)",
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5, 1)
        .setResolution(this.textRes)
        .setDepth(by + 100)
        .setVisible(false);
      this.tableLabels.set(n, label);
      this.hotspots.push({
        id: `table:${n}`,
        target: `table:${n}`,
        x,
        y,
        hit: new Phaser.Geom.Rectangle(x - 34, by - 48, 68, 50),
        label: "Rooms table",
      });
    }
  }

  /** Static flourishes: the Gattchaa sign over the store and the deck sign. */
  private decorate() {
    const store = PROPS.find((p) => p.type === "store")!;
    const s = propAnchor(store);
    // A dark plate with the logo, over the door.
    const door = DOORS.find((d) => d.id === "store-in")!;
    const plateX = door.trigger.x + door.trigger.w / 2;
    const plateY = s.y - 125;
    // In front of the building sprite (which sits a few px below its footprint).
    const front = s.y + 10;
    const g = this.scene.add.graphics().setDepth(front);
    g.fillStyle(0x131313, 1).fillRoundedRect(plateX - 27, plateY - 25, 54, 50, 6);
    g.lineStyle(2, 0xeb8224, 1).strokeRoundedRect(plateX - 27, plateY - 25, 54, 50, 6);
    this.scene.add.image(plateX, plateY, SHEETS.logo).setDepth(front + 1);
    this.sign(s.x + 44, s.y - 118, "GATTCHAA ORIPA", front, 9);

    // One sign per bank of machines (each machine names itself when you walk up).
    const machines = PROPS.filter((p) => p.type === "machine");
    const banks: Prop[][] = [];
    for (const m of machines) {
      const bank = banks.find((b) => b[b.length - 1].y === m.y && b[b.length - 1].x === m.x - 1);
      if (bank) bank.push(m);
      else banks.push([m]);
    }
    for (const bank of banks) {
      const a = propAnchor(bank[0]);
      const b = propAnchor(bank[bank.length - 1]);
      this.sign((a.x + b.x) / 2, a.y - 64, "ORIPA MACHINES", a.y + 2, 8);
    }

    const deck = PROPS.filter((p) => p.type === "cardTable" && inRect(TOWN_AREA, p.x, p.y)).map(propAnchor);
    const dx = (Math.min(...deck.map((d) => d.x)) + Math.max(...deck.map((d) => d.x))) / 2;
    const dy = Math.min(...deck.map((d) => d.y)) - 72;
    this.sign(dx, dy, "ROOMS · SHARING PACK & PACKS BATTLE", dy + 40, 8);
  }

  /** The store's back wall: big logo, store name and posters. */
  private decorateInterior() {
    const cx = (STORE_ROOM.x + STORE_ROOM.w / 2) * 32;
    const wallTop = STORE_ROOM.y * 32;
    const depth = -0.5; // on the wall: behind everyone
    const g = this.scene.add.graphics().setDepth(depth);
    g.fillStyle(0x131313, 1).fillRoundedRect(cx - 40, wallTop + 6, 80, 72, 6);
    g.lineStyle(2, 0xeb8224, 1).strokeRoundedRect(cx - 40, wallTop + 6, 80, 72, 6);
    this.scene.add.image(cx, wallTop + 42, SHEETS.logoBig).setDepth(depth);
    // Store name over the left shelves, tagline over the right; posters between.
    this.sign(cx - 240, wallTop + 22, "GATTCHAA ONE · BATAM", depth, 9);
    this.sign(cx + 240, wallTop + 22, "ORIPA · KUJI · TCG", depth, 9);
    [cx - 150, cx - 120, cx + 120, cx + 150].forEach((px, i) =>
      this.scene.add.image(px, wallTop + 62, SHEETS.posters, `poster:${i}`).setDepth(depth),
    );
  }

  private sign(x: number, y: number, text: string, depth: number, size: number) {
    return this.scene.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: "bold",
        color: "#eb8224",
        backgroundColor: "#131313",
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes)
      .setDepth(depth);
  }

  /** Refresh the live displays from the latest shop data. */
  update(shop: ShopSnapshot, rooms: ShopRoom[]) {
    const inStock = shop.products.filter((p) => !p.soldOut && p.imageUrl);
    for (const [id, slots] of this.stallSlots) {
      const npc = NPCS.find((n) => n.id === id);
      const list = npc ? npcProducts(npc, inStock) : [];
      slots.forEach((slot, i) => this.show(slot, list[i]));
    }
    for (const { id, slot } of this.machineSlots) {
      const m = MACHINES.find((mm) => mm.id === id)!;
      this.show(slot, inStock.find((p) => m.match.test(p.category)));
    }
    this.tableLabels.forEach((label, i) => {
      const r = rooms[i];
      if (!r) {
        label.setVisible(false);
        return;
      }
      const title = r.product.title.length > 24 ? `${r.product.title.slice(0, 23)}…` : r.product.title;
      label.setText(`${(ROOM_MODES[r.mode] ?? "Room").toUpperCase()}  ${r.taken}/${r.seats}\n${title}`).setVisible(true);
    });
  }

  private show(slot: LiveSlot, product: ShopProduct | undefined) {
    if (!product) {
      slot.image?.setVisible(false);
      return;
    }
    const key = `thumb:${product.imageUrl}`;
    if (slot.key === key) return;
    slot.key = key;
    const apply = () => {
      if (slot.key !== key) return;
      const tex = this.scene.textures.get(key);
      // Photos, not pixel art: smooth scaling looks much better here.
      tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
      const src = tex.getSourceImage() as HTMLImageElement;
      const scale = slot.size / Math.max(src.width, src.height);
      if (!slot.image) slot.image = this.scene.add.image(slot.x, slot.y, key).setDepth(slot.depth);
      slot.image.setTexture(key).setScale(scale).setVisible(true);
    };
    if (this.scene.textures.exists(key)) {
      apply();
      return;
    }
    // Needs CORS on the shop's thumbnails (see docs/gattchaa-town-api.md); without it the slot stays empty.
    this.scene.load.image(key, product.imageUrl);
    this.scene.load.once(`filecomplete-image-${key}`, apply);
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }
}
