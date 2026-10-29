import Phaser from "phaser";
import { Dir } from "../../shared/protocol";
import { MONSTERS, type MonsterDef, type MonsterId } from "../../shared/rpg";
import { MONSTER_ART, attackAnim, idleAnim, monsterReady, monsterTexture, moveAnim, type MonsterArt } from "./world/monsterArt";

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const BAR_W = 30;
const BOSS_BAR_W = 64;
const FLASH_MS = 80;
/** Humanoids step this far toward what they hit. */
const LUNGE_PX = 7;
/** Unit steps for each facing (up, left, down, right). */
const STEP = [
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
];

/**
 * A monster in the field. Like PlayerSprite, the container sits at its feet
 * with depth = y. The name shows while you point at it or fight it; the
 * health bar once it's hurt.
 */
export class MonsterSprite {
  readonly container: Phaser.GameObjects.Container;
  readonly def: MonsterDef;
  readonly art: MonsterArt;
  private sprite: Phaser.GameObjects.Sprite;
  private ring: Phaser.GameObjects.Graphics;
  private bar: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private ringTween?: Phaser.Tweens.Tween;
  private hp: number;
  private barKey = "";
  private attacking = false;
  private isTarget = false;
  private isHovered = false;
  private dying = false;
  private barW: number;
  private frozen = false;
  private thaw?: Phaser.Time.TimerEvent;
  /** Its texture exists (humanoids are put together the first time one appears). */
  private ready = false;
  private lungeTween?: Phaser.Tweens.Tween;

  moving = false;
  dir: number = Dir.Down;

  constructor(
    private scene: Phaser.Scene,
    readonly kind: MonsterId,
    x: number,
    y: number,
    hp: number,
    textRes: () => number,
  ) {
    this.def = MONSTERS[kind];
    this.art = MONSTER_ART[kind];
    this.hp = hp;
    const a = this.art;

    // A ring on the ground marks your target.
    const rx = Math.max(14, this.def.radius + 8);
    this.ring = scene.add.graphics().setVisible(false);
    this.ring.lineStyle(2, 0xff5a4f, 1).strokeEllipse(0, 0, rx * 2, rx).lineStyle(1, 0xffd0c0, 0.7).strokeEllipse(0, 0, rx * 2 + 6, rx + 3);

    this.sprite = scene.add.sprite(0, 0, "__DEFAULT").setOrigin(0.5, a.feet / a.frame).setScale(a.scale ?? 1).setVisible(false);
    this.barW = this.def.boss ? BOSS_BAR_W : BAR_W;
    this.bar = scene.add.graphics().setVisible(false);
    this.label = scene.add
      .text(0, -a.h - 6, `${this.def.name}  Lv ${this.def.level}`, {
        fontFamily: FONT,
        fontSize: "10px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#10202b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(textRes())
      .setVisible(Boolean(this.def.boss));

    this.container = scene.add.container(x, y, [this.ring, this.sprite, this.bar, this.label]).setDepth(y);
    this.drawBar();
    void monsterReady(scene, kind).then(() => {
      if (this.dying) return;
      this.ready = true;
      this.sprite.setTexture(monsterTexture(kind)).setVisible(true);
      // Out of step with its neighbours: start the loop on a random frame (a standing one has just the one).
      const key = this.loopKey();
      const frames = scene.anims.get(key)?.frames.length ?? 1;
      this.sprite.play({ key, startFrame: Math.floor(Math.random() * Math.min(3, frames)) });
    });
  }

  /** The loop for now: walking (or the pack's bobbing), or standing still. */
  private loopKey() {
    return !this.moving && this.art.idle ? idleAnim(this.kind, this.dir) : moveAnim(this.kind, this.dir);
  }

  get x() {
    return this.container.x;
  }

  get y() {
    return this.container.y;
  }

  /** Where it can be clicked or tapped. */
  hitBox(): Phaser.Geom.Rectangle {
    const { w, h } = this.art;
    return new Phaser.Geom.Rectangle(this.x - w / 2, this.y - h, w, h + 6);
  }

  /** Middle of the body, for numbers and slashes. */
  get head(): { x: number; y: number } {
    return { x: this.x, y: this.y - this.art.h };
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y).setDepth(y);
  }

  teleport(x: number, y: number) {
    this.setPosition(x, y);
  }

  /** Per frame: the idle/move loop for the way it faces (quicker while moving). */
  animate() {
    if (this.dying || this.frozen || !this.ready) return;
    // The pack's monsters bob quicker while they move; humanoids walk at one pace.
    this.sprite.anims.timeScale = this.moving && !this.art.parts ? 1.6 : 1;
    if (this.attacking) return;
    const key = this.loopKey();
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
  }

  /** Lunges/bites toward `dir`, then goes back to its loop. */
  attack(dir: number) {
    if (this.dying || this.frozen || !this.ready) return;
    this.dir = dir;
    if (this.art.parts) {
      // Humanoids have no attack frames: a quick step at the target, and back.
      const [sx, sy] = STEP[dir] ?? [0, 1];
      this.lungeTween?.complete();
      this.sprite.setPosition(0, 0);
      this.animate();
      this.lungeTween = this.scene.tweens.add({ targets: this.sprite, x: sx * LUNGE_PX, y: sy * LUNGE_PX, duration: 90, yoyo: true, ease: "Quad.Out" });
      return;
    }
    this.attacking = true;
    this.sprite.play(attackAnim(this.kind, dir));
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.attacking = false;
      this.animate();
    });
  }

  /** A white flash when hit. */
  flash() {
    if (this.dying) return;
    this.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => {
      if (!this.dying) this.restTint();
    });
  }

  /** Frost Nova: ice blue and stock still for `ms`. */
  freeze(ms: number) {
    if (this.dying) return;
    this.frozen = true;
    this.sprite.anims.pause();
    this.restTint();
    this.thaw?.remove();
    this.thaw = this.scene.time.delayedCall(ms, () => {
      this.frozen = false;
      if (this.dying) return;
      this.sprite.anims.resume();
      this.restTint();
    });
  }

  /** Its colour between flashes: ice blue while frozen, its own otherwise. */
  private restTint() {
    // Screen lightens toward the tint: an icy blue-white whatever the monster's colour.
    if (this.frozen) this.sprite.setTint(0x5fa8ff).setTintMode(Phaser.TintModes.SCREEN);
    else this.sprite.clearTint();
  }

  setHp(hp: number) {
    this.hp = hp;
    this.drawBar();
  }

  set targeted(on: boolean) {
    if (on === this.isTarget) return;
    this.isTarget = on;
    this.ring.setVisible(on);
    this.ringTween?.remove();
    this.ringTween = on ? this.scene.tweens.add({ targets: this.ring, alpha: { from: 1, to: 0.45 }, duration: 520, yoyo: true, repeat: -1 }) : undefined;
    this.refreshLabel();
    this.drawBar();
  }

  set hovered(on: boolean) {
    if (on === this.isHovered) return;
    this.isHovered = on;
    this.refreshLabel();
  }

  /** Name colour by how dangerous it is for you (see levelColor). */
  setNameColor(color: string) {
    if (this.label.style.color !== color) this.label.setColor(color);
  }

  /** Bosses always show their name and health. */
  private refreshLabel() {
    this.label.setVisible(!this.dying && (this.isTarget || this.isHovered || Boolean(this.def.boss)));
  }

  private drawBar() {
    const max = this.def.hp;
    const show = !this.dying && (this.hp < max || this.isTarget || Boolean(this.def.boss));
    const key = show ? `${this.hp}` : "";
    if (key === this.barKey) return;
    this.barKey = key;
    this.bar.setVisible(show);
    if (!show) return;
    const r = Phaser.Math.Clamp(this.hp / max, 0, 1);
    const color = r > 0.5 ? 0x5fd36b : r > 0.25 ? 0xf2c14e : 0xe5534b;
    this.bar
      .clear()
      .fillStyle(0x10202b, 0.85)
      .fillRect(-this.barW / 2 - 1, 4, this.barW + 2, 6)
      .fillStyle(color, 1)
      .fillRect(-this.barW / 2, 5, Math.max(1, Math.round(this.barW * r)), 4);
  }

  /** Defeated: flashes, shrinks into the ground and fades, then cleans itself up. */
  die() {
    if (this.dying) return;
    this.dying = true;
    this.ringTween?.remove();
    this.ring.setVisible(false);
    this.bar.setVisible(false);
    this.label.setVisible(false);
    this.sprite.anims.stop();
    this.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => this.sprite.clearTint());
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: 1.25,
      scaleY: 0.4,
      duration: 380,
      delay: FLASH_MS,
      ease: "Quad.In",
      onComplete: () => this.destroy(),
    });
  }

  destroy() {
    this.dying = true;
    this.lungeTween?.remove();
    this.thaw?.remove();
    this.ringTween?.remove();
    this.container.destroy();
  }
}
