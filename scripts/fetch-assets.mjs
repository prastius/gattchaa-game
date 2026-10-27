#!/usr/bin/env node
// Downloads the art used by the game from two open LPC repositories (pinned
// commits, so the result is reproducible), writes a manifest the client reads
// at runtime, and regenerates shared/catalog.ts + CREDITS.md. The output is
// committed to git, so the VPS never needs to run this.
//
//   node scripts/fetch-assets.mjs
//
// To add an item: add a row to ITEMS (browse the options at
// https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/)
// and re-run.

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "client/public/assets");

const ULPC_SHA = "9bf06be193b053db256b2536824af426de046aa2";
const ULPC = `https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/${ULPC_SHA}`;
const ELIZA_SHA = "f07f7f5892e67c932c68f70bb04472f2c64e46bc";
const ELIZA = `https://raw.githubusercontent.com/ElizaWy/LPC/${ELIZA_SHA}`;

const BODY_TYPES = ["male", "female"];
const B = BODY_TYPES;
const M = ["male"];
const F = ["female"];

// Look-alikes whose sitting frames stand in for items that have none.
const SIT_SKIRT = "legs/skirts/legs_skirts_plain.json";
const SIT_SCOOP = "torso/shirts/shortsleeve/torso_clothes_tshirt_scoop.json";
const SIT_SCOOP_LONG = "torso/shirts/longsleeve/torso_clothes_longsleeve2_scoop.json";
const SIT_LONGSLEEVE = "torso/shirts/longsleeve/torso_clothes_longsleeve.json";
const SIT_SLEEVELESS = "torso/shirts/sleeveless/torso_clothes_sleeveless2.json";

/**
 * Character options, in UI order: [category, id, label, definition path, bodies, options].
 * - bodies: which body types offer this option (masculine/feminine lists differ).
 * - options.variant: for pre-coloured items, which colour file to use ("white" is
 *   recoloured at runtime like everything else; others are drawn as-is).
 * - options.hides: categories this item covers (a dress hides the bottom).
 * - options.sitAs: definitions whose "sit" frames are used instead when the item
 *   has none (same cloth palette, so the colour still matches).
 * - id "none" (no path) is an empty choice.
 */
const ITEMS = [
  ["body", "body", "Body", "body/body.json", B],
  ["shadow", "shadow", "Shadow", "body/shadow.json", B, { fixed: true }],
  ["head", "male", "Head", "head/heads/human/heads_human_male.json", B],
  ["head", "female", "Head", "head/heads/human/heads_human_female.json", B],

  // Hair: shared styles first, then body-specific ones.
  ["hair", "plain", "Plain", "hair/short/hair_plain.json", B],
  ["hair", "messy", "Messy", "hair/short/hair_messy1.json", B],
  ["hair", "bedhead", "Bedhead", "hair/short/hair_bedhead.json", B],
  ["hair", "spiked", "Spiky", "hair/spiky/hair_spiked.json", B],
  ["hair", "curly", "Short curls", "hair/curly/hair_curly_short.json", B],
  ["hair", "afro", "Afro", "hair/afro/hair_afro.json", B],
  ["hair", "natural", "Natural", "hair/afro/hair_natural.json", B],
  ["hair", "mop", "Mop", "hair/short/hair_mop.json", B],
  ["hair", "idol", "Idol", "hair/short/hair_idol.json", B],
  ["hair", "bangs", "Bangs", "hair/short/hair_bangs.json", B],
  ["hair", "long", "Long", "hair/long/hair_long.json", B],
  ["hair", "ponytail", "Ponytail", "hair/braids/hair_ponytail.json", B],
  ["hair", "buzzcut", "Buzzcut", "hair/bald/hair_buzzcut.json", M],
  ["hair", "highTight", "High & tight", "hair/bald/hair_high_and_tight.json", M],
  ["hair", "flatTop", "Flat top", "hair/afro/hair_flat_top_fade.json", M],
  ["hair", "mohawk", "Mohawk", "hair/bald/hair_shorthawk.json", M],
  ["hair", "spiked2", "Spiky 2", "hair/spiky/hair_spiked2.json", M],
  ["hair", "cowlick", "Cowlick", "hair/short/hair_cowlick.json", M],
  ["hair", "parted", "Side part", "hair/short/hair_parted.json", M],
  ["hair", "swoop", "Swoop", "hair/short/hair_swoop.json", M],
  ["hair", "unkempt", "Unkempt", "hair/short/hair_unkempt.json", M],
  ["hair", "dreads", "Short dreads", "hair/afro/hair_dreadlocks_short.json", M],
  ["hair", "cornrows", "Cornrows", "hair/afro/hair_cornrows.json", M],
  ["hair", "twists", "Twists", "hair/afro/hair_twists_fade.json", M],
  ["hair", "topknot", "Top knot", "hair/braids/hair_topknot_short.json", M],
  ["hair", "longStraight", "Long straight", "hair/long/hair_long_straight.json", F],
  ["hair", "wavy", "Wavy", "hair/long/hair_wavy.json", F],
  ["hair", "loose", "Loose", "hair/long/hair_loose.json", F],
  ["hair", "bangsLong", "Long bangs", "hair/long/hair_bangslong.json", F],
  ["hair", "bob", "Bob", "hair/bob/hair_bob.json", F],
  ["hair", "bobSide", "Side bob", "hair/bob/hair_bob_side_part.json", F],
  ["hair", "lob", "Lob", "hair/bob/hair_lob.json", F],
  ["hair", "pixie", "Pixie", "hair/short/hair_pixie.json", F],
  ["hair", "highPonytail", "High ponytail", "hair/braids/hair_high_ponytail.json", F],
  ["hair", "pigtails", "Pigtails", "hair/pigtails/hair_pigtails.json", F],
  ["hair", "bunches", "Bunches", "hair/pigtails/hair_bunches.json", F],
  ["hair", "braid", "Braid", "hair/braids/hair_braid.json", F],
  ["hair", "halfUp", "Half up", "hair/braids/hair_half_up.json", F],
  ["hair", "bun", "Bun", "hair/braids/hair_bangs_bun.json", F],
  ["hair", "curlyLong", "Long curls", "hair/curly/hair_curly_long.json", F],
  ["hair", "bigCurls", "Big curls", "hair/curly/hair_curls_large.json", F],
  ["hair", "princess", "Princess", "hair/xlong/hair_princess.json", F],
  ["hair", "xlongWavy", "Extra long wavy", "hair/xlong/hair_xlong_wavy.json", F],
  ["hair", "bald", "Bald", null, B],

  ["beard", "none", "None", null, B],
  ["beard", "stubble", "Stubble", "hair/beards/beards_5oclock_shadow.json", M],
  ["beard", "trimmed", "Trimmed", "hair/beards/beards_trimmed.json", M],
  ["beard", "beard", "Beard", "hair/beards/beards_beard.json", M],
  ["beard", "medium", "Full beard", "hair/beards/beards_medium.json", M],
  ["beard", "mustache", "Mustache", "hair/mustaches/beards_mustache.json", M],
  ["beard", "french", "French", "hair/mustaches/beards_french.json", M],
  ["beard", "handlebar", "Handlebar", "hair/mustaches/beards_handlebar.json", M],

  ["top", "tshirt", "T-shirt", "torso/shirts/shortsleeve/torso_clothes_tshirt.json", B],
  ["top", "vneck", "V-neck tee", "torso/shirts/shortsleeve/torso_clothes_tshirt_vneck.json", B],
  ["top", "polo", "Polo", "torso/shirts/shortsleeve/torso_clothes_shortsleeve_polo.json", B],
  ["top", "longsleeve", "Long sleeve", "torso/shirts/longsleeve/torso_clothes_longsleeve.json", B],
  ["top", "cardigan", "Cardigan", "torso/shirts/longsleeve/torso_clothes_longsleeve2_cardigan.json", B],
  ["top", "sleeveless", "Sleeveless", "torso/shirts/sleeveless/torso_clothes_sleeveless2.json", B],
  ["top", "buttonTee", "Button tee", "torso/shirts/shortsleeve/torso_clothes_tshirt_buttoned.json", M],
  ["top", "shirt", "Shirt", "torso/shirts/longsleeve/torso_clothes_longsleeve2_buttoned.json", M],
  ["top", "longPolo", "Long polo", "torso/shirts/longsleeve/torso_clothes_longsleeve2_polo.json", M],
  ["top", "scoop", "Scoop tee", "torso/shirts/shortsleeve/torso_clothes_tshirt_scoop.json", F],
  ["top", "scoopLong", "Scoop long", "torso/shirts/longsleeve/torso_clothes_longsleeve2_scoop.json", F],
  ["top", "blouse", "Blouse", "torso/shirts/torso_clothes_blouse.json", F, { variant: "white", sitAs: [SIT_SCOOP] }],
  ["top", "blouseLong", "Long blouse", "torso/shirts/torso_clothes_blouse_longsleeve.json", F, { variant: "white", sitAs: [SIT_SCOOP_LONG] }],
  ["top", "tunic", "Tunic", "torso/shirts/torso_clothes_tunic.json", F, { variant: "white", sitAs: [SIT_LONGSLEEVE] }],
  ["top", "sashDress", "Sash dress", "torso/dresses/dress_sash.json", F, { variant: "white", hides: ["bottom"], sitAs: [SIT_SLEEVELESS, SIT_SKIRT] }],
  ["top", "slitDress", "Slit dress", "torso/dresses/dress_slit.json", F, { variant: "white", hides: ["bottom"], sitAs: [SIT_SLEEVELESS, SIT_SKIRT] }],
  ["top", "kimono", "Kimono", "torso/dresses/kimono/dress_kimono.json", F, { variant: "white", hides: ["bottom"], sitAs: [SIT_LONGSLEEVE, SIT_SKIRT] }],

  ["bottom", "pants", "Pants", "legs/pants/legs_pants.json", B],
  ["bottom", "shorts", "Shorts", "legs/shorts/legs_shorts.json", B],
  ["bottom", "shortShorts", "Short shorts", "legs/shorts/legs_shorts_short.json", B],
  ["bottom", "cuffed", "Cuffed pants", "legs/pants/legs_cuffed.json", B],
  ["bottom", "longPants", "Long pants", "legs/pants/legs_pants2.json", M],
  ["bottom", "formal", "Formal pants", "legs/pants/legs_formal.json", M],
  ["bottom", "leggings", "Leggings", "legs/leggings/legs_leggings.json", F],
  ["bottom", "skirt", "Skirt", "legs/skirts/legs_skirts_plain.json", F],
  ["bottom", "straightSkirt", "Pencil skirt", "legs/skirts/legs_skirt_straight.json", F, { variant: "white", sitAs: [SIT_SKIRT] }],
  ["bottom", "belleSkirt", "Long skirt", "legs/skirts/legs_skirt_belle.json", F, { sitAs: [SIT_SKIRT] }],
  ["bottom", "slitSkirt", "Slit skirt", "legs/skirts/legs_skirts_slit.json", F, { sitAs: [SIT_SKIRT] }],

  ["shoes", "shoes", "Shoes", "feet/shoes/feet_shoes_basic.json", B],
  ["shoes", "sneakers", "Sneakers", "feet/shoes/feet_shoes_revised.json", B],
  ["shoes", "boots", "Boots", "feet/boots/feet_boots_basic.json", B],
  ["shoes", "foldBoots", "Folded boots", "feet/boots/feet_boots_fold.json", B],
  ["shoes", "sandals", "Sandals", "feet/feet_sandals.json", B],
  ["shoes", "slippers", "Slippers", "feet/feet_slippers.json", B],

  ["hat", "none", "None", null, B],
  ["hat", "hijab", "Hijab", "headwear/coverings/hoods/hat_hood_hijab.json", B, { hides: ["hair"] }],
  ["hat", "bandana", "Bandana", "headwear/coverings/bandana/hat_bandana.json", B],
  ["hat", "headband", "Headband", "headwear/coverings/headbands/hat_headband_thick.json", B],
  ["hat", "kerchief", "Kerchief", "headwear/coverings/headbands/hat_headband_kerchief.json", B],
  ["hat", "hood", "Hood", "headwear/coverings/hoods/hat_hood_cloth.json", B, { hides: ["hair"] }],
  ["hat", "cap", "Cap", "headwear/hats/caps/hat_cap_leather.json", B, { variant: "white" }],

  ["glasses", "none", "None", null, B],
  ["glasses", "glasses", "Glasses", "headwear/accessories/glasses/facial_glasses.json", B, { variant: "black" }],
  ["glasses", "round", "Round", "headwear/accessories/glasses/facial_glasses_round.json", B, { variant: "black" }],
  ["glasses", "nerd", "Thick frames", "headwear/accessories/glasses/facial_glasses_nerd.json", B, { variant: "black" }],
  ["glasses", "sunglasses", "Sunglasses", "headwear/accessories/glasses/facial_glasses_sunglasses.json", B, { variant: "black" }],
  ["glasses", "shades", "Shades", "headwear/accessories/glasses/facial_glasses_shades.json", B, { variant: "black" }],
];

/**
 * Equipment art (category "gear"): how armour and weapons look on a character.
 * Never offered in the character creator; items in shared/items.ts pick pieces
 * by id and recolour them (iron, bronze, gold…). [id, label, definition path, options]
 * Weapons have no sitting frames, so they're put away while you sit.
 */
const GEAR = [
  ["capLeather", "Leather cap", "headwear/hats/caps/hat_cap_leather.json", { variant: "leather" }],
  ["coif", "Mail coif", "headwear/helmets/helmets/hat_helmet_mail.json"],
  ["kettle", "Kettle helm", "headwear/helmets/helmets/hat_helmet_kettle.json"],
  ["nasal", "Nasal helm", "headwear/helmets/helmets/hat_helmet_nasal.json"],
  ["crown", "Crown", "headwear/hats/formal/hat_formal_crown.json", { variant: "crown_gold" }],
  ["leatherArmor", "Leather armour", "torso/armour/torso_armour_leather.json"],
  ["legion", "Legion armour", "torso/armour/torso_armour_legion.json"],
  ["plate", "Plate armour", "torso/armour/torso_armour_plate.json"],
  ["plateArms", "Plate arms", "arms/arms_armour.json"],
  ["pants", "Pants", "legs/pants/legs_pants.json"],
  ["greaves", "Greaves", "legs/legs_armour.json"],
  ["boots", "Boots", "feet/boots/feet_boots_basic.json"],
  ["ironBoots", "Armoured boots", "feet/feet_armour.json"],
  ["dagger", "Dagger", "weapons/sword/weapon_sword_dagger.json"],
  ["swordIron", "Iron arming sword", "weapons/sword/weapon_sword_arming.json", { variant: "iron" }],
  ["swordBronze", "Bronze arming sword", "weapons/sword/weapon_sword_arming.json", { variant: "bronze" }],
  ["saber", "Saber", "weapons/sword/weapon_sword_saber.json"],
  ["longsword", "Longsword", "weapons/sword/weapon_sword_longsword.json"],
  // Bows only walk in big 128px frames; the client cuts the middle 64px out of each.
  ["bow", "Bow", "weapons/ranged/bow/weapon_ranged_bow_normal.json", { variant: "medium", walk128: true }],
  ["recurve", "Recurve bow", "weapons/ranged/bow/weapon_ranged_bow_recurve.json", { variant: "dark", walk128: true }],
  ["staff", "Simple staff", "weapons/magic/weapon_magic_simple.json"],
  ["gnarled", "Gnarled staff", "weapons/magic/weapon_magic_gnarled.json", { variant: "medium" }],
  ["crystal", "Crystal staff", "weapons/magic/weapon_magic_crystal.json", { variant: "blue" }],
  ["shield", "Heater shield", "weapons/shields/heater/shield_heater_wood.json"],
].map(([id, label, def, opts]) => ["gear", id, label, def, B, opts]);

const PALETTES = {
  body: "palette_definitions/body/body_ulpc.json",
  hair: "palette_definitions/hair/hair_ulpc.json",
  cloth: "palette_definitions/cloth/cloth_ulpc.json",
  eye: "palette_definitions/eye/eye_ulpc.json",
  metal: "palette_definitions/metal/metal_ulpc.json",
  wood: "palette_definitions/wood/wood_ulpc.json",
};
const PALETTE_BASE = { body: "light", hair: "orange", cloth: "white", eye: "blue", metal: "steel", wood: "maple" };

/** Item icons: Kyrise's Free 16x16 RPG Icon Pack (CC-BY 4.0). Every 16x16 icon is kept, so new items can use any of them. */
const ICONS_ZIP = "https://opengameart.org/sites/default/files/Kyrises_16x16_RPG_Icon_Pack_V1.2.zip";
const ICONS_DIR = "Kyrise's 16x16 RPG Icon Pack - V1.2/icons/16x16/";
const ICONS_CREDIT = [
  "\"Kyrise's Free 16x16 RPG Icon Pack\" by Kyrise.",
  "License: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
  "https://opengameart.org/content/kyrises-free-16x16-rpg-icon-pack",
  "https://kyrise.itch.io/",
].join("\n");

/** World art from Eliza Wyatt's LPC Revised (OGA-BY 3.0). */
const WORLD_FILES = {
  "terrain.png": "Terrain/terrain_summer.png",
  "trees.png": "Terrain/trees_summer.png",
  "plants.png": "Terrain/plants_summer.png",
  "flowers.png": "Terrain/flowers.png",
  "rocks.png": "Terrain/Rocks, Grasslands.png",
};

/** Town buildings, furniture and floors, also from LPC Revised (OGA-BY 3.0). */
const TOWN_FILES = {
  "house-a.png": "Structure/Structures/Brick House A.png",
  "house-b.png": "Structure/Structures/Brick House B.png",
  "house-c.png": "Structure/Structures/Paneled House A.png",
  "fountain.png": "Structure/Misc/Fountain A.png",
  "floor-herringbone.png": "Structure/Floor/Herringbone A.png",
  "floor-diamond.png": "Structure/Floor/Diamond Tile A.png",
  "vending.png": "Objects/Furniture/Vending Machine.png",
  "counter.png": "Objects/Furniture/Countertop.png",
  "card-table.png": "Objects/Furniture/Table, Card.png",
  "lamps.png": "Objects/Furniture/Lighting, Outdoors.png",
  "planter.png": "Objects/Furniture/Planter.png",
  "barrel.png": "Objects/Furniture/Barrel.png",
  "crate.png": "Objects/Furniture/Crate.png",
  "stools.png": "Objects/Furniture/Seating/Bar Stools.png",
  "cabinet.png": "Objects/Furniture/Cabinet.png",
  "floor-lamps.png": "Objects/Furniture/Lighting, Floor.png",
  "posters.png": "Objects/Wall Items/Posters.png",
  "wall-brick.png": "Structure/Walls/Brick Wall A.png",
  "wall-stone.png": "Structure/Walls/Jagged Stone Walls.png",
  "floor-tile.png": "Structure/Floor/Tile C.png",
  "pillar.png": "Structure/Pillars/Stone Pillar A.png",
  "door-arched.png": "Structure/Doors/64x64px Arched Doors/Arched Double Doors A.png",
  "windows-stone.png": "Structure/Windows/Stone Windows A.png",
  "carpet-floral.png": "Structure/Floor/Floral Carpet A.png",
  "thrones.png": "Objects/Furniture/Seating/Thrones.png",
  "loveseat.png": "Objects/Furniture/Seating/Loveseat, Small - Formal A.png",
  "table-ornate.png": "Objects/Furniture/Table, Ornate Wood.png",
  "clock.png": "Objects/Furniture/Clock, Grandfather.png",
  "portraits.png": "Objects/Wall Items/Paintings, Portraits.png",
  "lighting-wall.png": "Objects/Wall Items/Lighting, Wall.png",
  "curtains.png": "Objects/Wall Items/Curtains.png",
  "bench.png": "Objects/Furniture/Seating/Ottoman, Long A.png",
  "stone-slab.png": "Objects/Furniture/Stone Slab.png",
  "table-rough.png": "Objects/Furniture/Table, Rough Wood.png",
  "bin.png": "Objects/Furniture/Bin.png",
  "campfire.png": "Objects/Small Items/Fire, Camp.png",
  "water-fx.png": "FX/Water Reflections.png",
};

/** Monsters from "[LPC] Monsters" on OpenGameArt (CC-BY-SA 3.0 or GPL 3.0), which ships as one zip. */
const MONSTERS_ZIP = "https://opengameart.org/sites/default/files/lpc-monsters.zip";
const MONSTER_FILES = ["slime.png", "snake.png", "bee.png", "man_eater_flower.png"];
const MONSTER_CREDIT = [
  '"[LPC] Monsters" by Charles Sanchez (CharlesGabriel), bagzie, and bluecarrot16.',
  "License: CC-BY-SA 3.0+ or GPL 3.0+.",
  "https://opengameart.org/content/lpc-monsters",
  "https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles",
  "https://opengameart.org/content/bat-sprite",
].join("\n");

const TOWN_CREDIT_DIRS = [
  "Structure/Structures",
  "Structure/Misc",
  "Structure/Floor",
  "Structure/Walls",
  "Structure/Pillars",
  "Structure/Doors",
  "Structure/Windows",
  "Objects/Furniture",
  "Objects/Furniture/Seating",
  "Objects/Small Items",
  "Objects/Wall Items",
  "FX",
];

const elizaUrl = (src) => `${ELIZA}/${src.split("/").map(encodeURIComponent).join("/")}`;

async function get(url, kind = "text") {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return kind === "json" ? res.json() : kind === "bin" ? Buffer.from(await res.arrayBuffer()) : res.text();
    if (res.status === 404 || attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

/** Files in a zip (stored or deflated entries), by name. Enough for the art packs; no dependency. */
function unzip(buf) {
  const files = new Map();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip file");
  let p = buf.readUInt32LE(end + 16);
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const at = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(at, at + size);
    files.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

async function save(rel, data) {
  const file = path.join(OUT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

function materialsOf(def) {
  // "recolors" is either {material} or {color_1: {material}, color_2: {...}}
  const r = def.recolors ?? {};
  if (r.material) return [r.material];
  return Object.keys(r)
    .filter((k) => k.startsWith("color_"))
    .sort()
    .map((k) => r[k].material);
}

/** Runs async jobs with limited parallelism, preserving result order. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

/** The definition's layers, minus ones that only exist for special animations (a sword's big slash). */
const layersOf = (def) =>
  Object.keys(def)
    .filter((k) => /^layer_\d+$/.test(k))
    .sort()
    .map((k) => def[k])
    .filter((l) => !l.custom_animation);

/** Materials whose art isn't drawn in the palette's usual base colour (leather armour is drawn in "leather"). */
function basesOf(def) {
  const r = def.recolors ?? {};
  const out = {};
  if (r.material && r.base) out[r.material] = r.base;
  for (const [k, v] of Object.entries(r)) if (k.startsWith("color_") && v.base) out[v.material] = v.base;
  return out;
}

/** A bow's walking layers: drawn in 128px frames, as their own "walk_128" animation. */
const walk128LayersOf = (def) =>
  Object.keys(def)
    .filter((k) => /^layer_\d+$/.test(k))
    .sort()
    .map((k) => def[k])
    .filter((l) => l.custom_animation === "walk_128");

/** URL of one animation sheet ("walk", "sit"…) for a layer directory. */
const sheetUrl = (dir, anim, variant) =>
  variant ? `${ULPC}/spritesheets/${dir}${anim}/${variant}.png` : `${ULPC}/spritesheets/${dir}${anim}.png`;

async function fetchItem([category, id, label, defPath, bodies, opts = {}]) {
  const base = { category, id, name: label, bodies: [...bodies], materials: [], layers: [], ...(opts.hides && { hides: opts.hides }) };
  if (!defPath) return { item: base, credits: [] };

  const def = await get(`${ULPC}/sheet_definitions/${defPath}`, "json");
  const variant = def.variants ? (opts.variant ?? (def.variants.includes("white") ? "white" : def.variants[0])) : null;
  // Palette items recolour via their own materials; "white" variants share the cloth base palette.
  const materials = opts.fixed ? [] : variant ? (variant === "white" ? ["cloth"] : []) : materialsOf(def);
  const bases = variant ? {} : basesOf(def);
  const item = { ...base, materials, ...(Object.keys(bases).length && { bases }) };
  const hasSit = (def.animations ?? []).includes("sit");

  const layers = opts.walk128 ? walk128LayersOf(def) : layersOf(def);
  for (const [li, layer] of layers.entries()) {
    const out = { z: layer.zPos, files: {}, ...(opts.walk128 && { frame: 128 }) };
    for (const body of bodies) {
      const dir = layer[body];
      if (!dir) continue;
      const rel = `lpc/${category}/${id}/${li}_${body}.png`;
      const url = opts.walk128 ? `${ULPC}/spritesheets/${dir}${variant}.png` : sheetUrl(dir, "walk", variant);
      try {
        await save(rel, await get(url, "bin"));
        out.files[body] = { walk: rel };
      } catch (err) {
        console.warn(`  ${category}/${id} layer ${li} ${body}: ${err.message}`);
        continue;
      }
      if (!hasSit) continue;
      const sitRel = `lpc/${category}/${id}/${li}_${body}_sit.png`;
      try {
        await save(sitRel, await get(sheetUrl(dir, "sit", variant), "bin"));
        out.files[body].sit = sitRel;
      } catch (err) {
        console.warn(`  ${category}/${id} layer ${li} ${body} sit: ${err.message}`);
      }
    }
    if (Object.keys(out.files).length) item.layers.push(out);
  }
  // A body only offers the item if its main layer exists for that body.
  item.bodies = bodies.filter((b) => item.layers[0]?.files[b]);

  // No sitting frames of its own: borrow a look-alike's, recoloured with this item's palette.
  if (!hasSit && opts.sitAs) {
    item.sitLayers = [];
    for (const [si, sitPath] of opts.sitAs.entries()) {
      const sdef = await get(`${ULPC}/sheet_definitions/${sitPath}`, "json");
      const svariant = sdef.variants ? (sdef.variants.includes("white") ? "white" : sdef.variants[0]) : null;
      for (const [li, layer] of layersOf(sdef).entries()) {
        const out = { z: layer.zPos, files: {} };
        for (const body of item.bodies) {
          if (!layer[body]) continue;
          const rel = `lpc/${category}/${id}/sit${si}_${li}_${body}.png`;
          try {
            await save(rel, await get(sheetUrl(layer[body], "sit", svariant), "bin"));
            out.files[body] = { sit: rel };
          } catch (err) {
            console.warn(`  ${category}/${id} sit stand-in ${sitPath} ${body}: ${err.message}`);
          }
        }
        if (Object.keys(out.files).length) item.sitLayers.push(out);
      }
    }
  }

  const usedDirs = layers.flatMap((l) => bodies.map((b) => l[b]).filter(Boolean));
  const credits = (def.credits ?? [])
    .filter((c) => usedDirs.some((d) => d.startsWith(c.file) || c.file.startsWith(d.replace(/\/$/, ""))))
    .map((c) => ({
      key: `ulpc:${c.file}`,
      what: `${def.name} (${c.file})`,
      authors: c.authors ?? [],
      licenses: c.licenses ?? [],
      urls: c.urls ?? [],
      notes: c.notes ?? "",
    }));
  return { item, credits };
}

async function main() {
  await fs.rm(path.join(OUT, "lpc"), { recursive: true, force: true });
  // v3: layers carry "sit" sheets too; items without them list stand-in sitLayers.
  // v4: equipment art (category "gear"), metal and wood palettes, per-item palette bases.
  // v5: a layer may say `frame: 128` (bows): its walk sheet uses big frames with the usual 64px one in the middle.
  const manifest = { version: 5, frame: 64, items: [], palettes: {} };
  const credits = new Map();

  for (const [mat, file] of Object.entries(PALETTES)) {
    manifest.palettes[mat] = { base: PALETTE_BASE[mat], colors: await get(`${ULPC}/${file}`, "json") };
  }

  const results = await pool([...ITEMS, ...GEAR], 8, fetchItem);
  for (const { item, credits: cr } of results) {
    if (item.bodies.length === 0) {
      console.warn(`  dropping ${item.category}/${item.id}: no artwork for the requested bodies`);
      continue;
    }
    manifest.items.push(item);
    for (const c of cr) credits.set(c.key, c);
    console.log(`${item.category.padEnd(8)} ${item.id.padEnd(14)} bodies=${item.bodies.join(",")} layers=${item.layers.length}`);
  }

  for (const [name, src] of Object.entries(WORLD_FILES)) {
    await save(`world/${name}`, await get(elizaUrl(src), "bin"));
  }
  const terrainCredits = await get(`${ELIZA}/Terrain/Credits.txt`);
  for (const [name, src] of Object.entries(TOWN_FILES)) {
    await save(`town/${name}`, await get(elizaUrl(src), "bin"));
  }
  const townCredits = [];
  for (const dir of TOWN_CREDIT_DIRS) {
    townCredits.push(`== ${dir} ==\n${(await get(elizaUrl(`${dir}/Credits.txt`))).trim()}`);
  }

  const monsters = unzip(await get(MONSTERS_ZIP, "bin"));
  for (const name of MONSTER_FILES) {
    const data = monsters.get(`lpc-monsters/${name}`);
    if (!data) throw new Error(`lpc-monsters.zip has no ${name}`);
    await save(`monsters/${name}`, data);
  }

  await fs.rm(path.join(OUT, "items"), { recursive: true, force: true });
  let icons = 0;
  for (const [name, data] of unzip(await get(ICONS_ZIP, "bin"))) {
    if (!name.startsWith(ICONS_DIR) || !name.endsWith(".png")) continue;
    await save(`items/${name.slice(ICONS_DIR.length)}`, data);
    icons++;
  }
  if (icons === 0) throw new Error("the icon pack had no icons where expected");

  await save("lpc/manifest.json", JSON.stringify(manifest));
  await fs.writeFile(path.join(ROOT, "shared/catalog.ts"), renderCatalog(manifest));
  const creditsText = renderCredits([...credits.values()], terrainCredits, townCredits.join("\n\n"));
  await fs.writeFile(path.join(ROOT, "CREDITS.md"), creditsText);
  await save("CREDITS.txt", creditsText);
  console.log(`\nWrote ${manifest.items.length} items, ${credits.size} credit entries.`);
}

/** Option lists shared by client and server (the server validates appearance against them). */
function renderCatalog(manifest) {
  const list = (cat) =>
    manifest.items
      .filter((i) => i.category === cat)
      .map((i) => ({ id: i.id, name: i.name, bodies: i.bodies, ...(i.hides && { hides: i.hides }) }));
  const pal = (mat) => Object.keys(manifest.palettes[mat].colors);
  const catalog = {
    bodies: BODY_TYPES,
    hair: list("hair"),
    beard: list("beard"),
    top: list("top"),
    bottom: list("bottom"),
    shoes: list("shoes"),
    hat: list("hat"),
    glasses: list("glasses"),
    skin: pal("body"),
    hairColors: pal("hair"),
    clothColors: pal("cloth"),
    eyeColors: pal("eye"),
  };
  return [
    "// Generated by scripts/fetch-assets.mjs. Do not edit by hand.",
    "",
    "export interface CatalogItem {",
    "  id: string;",
    "  name: string;",
    "  bodies: readonly string[];",
    "  hides?: readonly string[];",
    "}",
    "",
    `export const CATALOG = ${JSON.stringify(catalog, null, 2)} as const satisfies {`,
    "  bodies: readonly string[];",
    "  hair: readonly CatalogItem[];",
    "  beard: readonly CatalogItem[];",
    "  top: readonly CatalogItem[];",
    "  bottom: readonly CatalogItem[];",
    "  shoes: readonly CatalogItem[];",
    "  hat: readonly CatalogItem[];",
    "  glasses: readonly CatalogItem[];",
    "  skin: readonly string[];",
    "  hairColors: readonly string[];",
    "  clothColors: readonly string[];",
    "  eyeColors: readonly string[];",
    "};",
    "",
  ].join("\n");
}

function renderCredits(entries, terrainCredits, townCredits) {
  const lines = [
    "# Art credits",
    "",
    "This game uses artwork from the Liberated Pixel Cup (LPC) community. Thank you to every artist below.",
    "",
    "## World tiles, trees, plants and rocks",
    "",
    `From **LPC Revised** by Eliza Wyatt and contributors: <https://github.com/ElizaWy/LPC> (commit \`${ELIZA_SHA.slice(0, 7)}\`).`,
    "Licensed **OGA-BY 3.0**: <https://opengameart.org/content/oga-by-30-faq>",
    "",
    "```",
    terrainCredits.trim(),
    "```",
    "",
    "## Town buildings, furniture and floors",
    "",
    `Also from **LPC Revised** (same commit), licensed **OGA-BY 3.0**. Credits for each folder used:`,
    "",
    "```",
    townCredits,
    "```",
    "",
    "## Monsters",
    "",
    "Slime, Grass Snake (snake), Hornet (bee) and Snapper Flower (man-eater flower):",
    "",
    "```",
    MONSTER_CREDIT,
    "```",
    "",
    "## Item icons",
    "",
    "Potions, weapons, shields, rings, amulets and monster loot in the bag (armour icons are cut from the character art below):",
    "",
    "```",
    ICONS_CREDIT,
    "```",
    "",
    "## Gattchaa logo",
    "",
    "The Gattchaa logo and product images are property of Gattchaa Hobby Store and are not covered by the licenses above.",
    "",
    "## Characters",
    "",
    `From the **Universal LPC Spritesheet Character Generator**: <https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator> (commit \`${ULPC_SHA.slice(0, 7)}\`).`,
    "Each layer is available under the licenses listed (any one may be chosen where several are given).",
    "",
  ];
  for (const e of entries.sort((a, b) => a.what.localeCompare(b.what))) {
    lines.push(`### ${e.what}`, "");
    lines.push(`- Authors: ${e.authors.join(", ")}`);
    lines.push(`- Licenses: ${e.licenses.join(", ")}`);
    if (e.notes) lines.push(`- Notes: ${e.notes.replace(/\s+/g, " ")}`);
    for (const u of e.urls) lines.push(`- <${u}>`);
    lines.push("");
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
