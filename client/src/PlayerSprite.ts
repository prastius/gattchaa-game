import Phaser from "phaser";
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

export interface SpriteOptions {
  isSelf?: boolean;
  /** NPCs: role shown under the name ("Pokémon Packs"). */
  title?: string;
  npc?: boolean;
  textRes: number;
}

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";

/**
 * A player (or NPC) avatar. The container's (x, y) is the player's feet, and its depth
 * equals y so everything in the world is drawn back-to-front ("2.5D" overlap).
 */
export class PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private titleLabel?: Phaser.GameObjects.Text;
  private bubble?: Phaser.GameObjects.Text;
  private bubbleY: number;
  private textRes: number;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private look = "";
  private walked = 0;
  private destroyed = false;

  moving = false;
  dir: number = Dir.Down;

  constructor(
    private scene: Phaser.Scene,
    private textures: CharacterTextures,
    x: number,
    y: number,
    name: string,
    look: string,
    opts: SpriteOptions,
  ) {
    this.textRes = opts.textRes;
    const hasTitle = !!opts.title;
    this.bubbleY = hasTitle ? -80 : -70;

    this.sprite = scene.add.sprite(0, 0, "__DEFAULT").setOrigin(0.5, FEET_Y / FRAME).setVisible(false);
    this.label = scene.add
      .text(0, hasTitle ? -62 : -54, name, {
        fontFamily: FONT,
        fontSize: "11px",
        fontStyle: "bold",
        color: opts.isSelf ? "#ffe680" : opts.npc ? "#ffb35c" : "#ffffff",
        stroke: "#10202b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes);
    const parts: Phaser.GameObjects.GameObject[] = [this.sprite, this.label];
    if (hasTitle) {
      this.titleLabel = scene.add
        .text(0, -51, opts.title!, {
          fontFamily: FONT,
          fontSize: "9px",
          color: "#ffe2b8",
          stroke: "#10202b",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setResolution(this.textRes);
      parts.push(this.titleLabel);
    }

    this.container = scene.add.container(x, y, parts).setDepth(y);
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
      .text(0, this.bubbleY, text, {
        fontFamily: FONT,
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

  /** Big jumps (respawn, reconnect) shouldn't count as walking distance. */
  teleport(x: number, y: number) {
    this.container.setPosition(x, y).setDepth(y);
  }

  destroy() {
    this.destroyed = true;
    this.bubbleTimer?.remove();
    if (this.look) this.textures.release(this.look);
    this.container.destroy();
  }
}
