import { DECOR, TILE_SIZE, Terrain, type World } from "../../../shared/world";
import { Floor } from "../../../shared/town";

export interface Dot {
  x: number;
  y: number;
}

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
};

export class HUD {
  private root = document.getElementById("hud")!;
  private online = document.getElementById("online")!;
  private coords = document.getElementById("coords")!;
  private connDot = document.getElementById("conn-dot")!;
  private minimap = document.getElementById("minimap") as HTMLCanvasElement;
  private ctx = this.minimap.getContext("2d")!;
  private terrain: HTMLCanvasElement;

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
        const [r, g, b] = world.solidAt(tx, ty)
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

  show() {
    this.root.hidden = false;
  }

  setConnected(connected: boolean) {
    this.connDot.classList.toggle("off", !connected);
  }

  update(self: Dot | undefined, others: Iterable<Dot>, onlineCount: number, siteOnline = 0) {
    this.online.textContent = siteOnline > 0 ? `${onlineCount} in town · ${siteOnline} on Gattchaa` : `${onlineCount} in town`;
    if (self) {
      this.coords.textContent = `${Math.floor(self.x / TILE_SIZE)}, ${Math.floor(self.y / TILE_SIZE)}`;
    }

    const { ctx, minimap } = this;
    const scale = minimap.width / (this.world.width * TILE_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain, 0, 0, minimap.width, minimap.height);

    ctx.fillStyle = "#ff5fa2";
    for (const o of others) ctx.fillRect(o.x * scale - 1.5, o.y * scale - 1.5, 3, 3);
    if (self) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(self.x * scale, self.y * scale, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
