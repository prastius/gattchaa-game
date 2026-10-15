import { DECOR, TILE_SIZE, Terrain, type World } from "../../../shared/world";

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
        const [r, g, b] = TERRAIN_RGB[world.vertexAt(tx, ty)] ?? [0, 0, 0];
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

  update(self: Dot | undefined, others: Iterable<Dot>, onlineCount: number) {
    this.online.textContent = `${onlineCount} online`;
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
