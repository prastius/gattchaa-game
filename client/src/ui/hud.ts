import { DECOR, TILE_SIZE, Terrain, type World } from "../../../shared/world";
import { Floor } from "../../../shared/town";
import { EMOTES, EMOTE_NAMES } from "../../../shared/protocol";

export interface Dot {
  x: number;
  y: number;
}

/** The minimap shows this many tiles across, centred on you: the whole walled town fits. */
const MINIMAP_TILES = 128;

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.Deep]: [38, 84, 112],
  [Terrain.Water]: [58, 135, 153],
  [Terrain.Grass]: [104, 160, 72],
  [Terrain.Dirt]: [166, 124, 82],
};

const FLOOR_RGB: Record<number, [number, number, number]> = {
  [Floor.Stone]: [214, 218, 222],
  [Floor.StoneEdge]: [170, 178, 186],
  [Floor.Brand]: [235, 130, 36],
  [Floor.Wood]: [176, 128, 80],
  [Floor.Slab]: [204, 196, 170],
};

export class HUD {
  private root = document.getElementById("hud")!;
  private online = document.getElementById("online")!;
  private coords = document.getElementById("coords")!;
  private connDot = document.getElementById("conn-dot")!;
  private minimap = document.getElementById("minimap") as HTMLCanvasElement;
  private ctx = this.minimap.getContext("2d")!;
  private terrain: HTMLCanvasElement;
  private zoomIn = document.getElementById("zoom-in-btn") as HTMLButtonElement;
  private zoomOut = document.getElementById("zoom-out-btn") as HTMLButtonElement;
  private sitBtn = document.getElementById("sit-btn") as HTMLButtonElement;
  private shopBtn = document.getElementById("shop-btn") as HTMLButtonElement;
  private shopLabel = document.getElementById("shop-label")!;
  private emoteBtn = document.getElementById("emote-btn") as HTMLButtonElement;
  private emotePicker = document.getElementById("emotes")!;
  /** Open player shops, shown on the minimap. */
  private shops: readonly Dot[] = [];

  constructor(private world: World) {
    // Pre-render the whole map once at 1px per tile.
    this.terrain = document.createElement("canvas");
    this.terrain.width = world.width;
    this.terrain.height = world.height;
    const tctx = this.terrain.getContext("2d")!;
    const img = tctx.createImageData(world.width, world.height);
    for (let ty = 0; ty < world.height; ty++) {
      for (let tx = 0; tx < world.width; tx++) {
        const floor = world.floorAt(tx, ty);
        const st = world.structAt(tx, ty);
        const [r, g, b] = st.top || st.face
          ? [222, 214, 196] // stone walls and the palace
          : world.solidAt(tx, ty)
          ? [120, 52, 30]
          : floor
            ? (FLOOR_RGB[floor] ?? [200, 200, 200])
            : (TERRAIN_RGB[world.vertexAt(tx, ty)] ?? [0, 0, 0]);
        const d = DECOR[world.decorAt(tx, ty)];
        const k = d.block ? 0.62 : 1;
        const o = (ty * world.width + tx) * 4;
        img.data[o] = r * k;
        img.data[o + 1] = g * k;
        img.data[o + 2] = b * k;
        img.data[o + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
  }

  /** step: +1 zooms in, -1 zooms out. */
  onZoom(fn: (step: number) => void) {
    this.zoomIn.addEventListener("click", () => fn(1));
    this.zoomOut.addEventListener("click", () => fn(-1));
  }

  setZoomLimits(canZoomOut: boolean, canZoomIn: boolean) {
    this.zoomOut.disabled = !canZoomOut;
    this.zoomIn.disabled = !canZoomIn;
  }

  onSit(fn: () => void) {
    this.sitBtn.addEventListener("click", fn);
  }

  onShop(fn: () => void) {
    this.shopBtn.addEventListener("click", fn);
  }

  /** The emote picker under the buttons: pick one to show it over your head. */
  onEmote(fn: (e: number) => void) {
    EMOTES.forEach((glyph, i) => {
      const key = String((i + 1) % 10);
      const b = document.createElement("button");
      b.type = "button";
      b.title = `${EMOTE_NAMES[i]} (${key})`;
      b.setAttribute("aria-label", EMOTE_NAMES[i]);
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      b.append(glyph, kbd);
      b.addEventListener("click", () => {
        fn(i);
        this.toggleEmotes(false);
      });
      this.emotePicker.append(b);
    });
    this.emoteBtn.addEventListener("click", () => this.toggleEmotes());
  }

  toggleEmotes(open = this.emotePicker.hidden) {
    this.emotePicker.hidden = !open;
    this.emoteBtn.setAttribute("aria-expanded", String(open));
  }

  /** While you mind a shop the button opens it ("My shop"), and there's no Sit (you're already seated). */
  setVending(on: boolean) {
    this.shopLabel.textContent = on ? "My shop" : "Open shop";
    this.shopBtn.title = on ? "Your shop (V)" : "Open a shop right here (V)";
    this.sitBtn.hidden = on;
  }

  setShops(shops: readonly Dot[]) {
    this.shops = shops;
  }

  private indoors = false;

  show() {
    this.root.hidden = false;
  }

  /** Inside the store the island map means nothing; show where you are instead. */
  setIndoors(on: boolean) {
    this.indoors = on;
    this.minimap.hidden = on;
  }

  setConnected(connected: boolean) {
    this.connDot.classList.toggle("off", !connected);
  }

  update(self: Dot | undefined, others: Iterable<Dot>, onlineCount: number, siteOnline = 0) {
    this.online.textContent = siteOnline > 0 ? `${onlineCount} in town · ${siteOnline} on Gattchaa` : `${onlineCount} in town`;
    if (self) {
      this.coords.textContent = this.indoors ? "Gattchaa Palace" : `${Math.floor(self.x / TILE_SIZE)}, ${Math.floor(self.y / TILE_SIZE)}`;
    }
    if (this.indoors) return;

    // The map around you (MINIMAP_TILES across), so the town's streets and squares are readable.
    const { ctx, minimap } = this;
    const at = self ?? { x: (this.world.width * TILE_SIZE) / 2, y: (this.world.height * TILE_SIZE) / 2 };
    const left = at.x / TILE_SIZE - MINIMAP_TILES / 2;
    const top = at.y / TILE_SIZE - MINIMAP_TILES / 2;
    const mx =(x: number) => (x / TILE_SIZE - left) * (minimap.width / MINIMAP_TILES);
    const my = (y: number) => (y / TILE_SIZE - top) * (minimap.height / MINIMAP_TILES);
    ctx.fillStyle = "#265470"; // open sea past the edge of the map
    ctx.fillRect(0, 0, minimap.width, minimap.height);
    ctx.imageSmoothingEnabled = true; // ~1.3 px per tile: smoothing keeps streets even
    ctx.drawImage(this.terrain, left, top, MINIMAP_TILES, MINIMAP_TILES, 0, 0, minimap.width, minimap.height);

    // Player shops: little orange signs with a dark rim, so they read on paving and grass.
    for (const s of this.shops) {
      ctx.fillStyle = "#131313";
      ctx.fillRect(Math.round(mx(s.x)) - 3, Math.round(my(s.y)) - 3, 6, 6);
      ctx.fillStyle = "#eb8224";
      ctx.fillRect(Math.round(mx(s.x)) - 2, Math.round(my(s.y)) - 2, 4, 4);
    }
    ctx.fillStyle = "#ff5fa2";
    for (const o of others) ctx.fillRect(mx(o.x) - 1.5, my(o.y) - 1.5, 3, 3);
    if (self) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx(self.x), my(self.y), 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
