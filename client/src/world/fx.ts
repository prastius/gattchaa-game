import Phaser from "phaser";
import { GLOW, makeGlowTexture } from "./daylight";

// Fight effects: damage numbers, slashes, level-up light. Everything here is
// short-lived and drawn above the night tint, so fights read in the dark too.

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const DEPTH = 1e6 - 5;
/** 3x3 white pixel made by the world scene. */
const SPARK = "spark";

/** dealt: your hits; taken: hits on you; other: everyone else's; miss: a whiff; heal: potions. */
export type NumberKind = "dealt" | "crit" | "taken" | "other" | "miss" | "heal";

const NUMBER_STYLE: Record<NumberKind, { size: number; color: string }> = {
  dealt: { size: 14, color: "#ffffff" },
  crit: { size: 18, color: "#ffd84a" },
  taken: { size: 14, color: "#ff5c57" },
  other: { size: 11, color: "#d9dde2" },
  miss: { size: 11, color: "#9fd3ff" },
  heal: { size: 14, color: "#7cf08a" },
};

export class Fx {
  constructor(
    private scene: Phaser.Scene,
    private textRes: () => number,
  ) {
    makeGlowTexture(scene);
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

  /** A column of golden light, rising sparks and "LEVEL UP!" over someone's head. */
  levelUp(x: number, y: number) {
    const glow = this.scene.add.image(x, y - 24, GLOW).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd27a).setDepth(DEPTH).setScale(0.4, 1.2).setAlpha(0);
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
      .text(Math.round(x), Math.round(y - 100), "LEVEL UP!", {
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
