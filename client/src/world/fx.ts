import Phaser from "phaser";
import { GLOW, makeGlowTexture } from "./daylight";

// Fight effects: damage numbers, slashes, level-up light. Everything here is
// short-lived and drawn above the night tint, so fights read in the dark too.

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const DEPTH = 1e6 - 5;
/** 3x3 white pixel made by the world scene. */
const SPARK = "spark";
/** A soft white dot, tinted for magic and fire. */
const ORB = "fx-orb";

/** Things that fly from an attacker to a target. */
export type Missile = "arrow" | "bolt" | "fire" | "seed" | "beam";

/** How long a missile takes to cover a distance (ms): quick, but long enough to see. */
export const flightMs = (d: number) => Phaser.Math.Clamp(d / 0.9, 90, 320);

const MISSILE_TINT: Record<Exclude<Missile, "arrow" | "beam">, number[]> = {
  bolt: [0xb98cff, 0xffffff, 0x7f5cff],
  fire: [0xff8a2a, 0xffd27a, 0xff4a1a],
  seed: [0xf0e2a8, 0xb08a4a],
};

/** dealt: your hits; taken: hits on you; other: everyone else's; miss: a whiff; heal: potions; thorn: a card biting back. */
export type NumberKind = "dealt" | "crit" | "taken" | "other" | "miss" | "heal" | "thorn";

const NUMBER_STYLE: Record<NumberKind, { size: number; color: string }> = {
  dealt: { size: 14, color: "#ffffff" },
  crit: { size: 18, color: "#ffd84a" },
  taken: { size: 14, color: "#ff5c57" },
  other: { size: 11, color: "#d9dde2" },
  miss: { size: 11, color: "#9fd3ff" },
  heal: { size: 14, color: "#7cf08a" },
  thorn: { size: 13, color: "#ff9fd0" },
};

export class Fx {
  constructor(
    private scene: Phaser.Scene,
    private textRes: () => number,
  ) {
    makeGlowTexture(scene);
    if (!scene.textures.exists(ORB)) {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255, 255, 255, 1)");
      grad.addColorStop(0.3, "rgba(255, 255, 255, 0.55)");
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      scene.textures.addCanvas(ORB, canvas);
    }
  }

  /** A number (or "Miss") that pops up over a head and floats away, Ragnarok style. */
  number(x: number, y: number, text: string, kind: NumberKind) {
    const style = NUMBER_STYLE[kind];
    const t = this.scene.add
      .text(Math.round(x + Phaser.Math.Between(-7, 7)), Math.round(y), text, {
        fontFamily: FONT,
        fontSize: `${style.size}px`,
        fontStyle: "bold",
        color: style.color,
        stroke: "#10202b",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes())
      .setDepth(DEPTH)
      .setScale(kind === "crit" ? 1.6 : 1.25);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: "Back.Out" });
    this.scene.tweens.add({ targets: t, y: y - 30, duration: 800, ease: "Cubic.Out" });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 520, duration: 300, onComplete: () => t.destroy() });
  }

  /** Soft text rising from your head (+EXP, +gold). */
  float(x: number, y: number, text: string, color: string, delay = 0) {
    const t = this.scene.add
      .text(Math.round(x), Math.round(y), text, { fontFamily: FONT, fontSize: "11px", fontStyle: "bold", color, stroke: "#10202b", strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes())
      .setDepth(DEPTH)
      .setAlpha(0);
    this.scene.tweens.add({ targets: t, alpha: 1, delay, duration: 150 });
    this.scene.tweens.add({ targets: t, y: y - 24, delay, duration: 1300, ease: "Sine.Out" });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: delay + 1000, duration: 300, onComplete: () => t.destroy() });
  }

  /** A quick white arc across whatever was hit. */
  slash(x: number, y: number) {
    const g = this.scene.add.graphics().setPosition(x, y).setDepth(DEPTH).setRotation(Math.random() * Math.PI * 2);
    g.lineStyle(3, 0xffffff, 0.95).beginPath().arc(0, 0, 13, -0.9, 0.9).strokePath();
    g.lineStyle(1.5, 0xfff2c4, 0.8).beginPath().arc(0, 0, 17, -0.6, 0.6).strokePath();
    g.setScale(0.6);
    this.scene.tweens.add({ targets: g, scale: 1.25, alpha: 0, duration: 200, ease: "Quad.Out", onComplete: () => g.destroy() });
  }

  /** A little cloud where a monster was. */
  poof(x: number, y: number) {
    const p = this.scene.add
      .particles(x, y - 10, SPARK, {
        speed: { min: 20, max: 70 },
        lifespan: { min: 300, max: 600 },
        scale: { start: 2.2, end: 0 },
        alpha: { start: 0.8, end: 0 },
        tint: [0xffffff, 0xd9dde2, 0xbfc6cc],
        emitting: false,
      })
      .setDepth(DEPTH);
    p.explode(14);
    this.scene.time.delayedCall(700, () => p.destroy());
  }

  /** A card going into someone's equipment: a ring of violet sparks drawn in. */
  card(x: number, y: number) {
    const glow = this.scene.add.image(x, y - 22, GLOW).setBlendMode(Phaser.BlendModes.ADD).setTint(0xc88bff).setDepth(DEPTH).setScale(0.2).setAlpha(0);
    this.scene.tweens.add({ targets: glow, alpha: 0.9, scale: 0.7, duration: 220, ease: "Quad.Out", yoyo: true, hold: 260, onComplete: () => glow.destroy() });
    const sparks = this.scene.add
      .particles(x, y - 22, SPARK, {
        emitZone: { type: "edge", source: new Phaser.Geom.Circle(0, 0, 26), quantity: 18 },
        moveToX: 0,
        moveToY: 0,
        lifespan: 420,
        scale: { start: 1.6, end: 0.4 },
        alpha: { start: 1, end: 0.2 },
        tint: [0xc88bff, 0xffffff, 0xe9c25c],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(DEPTH);
    sparks.explode(18);
    this.scene.time.delayedCall(500, () => sparks.destroy());
  }

  /** An arrow, a bolt of magic or fire, or a seed, flying from one point to another. Returns its flight time. */
  missile(x0: number, y0: number, x1: number, y1: number, kind: Missile): number {
    const ms = flightMs(Math.hypot(x1 - x0, y1 - y0));
    const angle = Math.atan2(y1 - y0, x1 - x0);
    if (kind === "beam") {
      // A Gazer's stare: a red line that flashes from eye to target.
      const g = this.scene.add.graphics().setDepth(DEPTH);
      g.lineStyle(5, 0xff3a5c, 0.55).lineBetween(x0, y0, x1, y1);
      g.lineStyle(2, 0xffe0e6, 1).lineBetween(x0, y0, x1, y1);
      g.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({ targets: g, alpha: 0, delay: 80, duration: 200, onComplete: () => g.destroy() });
      this.burst(x1, y1, [0xff3a5c, 0xffffff], 8);
      return 60;
    }
    if (kind === "arrow") {
      const g = this.scene.add.graphics().setDepth(DEPTH).setPosition(x0, y0).setRotation(angle);
      g.lineStyle(2, 0x7a5532, 1).lineBetween(-9, 0, 6, 0);
      g.fillStyle(0xdfe3e8, 1).fillTriangle(5, -3, 5, 3, 11, 0);
      g.lineStyle(1.5, 0xf4efe4, 1).lineBetween(-11, -3, -7, 0).lineBetween(-11, 3, -7, 0);
      this.scene.tweens.add({ targets: g, x: x1, y: y1, duration: ms, ease: "Linear", onComplete: () => g.destroy() });
      return ms;
    }
    const tints = MISSILE_TINT[kind];
    const seed = kind === "seed";
    const orb = this.scene.add
      .image(x0, y0, ORB)
      .setBlendMode(seed ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD)
      .setTint(tints[0])
      .setScale(seed ? 0.3 : 0.42)
      .setDepth(DEPTH);
    // Seeds are brown, so they show on the grass.
    const core = this.scene.add.circle(x0, y0, 3, seed ? 0x6b4423 : 0xffffff).setDepth(DEPTH);
    const trail = seed
      ? undefined
      : this.scene.add
          .particles(0, 0, SPARK, {
            follow: orb,
            lifespan: { min: 160, max: 280 },
            speed: { min: 5, max: 25 },
            scale: { start: 1.3, end: 0 },
            alpha: { start: 0.9, end: 0 },
            tint: tints,
            frequency: 14,
            blendMode: Phaser.BlendModes.ADD,
          })
          .setDepth(DEPTH);
    this.scene.tweens.add({
      targets: [orb, core],
      x: x1,
      y: y1,
      duration: ms,
      ease: "Linear",
      onComplete: () => {
        orb.destroy();
        core.destroy();
        trail?.stop();
        this.scene.time.delayedCall(300, () => trail?.destroy());
        if (!seed) this.burst(x1, y1, tints, 10);
      },
    });
    return ms;
  }

  /** A little shower of coloured sparks. */
  burst(x: number, y: number, tint: number[], n: number) {
    const p = this.scene.add
      .particles(x, y, SPARK, {
        speed: { min: 30, max: 90 },
        lifespan: { min: 200, max: 420 },
        scale: { start: 1.4, end: 0 },
        alpha: { start: 1, end: 0 },
        tint,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(DEPTH);
    p.explode(n);
    this.scene.time.delayedCall(500, () => p.destroy());
  }

  /** Whirlwind: two blades of light spinning once around someone. */
  whirl(x: number, y: number, r: number) {
    const g = this.scene.add.graphics().setPosition(x, y - 14).setDepth(DEPTH);
    g.lineStyle(4, 0xffffff, 0.9).beginPath().arc(0, 0, r * 0.75, 0, 1.6).strokePath();
    g.beginPath().arc(0, 0, r * 0.75, Math.PI, Math.PI + 1.6).strokePath();
    g.lineStyle(2, 0xffe2a0, 0.7).beginPath().arc(0, 0, r * 0.95, 0.3, 1.4).strokePath();
    g.beginPath().arc(0, 0, r * 0.95, Math.PI + 0.3, Math.PI + 1.4).strokePath();
    g.setScale(1, 0.55);
    this.scene.tweens.add({ targets: g, rotation: Math.PI * 2, duration: 320, ease: "Quad.Out" });
    this.scene.tweens.add({ targets: g, alpha: 0, delay: 200, duration: 200, onComplete: () => g.destroy() });
  }

  /** Frost Nova: a ring of ice racing outward, and shards. */
  nova(x: number, y: number, r: number) {
    // Drawn full size and scaled up (a shape's width doesn't redraw it).
    const ring = this.scene.add.ellipse(x, y - 4, r * 2, r).setStrokeStyle(3, 0xbfe9ff, 1).setDepth(DEPTH).setScale(0.1);
    const fill = this.scene.add.ellipse(x, y - 4, r * 2, r, 0x8fd0ff, 0.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH).setScale(0.1);
    this.scene.tweens.add({ targets: [ring, fill], scale: 1, duration: 260, ease: "Quad.Out" });
    this.scene.tweens.add({
      targets: [ring, fill],
      alpha: 0,
      delay: 220,
      duration: 320,
      onComplete: () => {
        ring.destroy();
        fill.destroy();
      },
    });
    const p = this.scene.add
      .particles(x, y - 10, SPARK, {
        speed: { min: 80, max: 200 },
        lifespan: { min: 300, max: 500 },
        scale: { start: 1.8, end: 0.2 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0xbfe9ff, 0x8fd0ff],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(DEPTH);
    p.explode(28);
    this.scene.time.delayedCall(600, () => p.destroy());
  }

  /** Arrow Rain: arrows dropping from the sky around a spot. Returns when the last one lands (ms). */
  rain(x: number, y: number, r: number): number {
    let last = 0;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const tx = x + Math.cos(a) * d;
      const ty = y + Math.sin(a) * d * 0.55;
      const delay = i * 35;
      const g = this.scene.add
        .graphics()
        .setDepth(DEPTH)
        .setPosition(tx + 30, ty - 150)
        .setRotation(Math.atan2(150, -30))
        .setAlpha(0);
      g.lineStyle(2, 0x7a5532, 1).lineBetween(-9, 0, 6, 0);
      g.fillStyle(0xdfe3e8, 1).fillTriangle(5, -3, 5, 3, 11, 0);
      this.scene.tweens.add({ targets: g, alpha: 1, delay, duration: 40 });
      this.scene.tweens.add({
        targets: g,
        x: tx,
        y: ty,
        delay,
        duration: 220,
        ease: "Quad.In",
        onComplete: () => {
          this.burst(tx, ty, [0xd9c7a0, 0xffffff], 4);
          this.scene.tweens.add({ targets: g, alpha: 0, delay: 120, duration: 160, onComplete: () => g.destroy() });
        },
      });
      last = delay + 220;
    }
    return last;
  }

  /** A buff or a heal: a ring of light rising around someone. */
  aura(x: number, y: number, tint: number) {
    const glow = this.scene.add.image(x, y - 22, ORB).setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setDepth(DEPTH).setScale(0.6, 1.1).setAlpha(0);
    this.scene.tweens.add({ targets: glow, alpha: 0.75, duration: 160, yoyo: true, hold: 260, onComplete: () => glow.destroy() });
    const ring = this.scene.add.ellipse(x, y - 2, 34, 14).setStrokeStyle(2, tint, 1).setDepth(DEPTH);
    this.scene.tweens.add({ targets: ring, y: y - 46, scaleX: 0.7, scaleY: 0.7, alpha: 0, duration: 700, ease: "Quad.Out", onComplete: () => ring.destroy() });
    const sparks = this.scene.add
      .particles(x, y, SPARK, {
        x: { min: -14, max: 14 },
        speedY: { min: -90, max: -40 },
        lifespan: { min: 400, max: 700 },
        scale: { start: 1.3, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [tint, 0xffffff],
        frequency: 30,
        quantity: 2,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(DEPTH);
    this.scene.time.delayedCall(450, () => sparks.stop());
    this.scene.time.delayedCall(1200, () => sparks.destroy());
  }

  /** A column of golden light, rising sparks and "LEVEL UP!" (or a new job) over someone's head. */
  levelUp(x: number, y: number, text = "LEVEL UP!", tint = 0xffd27a) {
    const glow = this.scene.add.image(x, y - 24, GLOW).setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setDepth(DEPTH).setScale(0.4, 1.2).setAlpha(0);
    this.scene.tweens.add({ targets: glow, alpha: 0.95, scaleX: 0.9, scaleY: 1.9, duration: 260, ease: "Quad.Out" });
    this.scene.tweens.add({ targets: glow, alpha: 0, delay: 700, duration: 600, onComplete: () => glow.destroy() });

    const sparks = this.scene.add
      .particles(x, y, SPARK, {
        x: { min: -16, max: 16 },
        speedY: { min: -120, max: -50 },
        speedX: { min: -12, max: 12 },
        lifespan: { min: 600, max: 1100 },
        scale: { start: 1.4, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffd27a, 0xffffff, 0xeb8224],
        frequency: 25,
        quantity: 2,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(DEPTH);
    this.scene.time.delayedCall(650, () => sparks.stop());
    this.scene.time.delayedCall(1900, () => sparks.destroy());

    const t = this.scene.add
      .text(Math.round(x), Math.round(y - 100), text, {
        fontFamily: FONT,
        fontSize: "15px",
        fontStyle: "bold",
        color: "#ffd84a",
        stroke: "#3a1d05",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes())
      .setDepth(DEPTH)
      .setScale(0.4);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 300, ease: "Back.Out" });
    this.scene.tweens.add({ targets: t, y: y - 120, alpha: 0, delay: 1300, duration: 500, onComplete: () => t.destroy() });
  }
}
