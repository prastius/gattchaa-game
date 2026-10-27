import Phaser from "phaser";
import { MONSTERS, type MonsterId } from "../../../shared/rpg";

// Monster sprite sheets ("[LPC] Monsters", see CREDITS.md). Rows face up,
// left, down, right like the characters. In every sheet the first three
// columns are the idle/move loop and the rest are the attack.

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
  /** Clickable box above the feet, and where the name and numbers go. */
  w: number;
  h: number;
}

const same = (cols: number[]): MonsterArt["attack"] => [cols, cols, cols, cols];

export const MONSTER_ART: Record<MonsterId, MonsterArt> = {
  // The slime's up/down rows have three attack frames, its side rows five.
  slime: { file: "slime.png", frame: 64, cols: 8, feet: 46, attack: [[3, 4, 5], [3, 4, 5, 6, 7], [3, 4, 5], [3, 4, 5, 6, 7]], w: 30, h: 28 },
  snake: { file: "snake.png", frame: 64, cols: 7, feet: 47, attack: same([3, 4, 5, 6]), w: 28, h: 32 },
  hornet: { file: "bee.png", frame: 32, cols: 6, feet: 31, attack: same([3, 4, 5]), w: 24, h: 30 },
  snapper: { file: "man_eater_flower.png", frame: 128, cols: 6, feet: 101, attack: same([3, 4, 5]), w: 52, h: 74 },
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
      scene.anims.create({ key: moveAnim(kind, dir), frames: frames(MOVE_COLS), frameRate: 6, repeat: -1 });
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
