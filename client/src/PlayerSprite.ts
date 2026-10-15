import Phaser from "phaser";
import { PLAYER_SPEED } from "../../shared/world";
import { Dir } from "../../shared/protocol";
import { FRAME, SHEET_H, SHEET_W, WALK_COLS, composeCharacter } from "./character";

const BUBBLE_MS = 6000;
const STRIDE_PX = 15; // distance walked per animation frame
const FEET_Y = 58; // feet line inside the 64px LPC frame

/** Ref-counted Phaser textures, one per distinct look; unused ones are freed. */
export class CharacterTextures {
  private refs = new Map<string, number>();
  private loading = new Map<string, Promise<string>>();

  constructor(private scene: Phaser.Scene) {}

  acquire(look: string): Promise<string> {
    this.refs.set(look, (this.refs.get(look) ?? 0) + 1);
    const key = `char:${look}`;
    if (this.scene.textures.exists(key)) return Promise.resolve(key);
    let p = this.loading.get(look);
    if (!p) {
      p = composeCharacter(look).then((canvas) => {
        this.loading.delete(look);
        if (!this.scene.textures.exists(key)) {
          const tex = this.scene.textures.addCanvas(key, canvas)!;
          for (let row = 0; row < SHEET_H / FRAME; row++) {
            for (let col = 0; col < SHEET_W / FRAME; col++) {
              tex.add(row * WALK_COLS + col, 0, col * FRAME, row * FRAME, FRAME, FRAME);
            }
          }
        }
        return key;
      });
      this.loading.set(look, p);
    }
    return p;
  }

  release(look: string) {
    const n = (this.refs.get(look) ?? 1) - 1;
    if (n > 0) {
      this.refs.set(look, n);
      return;
    }
    this.refs.delete(look);
    // Free GPU memory a little later in case the look comes straight back.
    this.scene.time.delayedCall(15000, () => {
      const key = `char:${look}`;
      if (!this.refs.has(look) && this.scene.textures.exists(key)) this.scene.textures.remove(key);
    });
  }
}

/**
 * A player avatar. The container's (x, y) is the player's feet, and its depth
 * equals y so everything in the world is drawn back-to-front ("2.5D" overlap).
 */
export class PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private bubble?: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private look = "";
  private walked = 0;
  private destroyed = false;

  targetX: number;
  targetY: number;
  moving = false;
  dir: number = Dir.Down;

  constructor(
    private scene: Phaser.Scene,
    private textures: CharacterTextures,
    x: number,
    y: number,
    name: string,
    look: string,
    isSelf: boolean,
    private textRes: number,
  ) {
    this.targetX = x;
    this.targetY = y;

    this.sprite = scene.add.sprite(0, 0, "__DEFAULT").setOrigin(0.5, FEET_Y / FRAME).setVisible(false);
    this.label = scene.add
      .text(0, -54, name, {
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        fontSize: "11px",
        fontStyle: "bold",
        color: isSelf ? "#ffe680" : "#ffffff",
        stroke: "#10202b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(textRes);

    this.container = scene.add.container(x, y, [this.sprite, this.label]).setDepth(y);
    this.setLook(look);
  }

  get x() {
    return this.container.x;
  }

  get y() {
    return this.container.y;
  }

  setLook(look: string) {
    if (look === this.look) return;
    const previous = this.look;
    this.look = look;
    this.textures.acquire(look).then((key) => {
      if (this.destroyed || this.look !== look) return;
      this.sprite.setTexture(key, this.frameIndex()).setVisible(true);
    });
    if (previous) this.textures.release(previous);
  }

  setPosition(x: number, y: number) {
    const moved = Math.hypot(x - this.container.x, y - this.container.y);
    this.walked += moved;
    this.container.setPosition(x, y);
    this.container.setDepth(y);
  }

  say(text: string) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    this.bubble = this.scene.add
      .text(0, -70, text, {
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        fontSize: "12px",
        color: "#1b2733",
        backgroundColor: "#fffdf5",
        padding: { x: 7, y: 4 },
        wordWrap: { width: 190, useAdvancedWrap: true },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes);
    this.container.add(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(BUBBLE_MS, () => {
      this.bubble?.destroy();
      this.bubble = undefined;
    });
  }

  private frameIndex(): number {
    const col = this.moving ? 1 + (Math.floor(this.walked / STRIDE_PX) % (WALK_COLS - 1)) : 0;
    return this.dir * WALK_COLS + col;
  }

  /** Per-frame: pick the walk frame from distance travelled (so feet match speed). */
  animate() {
    if (!this.moving) this.walked = 0;
    if (this.sprite.visible) this.sprite.setFrame(this.frameIndex());
  }

  /** Remote players: walk toward the last network position at (about) walking speed. */
  interpolate(deltaMs: number) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    if (dist > 400) {
      this.container.setPosition(this.targetX, this.targetY).setDepth(this.targetY); // teleport/respawn
      return;
    }
    // Catch up faster when we fall behind, so remote players never drift far.
    const speed = PLAYER_SPEED * (dist > 48 ? 2 : 1.15);
    const step = Math.min(dist, (speed * deltaMs) / 1000);
    this.setPosition(this.x + (dx / dist) * step, this.y + (dy / dist) * step);
  }

  destroy() {
    this.destroyed = true;
    this.bubbleTimer?.remove();
    if (this.look) this.textures.release(this.look);
    this.container.destroy();
  }
}
