import Phaser from "phaser";
import { DECOR, type DecorId } from "../../../shared/world";
import type { Biome } from "../../../shared/town";

// Sprite rectangles (x, y, w, h) inside the LPC Revised sheets, measured from
// their alpha channel. Each decor id has visual variants; the world picks one
// per tile with a hash so it's stable across reloads.

export const WORLD_TEX = {
  terrain: "terrain",
  trees: "trees",
  plants: "plants",
  flowers: "flowers",
  rocks: "rocks",
  // Frostfell's snowy versions, Ravenmoor's autumn ones and Petalfall's spring ones (same layout as the summer sheets).
  terrainWinter: "terrain-winter",
  treesWinter: "trees-winter",
  plantsWinter: "plants-winter",
  terrainAutumn: "terrain-autumn",
  treesAutumn: "trees-autumn",
  plantsAutumn: "plants-autumn",
  terrainSpring: "terrain-spring",
  treesSpring: "trees-spring",
  plantsSpring: "plants-spring",
  // The far eastern islands': made when the game starts (makeIslandSheets). Ashpeak's ash from the
  // winter sheets, Sunscar's sand and Starfall's night from the summer ones.
  terrainAsh: "terrain-ash",
  treesAsh: "trees-ash",
  plantsAsh: "plants-ash",
  terrainDesert: "terrain-desert",
  treesDesert: "trees-desert",
  plantsDesert: "plants-desert",
  terrainStarlit: "terrain-starlit",
  treesStarlit: "trees-starlit",
  plantsStarlit: "plants-starlit",
} as const;

/** The season's sheet standing in for a summer one on the islands. */
const SEASON: Record<Biome, Record<string, string>> = {
  summer: {},
  winter: { [WORLD_TEX.trees]: WORLD_TEX.treesWinter, [WORLD_TEX.plants]: WORLD_TEX.plantsWinter },
  autumn: { [WORLD_TEX.trees]: WORLD_TEX.treesAutumn, [WORLD_TEX.plants]: WORLD_TEX.plantsAutumn },
  spring: { [WORLD_TEX.trees]: WORLD_TEX.treesSpring, [WORLD_TEX.plants]: WORLD_TEX.plantsSpring },
  ash: { [WORLD_TEX.trees]: WORLD_TEX.treesAsh, [WORLD_TEX.plants]: WORLD_TEX.plantsAsh },
  desert: { [WORLD_TEX.trees]: WORLD_TEX.treesDesert, [WORLD_TEX.plants]: WORLD_TEX.plantsDesert },
  starlit: { [WORLD_TEX.trees]: WORLD_TEX.treesStarlit, [WORLD_TEX.plants]: WORLD_TEX.plantsStarlit },
};

/** How one pixel of a sheet changes for an island's look; undefined keeps it as it is. */
type Recolor = (r: number, g: number, b: number, lum: number) => [number, number, number] | undefined;

/** Copies a loaded sheet into a new texture, pixel by pixel through `fn` (same layout, so the same cells and frames work). */
function recolorSheet(scene: Phaser.Scene, from: string, to: string, fn: Recolor) {
  if (scene.textures.exists(to)) return;
  const src = scene.textures.get(from).getSourceImage() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const out = fn(d[i], d[i + 1], d[i + 2], 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
    if (out) [d[i], d[i + 1], d[i + 2]] = out;
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(to, canvas);
}

/** Sea (blue above green and red) and surf (nearly white) stay as they are on every island. */
const isSea = (r: number, g: number, b: number, lum: number) => (b > r + 40 && b >= g) || (lum > 205 && Math.max(r, g, b) - Math.min(r, g, b) < 30);
/** Grass and leaves: green above red and blue. */
const isGreen = (r: number, g: number, b: number) => g > r && g >= b;

/**
 * The far eastern islands' sheets, made when the game starts since there are none to download.
 * Ashpeak's from Frostfell's: snow and ice to grey ash, bark, needles, berries and rock to charcoal.
 * Sunscar's from the summer ones: grass to sand, leaves dried to olive. Starfall's from the summer
 * ones too: grass and leaves to the violets and blues of a night sky. The sea stays sea.
 */
export function makeIslandSheets(scene: Phaser.Scene) {
  const ash: (water: boolean) => Recolor = (water) => (r, _g, b, lum) => {
    if (lum >= 140) {
      const t = Math.min(1, (lum - 140) / 115);
      return [78 + t * 60, 72 + t * 56, 70 + t * 54];
    }
    if (water && b > r + 40) return undefined;
    return [lum * 0.92 + 10, lum * 0.78 + 4, lum * 0.7];
  };
  recolorSheet(scene, WORLD_TEX.terrainWinter, WORLD_TEX.terrainAsh, ash(true));
  recolorSheet(scene, WORLD_TEX.treesWinter, WORLD_TEX.treesAsh, ash(false));
  recolorSheet(scene, WORLD_TEX.plantsWinter, WORLD_TEX.plantsAsh, ash(false));

  recolorSheet(scene, WORLD_TEX.terrain, WORLD_TEX.terrainDesert, (r, g, b, lum) => {
    if (isSea(r, g, b, lum)) return undefined;
    if (isGreen(r, g, b)) return [lum * 0.85 + 80, lum * 0.72 + 64, lum * 0.42 + 30];
    return [r * 1.02 + 14, g + 10, b * 0.9];
  });
  const dry: Recolor = (r, g, b, lum) => (isGreen(r, g, b) ? [lum * 0.8 + 40, lum * 0.72 + 34, lum * 0.3 + 10] : undefined);
  recolorSheet(scene, WORLD_TEX.trees, WORLD_TEX.treesDesert, dry);
  recolorSheet(scene, WORLD_TEX.plants, WORLD_TEX.plantsDesert, dry);

  recolorSheet(scene, WORLD_TEX.terrain, WORLD_TEX.terrainStarlit, (r, g, b, lum) => {
    if (isSea(r, g, b, lum)) return undefined;
    if (isGreen(r, g, b)) return [lum * 0.5 + 30, lum * 0.35 + 22, lum * 0.8 + 50];
    return [r * 0.55 + 20, g * 0.5 + 16, b * 0.8 + 40];
  });
  const night: Recolor = (r, g, b, lum) => (isGreen(r, g, b) ? [lum * 0.45 + 30, lum * 0.4 + 30, lum * 0.85 + 50] : [r * 0.6, g * 0.55, b * 0.75 + 20]);
  recolorSheet(scene, WORLD_TEX.trees, WORLD_TEX.treesStarlit, night);
  recolorSheet(scene, WORLD_TEX.plants, WORLD_TEX.plantsStarlit, night);
}
/** In spring these trees' second variant is cherry blossom: Petalfall shows it most of the time. */
const BLOSSOM = new Set<string>(["oak", "oakRoots", "oakTall", "bushTree"]);
const BLOSSOM_SHARE = 0.7;

type Rect = readonly [x: number, y: number, w: number, h: number];
interface DecorArt {
  tex: string;
  rects: Rect[];
  /** Tall props fade when the player walks behind them. */
  tall?: boolean;
  shadow?: boolean;
}

const ART: Record<Exclude<DecorId, "none">, DecorArt> = {
  oak: { tex: WORLD_TEX.trees, tall: true, shadow: true, rects: [[129, 16, 94, 93], [129, 144, 94, 93], [129, 272, 94, 93]] },
  oakRoots: { tex: WORLD_TEX.trees, tall: true, shadow: true, rects: [[225, 16, 94, 100], [225, 144, 94, 100], [225, 272, 94, 100]] },
  oakTall: { tex: WORLD_TEX.trees, tall: true, shadow: true, rects: [[321, 16, 94, 125], [417, 112, 94, 125], [321, 272, 94, 125]] },
  bushTree: { tex: WORLD_TEX.trees, tall: true, shadow: true, rects: [[417, 16, 94, 80], [321, 176, 94, 80], [417, 272, 94, 80]] },
  pine: { tex: WORLD_TEX.trees, tall: true, shadow: true, rects: [[132, 389, 85, 104], [228, 389, 85, 111], [324, 421, 85, 91]] },
  pineTall: { tex: WORLD_TEX.trees, tall: true, shadow: true, rects: [[420, 357, 85, 136]] },
  cypress: { tex: WORLD_TEX.plants, tall: true, rects: [[2, 70, 29, 57], [32, 69, 32, 58], [67, 77, 28, 49]] },
  bush: { tex: WORLD_TEX.plants, rects: [[99, 77, 55, 51], [160, 76, 87, 52]] },
  boulder: { tex: WORLD_TEX.rocks, rects: [[130, 3, 59, 54], [0, 97, 61, 30], [0, 0, 64, 91]] },
  rock: { tex: WORLD_TEX.rocks, rects: [[128, 71, 32, 55], [130, 3, 59, 54]] },
  stone: { tex: WORLD_TEX.rocks, rects: [[163, 77, 27, 14], [170, 108, 15, 8]] },
  fern: { tex: WORLD_TEX.plants, rects: [[96, 0, 32, 32], [128, 0, 32, 32], [160, 0, 32, 32], [195, 39, 28, 25]] },
  tallGrass: {
    tex: WORLD_TEX.plants,
    rects: [[263, 23, 22, 28], [295, 23, 22, 28], [327, 23, 22, 28], [259, 63, 27, 43], [291, 63, 27, 43]],
  },
  flowers: {
    tex: WORLD_TEX.flowers,
    rects: [[8, 99, 16, 21], [40, 99, 16, 21], [72, 99, 16, 21], [104, 99, 16, 21], [136, 99, 16, 21], [7, 131, 16, 22], [39, 131, 16, 22], [71, 131, 16, 22], [4, 70, 23, 20], [36, 70, 23, 20]],
  },
};

const SHADOW_FRAME = "decor-shadow";

/** Registers a named frame for every rect (on the seasons' sheets too); call once after the sheets load. */
export function registerDecorFrames(scene: Phaser.Scene) {
  for (const [id, art] of Object.entries(ART)) {
    for (const key of [art.tex, ...Object.values(SEASON).map((s) => s[art.tex])]) {
      if (!key) continue;
      const tex = scene.textures.get(key);
      art.rects.forEach((r, i) => tex.add(`${id}:${i}`, 0, r[0], r[1], r[2], r[3]));
    }
  }
  scene.textures.get(WORLD_TEX.trees).add(SHADOW_FRAME, 0, 16, 25, 64, 31);
}

export interface DecorSprite {
  image: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  tall: boolean;
}

/** Creates the sprite(s) for a decor at tile (tx, ty); `pick` in [0,1) chooses the variant. Snowy on Frostfell, autumn on Ravenmoor, in blossom on Petalfall, ashen on Ashpeak, dry on Sunscar, starlit on Starfall. */
export function createDecor(scene: Phaser.Scene, decor: number, px: number, py: number, pick: number, biome: Biome = "summer"): DecorSprite | null {
  const id = DECOR[decor]?.id;
  if (!id || id === "none") return null;
  const art = ART[id];
  const variant = biome === "spring" && BLOSSOM.has(id) && pick < BLOSSOM_SHARE ? 1 : Math.floor(pick * art.rects.length);
  const tex = SEASON[biome][art.tex] ?? art.tex;
  const image = scene.add.image(px, py, tex, `${id}:${variant}`).setOrigin(0.5, 1).setDepth(py);
  let shadow: Phaser.GameObjects.Image | undefined;
  if (art.shadow) {
    // Ground shadow under the canopy; drawn above terrain but below everything standing.
    shadow = scene.add.image(px + 4, py - 6, WORLD_TEX.trees, SHADOW_FRAME).setAlpha(0.32).setDepth(0);
  }
  return { image, shadow, tall: Boolean(art.tall) };
}
