import Phaser from "phaser";
import { MONSTERS, type MonsterId } from "../../../shared/rpg";
// character.ts imports this file too: use its exports inside functions only, never while this file loads.
import { composeParts, type ArtPart } from "../character";
import type { Missile } from "./fx";

// Monster sprite sheets ("[LPC] Monsters", see CREDITS.md). Rows face up,
// left, down, right like the characters. Most sheets start with a three-column
// idle/move loop; the attack columns follow.
//
// Orcs, goblins, the undead and the beastmen of the Wildlands and Frostfell are put together from
// character art instead (heads, bodies, tails, armour and weapons from the LPC
// character generator), so they walk like people and lunge to attack.

export interface MonsterArt {
  /** A sheet from the monster pack… */
  file?: string;
  /** …or a humanoid put together from character art on the male body: walking frames only. */
  parts?: ArtPart[];
  /** Square frame size in pixels. */
  frame: number;
  /** Columns in the sheet. */
  cols: number;
  /** Where the ground is inside a frame (the sprite's origin). */
  feet: number;
  /** Attack columns per facing (up, left, down, right). */
  attack: [number[], number[], number[], number[]];
  /** Clickable box above the feet, and where the name and numbers go (after scaling). */
  w: number;
  h: number;
  /** The idle/move loop's columns (default 0, 1, 2, 1). */
  move?: number[];
  /** Standing still: these columns instead of the move loop (humanoids stand; the pack's monsters bob). */
  idle?: number[];
  /** Drawn bigger than the sheet (bosses). */
  scale?: number;
  /** What it shoots, from at least `missileFrom` px away (closer, it bites). */
  missile?: Missile;
  missileFrom?: number;
}

const same = (cols: number[]): MonsterArt["attack"] => [cols, cols, cols, cols];

/** Character sheets (see character.ts): 64px frames, nine columns (standing, then the walk cycle), four rows. */
const CHAR_FRAME = 64;
const CHAR_COLS = 9;

/** A humanoid: the walk cycle to move, the standing frame to idle, and a lunge (not frames) to attack. */
const humanoid = (parts: ArtPart[], more: Partial<MonsterArt> = {}): MonsterArt => ({
  parts: [{ category: "shadow", id: "shadow" }, ...parts],
  frame: CHAR_FRAME,
  cols: CHAR_COLS,
  feet: 58,
  move: [1, 2, 3, 4, 5, 6, 7, 8],
  idle: [0],
  attack: same([0]),
  w: 26,
  h: 50,
  ...more,
});
const skin = (color: string): ArtPart[] => [{ category: "body", id: "body", colors: { body: color } }];

export const MONSTER_ART: Record<MonsterId, MonsterArt> = {
  // The slime's up/down rows have three attack frames, its side rows five.
  slime: { file: "slime.png", frame: 64, cols: 8, feet: 46, attack: [[3, 4, 5], [3, 4, 5, 6, 7], [3, 4, 5], [3, 4, 5, 6, 7]], w: 30, h: 28 },
  snake: { file: "snake.png", frame: 64, cols: 7, feet: 47, attack: same([3, 4, 5, 6]), w: 28, h: 32 },
  hornet: { file: "bee.png", frame: 32, cols: 6, feet: 31, attack: same([3, 4, 5]), w: 24, h: 30 },
  snapper: { file: "man_eater_flower.png", frame: 128, cols: 6, feet: 101, attack: same([3, 4, 5]), w: 52, h: 74, missile: "seed", missileFrom: 90 },
  // Dusk Hollow.
  grub: { file: "small_worm.png", frame: 64, cols: 11, feet: 48, attack: same([3, 4]), w: 18, h: 32 },
  // The bat's first column is it hanging asleep; it flaps through the rest.
  bat: { file: "bat.png", frame: 64, cols: 7, feet: 52, move: [1, 2, 3, 2], attack: same([4, 5, 6]), w: 28, h: 34 },
  rockworm: { file: "big_worm.png", frame: 64, cols: 6, feet: 54, attack: same([4, 5]), w: 30, h: 46 },
  gazer: { file: "eyeball.png", frame: 64, cols: 7, feet: 51, move: [0, 1, 2, 3], attack: same([4, 5]), w: 28, h: 38, missile: "beam" },
  ghost: { file: "ghost.png", frame: 64, cols: 6, feet: 56, attack: same([4, 5]), w: 34, h: 46 },
  pumpking: { file: "pumpking.png", frame: 64, cols: 6, feet: 54, attack: same([3, 4, 5]), w: 64, h: 72, scale: 1.6, missile: "fire", missileFrom: 60 },
  // The Orc Woods.
  goblin: humanoid(
    [
      ...skin("green"),
      { category: "mob", id: "goblinHead", colors: { body: "green" } },
      { category: "bottom", id: "shorts", colors: { cloth: "brown" } },
      { category: "gear", id: "leatherArmor" },
      { category: "gear", id: "dagger" },
    ],
    { scale: 0.85, h: 44 },
  ),
  orcWarrior: humanoid(
    [
      ...skin("dark_green"),
      { category: "mob", id: "orcHead", colors: { body: "dark_green" } },
      { category: "bottom", id: "pants", colors: { cloth: "walnut" } },
      { category: "shoes", id: "boots", colors: { cloth: "black" } },
      { category: "gear", id: "legion", colors: { metal: "iron" } },
      { category: "mob", id: "waraxe" },
    ],
    { scale: 1.1, w: 30, h: 54 },
  ),
  orcArcher: humanoid(
    [
      ...skin("green"),
      { category: "mob", id: "orcHead", colors: { body: "green" } },
      { category: "bottom", id: "pants", colors: { cloth: "charcoal" } },
      { category: "shoes", id: "boots", colors: { cloth: "brown" } },
      { category: "gear", id: "leatherArmor" },
      { category: "gear", id: "capeTattered", colors: { cloth: "maroon" } },
      { category: "gear", id: "recurve" },
    ],
    { scale: 1.05, w: 28, h: 52, missile: "arrow", missileFrom: 60 },
  ),
  orcSkeleton: humanoid(
    [
      { category: "mob", id: "skeletonBody" },
      { category: "mob", id: "skullHead" },
      { category: "gear", id: "legion", colors: { metal: "bronze" } },
      { category: "gear", id: "roundShield" },
      { category: "gear", id: "saber" },
    ],
    { scale: 1.05, w: 28, h: 52 },
  ),
  orcZombie: humanoid(
    [
      { category: "mob", id: "zombieBody" },
      { category: "mob", id: "zombieHead", colors: { body: "zombie_green" } },
      { category: "bottom", id: "pants", colors: { cloth: "slate" } },
      { category: "top", id: "tshirt", colors: { cloth: "gray" } },
      { category: "mob", id: "mace" },
    ],
    { scale: 1.1, w: 30, h: 54 },
  ),
  orcWarlord: humanoid(
    [
      ...skin("dark_green"),
      { category: "mob", id: "orcHead", colors: { body: "dark_green" } },
      { category: "gear", id: "cape", colors: { cloth: "red" } },
      { category: "gear", id: "plate", colors: { metal: "gold" } },
      { category: "gear", id: "plateArms", colors: { metal: "gold" } },
      { category: "gear", id: "greaves", colors: { metal: "gold" } },
      { category: "gear", id: "ironBoots", colors: { metal: "iron" } },
      { category: "gear", id: "halberd" },
    ],
    { scale: 1.6, w: 44, h: 84 },
  ),
  // The Wildlands.
  boarman: humanoid(
    [
      ...skin("fur_brown"),
      { category: "mob", id: "boarHead", colors: { body: "fur_brown" } },
      { category: "bottom", id: "pants", colors: { cloth: "leather" } },
      { category: "shoes", id: "boots", colors: { cloth: "brown" } },
      { category: "gear", id: "leatherArmor" },
      { category: "mob", id: "flail" },
    ],
    { scale: 1.1, w: 30, h: 54 },
  ),
  lizardman: humanoid(
    [
      ...skin("green"),
      { category: "mob", id: "lizardTail", colors: { body: "green" } },
      { category: "mob", id: "lizardHead", colors: { body: "green" } },
      { category: "bottom", id: "shorts", colors: { cloth: "teal" } },
      { category: "gear", id: "legion", colors: { metal: "bronze" } },
      { category: "gear", id: "roundShield" },
      { category: "gear", id: "trident" },
    ],
    { scale: 1.05, w: 28, h: 52 },
  ),
  werewolf: humanoid(
    [
      ...skin("fur_grey"),
      { category: "mob", id: "wolfTail" },
      { category: "mob", id: "wolfHead", colors: { body: "fur_grey" } },
      { category: "bottom", id: "pants", colors: { cloth: "slate" } },
    ],
    { scale: 1.1, w: 30, h: 54 },
  ),
  troll: humanoid(
    [
      ...skin("pale_green"),
      { category: "mob", id: "trollHead", colors: { body: "pale_green" } },
      { category: "bottom", id: "shorts", colors: { cloth: "brown" } },
      { category: "mob", id: "mace" },
    ],
    { scale: 1.35, w: 36, h: 66 },
  ),
  vampire: humanoid(
    [
      ...skin("lavender"),
      { category: "mob", id: "vampireHead", colors: { body: "lavender" } },
      { category: "gear", id: "cape", colors: { cloth: "red" } },
      { category: "bottom", id: "formal", colors: { cloth: "black" } },
      { category: "shoes", id: "shoes", colors: { cloth: "black" } },
      { category: "gear", id: "tabardBlack" },
    ],
    { scale: 1.05, w: 28, h: 52, missile: "bolt", missileFrom: 60 },
  ),
  minotaurKing: humanoid(
    [
      ...skin("fur_copper"),
      { category: "mob", id: "minotaurHead", colors: { body: "fur_copper" } },
      { category: "gear", id: "cape", colors: { cloth: "maroon" } },
      { category: "gear", id: "plate", colors: { metal: "gold" } },
      { category: "gear", id: "greaves", colors: { metal: "gold" } },
      { category: "gear", id: "ironBoots", colors: { metal: "iron" } },
      { category: "mob", id: "waraxe" },
    ],
    { scale: 1.7, w: 48, h: 90 },
  ),
  // Frostfell.
  yeti: humanoid(
    [
      ...skin("fur_white"),
      { category: "mob", id: "beastHead", colors: { body: "fur_white" } },
    ],
    { scale: 1.3, w: 34, h: 62 },
  ),
  ramhorn: humanoid(
    [
      ...skin("fur_tan"),
      { category: "mob", id: "sheepHead" },
      { category: "mob", id: "hornsCurled", colors: { body: "fur_grey" } },
      { category: "bottom", id: "pants", colors: { cloth: "slate" } },
      { category: "shoes", id: "boots", colors: { cloth: "brown" } },
      { category: "gear", id: "leatherArmor" },
      { category: "gear", id: "capeTattered", colors: { cloth: "white" } },
      { category: "mob", id: "spear" },
    ],
    { scale: 1.1, w: 30, h: 54 },
  ),
  frostShaman: humanoid(
    [
      ...skin("blue"),
      { category: "head", id: "male", colors: { body: "blue" } },
      { category: "beard", id: "beard", colors: { hair: "white" } },
      { category: "bottom", id: "pants", colors: { cloth: "navy" } },
      { category: "shoes", id: "boots", colors: { cloth: "white" } },
      { category: "gear", id: "cape", colors: { cloth: "navy" } },
      { category: "gear", id: "tabardWhite", colors: { cloth: "sky" } },
      { category: "gear", id: "celestialMoon", colors: { cloth: "sky" } },
      { category: "gear", id: "gnarledSilver" },
    ],
    { missile: "ice", missileFrom: 60 },
  ),
  frostWight: humanoid(
    [
      { category: "mob", id: "skeletonBody" },
      { category: "mob", id: "skullHead" },
      { category: "gear", id: "capeTattered", colors: { cloth: "slate" } },
      { category: "gear", id: "plate", colors: { metal: "silver" } },
      { category: "gear", id: "plateArms", colors: { metal: "silver" } },
      { category: "gear", id: "norman", colors: { metal: "silver" } },
      { category: "gear", id: "kiteBlue" },
      { category: "gear", id: "swordSilver" },
    ],
    { scale: 1.05, w: 28, h: 52 },
  ),
  frostDrake: humanoid(
    [
      ...skin("blue"),
      { category: "mob", id: "lizardWings", colors: { body: "blue" } },
      { category: "mob", id: "lizardTail", colors: { body: "blue" } },
      { category: "mob", id: "lizardHead", colors: { body: "blue" } },
    ],
    { scale: 1.35, w: 36, h: 66 },
  ),
  frostGiant: humanoid(
    [
      ...skin("blue"),
      { category: "mob", id: "trollHead", colors: { body: "blue" } },
      { category: "gear", id: "cape", colors: { cloth: "white" } },
      { category: "gear", id: "plate", colors: { metal: "silver" } },
      { category: "gear", id: "greaves", colors: { metal: "silver" } },
      { category: "gear", id: "ironBoots", colors: { metal: "iron" } },
      { category: "gear", id: "viking" },
      { category: "mob", id: "waraxe" },
    ],
    { scale: 1.9, w: 52, h: 98, missile: "ice", missileFrom: 70 },
  ),
};

const MOVE_COLS = [0, 1, 2, 1];
const texKey = (kind: MonsterId) => `mob:${kind}`;
export const moveAnim = (kind: MonsterId, dir: number) => `mob:${kind}:move:${dir}`;
export const idleAnim = (kind: MonsterId, dir: number) => `mob:${kind}:idle:${dir}`;
export const attackAnim = (kind: MonsterId, dir: number) => `mob:${kind}:attack:${dir}`;
export const monsterTexture = texKey;
const ALL = Object.entries(MONSTER_ART) as [MonsterId, MonsterArt][];

/** The pack's sheets load with the scene; humanoids are put together in createMonsterAnims. */
export function preloadMonsters(scene: Phaser.Scene) {
  for (const [kind, art] of ALL) {
    if (art.file) scene.load.spritesheet(texKey(kind), `${import.meta.env.BASE_URL}assets/monsters/${art.file}`, { frameWidth: art.frame, frameHeight: art.frame });
  }
}

function createAnims(scene: Phaser.Scene, kind: MonsterId, art: MonsterArt) {
  for (let dir = 0; dir < 4; dir++) {
    if (scene.anims.exists(moveAnim(kind, dir))) continue;
    const frames = (cols: number[]) => cols.map((c) => ({ key: texKey(kind), frame: dir * art.cols + c }));
    // Humanoids walk at walking pace; the pack's monsters bob slowly.
    scene.anims.create({ key: moveAnim(kind, dir), frames: frames(art.move ?? MOVE_COLS), frameRate: art.parts ? 10 : 6, repeat: -1 });
    if (art.idle) scene.anims.create({ key: idleAnim(kind, dir), frames: frames(art.idle), frameRate: 1, repeat: -1 });
    scene.anims.create({ key: attackAnim(kind, dir), frames: frames(art.attack[dir]), frameRate: 12, repeat: 0 });
  }
}

const humanoids = new Map<MonsterId, Promise<void>>();

/**
 * Resolves once a monster's texture and animations exist. The pack's are ready
 * from the start; a humanoid is put together the first time it's asked for.
 */
export function monsterReady(scene: Phaser.Scene, kind: MonsterId): Promise<void> {
  const art = MONSTER_ART[kind];
  if (!art.parts || scene.textures.exists(texKey(kind))) return Promise.resolve();
  let p = humanoids.get(kind);
  if (!p) {
    p = composeParts(art.parts).then((canvas) => {
      if (!scene.textures.exists(texKey(kind))) {
        const tex = scene.textures.addCanvas(texKey(kind), canvas)!;
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < CHAR_COLS; col++) tex.add(row * CHAR_COLS + col, 0, col * CHAR_FRAME, row * CHAR_FRAME, CHAR_FRAME, CHAR_FRAME);
        }
      }
      createAnims(scene, kind, art);
    });
    humanoids.set(kind, p);
  }
  return p;
}

export function createMonsterAnims(scene: Phaser.Scene) {
  for (const [kind, art] of ALL) {
    if (art.parts) void monsterReady(scene, kind);
    else createAnims(scene, kind, art);
  }
}

/** Name colour by how dangerous a monster is for you, as in many MMOs: grey is easy, red is deadly. */
export function levelColor(mine: number, kind: MonsterId): string {
  const d = MONSTERS[kind].level - mine;
  if (d >= 5) return "#ff6b6b";
  if (d >= 2) return "#ffb35c";
  if (d <= -6) return "#a7adb3";
  return "#ffffff";
}
