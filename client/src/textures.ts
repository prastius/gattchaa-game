import Phaser from "phaser";
import { TILE_SIZE, TILE_TYPE_COUNT, TILE_VARIANTS, Tile } from "../../shared/world";

// All art is drawn procedurally at startup, so the project runs with zero asset
// files. Swap any of these for real sprite sheets later by loading an image
// under the same texture key.

export const TEX = {
  tiles: "tiles",
  tree: "tree",
  pine: "pine",
  boulder: "boulder",
  shadow: "shadow",
  body: "body",
  head: "head",
} as const;

/** Base colours per tile type; also used by the minimap. */
export const TILE_COLORS: Record<number, string> = {
  [Tile.DeepWater]: "#1c4a6b",
  [Tile.Water]: "#2c7aa0",
  [Tile.Sand]: "#e0cc8e",
  [Tile.Grass]: "#5eab4c",
  [Tile.Forest]: "#3e873b",
  [Tile.Rock]: "#8b8a83",
  [Tile.Snow]: "#e6eef2",
};

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d")!];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `rgb(${r},${g},${b})`;
}

function drawTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, type: number, variant: number) {
  const S = TILE_SIZE;
  const base = TILE_COLORS[type];
  const rand = rng(type * 97 + variant * 13 + 1);
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, S, S);

  const speck = (count: number, size: number, color: () => string) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = color();
      ctx.fillRect(ox + Math.floor(rand() * (S - size)), oy + Math.floor(rand() * (S - size)), size, size);
    }
  };

  switch (type) {
    case Tile.DeepWater:
    case Tile.Water: {
      ctx.strokeStyle = shade(base, type === Tile.Water ? 0.25 : 0.18);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const x = ox + 4 + rand() * (S - 16);
        const y = oy + 6 + rand() * (S - 12);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 4, y - 3, x + 8, y);
        ctx.stroke();
      }
      break;
    }
    case Tile.Sand:
      speck(10, 1, () => (rand() < 0.5 ? shade(base, -0.12) : shade(base, 0.08)));
      break;
    case Tile.Grass:
    case Tile.Forest: {
      speck(14, 2, () => (rand() < 0.6 ? shade(base, -0.14) : shade(base, 0.12)));
      if (type === Tile.Grass && variant === 3) {
        // a few flowers
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = ["#f6e05e", "#f28b82", "#ffffff"][i];
          ctx.fillRect(ox + 4 + rand() * 24, oy + 4 + rand() * 24, 2, 2);
        }
      }
      break;
    }
    case Tile.Rock:
      speck(8, 3, () => shade(base, rand() < 0.5 ? -0.15 : 0.12));
      ctx.strokeStyle = shade(base, -0.25);
      ctx.beginPath();
      ctx.moveTo(ox + rand() * S, oy + rand() * S);
      ctx.lineTo(ox + rand() * S, oy + rand() * S);
      ctx.stroke();
      break;
    case Tile.Snow:
      speck(8, 2, () => (rand() < 0.5 ? "#d4e2ea" : "#ffffff"));
      break;
  }
}

function buildTileset(scene: Phaser.Scene) {
  const [canvas, ctx] = makeCanvas(TILE_VARIANTS * TILE_SIZE, TILE_TYPE_COUNT * TILE_SIZE);
  for (let type = 0; type < TILE_TYPE_COUNT; type++) {
    for (let v = 0; v < TILE_VARIANTS; v++) {
      drawTile(ctx, v * TILE_SIZE, type * TILE_SIZE, type, v);
    }
  }
  scene.textures.addCanvas(TEX.tiles, canvas);
}

function ellipseShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function buildTree(scene: Phaser.Scene) {
  const [c, ctx] = makeCanvas(56, 76);
  ellipseShadow(ctx, 28, 70, 18, 5);
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(24, 46, 8, 24);
  const blobs: [number, number, number, string][] = [
    [28, 34, 18, "#2f6f2e"],
    [17, 38, 12, "#2f6f2e"],
    [39, 38, 12, "#2f6f2e"],
    [28, 26, 15, "#3d8a3a"],
    [22, 22, 8, "#55a64f"],
  ];
  for (const [x, y, r, col] of blobs) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  scene.textures.addCanvas(TEX.tree, c);
}

function buildPine(scene: Phaser.Scene) {
  const [c, ctx] = makeCanvas(44, 80);
  ellipseShadow(ctx, 22, 74, 14, 4);
  ctx.fillStyle = "#5a3d24";
  ctx.fillRect(19, 58, 6, 16);
  const layers: [number, number, string][] = [
    [62, 20, "#1f5a3a"],
    [46, 16, "#26693f"],
    [31, 12, "#2f7a49"],
  ];
  for (const [base, half, col] of layers) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(22 - half, base);
    ctx.lineTo(22 + half, base);
    ctx.lineTo(22, base - 26);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.75)"; // snowy tip
  ctx.beginPath();
  ctx.moveTo(17, 12);
  ctx.lineTo(27, 12);
  ctx.lineTo(22, 5);
  ctx.closePath();
  ctx.fill();
  scene.textures.addCanvas(TEX.pine, c);
}

function buildBoulder(scene: Phaser.Scene) {
  const [c, ctx] = makeCanvas(40, 34);
  ellipseShadow(ctx, 20, 28, 16, 5);
  ctx.fillStyle = "#6f6e69";
  ctx.beginPath();
  ctx.moveTo(5, 28);
  ctx.lineTo(8, 12);
  ctx.lineTo(18, 5);
  ctx.lineTo(30, 8);
  ctx.lineTo(36, 20);
  ctx.lineTo(33, 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#9a9992";
  ctx.beginPath();
  ctx.moveTo(10, 14);
  ctx.lineTo(18, 8);
  ctx.lineTo(27, 10);
  ctx.lineTo(20, 16);
  ctx.closePath();
  ctx.fill();
  scene.textures.addCanvas(TEX.boulder, c);
}

function buildCharacter(scene: Phaser.Scene) {
  {
    const [c, ctx] = makeCanvas(30, 12);
    ellipseShadow(ctx, 15, 6, 13, 5);
    scene.textures.addCanvas(TEX.shadow, c);
  }
  {
    // Torso + legs in light greys so a tint gives each player their colour.
    const [c, ctx] = makeCanvas(24, 24);
    ctx.fillStyle = "#bdbdbd";
    ctx.fillRect(6, 16, 5, 8);
    ctx.fillRect(13, 16, 5, 8);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(3, 2, 18, 17, 6);
    ctx.fill();
    ctx.fillStyle = "#e2e2e2";
    ctx.fillRect(3, 13, 18, 3);
    scene.textures.addCanvas(TEX.body, c);
  }
  {
    // Head faces right; flipX for left.
    const [c, ctx] = makeCanvas(22, 22);
    ctx.fillStyle = "#f2c9a0";
    ctx.beginPath();
    ctx.arc(11, 12, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a3426";
    ctx.beginPath();
    ctx.arc(10, 9, 9, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.fillStyle = "#1d1d1d";
    ctx.fillRect(13, 11, 2, 3);
    ctx.fillRect(17, 11, 2, 3);
    scene.textures.addCanvas(TEX.head, c);
  }
}

export function buildTextures(scene: Phaser.Scene) {
  buildTileset(scene);
  buildTree(scene);
  buildPine(scene);
  buildBoulder(scene);
  buildCharacter(scene);
}
