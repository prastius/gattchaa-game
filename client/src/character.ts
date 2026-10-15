import { CATALOG } from "../../shared/catalog";
import { ITEM_FIELDS, bodyName, decodeLook, isHidden, type ItemField } from "../../shared/appearance";

// Builds a character sprite sheet from LPC layers (body, head, hair, clothes...)
// recoloured with palette swaps. One sheet per distinct appearance, cached.

export const FRAME = 64;
export const WALK_COLS = 9; // column 0 = standing, 1..8 = walk cycle
export const SHEET_W = FRAME * WALK_COLS;
export const SHEET_H = FRAME * 4; // rows: up, left, down, right

interface LayerDef {
  z: number;
  files: Record<string, { walk: string; idle?: string }>;
}
interface ItemDef {
  category: string;
  id: string;
  name: string;
  materials: string[];
  layers: LayerDef[];
}
interface Manifest {
  items: ItemDef[];
  palettes: Record<string, { base: string; colors: Record<string, string[]> }>;
}

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

let manifestPromise: Promise<Manifest> | undefined;
export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch(`${ASSET_BASE}lpc/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  });
  return manifestPromise;
}

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(rel: string): Promise<HTMLImageElement> {
  let p = images.get(rel);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${rel}`));
      img.src = ASSET_BASE + rel;
    });
    images.set(rel, p);
  }
  return p;
}

function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** Returns the colour swaps for one item: base palette colour -> chosen palette colour. */
function colorMap(m: Manifest, item: ItemDef, choice: Record<string, string>): Map<number, number> {
  const map = new Map<number, number>();
  for (const material of item.materials) {
    const name = choice[material];
    const pal = m.palettes[material];
    if (!name || !pal || name === pal.base) continue;
    const from = pal.colors[pal.base];
    const to = pal.colors[name];
    if (!from || !to) continue;
    from.forEach((c, i) => to[i] && map.set(hexToInt(c), hexToInt(to[i])));
  }
  return map;
}

const recolored = new Map<string, Promise<CanvasImageSource>>();
function recolor(file: string, map: Map<number, number>): Promise<CanvasImageSource> {
  const key = `${file}|${[...map].join(",")}`;
  let p = recolored.get(key);
  if (!p) {
    p = loadImage(file).then((img) => {
      if (map.size === 0) return img;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        const to = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        if (to === undefined) continue;
        px[i] = to >> 16;
        px[i + 1] = (to >> 8) & 255;
        px[i + 2] = to & 255;
      }
      ctx.putImageData(data, 0, 0);
      return canvas;
    });
    recolored.set(key, p);
  }
  return p;
}

/** Composes the walk sheet (576x256) for an encoded look. */
export async function composeCharacter(lookStr: string, target?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const m = await loadManifest();
  const look = decodeLook(lookStr);
  const body = bodyName(look);
  const item = (category: string, id: string) => m.items.find((i) => i.category === category && i.id === id);

  const cloth = CATALOG.clothColors;
  const hair = CATALOG.hairColors[look.hairColor];
  const picks: [ItemDef | undefined, Record<string, string>][] = [
    [item("shadow", "shadow"), {}],
    [item("body", "body"), { body: CATALOG.skin[look.skin] }],
    [item("head", body), { body: CATALOG.skin[look.skin], eye: CATALOG.eyeColors[look.eyes] }],
  ];
  // Colour choices per style field; hair ties follow the top colour.
  const colors: Record<ItemField, Record<string, string>> = {
    hair: { hair, cloth: cloth[look.topColor] },
    beard: { hair },
    top: { cloth: cloth[look.topColor] },
    bottom: { cloth: cloth[look.bottomColor] },
    shoes: { cloth: cloth[look.shoesColor] },
    hat: { cloth: cloth[look.hatColor] },
    glasses: {},
  };
  for (const field of Object.keys(ITEM_FIELDS) as ItemField[]) {
    if (isHidden(look, field)) continue;
    const choice = ITEM_FIELDS[field][look[field]];
    if (choice) picks.push([item(field, choice.id), colors[field]]);
  }

  const layers: { z: number; src: Promise<CanvasImageSource> }[] = [];
  for (const [it, choice] of picks) {
    if (!it) continue;
    const map = colorMap(m, it, choice);
    for (const layer of it.layers) {
      const file = layer.files[body]?.walk;
      if (file) layers.push({ z: layer.z, src: recolor(file, map) });
    }
  }
  layers.sort((a, b) => a.z - b.z);
  const sources = await Promise.all(layers.map((l) => l.src));

  const canvas = target ?? document.createElement("canvas");
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);
  for (const src of sources) ctx.drawImage(src, 0, 0);
  return canvas;
}

/** Preloads every character layer so the creator feels instant. */
export async function preloadCharacterArt(): Promise<void> {
  const m = await loadManifest();
  await Promise.all(
    m.items.flatMap((i) => i.layers.flatMap((l) => Object.values(l.files).map((f) => loadImage(f.walk).catch(() => undefined)))),
  );
}

/** Mid-tone swatch colour for a palette entry (for the UI). */
export async function swatch(material: "body" | "hair" | "cloth" | "eye", name: string): Promise<string> {
  const m = await loadManifest();
  const colors = m.palettes[material]?.colors[name] ?? [];
  return colors[Math.min(colors.length - 1, material === "eye" ? 1 : 3)] ?? "#888";
}
