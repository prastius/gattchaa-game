import Phaser from "phaser";
import { MONSTERS, type MonsterId } from "../../../shared/rpg";
import type { Missile } from "./fx";

// Monster sprite sheets ("[LPC] Monsters", see CREDITS.md). Rows face up,
// left, down, right like the characters. Most sheets start with a three-column
// idle/move loop; the attack columns follow.

export interface MonsterArt {
  file: string;
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
  /** Drawn bigger than the sheet (bosses). */
  scale?: number;
  /** What it shoots, from at least `missileFrom` px away (closer, it bites). */
  missile?: Missile;
  missileFrom?: number;
}

const same = (cols: number[]): MonsterArt["attack"] => [cols, cols, cols, cols];

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
};

const MOVE_COLS = [0, 1, 2, 1];
const texKey = (kind: MonsterId) => `mob:${kind}`;
export const moveAnim = (kind: MonsterId, dir: number) => `mob:${kind}:move:${dir}`;
export const attackAnim = (kind: MonsterId, dir: number) => `mob:${kind}:attack:${dir}`;
export const monsterTexture = texKey;

export function preloadMonsters(scene: Phaser.Scene) {
  for (const [kind, art] of Object.entries(MONSTER_ART) as [MonsterId, MonsterArt][]) {
    scene.load.spritesheet(texKey(kind), `${import.meta.env.BASE_URL}assets/monsters/${art.file}`, { frameWidth: art.frame, frameHeight: art.frame });
  }
}

export function createMonsterAnims(scene: Phaser.Scene) {
  for (const [kind, art] of Object.entries(MONSTER_ART) as [MonsterId, MonsterArt][]) {
    for (let dir = 0; dir < 4; dir++) {
      if (scene.anims.exists(moveAnim(kind, dir))) continue;
      const frames = (cols: number[]) => cols.map((c) => ({ key: texKey(kind), frame: dir * art.cols + c }));
      scene.anims.create({ key: moveAnim(kind, dir), frames: frames(art.move ?? MOVE_COLS), frameRate: 6, repeat: -1 });
      scene.anims.create({ key: attackAnim(kind, dir), frames: frames(art.attack[dir]), frameRate: 12, repeat: 0 });
    }
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
