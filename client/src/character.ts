import { CATALOG } from "../../shared/catalog";
import { ITEM_FIELDS, bodyName, decodeLook, isHidden, type ItemField } from "../../shared/appearance";
import { ITEMS, parseGear, splitAppearance, type GearArt, type ItemId, type Slot } from "../../shared/items";
import type { MonsterId } from "../../shared/rpg";
import { MONSTER_ART } from "./world/monsterArt";

// Builds a character sprite sheet from LPC layers (body, head, hair, clothes...)
// recoloured with palette swaps. One sheet per distinct appearance, cached.

export const FRAME = 64;
export const WALK_COLS = 9; // column 0 = standing, 1..8 = walk cycle
/** One sitting pose after the walk cycle: resting, or minding a shop. */
export const SIT_COL = WALK_COLS;
export const SHEET_COLS = WALK_COLS + 1;
export const SHEET_W = FRAME * SHEET_COLS;
export const SHEET_H = FRAME * 4; // rows: up, left, down, right

/**
 * LPC sit sheets hold three poses (one knee up, legs folded to one side, on a
 * chair). Men sit with a knee up, women with their legs folded to the side.
 */
const SIT_POSE: Record<string, number> = { male: 0, female: 1 };
/** How far the head drops when seated (px), facing up, left, down, right; measured from the LPC heads. */
const SIT_DROP: Record<string, readonly number[]> = { male: [10, 8, 2, 9], female: [9, 8, 7, 9] };
export const sitDrop = (body: string, dir: number) => (SIT_DROP[body] ?? SIT_DROP.male)[dir] ?? 8;

interface LayerDef {
  z: number;
  files: Record<string, { walk?: string; sit?: string }>;
  /** 128: the walk sheet uses big frames with the usual 64px frame in the middle (bows). */
  frame?: number;
}
interface ItemDef {
  category: string;
  id: string;
  name: string;
  materials: string[];
  /** Materials drawn in another colour than the palette's base (leather armour is drawn in "leather"). */
  bases?: Record<string, string>;
  layers: LayerDef[];
  /** Stand-in sitting layers for items that have no sit frames of their own. */
  sitLayers?: LayerDef[];
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
    const base = item.bases?.[material] ?? pal?.base;
    if (!name || !pal || !base || name === base) continue;
    const from = pal.colors[base];
    const to = pal.colors[name];
    if (!from || !to) continue;
    from.forEach((c, i) => to[i] && map.set(hexToInt(c), hexToInt(to[i])));
  }
  return map;
}

/** A walk sheet in big frames, cut down to the usual 64px frames (the middle of each). */
function normalize(img: HTMLImageElement, frame: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WALK_COLS * FRAME;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  const pad = (frame - FRAME) / 2;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < WALK_COLS; col++) {
      ctx.drawImage(img, col * frame + pad, row * frame + pad, FRAME, FRAME, col * FRAME, row * FRAME, FRAME, FRAME);
    }
  }
  return canvas;
}

const recolored = new Map<string, Promise<CanvasImageSource>>();
function recolor(file: string, map: Map<number, number>, frame = FRAME): Promise<CanvasImageSource> {
  const key = `${file}|${[...map].join(",")}`;
  let p = recolored.get(key);
  if (!p) {
    p = loadImage(file).then((loaded) => {
      const img = frame === FRAME ? loaded : normalize(loaded, frame);
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

/** Worn equipment covers the clothes underneath: a helmet replaces the hat, greaves the trousers… */
const GEAR_COVERS: Partial<Record<Slot, ItemField>> = { head: "hat", legs: "bottom", feet: "shoes" };

const findItem = (m: Manifest, category: string, id: string) => m.items.find((i) => i.category === category && i.id === id);
const gearPick = (m: Manifest, art: GearArt): [ItemDef | undefined, Record<string, string>] => [findItem(m, "gear", art.id), { ...art.colors }];

/**
 * Composes the sprite sheet for an appearance key (an encoded look, plus
 * "|gear" when equipment is worn): the walk cycle (576x256), plus the body's
 * sitting pose to its right when `sit` is set (640x256). Previews that only
 * walk skip the sitting layers and their downloads.
 */
export async function composeCharacter(key: string, opts: { sit?: boolean } = {}): Promise<HTMLCanvasElement> {
  const m = await loadManifest();
  const { look: lookStr, gear: gearStr } = splitAppearance(key);
  const look = decodeLook(lookStr);
  const body = bodyName(look);
  const item = (category: string, id: string) => findItem(m, category, id);
  const gear = parseGear(gearStr);
  const covered = new Set<string | undefined>(gear.flatMap((g) => [g.slot && GEAR_COVERS[g.slot], ...(g.hides ?? [])]));

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
    if (isHidden(look, field) || covered.has(field)) continue;
    const choice = ITEM_FIELDS[field][look[field]];
    if (choice) picks.push([item(field, choice.id), colors[field]]);
  }
  for (const g of gear) for (const art of g.art ?? []) picks.push(gearPick(m, art));

  // `pose`: which column of an LPC sit sheet to copy into the sitting column.
  const layers: { z: number; pose?: number; src: Promise<CanvasImageSource> }[] = [];
  const pose = SIT_POSE[body] ?? 0;
  for (const [it, choice] of picks) {
    if (!it) continue;
    const map = colorMap(m, it, choice);
    for (const layer of it.layers) {
      const file = layer.files[body]?.walk;
      if (file) layers.push({ z: layer.z, src: recolor(file, map, layer.frame) });
    }
    if (!opts.sit) continue;
    for (const layer of it.sitLayers ?? it.layers) {
      const file = layer.files[body]?.sit;
      if (file) layers.push({ z: layer.z, pose, src: recolor(file, map) });
    }
  }
  layers.sort((a, b) => a.z - b.z);
  const sources = await Promise.all(layers.map((l) => l.src));

  const canvas = document.createElement("canvas");
  canvas.width = opts.sit ? SHEET_W : WALK_COLS * FRAME;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  layers.forEach((l, i) => {
    if (l.pose === undefined) ctx.drawImage(sources[i], 0, 0);
    else ctx.drawImage(sources[i], l.pose * FRAME, 0, FRAME, SHEET_H, SIT_COL * FRAME, 0, FRAME, SHEET_H);
  });
  return canvas;
}

/** One piece of character art for a monster: a manifest item (category and id) and its colours by material. */
export interface ArtPart {
  category: string;
  id: string;
  colors?: Record<string, string>;
}

/**
 * A walk sheet (576x256) put together from pieces of character art on the
 * male body, for humanoid monsters: orcs, goblins, skeletons…
 */
export async function composeParts(parts: readonly ArtPart[]): Promise<HTMLCanvasElement> {
  const m = await loadManifest();
  const layers: { z: number; src: Promise<CanvasImageSource> }[] = [];
  for (const part of parts) {
    const it = findItem(m, part.category, part.id);
    if (!it) {
      console.warn("monster art: no", part.category, part.id);
      continue;
    }
    const map = colorMap(m, it, part.colors ?? {});
    for (const layer of it.layers) {
      const file = layer.files.male?.walk;
      if (file) layers.push({ z: layer.z, src: recolor(file, map, layer.frame) });
    }
  }
  layers.sort((a, b) => a.z - b.z);
  const sources = await Promise.all(layers.map((l) => l.src));
  const canvas = document.createElement("canvas");
  canvas.width = WALK_COLS * FRAME;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d")!;
  for (const src of sources) ctx.drawImage(src, 0, 0);
  return canvas;
}

/** Preloads every character layer so the creator feels instant (equipment loads when someone wears it). */
export async function preloadCharacterArt(): Promise<void> {
  const m = await loadManifest();
  await Promise.all(
    m.items
      .filter((i) => i.category !== "gear")
      .flatMap((i) => i.layers.flatMap((l) => Object.values(l.files).map((f) => f.walk && loadImage(f.walk).catch(() => undefined)))),
  );
}

// ---------------------------------------------------------------- item icons

/** Item icons are drawn at this size (the 16px icon pack at 2x). */
export const ICON = 32;
const icons = new Map<string, Promise<HTMLCanvasElement>>();
const packIcons = new Map<string, Promise<HTMLCanvasElement>>();

/** An icon from the icon pack (assets/items) at 2x, on a 32x32 canvas (cached). Skills use these too. */
export function packIcon(name: string): Promise<HTMLCanvasElement> {
  let p = packIcons.get(name);
  if (!p) {
    p = loadImage(`items/${name}.png`)
      .then((img) => {
        const out = blankIcon();
        const ctx = out.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, img.width, img.height, (ICON - img.width * 2) / 2, (ICON - img.height * 2) / 2, img.width * 2, img.height * 2);
        return out;
      })
      .catch(() => blankIcon());
    packIcons.set(name, p);
  }
  return p;
}

/**
 * An item's icon on a 32x32 canvas (cached): from the icon pack, a little card
 * with its monster on it, or cut from its gear art (the standing, facing-down
 * frame, trimmed and centred).
 */
export function itemIcon(id: ItemId): Promise<HTMLCanvasElement> {
  let p = icons.get(id);
  if (!p) {
    p = drawIcon(id).catch((err) => {
      console.warn("item icon", id, err);
      return blankIcon();
    });
    icons.set(id, p);
  }
  return p;
}

function blankIcon(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = ICON;
  return c;
}

async function drawIcon(id: ItemId): Promise<HTMLCanvasElement> {
  const it = ITEMS[id];
  const out = blankIcon();
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  if (it.icon) {
    ctx.drawImage(await packIcon(it.icon), 0, 0);
    return out;
  }
  if (it.kind === "card" && it.monster) {
    await drawCard(ctx, it.monster);
    return out;
  }

  // The art alone, on the male body's standing frame: facing down, or sideways
  // for boots (one boot side-on reads better than two specks).
  const row = it.slot === "feet" ? 3 : 2;
  const m = await loadManifest();
  const frame = document.createElement("canvas");
  frame.width = frame.height = FRAME;
  const fctx = frame.getContext("2d", { willReadFrequently: true })!;
  const layers: { z: number; src: CanvasImageSource }[] = [];
  for (const art of it.art ?? []) {
    const [def, choice] = gearPick(m, art);
    if (!def) continue;
    const map = colorMap(m, def, choice);
    for (const layer of def.layers) {
      const file = layer.files.male?.walk;
      if (file) layers.push({ z: layer.z, src: await recolor(file, map, layer.frame) });
    }
  }
  layers.sort((a, b) => a.z - b.z);
  for (const l of layers) fctx.drawImage(l.src, 0, row * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME);

  // Fill the icon with the drawn pixels (up to 2x), in the middle.
  fit(ctx, frame, { x: 0, y: 0, w: ICON, h: ICON }, 2, 1);
  return out;
}

/** The box around a canvas's drawn (non-transparent) pixels. */
function trim(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | undefined {
  const px = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (px[(y * c.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Draws the drawn part of `src` as big as fits in `box` (at most `max` times), centred. */
function fit(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }, max: number, pad: number) {
  const t = trim(src);
  if (!t) return;
  const scale = Math.min(max, (box.w - 2 * pad) / t.w, (box.h - 2 * pad) / t.h);
  const dw = Math.round(t.w * scale);
  const dh = Math.round(t.h * scale);
  // Shrinking big sprites reads better smoothed; pixel art grows crisp.
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(src, t.x, t.y, t.w, t.h, box.x + Math.floor((box.w - dw) / 2), box.y + Math.floor((box.h - dh) / 2), dw, dh);
  ctx.imageSmoothingEnabled = false;
}

/** Behind the monster on its card. */
const CARD_SKY: Record<MonsterId, [string, string]> = {
  slime: ["#cdeccf", "#8fcf9a"],
  snake: ["#efe6b4", "#c9b86a"],
  hornet: ["#ffe7b0", "#f2b54d"],
  snapper: ["#fbd3e3", "#e48ab0"],
  grub: ["#e9dfc8", "#b9a27a"],
  bat: ["#c9c3e6", "#6f62a8"],
  rockworm: ["#e3d2b4", "#a07c52"],
  gazer: ["#ffd9d9", "#d9707a"],
  ghost: ["#dff3d0", "#8fb57a"],
  pumpking: ["#ffe2a6", "#e8822a"],
  goblin: ["#e2efc4", "#9cbf5e"],
  orcWarrior: ["#e8dcc4", "#a88a5c"],
  orcArcher: ["#d8e8d0", "#7c9a6c"],
  orcSkeleton: ["#e6e2f0", "#8c86a6"],
  orcZombie: ["#d6e4cc", "#6f8a62"],
  orcWarlord: ["#ffd8a8", "#c0442c"],
  boarman: ["#ecdcc8", "#a5734f"],
  lizardman: ["#d4ecdf", "#4f9a7a"],
  werewolf: ["#d9dde6", "#5f6a80"],
  troll: ["#dfe8c8", "#7f9a52"],
  vampire: ["#e8d0dc", "#7a2e4a"],
  minotaurKing: ["#ffe0a0", "#9a3a1c"],
  yeti: ["#eef6fb", "#a9c4d6"],
  ramhorn: ["#ece6da", "#8f8470"],
  frostShaman: ["#dcefff", "#4f7fc4"],
  frostWight: ["#e4ecf2", "#6f8394"],
  frostDrake: ["#d6f1ff", "#3f8fc4"],
  frostGiant: ["#e0f6ff", "#2f5f9a"],
};

/** A monster card: gold frame, the monster facing you, and a name plate (Ragnarok style). */
async function drawCard(ctx: CanvasRenderingContext2D, monster: MonsterId) {
  const art = MONSTER_ART[monster];
  const sheet = art.parts ? await composeParts(art.parts) : await loadImage(`monsters/${art.file}`);
  // Its standing frame, facing down.
  const frame = document.createElement("canvas");
  frame.width = frame.height = art.frame;
  frame.getContext("2d", { willReadFrequently: true })!.drawImage(sheet, 0, 2 * art.frame, art.frame, art.frame, 0, 0, art.frame, art.frame);

  const x = 6;
  const y = 1;
  const w = 20;
  const h = 30;
  ctx.fillStyle = "#3a230c";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#e9c25c";
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = "#fff4d8";
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  // The picture window.
  const win = { x: x + 3, y: y + 3, w: w - 6, h: 16 };
  const [top, bottom] = CARD_SKY[monster];
  const sky = ctx.createLinearGradient(0, win.y, 0, win.y + win.h);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(win.x, win.y, win.w, win.h);
  fit(ctx, frame, win, 1, 0);
  ctx.fillStyle = "#7a5a2a";
  ctx.fillRect(win.x, win.y + win.h, win.w, 1);
  // The name plate and a line of rules text.
  ctx.fillStyle = "#b08a4a";
  ctx.fillRect(x + 4, y + 22, w - 8, 1);
  ctx.fillRect(x + 4, y + 24, w - 10, 1);
  ctx.fillRect(x + 4, y + 26, w - 9, 1);
  // Rounded corners.
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) ctx.clearRect(cx, cy, 1, 1);
}

/** Mid-tone swatch colour for a palette entry (for the UI). */
export async function swatch(material: "body" | "hair" | "cloth" | "eye", name: string): Promise<string> {
  const m = await loadManifest();
  const colors = m.palettes[material]?.colors[name] ?? [];
  return colors[Math.min(colors.length - 1, material === "eye" ? 1 : 3)] ?? "#888";
}
