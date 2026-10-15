import Phaser from "phaser";
import { TEX } from "./textures";

const BUBBLE_MS = 6000;
const TEXT_RES = Math.min(2, window.devicePixelRatio || 1);

function hueToTint(hue: number): number {
  // HSV(h, 0.55, 0.95) -> 0xRRGGBB
  const s = 0.55;
  const v = 0.95;
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/**
 * A player avatar. The container's (x, y) is the player's feet, and its depth
 * equals y so everything in the world is drawn back-to-front ("2.5D" overlap).
 */
export class PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private bubble?: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private walkTime = 0;

  /** Network target for remote players; ignored for the local player. */
  targetX: number;
  targetY: number;
  moving = false;
  facing = 1;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    name: string,
    hue: number,
    isSelf: boolean,
  ) {
    this.targetX = x;
    this.targetY = y;

    const shadow = scene.add.image(0, 0, TEX.shadow);
    this.body = scene.add.image(0, -12, TEX.body).setTint(hueToTint(hue));
    this.head = scene.add.image(0, -30, TEX.head);
    this.label = scene.add
      .text(0, -46, name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        color: isSelf ? "#ffe680" : "#ffffff",
        stroke: "#0b1d2a",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES);

    this.container = scene.add.container(x, y, [shadow, this.body, this.head, this.label]);
    this.container.setDepth(y);
  }

  get x() {
    return this.container.x;
  }

  get y() {
    return this.container.y;
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
    this.container.setDepth(y);
  }

  say(text: string) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    this.bubble = this.scene.add
      .text(0, -64, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#10202b",
        backgroundColor: "#ffffffee",
        padding: { x: 8, y: 5 },
        wordWrap: { width: 200, useAdvancedWrap: true },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES);
    this.container.add(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(BUBBLE_MS, () => {
      this.bubble?.destroy();
      this.bubble = undefined;
    });
  }

  /** Per-frame animation: walk bob + facing. */
  animate(deltaMs: number) {
    if (this.moving) {
      this.walkTime += deltaMs;
      const bob = Math.abs(Math.sin(this.walkTime / 90)) * 3;
      this.body.y = -12 - bob;
      this.head.y = -30 - bob;
    } else {
      this.walkTime = 0;
      this.body.y = -12;
      this.head.y = -30;
    }
    this.head.setFlipX(this.facing < 0);
  }

  /** Smoothly approach the last network position (remote players). */
  interpolate(deltaMs: number) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (dx * dx + dy * dy > 400 * 400) {
      this.setPosition(this.targetX, this.targetY); // teleport / respawn
      return;
    }
    const t = 1 - Math.exp(-deltaMs / 80);
    this.setPosition(this.x + dx * t, this.y + dy * t);
  }

  destroy() {
    this.bubbleTimer?.remove();
    this.container.destroy();
  }
}
