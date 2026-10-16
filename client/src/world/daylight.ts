import Phaser from "phaser";

// Day and night follow the real clock in Batam (WIB, UTC+7), so everyone in
// town shares the same sky. Night tints the world blue and lights the lamps.
// For testing: add ?hour=21 to the URL.

interface Key {
  hour: number;
  tint: number; // multiplied over the world (0xffffff = no change)
  lamps: number; // lamp glow 0..1
}

const KEYS: Key[] = [
  { hour: 0, tint: 0x7482bd, lamps: 1 },
  { hour: 5, tint: 0x7482bd, lamps: 1 },
  { hour: 6, tint: 0xd9b2a0, lamps: 0.5 },
  { hour: 7.5, tint: 0xffffff, lamps: 0 },
  { hour: 17, tint: 0xffffff, lamps: 0 },
  { hour: 18, tint: 0xf3c39a, lamps: 0.35 },
  { hour: 19, tint: 0xa496c4, lamps: 0.85 },
  { hour: 20, tint: 0x7482bd, lamps: 1 },
  { hour: 24, tint: 0x7482bd, lamps: 1 },
];

const forced = Number(new URLSearchParams(location.search).get("hour"));

/** Hour of day in Batam, with fractions (e.g. 18.5 = 18:30). */
export function batamHour(now = Date.now()): number {
  if (Number.isFinite(forced) && new URLSearchParams(location.search).has("hour")) return ((forced % 24) + 24) % 24;
  return (((now / 3_600_000 + 7) % 24) + 24) % 24;
}

function mix(a: number, b: number, k: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k) << s;
  return m(16) | m(8) | m(0);
}

export function sky(hour: number): { tint: number; lamps: number } {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const k = (hour - a.hour) / Math.max(0.0001, b.hour - a.hour);
      return { tint: mix(a.tint, b.tint, k), lamps: a.lamps + (b.lamps - a.lamps) * k };
    }
  }
  return { tint: 0xffffff, lamps: 0 };
}

const GLOW = "lamp-glow";

export class Daylight {
  private overlay: Phaser.GameObjects.Rectangle;
  private glows: Phaser.GameObjects.Image[] = [];
  private checkedAt = -Infinity;
  /** True when the current hour counts as night (for calmer music). */
  night = false;

  constructor(
    scene: Phaser.Scene,
    lights: { x: number; y: number }[],
  ) {
    if (!scene.textures.exists(GLOW)) {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255, 214, 140, 0.9)");
      grad.addColorStop(0.35, "rgba(255, 170, 80, 0.35)");
      grad.addColorStop(1, "rgba(255, 150, 60, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      scene.textures.addCanvas(GLOW, canvas);
    }
    // A huge screen-fixed rectangle multiplied over everything below it.
    this.overlay = scene.add
      .rectangle(0, 0, 40000, 40000, 0xffffff)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(1e6 - 10);
    for (const l of lights) {
      this.glows.push(scene.add.image(l.x, l.y, GLOW).setBlendMode(Phaser.BlendModes.ADD).setDepth(1e6 - 9).setAlpha(0).setScale(1.3));
    }
  }

  /** Call every frame; recomputes the sky a few times a minute. */
  update(time: number, indoors: boolean) {
    if (time - this.checkedAt < 5000 && !this.dirty) return;
    this.checkedAt = time;
    this.dirty = false;
    const { tint, lamps } = indoors ? { tint: 0xffffff, lamps: 0 } : sky(batamHour());
    this.night = !indoors && lamps > 0.5;
    this.overlay.setFillStyle(tint).setVisible(tint !== 0xffffff);
    for (const g of this.glows) g.setAlpha(lamps * 0.75).setVisible(lamps > 0.02);
  }

  private dirty = true;

  /** Force a recompute on the next update (e.g. after going indoors). */
  refresh() {
    this.dirty = true;
  }
}
