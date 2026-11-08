import Phaser from "phaser";
import { DECOR, TILE_SIZE, Terrain, type World } from "../../../shared/world";
import { GLOW } from "./daylight";

// Small moving details that make the world feel alive: butterflies over the
// flowers by day, fireflies drifting over the grass at night. Only a handful
// at a time, and only around the camera, so they cost next to nothing.

const BUTTERFLIES = 6;
const FIREFLIES = 16;
const SPAWN_EVERY_MS = 900;
/** Critters further than this from the middle of the screen fly off. */
const RANGE = 900;
const WING_COLORS = [0xeb8224, 0xffffff, 0xf2c14e, 0x7cc4ff, 0xff8fb8, 0xb08cff];
const FLAP_MS = 110;

interface Butterfly {
  img: Phaser.GameObjects.Image;
  home: { x: number; y: number };
  x: number;
  y: number;
  target: { x: number; y: number };
  phase: number;
  leaveAt: number;
  color: number;
}

interface Firefly {
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  leaveAt: number;
}

/** Pixel butterflies, two frames each (wings open, wings up), one texture per colour. */
function makeButterflyTextures(scene: Phaser.Scene) {
  const open = ["0110.0110", "1111.1111", "1111b1111", "0111b1110", "0110b0110", "0000b0000"];
  const shut = ["000101000", "000b0b000", "0001b1000", "0001b1000", "0000b0000", "0000b0000"];
  WING_COLORS.forEach((color, ci) => {
    const key = `butterfly-${ci}`;
    if (scene.textures.exists(key)) return;
    const canvas = document.createElement("canvas");
    canvas.width = 18;
    canvas.height = 6;
    const ctx = canvas.getContext("2d")!;
    const wing = `#${color.toString(16).padStart(6, "0")}`;
    [open, shut].forEach((rows, f) =>
      rows.forEach((row, y) =>
        [...row].forEach((c, x) => {
          if (c === "0" || c === ".") return;
          ctx.fillStyle = c === "b" ? "#2a1d14" : wing;
          ctx.fillRect(f * 9 + x, y, 1, 1);
        }),
      ),
    );
    const tex = scene.textures.addCanvas(key, canvas)!;
    tex.add(0, 0, 0, 0, 9, 6);
    tex.add(1, 0, 9, 0, 9, 6);
  });
  if (!scene.textures.exists("firefly")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 3;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(214, 255, 120, 0.55)";
    ctx.fillRect(0, 1, 3, 1);
    ctx.fillRect(1, 0, 1, 3);
    ctx.fillStyle = "#f6ffc8";
    ctx.fillRect(1, 1, 1, 1);
    scene.textures.addCanvas("firefly", canvas);
  }
}

export class Critters {
  private butterflies: Butterfly[] = [];
  private flies: Firefly[] = [];
  private spawnAt = 0;

  constructor(
    private scene: Phaser.Scene,
    private world: World,
  ) {
    makeButterflyTextures(scene);
  }

  /** Grass with something growing nearby: where butterflies like to be. */
  private flowery(tx: number, ty: number): boolean {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const id = DECOR[this.world.decorAt(tx + ox, ty + oy)].id;
        if (id === "flowers" || id === "tallGrass" || id === "fern") return true;
      }
    }
    return false;
  }

  /** Open grass (no paving, no water): where fireflies drift. */
  private grassy(tx: number, ty: number): boolean {
    return !this.world.floorAt(tx, ty) && !this.world.solidAt(tx, ty) && this.world.corners(tx, ty).every((t) => t === Terrain.Grass);
  }

  /** A random tile inside the view that passes `test`, or undefined. */
  private spot(view: Phaser.Geom.Rectangle, test: (tx: number, ty: number) => boolean) {
    for (let i = 0; i < 12; i++) {
      const tx = Math.floor((view.x + Math.random() * view.width) / TILE_SIZE);
      const ty = Math.floor((view.y + Math.random() * view.height) / TILE_SIZE);
      if (test(tx, ty)) return { x: (tx + Math.random()) * TILE_SIZE, y: (ty + Math.random()) * TILE_SIZE };
    }
    return undefined;
  }

  update(time: number, dt: number, view: Phaser.Geom.Rectangle, night: boolean, indoors: boolean) {
    const cx = view.centerX;
    const cy = view.centerY;
    const wantButterflies = indoors || night ? 0 : BUTTERFLIES;
    const wantFlies = indoors || !night ? 0 : FIREFLIES;

    if (time > this.spawnAt) {
      this.spawnAt = time + SPAWN_EVERY_MS;
      if (this.butterflies.length < wantButterflies) {
        const at = this.spot(view, (tx, ty) => this.flowery(tx, ty));
        if (at) this.addButterfly(at, time);
      }
      if (this.flies.length < wantFlies) {
        const at = this.spot(view, (tx, ty) => this.grassy(tx, ty));
        if (at) this.addFirefly(at, time);
      }
    }

    const s = dt / 1000;
    this.butterflies = this.butterflies.filter((b) => {
      const leaving = time > b.leaveAt || this.butterflies.length > wantButterflies || Math.hypot(b.x - cx, b.y - cy) > RANGE;
      if (leaving) b.target = { x: b.x + 400, y: b.y - 300 }; // off and away, up to the right
      const dx = b.target.x - b.x;
      const dy = b.target.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 4 && !leaving) {
        b.target = { x: b.home.x + (Math.random() - 0.5) * 160, y: b.home.y + (Math.random() - 0.5) * 110 };
      } else if (d > 0) {
        const speed = leaving ? 60 : 32;
        b.x += (dx / d) * speed * s;
        b.y += (dy / d) * speed * s;
      }
      // Fluttering: a zig-zag on top of the straight line, bobbing up and down.
      const wobble = Math.sin(time / 170 + b.phase) * 5;
      const lift = 18 + Math.sin(time / 260 + b.phase) * 5;
      b.img.setPosition(Math.round(b.x + wobble), Math.round(b.y - lift)).setDepth(b.y + 4);
      b.img.setFrame(Math.floor((time + b.phase * 100) / FLAP_MS) % 2);
      if (leaving) b.img.setAlpha(Math.max(0, b.img.alpha - s * 0.8));
      if (b.img.alpha <= 0) {
        b.img.destroy();
        return false;
      }
      return true;
    });

    this.flies = this.flies.filter((f) => {
      const gone = time > f.leaveAt || this.flies.length > wantFlies || Math.hypot(f.x - cx, f.y - cy) > RANGE;
      // Lazy drifting, turning a little now and then.
      if (Math.random() < 0.02) {
        f.vx = (Math.random() - 0.5) * 24;
        f.vy = (Math.random() - 0.5) * 16;
      }
      f.x += f.vx * s;
      f.y += f.vy * s;
      const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(time / 420 + f.phase));
      const fade = gone ? Math.max(0, f.img.alpha - s * 0.7) : Math.min(1, f.img.alpha + s * 0.7);
      const y = Math.round(f.y - 14 + Math.sin(time / 600 + f.phase) * 6);
      f.img.setPosition(Math.round(f.x), y).setAlpha(fade);
      f.glow.setPosition(Math.round(f.x), y).setAlpha(fade * pulse * 0.7);
      if (gone && fade <= 0) {
        f.img.destroy();
        f.glow.destroy();
        return false;
      }
      return true;
    });
  }

  private addButterfly(at: { x: number; y: number }, time: number) {
    const color = Math.floor(Math.random() * WING_COLORS.length);
    const img = this.scene.add.image(at.x, at.y, `butterfly-${color}`, 0).setOrigin(0.5, 1);
    this.butterflies.push({
      img,
      home: { ...at },
      x: at.x,
      y: at.y,
      target: { ...at },
      phase: Math.random() * 10,
      leaveAt: time + 15_000 + Math.random() * 25_000,
      color,
    });
  }

  private addFirefly(at: { x: number; y: number }, time: number) {
    // Above the night tint, so they glow.
    const img = this.scene.add.image(at.x, at.y, "firefly").setDepth(1e6 - 8).setAlpha(0);
    const glow = this.scene.add.image(at.x, at.y, GLOW).setDisplaySize(26, 26).setTint(0xa8ff6a).setBlendMode(Phaser.BlendModes.ADD).setDepth(1e6 - 8).setAlpha(0);
    this.flies.push({ img, glow, x: at.x, y: at.y, vx: 0, vy: 0, phase: Math.random() * 10, leaveAt: time + 20_000 + Math.random() * 30_000 });
  }
}

/** Little textures for the weather: a snowflake, a leaf and a petal. */
function makeWeatherTextures(scene: Phaser.Scene) {
  if (!scene.textures.exists("snowflake")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 3;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillRect(0, 1, 3, 1);
    ctx.fillRect(1, 0, 1, 3);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(1, 1, 1, 1);
    scene.textures.addCanvas("snowflake", canvas);
  }
  if (!scene.textures.exists("leaf")) {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 3;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(1, 0, 2, 1);
    ctx.fillRect(0, 1, 4, 1);
    ctx.fillRect(1, 2, 2, 1);
    scene.textures.addCanvas("leaf", canvas);
  }
  if (!scene.textures.exists("ember")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 2, 2);
    scene.textures.addCanvas("ember", canvas);
  }
  if (!scene.textures.exists("petal")) {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 3;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 2, 1);
    ctx.fillRect(0, 1, 4, 1);
    ctx.fillRect(2, 2, 2, 1);
    scene.textures.addCanvas("petal", canvas);
  }
}

/** How each kind of weather falls. */
const WEATHER = {
  // Snow over Frostfell: light, steady, drifting a little to the left.
  snow: { tex: "snowflake", speedX: { min: -14, max: 6 }, speedY: { min: 16, max: 38 }, scale: { min: 0.7, max: 1.6 }, frequency: 55, quantity: 2, tint: [0xffffff] },
  // Leaves over Ravenmoor: fewer, blown by the wind, tumbling as they go.
  leaves: { tex: "leaf", speedX: { min: -40, max: -10 }, speedY: { min: 18, max: 42 }, scale: { min: 1, max: 1.8 }, frequency: 140, quantity: 1, tint: [0xe8832a, 0xd8452a, 0xf2c14e, 0x9a5a2a] },
  // Cherry blossom over Petalfall: a gentle, steady fall of pink petals, drifting on the breeze.
  petals: { tex: "petal", speedX: { min: -30, max: -4 }, speedY: { min: 12, max: 30 }, scale: { min: 1.2, max: 2 }, frequency: 80, quantity: 1, tint: [0xffc4da, 0xffadc9, 0xfff0f6, 0xf59ab9] },
  // Embers over Ashpeak: sparks rising from the hot rock, and grey ash drifting among them.
  embers: { tex: "ember", speedX: { min: -12, max: 12 }, speedY: { min: -34, max: -10 }, scale: { min: 0.8, max: 1.6 }, frequency: 70, quantity: 1, tint: [0xff8a3a, 0xffc04a, 0xff5a2a, 0x9a8a84] },
  // Sand over Sunscar: grains blown sideways on a hot wind.
  sand: { tex: "ember", speedX: { min: 50, max: 110 }, speedY: { min: -6, max: 10 }, scale: { min: 0.8, max: 1.4 }, frequency: 60, quantity: 1, tint: [0xe8c88a, 0xd8b070, 0xf0dca8] },
  // Starlight over Starfall: little sparks of light drifting slowly up into the night.
  stars: { tex: "ember", speedX: { min: -6, max: 6 }, speedY: { min: -10, max: -2 }, scale: { min: 0.8, max: 1.6 }, frequency: 90, quantity: 1, tint: [0xffffff, 0xb8d8ff, 0xd8b8ff, 0xfff0a0] },
} as const;

/** Snow or leaves falling over the view while the camera is on an island that has them. */
export class Weather {
  private zone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene, kind: keyof typeof WEATHER) {
    makeWeatherTextures(scene);
    const w = WEATHER[kind];
    this.emitter = scene.add
      .particles(0, 0, w.tex, {
        emitZone: {
          type: "random",
          source: {
            getRandomPoint: (p: Phaser.Types.Math.Vector2Like) => {
              p.x = this.zone.x + Math.random() * this.zone.width;
              p.y = this.zone.y + Math.random() * this.zone.height;
            },
          },
        },
        lifespan: { min: 3500, max: 6500 },
        speedX: w.speedX,
        speedY: w.speedY,
        scale: w.scale,
        rotate: kind === "snow" ? 0 : { min: 0, max: 360 },
        tint: [...w.tint],
        // Fades in where it appears and out before it goes, so nothing pops.
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.85 },
        frequency: w.frequency,
        quantity: w.quantity,
        emitting: false,
      })
      // Over the world, under the night tint.
      .setDepth(1e6 - 11);
  }

  update(view: Phaser.Geom.Rectangle, on: boolean) {
    this.emitter.setPosition(view.x, view.y);
    this.zone.setTo(-80, -40, view.width + 160, view.height + 40);
    if (on !== this.emitter.emitting) {
      if (on) this.emitter.start();
      else this.emitter.stop();
    }
  }
}
