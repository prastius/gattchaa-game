import Phaser from "phaser";
import { Dir } from "../../shared/protocol";
import { bodyName, decodeLook } from "../../shared/appearance";
import { FRAME, SHEET_COLS, SHEET_H, SIT_COL, WALK_COLS, composeCharacter, sitDrop } from "./character";

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
      p = composeCharacter(look, { sit: true }).then((canvas) => {
        this.loading.delete(look);
        if (!this.scene.textures.exists(key)) {
          const tex = this.scene.textures.addCanvas(key, canvas)!;
          for (let row = 0; row < SHEET_H / FRAME; row++) {
            for (let col = 0; col < SHEET_COLS; col++) {
              tex.add(row * SHEET_COLS + col, 0, col * FRAME, row * FRAME, FRAME, FRAME);
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
  /** Current text resolution; read again for text made later (chat bubbles). */
  textRes: () => number;
}

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const EMOJI_FONT = "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
/** Speech and emote bubbles have a tail this long under them. */
const TAIL = 6;
const EMOTE_MS = 2400;
const HP_BAR_W = 30;
const LUNGE_PX = 6;

/**
 * A player (or NPC) avatar. The container's (x, y) is the player's feet, and its depth
 * equals y so everything in the world is drawn back-to-front ("2.5D" overlap).
 */
export class PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private titleLabel?: Phaser.GameObjects.Text;
  private bubble?: Phaser.GameObjects.Container;
  private bubbleY: number;
  private textRes: () => number;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private emoteBox?: Phaser.GameObjects.Container;
  private emoteTimer?: Phaser.Time.TimerEvent;
  private look = "";
  private walked = 0;
  private destroyed = false;
  private seated = false;
  private lift = 0;
  private body = "male";
  /** How far the name, title and bubble are shifted down right now, following a seated head. */
  private drop = 0;
  private hpBar?: Phaser.GameObjects.Graphics;
  private hpKey = "";
  private fainted = false;
  private lungeTween?: Phaser.Tweens.Tween;

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
      .setResolution(this.textRes());
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
        .setResolution(this.textRes());
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

  get sitting() {
    return this.seated;
  }

  /** Sits down (facing `dir`) or stands up; the name and bubble move with the head. */
  set sitting(on: boolean) {
    if (on === this.seated) return;
    this.seated = on;
    this.placeLabels();
  }

  /** Moves the name, title and bubble down to a seated head (how far depends on the body and facing). */
  private placeLabels() {
    const want = this.seated ? sitDrop(this.body, this.dir) : 0;
    const dy = want - this.drop;
    if (!dy) return;
    this.drop = want;
    for (const t of [this.label, this.titleLabel, this.bubble]) t?.setY(t.y + dy);
    this.bubbleY += dy;
  }

  /** Raises chat bubbles by this many pixels (sellers: above their shop sign). */
  set bubbleLift(px: number) {
    const dy = this.lift - px;
    if (dy === 0) return;
    this.lift = px;
    this.bubbleY += dy;
    this.bubble?.setY(this.bubble.y + dy);
  }

  setLook(look: string) {
    if (look === this.look) return;
    const previous = this.look;
    this.look = look;
    this.body = bodyName(decodeLook(look));
    this.placeLabels();
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

  /** Health bar under the feet (hidden when `show` is false). */
  setHp(hp: number, max: number, show: boolean) {
    const key = show && max > 0 ? `${hp}/${max}` : "";
    if (key === this.hpKey) return;
    this.hpKey = key;
    if (!key) {
      this.hpBar?.setVisible(false);
      return;
    }
    if (!this.hpBar) {
      this.hpBar = this.scene.add.graphics();
      this.container.addAt(this.hpBar, 0);
    }
    const r = Phaser.Math.Clamp(hp / max, 0, 1);
    const color = r > 0.5 ? 0x5fd36b : r > 0.25 ? 0xf2c14e : 0xe5534b;
    this.hpBar
      .clear()
      .fillStyle(0x10202b, 0.85)
      .fillRect(-HP_BAR_W / 2 - 1, 3, HP_BAR_W + 2, 6)
      .fillStyle(color, 1)
      .fillRect(-HP_BAR_W / 2, 4, Math.round(HP_BAR_W * r), 4)
      .setVisible(true);
  }

  /** A quick step toward what you're hitting, and back. */
  lunge(dx: number, dy: number) {
    if (this.fainted) return;
    const d = Math.hypot(dx, dy) || 1;
    this.lungeTween?.complete();
    this.sprite.setPosition(0, 0);
    this.lungeTween = this.scene.tweens.add({
      targets: this.sprite,
      x: Math.round((dx / d) * LUNGE_PX),
      y: Math.round((dy / d) * LUNGE_PX),
      duration: 80,
      yoyo: true,
      ease: "Quad.Out",
    });
  }

  /** Flashes red when hurt. */
  flash() {
    if (this.fainted) return;
    this.sprite.setTint(0xff5c57).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(90, () => {
      if (!this.fainted) this.sprite.clearTint();
    });
  }

  /** Knocked out: lying on the ground, greyed out. */
  set dead(on: boolean) {
    if (on === this.fainted) return;
    this.fainted = on;
    this.lungeTween?.complete();
    this.sprite.setPosition(0, 0).setAngle(on ? -90 : 0).setAlpha(on ? 0.75 : 1);
    if (on) this.sprite.setTint(0x8a8f96);
    else this.sprite.clearTint();
  }

  get dead() {
    return this.fainted;
  }

  /** A speech bubble over the head: rounded, with a little tail pointing down at the speaker. */
  say(text: string) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    const label = this.scene.add
      .text(0, -TAIL - 4, text, {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#1b2733",
        wordWrap: { width: 190, useAdvancedWrap: true },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes());
    // Whole, even sizes keep the edges crisp at any zoom.
    const w = Math.ceil((label.width + 14) / 2) * 2;
    const h = Math.ceil(label.height) + 8;
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.22).fillRoundedRect(-w / 2 + 1, -TAIL - h + 1, w, h, 8);
    g.fillStyle(0xfffdf5, 1).fillRoundedRect(-w / 2, -TAIL - h, w, h, 8);
    g.fillTriangle(-5, -TAIL - 1, 5, -TAIL - 1, 0, 0);
    // The bubble's body ends where it always did; the tail hangs below it.
    this.bubble = this.scene.add.container(0, this.bubbleY + TAIL, [g, label]);
    this.container.add(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(BUBBLE_MS, () => {
      this.bubble?.destroy();
      this.bubble = undefined;
    });
  }

  /** An emote pops up above the head, Ragnarok style, for a couple of seconds. */
  emote(glyph: string) {
    this.emoteBox?.destroy();
    this.emoteTimer?.remove();
    const icon = this.scene.add
      .text(0, -TAIL - 12, glyph, { fontFamily: EMOJI_FONT, fontSize: "16px", padding: { x: 2, y: 2 } })
      .setOrigin(0.5)
      .setResolution(this.textRes());
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.22).fillRoundedRect(-13, -TAIL - 23, 28, 24, 10);
    g.fillStyle(0xffffff, 1).fillRoundedRect(-14, -TAIL - 24, 28, 24, 10);
    g.fillTriangle(-4, -TAIL - 1, 4, -TAIL - 1, 0, 0);
    // Above the name (and above a seller's sign), a little to the right like a thought.
    const y = this.label.y - 16 - this.lift;
    const box = this.scene.add.container(10, y, [g, icon]).setScale(0.3);
    this.container.add(box);
    this.emoteBox = box;
    this.scene.tweens.add({ targets: box, scale: 1, duration: 260, ease: "Back.Out" });
    this.emoteTimer = this.scene.time.delayedCall(EMOTE_MS, () => {
      this.scene.tweens.add({ targets: box, alpha: 0, y: y - 8, duration: 300, onComplete: () => box.destroy() });
      if (this.emoteBox === box) this.emoteBox = undefined;
    });
  }

  private frameIndex(): number {
    const col = this.seated ? SIT_COL : this.moving ? 1 + (Math.floor(this.walked / STRIDE_PX) % (WALK_COLS - 1)) : 0;
    return this.dir * SHEET_COLS + col;
  }

  /** Per-frame: pick the walk frame from distance travelled (so feet match speed). */
  animate() {
    if (!this.moving || this.seated) this.walked = 0;
    this.placeLabels();
    if (this.sprite.visible) this.sprite.setFrame(this.frameIndex());
  }

  /** Big jumps (respawn, reconnect) shouldn't count as walking distance. */
  teleport(x: number, y: number) {
    this.container.setPosition(x, y).setDepth(y);
  }

  destroy() {
    this.destroyed = true;
    this.lungeTween?.remove();
    this.bubbleTimer?.remove();
    this.emoteTimer?.remove();
    if (this.look) this.textures.release(this.look);
    this.container.destroy();
  }
}
