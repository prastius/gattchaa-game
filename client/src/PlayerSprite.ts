import Phaser from "phaser";
import { Dir } from "../../shared/protocol";
import { bodyName, decodeLook } from "../../shared/appearance";
import { splitAppearance } from "../../shared/items";
import { FRAME, SHEET_COLS, SHEET_H, SIT_COL, WALK_COLS, composeCharacter, sitDrop } from "./character";
import { ORB, SPARK } from "./world/fx";
import { AURA_LEGENDARY } from "../../shared/items";
import { AURA_CARD_MASTER, AURA_KINGSLAYER, AURA_PIONEER } from "../../shared/titles";

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
 * How each aura looks: its colour, one ring or two, a column of light, rings
 * rippling out, how often a mote rises (ms) and the motes' colours.
 */
interface AuraStyle {
  tint: number;
  double?: boolean;
  column?: boolean;
  ripple?: boolean;
  motes: number;
  colors?: number[];
}
const AURAS: Record<number, AuraStyle> = {
  // Upgraded gear: +7 a cool blue, +9 violet, +10 gold.
  7: { tint: 0x6fc3ff, motes: 240 },
  9: { tint: 0xc08bff, double: true, motes: 110 },
  10: { tint: 0xffcf5a, double: true, column: true, ripple: true, motes: 60 },
  // Legendary gear: embers.
  [AURA_LEGENDARY]: { tint: 0xffad42, double: true, motes: 70, colors: [0xffad42, 0xff6a2a, 0xffe08a] },
  // Titles.
  [AURA_KINGSLAYER]: { tint: 0xff4d6d, double: true, ripple: true, motes: 80, colors: [0xff4d6d, 0xff9a5a, 0xffffff] },
  [AURA_CARD_MASTER]: { tint: 0xff7ad9, double: true, column: true, motes: 70, colors: [0xff7ad9, 0xc88bff, 0xffffff] },
  [AURA_PIONEER]: { tint: 0xbff6ff, double: true, column: true, ripple: true, motes: 45, colors: [0xff7a7a, 0xffd27a, 0x7ddb6e, 0x5cb2ff, 0xc88bff] },
};
/** Above the night tint (with the lamp glows), so auras light up the dark. */
const NIGHT_GLOW_DEPTH = 1e6 - 9;

/**
 * A player (or NPC) avatar. The container's (x, y) is the player's feet, and its depth
 * equals y so everything in the world is drawn back-to-front ("2.5D" overlap).
 */
export class PlayerSprite {
  /** How dark it is (the lamps' brightness, 0..1); auras glow this much. Set by the game scene. */
  static nightLight = 0;

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
  /** The aura, when there is one: on the ground behind the body, and motes rising in front of it. */
  private auraBox: Phaser.GameObjects.Container;
  private auraFront: Phaser.GameObjects.Container;
  /** The aura's light at night: outside the container, above the night tint. */
  private nightGlow?: Phaser.GameObjects.Image;
  private aura = 0;
  /** A player's title under their name (NPCs get theirs once, in the constructor). */
  private titleKey = "";

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
    this.auraBox = scene.add.container(0, 0);
    this.auraFront = scene.add.container(0, 0);
    const parts: Phaser.GameObjects.GameObject[] = [this.auraBox, this.sprite, this.auraFront, this.label];
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
    this.body = bodyName(decodeLook(splitAppearance(look).look));
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
      // Over the aura, under the body.
      this.container.addAt(this.hpBar, 1);
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

  /**
   * An aura (0 = none; see AURAS): a coloured ring breathing at the feet and
   * motes rising around the body, with a second ring, a column of light or
   * rings rippling out for the grander ones.
   */
  setAura(aura: number) {
    if (aura === this.aura) return;
    this.aura = aura;
    for (const box of [this.auraBox, this.auraFront]) {
      this.scene.tweens.killTweensOf(box.list);
      box.removeAll(true);
    }
    this.nightGlow?.destroy();
    this.nightGlow = undefined;
    const style = AURAS[aura];
    if (!style) return;
    const { tint } = style;
    const add = Phaser.BlendModes.ADD;
    this.nightGlow = this.scene.add
      .image(this.x, this.y - 6, ORB)
      .setTint(tint)
      .setBlendMode(add)
      .setDepth(NIGHT_GLOW_DEPTH)
      .setScale(style.column ? 1.3 : 1.1, style.column ? 1.1 : 0.6)
      .setVisible(false);
    // Additive light alone washes out to white on bright grass, so the ring and disc are solid colour.
    const glow = this.scene.add.image(0, -1, ORB).setTint(tint).setBlendMode(add).setScale(1.1, 0.45).setAlpha(0.7);
    const disc = this.scene.add.ellipse(0, 0, 44, 15, tint, 0.3);
    const ring = this.scene.add.ellipse(0, 0, 44, 15).setStrokeStyle(2, tint, 1);
    this.auraBox.add([glow, disc, ring]);
    const breathe = { duration: 900, yoyo: true, repeat: -1, ease: "Sine.InOut" };
    this.scene.tweens.add({ targets: [disc, ring], scaleX: 1.1, scaleY: 1.1, ...breathe });
    this.scene.tweens.add({ targets: glow, alpha: 0.4, ...breathe });
    if (style.double) {
      const inner = this.scene.add.ellipse(0, 0, 28, 9).setStrokeStyle(1, 0xffffff, 0.8);
      this.auraBox.add(inner);
      this.scene.tweens.add({ targets: inner, scaleX: 1.2, scaleY: 1.2, ...breathe });
    }
    if (style.column) {
      const column = this.scene.add.image(0, -24, ORB).setTint(tint).setBlendMode(add).setScale(0.7, 1.5).setAlpha(0.3);
      this.auraBox.addAt(column, 0);
      this.scene.tweens.add({ targets: column, alpha: 0.55, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    }
    if (style.ripple) {
      const ripple = this.scene.add.ellipse(0, 0, 44, 15).setStrokeStyle(2, 0xffffff, 1);
      this.auraBox.add(ripple);
      this.scene.tweens.add({ targets: ripple, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 1400, repeat: -1, ease: "Quad.Out" });
    }
    const motes = this.scene.add.particles(0, 0, SPARK, {
      x: { min: -16, max: 16 },
      y: { min: -6, max: 2 },
      speedY: { min: -40, max: -18 },
      lifespan: { min: 900, max: 1500 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: style.colors ?? [tint, tint, 0xffffff],
      frequency: style.motes,
    });
    this.auraFront.add(motes);
  }

  /** A player's title under their name ("" for none), in its rarity colour. The name moves up to make room. */
  setTitle(text: string, color: string) {
    const key = text && `${text}|${color}`;
    if (key === this.titleKey) return;
    const had = Boolean(this.titleKey);
    this.titleKey = key;
    if (text) {
      if (!this.titleLabel) {
        this.titleLabel = this.scene.add
          .text(0, -51 + this.drop, "", { fontFamily: FONT, fontSize: "9px", fontStyle: "bold", stroke: "#10202b", strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setResolution(this.textRes());
        this.container.add(this.titleLabel);
      }
      this.titleLabel.setText(text).setColor(color).setVisible(true);
    } else this.titleLabel?.setVisible(false);
    if (Boolean(text) === had) return;
    // Same spacing as an NPC's title: the name 8 px higher, bubbles 10 px higher.
    const up = text ? -1 : 1;
    this.label.setY(this.label.y + 8 * up);
    this.bubbleY += 10 * up;
    this.bubble?.setY(this.bubble.y + 10 * up);
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
    this.auraBox.setVisible(!on);
    this.auraFront.setVisible(!on);
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
    if (this.nightGlow) {
      const light = this.fainted ? 0 : PlayerSprite.nightLight;
      const column = AURAS[this.aura]?.column;
      this.nightGlow.setPosition(this.x, this.y - (column ? 12 : 4)).setAlpha(light * (column ? 0.55 : 0.75)).setVisible(light > 0.02);
    }
  }

  /** Big jumps (respawn, reconnect) shouldn't count as walking distance. */
  teleport(x: number, y: number) {
    this.container.setPosition(x, y).setDepth(y);
  }

  destroy() {
    this.destroyed = true;
    this.lungeTween?.remove();
    this.scene.tweens.killTweensOf([...this.auraBox.list, ...this.auraFront.list]);
    this.nightGlow?.destroy();
    this.bubbleTimer?.remove();
    this.emoteTimer?.remove();
    if (this.look) this.textures.release(this.look);
    this.container.destroy();
  }
}
