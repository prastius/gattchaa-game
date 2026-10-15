import { TILE_SIZE, type World } from "../../../shared/world";
import { TILE_COLORS } from "../textures";

export interface Dot {
  x: number;
  y: number;
}

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
    const rgb = Object.fromEntries(
      Object.entries(TILE_COLORS).map(([k, hex]) => {
        const n = parseInt(hex.slice(1), 16);
        return [k, [(n >> 16) & 255, (n >> 8) & 255, n & 255]];
      }),
    );
    for (let i = 0; i < world.tiles.length; i++) {
      const [r, g, b] = rgb[world.tiles[i]];
      const dark = world.decor[i] ? 0.75 : 1;
      img.data[i * 4] = r * dark;
      img.data[i * 4 + 1] = g * dark;
      img.data[i * 4 + 2] = b * dark;
      img.data[i * 4 + 3] = 255;
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
    for (const o of others) {
      ctx.fillRect(o.x * scale - 1.5, o.y * scale - 1.5, 3, 3);
    }
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
