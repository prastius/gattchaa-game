import Phaser from "phaser";
import {
  DOORS,
  FACADES,
  MACHINES,
  PALACE_DOOR_X,
  PALACE_FACE_BOTTOM,
  PROPS,
  BATTLE_HALL,
  HALL,
  HALL_CX,
  TOWN_AREA,
  TOWN_CX,
  inRect,
  propAnchor,
  type Prop,
  type PropType,
} from "../../../shared/town";
import { NPCS, npcProducts } from "../../../shared/npcs";
import { ROOM_MODES, type ShopProduct, type ShopRoom, type ShopSnapshot } from "../../../shared/gattchaa";
import { FLOOR_TEX } from "./terrainTiles";

// Renders Gattchaa Town's buildings and furniture (LPC Revised art) and keeps
// the "live" bits in sync with the shop: packs on the stall counters, a pack
// in each machine window, and open rooms above the tables.

const TOWN = `${import.meta.env.BASE_URL}assets/town/`;
const BRAND = `${import.meta.env.BASE_URL}assets/gattchaa/`;

const SHEETS = {
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
  pillar: "town-pillar",
  door: "town-door-arched",
  windows: "town-windows",
  thrones: "town-thrones",
  loveseat: "town-loveseat",
  tableOrnate: "town-table-ornate",
  clock: "town-clock",
  portraits: "town-portraits",
  wallLights: "town-wall-lights",
  curtains: "town-curtains",
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
  pillar: { tex: SHEETS.pillar, rects: [[0, 0, 32, 96]] },
  // Gold throne, front view.
  throne: { tex: SHEETS.thrones, rects: [[0, 0, 32, 64]], dy: 4 },
  // Gold formal loveseat: facing you, and seen from behind.
  loveseat: { tex: SHEETS.loveseat, rects: [[0, 9, 64, 40]], dy: 2 },
  loveseatBack: { tex: SHEETS.loveseat, rects: [[0, 129, 64, 31]], dy: 2 },
  coffeeTable: { tex: SHEETS.tableOrnate, rects: [[8, 35, 48, 25]], dy: -2 },
  clock: { tex: SHEETS.clock, rects: [[7, 22, 18, 71], [39, 22, 18, 71]], dy: -2 },
};

/** Wall art in the palace hall (frames in their sheets). */
const PORTRAITS: Rect[] = [[2, 8, 29, 49], [34, 8, 29, 49]]; // king, queen
const TORCH: Rect = [75, 31, 10, 33];
const SWAG: Rect = [0, 128, 96, 64]; // red valance with tie-backs

// Stone Windows A: three glass colours (dark, daylight, lamplit), each an arch on top of a tall pane.
const WINDOW_ARCH = (c: number): Rect => [c * 32, 5, 32, 27];
const WINDOW_BODY = (c: number): Rect => [c * 32, 34, 32, 62];
const WINDOW_DAY = 1;
const WINDOW_LIT = 2;


export function preloadTown(scene: Phaser.Scene) {
  const files: Record<string, string> = {
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
    [SHEETS.pillar]: "pillar.png",
    [SHEETS.door]: "door-arched.png",
    [SHEETS.windows]: "windows-stone.png",
    [FLOOR_TEX.stone]: "wall-stone.png",
    [FLOOR_TEX.tile]: "floor-tile.png",
    [FLOOR_TEX.carpet]: "carpet-floral.png",
    [SHEETS.thrones]: "thrones.png",
    [SHEETS.loveseat]: "loveseat.png",
    [SHEETS.tableOrnate]: "table-ornate.png",
    [SHEETS.clock]: "clock.png",
    [SHEETS.portraits]: "portraits.png",
    [SHEETS.wallLights]: "lighting-wall.png",
    [SHEETS.curtains]: "curtains.png",
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
  /** Lamplit window panes, faded in at night. */
  readonly nightWindows: Phaser.GameObjects.Image[] = [];
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
    const windows = scene.textures.get(SHEETS.windows);
    for (const c of [WINDOW_DAY, WINDOW_LIT]) {
      windows.add(`arch:${c}`, 0, ...WINDOW_ARCH(c));
      windows.add(`pane:${c}`, 0, ...WINDOW_BODY(c));
    }
    scene.textures.get(SHEETS.door).add("closed", 0, 0, 32, 64, 64);
    PORTRAITS.forEach((r, i) => scene.textures.get(SHEETS.portraits).add(`portrait:${i}`, 0, ...r));
    scene.textures.get(SHEETS.wallLights).add("torch", 0, ...TORCH);
    scene.textures.get(SHEETS.curtains).add("swag", 0, ...SWAG);
    for (const p of PROPS) this.place(p);
    this.facades();
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

  /** Doors, windows and banners on the palace and the towers (all on solid stone, so behind everyone). */
  private facades() {
    const depth = -0.5;
    for (const f of FACADES) {
      if (f.kind === "door") {
        this.scene.add.image(f.x, f.y, SHEETS.door, "closed").setOrigin(0.5, 1).setDepth(depth);
      } else if (f.kind === "window") {
        for (const c of [WINDOW_DAY, WINDOW_LIT]) {
          const arch = this.scene.add.image(f.x, f.y - 62, SHEETS.windows, `arch:${c}`).setOrigin(0.5, 1);
          const pane = this.scene.add.image(f.x, f.y, SHEETS.windows, `pane:${c}`).setOrigin(0.5, 1);
          if (c === WINDOW_DAY) {
            arch.setDepth(depth);
            pane.setDepth(depth);
          } else {
            // Above the night tint, so the panes glow.
            for (const img of [arch, pane]) this.nightWindows.push(img.setDepth(1e6 - 8).setAlpha(0).setVisible(false));
          }
        }
      } else if (f.kind === "portrait") {
        this.scene.add.image(f.x, f.y, SHEETS.portraits, `portrait:${f.variant ?? 0}`).setOrigin(0.5, 1).setDepth(depth);
      } else if (f.kind === "torch") {
        this.scene.add.image(f.x, f.y, SHEETS.wallLights, "torch").setOrigin(0.5, 1).setDepth(depth);
      } else if (f.kind === "swag") {
        this.scene.add.image(f.x, f.y, SHEETS.curtains, "swag").setOrigin(0.5, 1).setDepth(depth + 0.05);
      } else {
        this.banner(f.x, f.y, depth + 0.1);
      }
    }
  }

  /** A Gattchaa banner hanging from a rod: orange cloth, swallowtail hem, the logo. */
  private banner(x: number, bottom: number, depth: number) {
    const w = 22;
    const h = 58;
    const top = bottom - h;
    const g = this.scene.add.graphics().setDepth(depth);
    g.fillStyle(0x131313, 1).fillRect(x - w / 2 - 1, top, w + 2, h - 6);
    g.fillTriangle(x - w / 2 - 1, bottom - 7, x + w / 2 + 1, bottom - 7, x - w / 2 - 1, bottom + 1);
    g.fillTriangle(x + w / 2 + 1, bottom - 7, x + w / 2 + 1, bottom + 1, x - w / 2 - 1, bottom - 7);
    g.fillStyle(0xeb8224, 1).fillRect(x - w / 2, top + 1, w, h - 8);
    g.fillTriangle(x - w / 2, bottom - 8, x + w / 2, bottom - 8, x - w / 2, bottom - 1);
    g.fillTriangle(x + w / 2, bottom - 8, x + w / 2, bottom - 1, x - w / 2, bottom - 8);
    // Notch between the two tails.
    g.fillStyle(0x131313, 1).fillTriangle(x - 5, bottom - 1, x + 5, bottom - 1, x, bottom - 8);
    g.fillStyle(0xb85f12, 1).fillRect(x - w / 2, top + 1, 2, h - 9).fillRect(x + w / 2 - 2, top + 1, 2, h - 9);
    // Gold rod with end caps.
    g.fillStyle(0x3b2a12, 1).fillRect(x - w / 2 - 4, top - 3, w + 8, 4);
    g.fillStyle(0xf2c14e, 1).fillRect(x - w / 2 - 3, top - 2, w + 6, 2);
    this.scene.add.image(x, top + 20, SHEETS.logo).setScale(0.42).setDepth(depth + 0.01);
  }

  /** Static flourishes: the Gattchaa crest on the keep, the palace and gate signs, the deck sign. */
  private decorate() {
    // The crest: a dark plate with the logo, centred on the keep between its windows.
    const plateX = PALACE_DOOR_X;
    const plateY = 161 * 32;
    const g = this.scene.add.graphics().setDepth(-0.5);
    g.fillStyle(0x131313, 1).fillRoundedRect(plateX - 30, plateY - 28, 60, 56, 6);
    g.lineStyle(2, 0xeb8224, 1).strokeRoundedRect(plateX - 30, plateY - 28, 60, 56, 6);
    g.lineStyle(1, 0xf2c14e, 1).strokeRoundedRect(plateX - 26, plateY - 24, 52, 48, 4);
    this.scene.add.image(plateX, plateY, SHEETS.logo).setDepth(-0.45);
    this.sign(PALACE_DOOR_X, PALACE_FACE_BOTTOM * 32 - 68, "GATTCHAA ORIPA", -0.4, 9);

    // The south gate: a stone lintel between the towers that you walk under.
    const gx0 = (TOWN_CX - 3) * 32;
    const gx1 = (TOWN_CX + 3) * 32;
    const gy = 216 * 32 - 6;
    const lintelDepth = 218 * 32 + 40; // in front of anyone walking through
    const lintel = this.scene.add.graphics().setDepth(lintelDepth);
    lintel.fillStyle(0x4b4b60, 1).fillRect(gx0 - 4, gy, gx1 - gx0 + 8, 30);
    lintel.fillStyle(0xa89a8c, 1).fillRect(gx0 - 3, gy + 1, gx1 - gx0 + 6, 18);
    lintel.fillStyle(0xd8d2c0, 1).fillRect(gx0 - 3, gy + 1, gx1 - gx0 + 6, 2);
    lintel.fillStyle(0x726b7e, 1).fillRect(gx0 - 3, gy + 19, gx1 - gx0 + 6, 10);
    for (let x = gx0 + 3; x < gx1 - 6; x += 16) {
      lintel.fillStyle(0x4b4b60, 1).fillRect(x, gy - 7, 10, 8);
      lintel.fillStyle(0xd8d2c0, 1).fillRect(x + 1, gy - 6, 8, 1);
      lintel.fillStyle(0xa89a8c, 1).fillRect(x + 1, gy - 5, 8, 5);
    }
    this.sign(PALACE_DOOR_X, gy + 27, "GATTCHAA TOWN", lintelDepth + 1, 10);

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

  /** The palace hall: the crest above the throne, plaques by the door, the Battle Hall sign. */
  private decorateInterior() {
    const cx = HALL_CX * 32;
    const depth = -0.5; // on the wall: behind everyone
    const crestY = 7 * 32 - 4;
    const g = this.scene.add.graphics().setDepth(depth);
    g.fillStyle(0x131313, 1).fillRoundedRect(cx - 34, crestY - 30, 68, 60, 6);
    g.lineStyle(2, 0xeb8224, 1).strokeRoundedRect(cx - 34, crestY - 30, 68, 60, 6);
    g.lineStyle(1, 0xf2c14e, 1).strokeRoundedRect(cx - 30, crestY - 26, 60, 52, 4);
    this.scene.add.image(cx, crestY, SHEETS.logo).setDepth(depth + 0.01);

    // Plaques on the wall top either side of the door.
    const plaqueY = (HALL.y + HALL.h + 1) * 32 + 10;
    this.sign(cx - 14 * 32, plaqueY, "GATTCHAA ONE · BATAM", depth, 9);
    this.sign(cx + 14 * 32, plaqueY, "ORIPA · KUJI · TCG", depth, 9);

    const tables = PROPS.filter((p) => p.type === "cardTable" && inRect(BATTLE_HALL, p.x, p.y)).map(propAnchor);
    const tx = (Math.min(...tables.map((t) => t.x)) + Math.max(...tables.map((t) => t.x))) / 2;
    const ty = Math.min(...tables.map((t) => t.y)) - 72;
    this.sign(tx, ty, "BATTLE HALL · SHARING PACK & PACKS BATTLE", ty + 40, 8);
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
