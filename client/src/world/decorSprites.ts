import Phaser from "phaser";
import { DECOR, type DecorId } from "../../../shared/world";

// Sprite rectangles (x, y, w, h) inside the LPC Revised sheets, measured from
// their alpha channel. Each decor id has visual variants; the world picks one
// per tile with a hash so it's stable across reloads.

export const WORLD_TEX = {
  terrain: "terrain",
  trees: "trees",
  plants: "plants",
  flowers: "flowers",
  rocks: "rocks",
} as const;

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

/** Registers a named frame for every rect; call once after the sheets load. */
export function registerDecorFrames(scene: Phaser.Scene) {
  for (const [id, art] of Object.entries(ART)) {
    const tex = scene.textures.get(art.tex);
    art.rects.forEach((r, i) => tex.add(`${id}:${i}`, 0, r[0], r[1], r[2], r[3]));
  }
  scene.textures.get(WORLD_TEX.trees).add(SHADOW_FRAME, 0, 16, 25, 64, 31);
}

export interface DecorSprite {
  image: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  tall: boolean;
}

/** Creates the sprite(s) for a decor at tile (tx, ty); `pick` in [0,1) chooses the variant. */
export function createDecor(scene: Phaser.Scene, decor: number, px: number, py: number, pick: number): DecorSprite | null {
  const id = DECOR[decor]?.id;
  if (!id || id === "none") return null;
  const art = ART[id];
  const variant = Math.floor(pick * art.rects.length);
  const image = scene.add.image(px, py, art.tex, `${id}:${variant}`).setOrigin(0.5, 1).setDepth(py);
  let shadow: Phaser.GameObjects.Image | undefined;
  if (art.shadow) {
    // Ground shadow under the canopy; drawn above terrain but below everything standing.
    shadow = scene.add.image(px + 4, py - 6, WORLD_TEX.trees, SHADOW_FRAME).setAlpha(0.32).setDepth(0);
  }
  return { image, shadow, tall: Boolean(art.tall) };
}
