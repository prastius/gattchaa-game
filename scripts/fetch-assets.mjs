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

/**
 * Character options, in UI order: [category, id, label, definition path, bodies, options].
 * - bodies: which body types offer this option (masculine/feminine lists differ).
 * - options.variant: for pre-coloured items, which colour file to use ("white" is
 *   recoloured at runtime like everything else; others are drawn as-is).
 * - options.hides: categories this item covers (a dress hides the bottom).
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
  ["top", "blouse", "Blouse", "torso/shirts/torso_clothes_blouse.json", F, { variant: "white" }],
  ["top", "blouseLong", "Long blouse", "torso/shirts/torso_clothes_blouse_longsleeve.json", F, { variant: "white" }],
  ["top", "tunic", "Tunic", "torso/shirts/torso_clothes_tunic.json", F, { variant: "white" }],
  ["top", "sashDress", "Sash dress", "torso/dresses/dress_sash.json", F, { variant: "white", hides: ["bottom"] }],
  ["top", "slitDress", "Slit dress", "torso/dresses/dress_slit.json", F, { variant: "white", hides: ["bottom"] }],
  ["top", "kimono", "Kimono", "torso/dresses/kimono/dress_kimono.json", F, { variant: "white", hides: ["bottom"] }],

  ["bottom", "pants", "Pants", "legs/pants/legs_pants.json", B],
  ["bottom", "shorts", "Shorts", "legs/shorts/legs_shorts.json", B],
  ["bottom", "shortShorts", "Short shorts", "legs/shorts/legs_shorts_short.json", B],
  ["bottom", "cuffed", "Cuffed pants", "legs/pants/legs_cuffed.json", B],
  ["bottom", "longPants", "Long pants", "legs/pants/legs_pants2.json", M],
  ["bottom", "formal", "Formal pants", "legs/pants/legs_formal.json", M],
  ["bottom", "leggings", "Leggings", "legs/leggings/legs_leggings.json", F],
  ["bottom", "skirt", "Skirt", "legs/skirts/legs_skirts_plain.json", F],
  ["bottom", "straightSkirt", "Pencil skirt", "legs/skirts/legs_skirt_straight.json", F, { variant: "white" }],
  ["bottom", "belleSkirt", "Long skirt", "legs/skirts/legs_skirt_belle.json", F],
  ["bottom", "slitSkirt", "Slit skirt", "legs/skirts/legs_skirts_slit.json", F],

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

const PALETTES = {
  body: "palette_definitions/body/body_ulpc.json",
  hair: "palette_definitions/hair/hair_ulpc.json",
  cloth: "palette_definitions/cloth/cloth_ulpc.json",
  eye: "palette_definitions/eye/eye_ulpc.json",
};
const PALETTE_BASE = { body: "light", hair: "orange", cloth: "white", eye: "blue" };

/** World art from Eliza Wyatt's LPC Revised (OGA-BY 3.0). */
const WORLD_FILES = {
  "terrain.png": "Terrain/terrain_summer.png",
  "trees.png": "Terrain/trees_summer.png",
  "plants.png": "Terrain/plants_summer.png",
  "flowers.png": "Terrain/flowers.png",
  "rocks.png": "Terrain/Rocks, Grasslands.png",
};

async function get(url, kind = "text") {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return kind === "json" ? res.json() : kind === "bin" ? Buffer.from(await res.arrayBuffer()) : res.text();
    if (res.status === 404 || attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
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

async function fetchItem([category, id, label, defPath, bodies, opts = {}]) {
  const base = { category, id, name: label, bodies: [...bodies], materials: [], layers: [], ...(opts.hides && { hides: opts.hides }) };
  if (!defPath) return { item: base, credits: [] };

  const def = await get(`${ULPC}/sheet_definitions/${defPath}`, "json");
  const variant = def.variants ? (opts.variant ?? (def.variants.includes("white") ? "white" : def.variants[0])) : null;
  // Palette items recolour via their own materials; "white" variants share the cloth base palette.
  const materials = opts.fixed ? [] : variant ? (variant === "white" ? ["cloth"] : []) : materialsOf(def);
  const item = { ...base, materials };

  const layers = Object.keys(def)
    .filter((k) => /^layer_\d+$/.test(k))
    .sort()
    .map((k) => def[k]);

  for (const [li, layer] of layers.entries()) {
    const out = { z: layer.zPos, files: {} };
    for (const body of bodies) {
      const dir = layer[body];
      if (!dir) continue;
      const src = variant ? `${ULPC}/spritesheets/${dir}walk/${variant}.png` : `${ULPC}/spritesheets/${dir}walk.png`;
      const rel = `lpc/${category}/${id}/${li}_${body}.png`;
      try {
        await save(rel, await get(src, "bin"));
        out.files[body] = { walk: rel };
      } catch (err) {
        console.warn(`  ${category}/${id} layer ${li} ${body}: ${err.message}`);
      }
    }
    if (Object.keys(out.files).length) item.layers.push(out);
  }
  // A body only offers the item if its main layer exists for that body.
  item.bodies = bodies.filter((b) => item.layers[0]?.files[b]);

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
  const manifest = { version: 2, frame: 64, items: [], palettes: {} };
  const credits = new Map();

  for (const [mat, file] of Object.entries(PALETTES)) {
    manifest.palettes[mat] = { base: PALETTE_BASE[mat], colors: await get(`${ULPC}/${file}`, "json") };
  }

  const results = await pool(ITEMS, 8, fetchItem);
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
    await save(`world/${name}`, await get(`${ELIZA}/${src.split("/").map(encodeURIComponent).join("/")}`, "bin"));
  }
  const terrainCredits = await get(`${ELIZA}/Terrain/Credits.txt`);

  await save("lpc/manifest.json", JSON.stringify(manifest));
  await fs.writeFile(path.join(ROOT, "shared/catalog.ts"), renderCatalog(manifest));
  const creditsText = renderCredits([...credits.values()], terrainCredits);
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

function renderCredits(entries, terrainCredits) {
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
