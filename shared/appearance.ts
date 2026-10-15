import { CATALOG, type CatalogItem } from "./catalog";

/**
 * A character's appearance: indexes into CATALOG. Synced as a compact string
 * like "0.3.1.5.12.0.4.2.7.1.22.0.0.0.0" so it costs a few bytes per player.
 */
export interface Look {
  body: number;
  skin: number;
  eyes: number;
  hair: number;
  hairColor: number;
  beard: number;
  top: number;
  topColor: number;
  bottom: number;
  bottomColor: number;
  shoes: number;
  shoesColor: number;
  hat: number;
  hatColor: number;
  glasses: number;
}

export const LOOK_KEYS = [
  "body",
  "skin",
  "eyes",
  "hair",
  "hairColor",
  "beard",
  "top",
  "topColor",
  "bottom",
  "bottomColor",
  "shoes",
  "shoesColor",
  "hat",
  "hatColor",
  "glasses",
] as const satisfies readonly (keyof Look)[];

/** Style fields and the catalog list each one indexes. */
export const ITEM_FIELDS = {
  hair: CATALOG.hair,
  beard: CATALOG.beard,
  top: CATALOG.top,
  bottom: CATALOG.bottom,
  shoes: CATALOG.shoes,
  hat: CATALOG.hat,
  glasses: CATALOG.glasses,
} as const satisfies Partial<Record<keyof Look, readonly CatalogItem[]>>;
export type ItemField = keyof typeof ITEM_FIELDS;

/** Colour fields and the palette names each one indexes. */
export const COLOR_FIELDS = {
  skin: CATALOG.skin,
  eyes: CATALOG.eyeColors,
  hairColor: CATALOG.hairColors,
  topColor: CATALOG.clothColors,
  bottomColor: CATALOG.clothColors,
  shoesColor: CATALOG.clothColors,
  hatColor: CATALOG.clothColors,
} as const satisfies Partial<Record<keyof Look, readonly string[]>>;
export type ColorField = keyof typeof COLOR_FIELDS;

export const bodyName = (look: Pick<Look, "body">) => CATALOG.bodies[look.body] ?? CATALOG.bodies[0];

export function supports(item: CatalogItem | undefined, body: string): boolean {
  return !!item && item.bodies.includes(body);
}

/** Indexes of the options a body type can wear for a style field. */
export function optionsFor(field: ItemField, body: string): number[] {
  const out: number[] = [];
  ITEM_FIELDS[field].forEach((item, i) => supports(item, body) && out.push(i));
  return out;
}

const indexOf = (field: ItemField, id: string) => ITEM_FIELDS[field].findIndex((i) => i.id === id);
const colorIndex = (field: ColorField, name: string) => Math.max(0, (COLOR_FIELDS[field] as readonly string[]).indexOf(name));

/** Sensible starting outfit per body type (also the fallback for invalid input). */
const STARTER: Record<string, Partial<Record<ItemField, string>>> = {
  male: { hair: "plain", beard: "none", top: "tshirt", bottom: "pants", shoes: "shoes", hat: "none", glasses: "none" },
  female: { hair: "long", beard: "none", top: "blouse", bottom: "skirt", shoes: "shoes", hat: "none", glasses: "none" },
};

function defaultItem(field: ItemField, body: string): number {
  const preferred = indexOf(field, STARTER[body]?.[field] ?? "");
  if (supports(ITEM_FIELDS[field][preferred], body)) return preferred;
  return optionsFor(field, body)[0] ?? 0;
}

export function defaultLook(body = 0): Look {
  const b = CATALOG.bodies[body] ?? CATALOG.bodies[0];
  return {
    body,
    skin: 0,
    eyes: colorIndex("eyes", "brown"),
    hair: defaultItem("hair", b),
    hairColor: colorIndex("hairColor", "dark_brown"),
    beard: defaultItem("beard", b),
    top: defaultItem("top", b),
    topColor: colorIndex("topColor", "blue"),
    bottom: defaultItem("bottom", b),
    bottomColor: colorIndex("bottomColor", "charcoal"),
    shoes: defaultItem("shoes", b),
    shoesColor: colorIndex("shoesColor", "brown"),
    hat: defaultItem("hat", b),
    hatColor: colorIndex("hatColor", "white"),
    glasses: defaultItem("glasses", b),
  };
}

/** Makes every style valid for the look's body type (used after switching body). */
export function fitToBody(look: Look): Look {
  const b = bodyName(look);
  const out = { ...look };
  for (const field of Object.keys(ITEM_FIELDS) as ItemField[]) {
    if (!supports(ITEM_FIELDS[field][out[field]], b)) out[field] = defaultItem(field, b);
  }
  return out;
}

export function encodeLook(look: Look): string {
  return LOOK_KEYS.map((k) => look[k]).join(".");
}

/** Parses untrusted input; anything missing, out of range or wrong for the body falls back. */
export function decodeLook(raw: unknown): Look {
  const parts = String(raw ?? "")
    .slice(0, 80)
    .split(".")
    .map((p) => (p === "" ? NaN : Number(p)));
  const read = (i: number, n: number, fallback: number) =>
    Number.isInteger(parts[i]) && parts[i] >= 0 && parts[i] < n ? parts[i] : fallback;

  const body = read(0, CATALOG.bodies.length, 0);
  const look = defaultLook(body);
  LOOK_KEYS.forEach((k, i) => {
    if (k === "body") return;
    if (k in COLOR_FIELDS) look[k] = read(i, COLOR_FIELDS[k as ColorField].length, look[k]);
    else look[k] = read(i, ITEM_FIELDS[k as ItemField].length, look[k]);
  });
  return fitToBody(look);
}

export function normalizeLook(raw: unknown): string {
  return encodeLook(decodeLook(raw));
}

/** True when another item covers this category (e.g. a dress hides the bottom). */
export function isHidden(look: Look, category: ItemField): boolean {
  return (Object.keys(ITEM_FIELDS) as ItemField[]).some((field) => {
    const item: CatalogItem | undefined = ITEM_FIELDS[field][look[field]];
    return !!item?.hides?.includes(category);
  });
}

/** Natural-looking random character (skin/hair limited to realistic tones). */
export function randomLook(rand: () => number = Math.random, body?: number): Look {
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const b = body ?? Math.floor(rand() * CATALOG.bodies.length);
  const name = CATALOG.bodies[b];
  const natural = (field: ColorField, names: string[]) =>
    names.map((n) => (COLOR_FIELDS[field] as readonly string[]).indexOf(n)).filter((i) => i >= 0);
  const look = defaultLook(b);
  look.skin = pick(natural("skin", ["light", "amber", "olive", "taupe", "bronze", "brown", "black"])) ?? 0;
  look.eyes = Math.floor(rand() * COLOR_FIELDS.eyes.length);
  look.hairColor =
    pick(natural("hairColor", ["ash", "platinum", "blonde", "sandy", "ginger", "light_brown", "chestnut", "dark_brown", "black", "raven", "gray"])) ?? 0;
  const anyBut = (field: ItemField, ...skip: string[]) =>
    pick(optionsFor(field, name).filter((i) => !skip.includes(ITEM_FIELDS[field][i].id)));
  look.hair = anyBut("hair", "bald");
  look.top = anyBut("top");
  look.bottom = anyBut("bottom");
  look.shoes = anyBut("shoes");
  // Accessories are occasional, not every other character.
  look.beard = rand() < 0.3 ? anyBut("beard", "none") ?? 0 : defaultItem("beard", name);
  look.glasses = rand() < 0.2 ? anyBut("glasses", "none") ?? 0 : defaultItem("glasses", name);
  look.hat = rand() < 0.15 ? anyBut("hat", "none") ?? 0 : defaultItem("hat", name);
  for (const k of ["topColor", "bottomColor", "shoesColor", "hatColor"] as const) {
    look[k] = Math.floor(rand() * COLOR_FIELDS[k].length);
  }
  return fitToBody(look);
}
