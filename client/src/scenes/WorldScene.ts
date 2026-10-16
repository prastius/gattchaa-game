import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import { CHUNK_TILES, PLAYER_SPEED, TILE_SIZE, WORLD_PX_H, WORLD_PX_W, hash2, type World } from "../../../shared/world";
import { Dir, NET_SEND_HZ, type MoveMessage, type PlayerView } from "../../../shared/protocol";
import { NPCS, type NpcDef } from "../../../shared/npcs";
import { PROPS } from "../../../shared/town";
import { CharacterTextures, PlayerSprite } from "../PlayerSprite";
import { ATLAS_MARGIN, ATLAS_SPACING, buildTerrainAtlas, floorCell, tileCells, type TerrainAtlas } from "../world/terrainTiles";
import { WORLD_TEX, createDecor, registerDecorFrames, type DecorSprite } from "../world/decorSprites";
import { Town, preloadTown, type Hotspot } from "../world/town";
import { Interpolator, ServerClock } from "../interp";
import type { ChatUI } from "../ui/chat";
import type { HUD } from "../ui/hud";
import type { Net } from "../net";
import type { Shop } from "../shop";
import type { TownDialog } from "../ui/dialog";

export interface WorldSceneData {
  world: World;
  room: Room;
  net: Net;
  chat: ChatUI;
  hud: HUD;
  shop: Shop;
  dialog: TownDialog;
}

interface Chunk {
  map: Phaser.Tilemaps.Tilemap;
  decor: DecorSprite[];
}

/** Synced fields shared by players and NPCs (live schema instances, mutated in place by the SDK). */
type Synced = PlayerView & { ts: number };

interface Entity {
  sprite: PlayerSprite;
  state: Synced;
  interp: Interpolator;
  lastTs: number;
  npc?: NpcDef;
}

const ATLAS_KEY = "terrain-atlas";
const SEND_INTERVAL = 1000 / NET_SEND_HZ;
const HUD_INTERVAL = 250;
const ASSETS = `${import.meta.env.BASE_URL}assets/world/`;
const TALK_RANGE = 72; // px from your feet to press E
const CLICK_RANGE = 360; // px: click/tap something this close to use it
const DIALOG_LEAVE_RANGE = 200;
const NPC_FACE_RANGE = 150;
const SPARK = "spark";

/**
 * Integer zoom keeps every art pixel the same size (no shimmer when scrolling).
 * width/height are in device pixels: big or high-DPI screens scale up, but the
 * view always keeps at least ~14x10 tiles.
 */
export function pickZoom(width: number, height: number, dpr: number): number {
  const comfortable = Math.floor(Math.min(width / 1100, height / 640));
  const fitMin = Math.floor(Math.min(width / (14 * TILE_SIZE), height / (10 * TILE_SIZE)));
  return Math.max(1, Math.min(Math.max(comfortable, Math.floor(dpr)), fitMin));
}

export class WorldScene extends Phaser.Scene {
  private world!: World;
  private room!: Room;
  private net!: Net;
  private chat!: ChatUI;
  private hud!: HUD;
  private shop!: Shop;
  private dialog!: TownDialog;

  private charTextures!: CharacterTextures;
  private atlas!: TerrainAtlas;
  private town!: Town;
  private entities = new Map<string, Entity>();
  private npcs = new Map<string, Entity>();
  private clock = new ServerClock();
  private self?: PlayerSprite;
  private chunks = new Map<string, Chunk>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "e", Phaser.Input.Keyboard.Key>;
  private lastSent = { x: 0, y: 0, dir: Dir.Down as number, moving: false, at: 0 };
  private hudAt = 0;
  private zoom = 1;
  private prompt!: Phaser.GameObjects.Text;
  private focus?: { target: string; x: number; y: number };
  /** The current press opened something, so it must not also walk. */
  private pointerUsed = false;

  constructor() {
    super("world");
  }

  init(data: WorldSceneData) {
    Object.assign(this, data);
  }

  preload() {
    this.load.image(WORLD_TEX.terrain, `${ASSETS}terrain.png`);
    this.load.image(WORLD_TEX.trees, `${ASSETS}trees.png`);
    this.load.image(WORLD_TEX.plants, `${ASSETS}plants.png`);
    this.load.image(WORLD_TEX.flowers, `${ASSETS}flowers.png`);
    this.load.image(WORLD_TEX.rocks, `${ASSETS}rocks.png`);
    preloadTown(this);
    this.load.setCORS("anonymous"); // product thumbnails come from the shop (needs CORS there)
  }

  create() {
    this.charTextures = new CharacterTextures(this);
    this.atlas = buildTerrainAtlas(this, WORLD_TEX.terrain, ATLAS_KEY);
    registerDecorFrames(this);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_PX_W, WORLD_PX_H);
    cam.setBackgroundColor("#1f5f7a");
    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.applyZoom());

    this.town = new Town(this, this.textRes);
    this.shop.onChange((data) => this.town.update(data, this.shop.openRooms));

    const K = Phaser.Input.Keyboard.KeyCodes;
    // enableCapture=false so the browser still delivers these keys to the chat input.
    this.keys = this.input.keyboard!.addKeys(
      { up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D, e: K.E },
      false,
    ) as typeof this.keys;
    this.keys.e.on("down", () => {
      if (this.chat.isFocused()) return;
      if (this.dialog.isOpen) this.dialog.close();
      else if (this.focus) this.dialog.open(this.focus.target, this.focus);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.chat.blur();
      this.pointerUsed = this.tryUse(p);
    });
    this.input.on("pointerup", () => (this.pointerUsed = false));
    // Releasing keys while focus is elsewhere never reaches Phaser; reset on blur.
    window.addEventListener("blur", () => this.input.keyboard?.resetKeys());

    this.prompt = this.add
      .text(0, 0, "", {
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        fontSize: "10px",
        fontStyle: "bold",
        color: "#131313",
        backgroundColor: "#eb8224",
        padding: { x: 5, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setResolution(this.textRes)
      .setDepth(1e6)
      .setVisible(false);

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 3, 3);
    g.generateTexture(SPARK, 3, 3);
    g.destroy();

    this.bindRoom();
  }

  /** One line for the F3 panel: how far behind others are drawn, and how often data ran late. */
  netStats(): string {
    return `smoothing ${Math.round(this.clock.delay)} ms   late frames ${this.clock.starvedFrames}`;
  }

  private applyZoom() {
    this.zoom = pickZoom(this.scale.width, this.scale.height, window.devicePixelRatio || 1);
    this.cameras.main.setZoom(this.zoom);
  }

  /** Text is rasterised at the camera zoom so names stay crisp. */
  private get textRes() {
    return this.zoom;
  }

  // ---------------------------------------------------------------- networking

  private bindRoom() {
    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("players", (value, key) => {
      const state = value as Synced;
      const sessionId = key as string;
      const isSelf = sessionId === this.room.sessionId;
      this.entities.get(sessionId)?.sprite.destroy();
      const sprite = new PlayerSprite(this, this.charTextures, state.x, state.y, state.name, state.look, { isSelf, textRes: this.textRes });
      sprite.dir = state.dir;
      this.entities.set(sessionId, { sprite, state, interp: new Interpolator(), lastTs: -1 });
      if (isSelf) {
        this.self = sprite;
        this.lastSent = { x: state.x, y: state.y, dir: state.dir, moving: false, at: 0 };
        // Hard follow (lerp 1): camera and player round identically, so no 1px jitter.
        this.cameras.main.startFollow(sprite.container, true, 1, 1);
        this.cameras.main.centerOn(state.x, state.y);
      }
    });

    callbacks.onRemove("players", (_value, key) => {
      const sessionId = key as string;
      this.entities.get(sessionId)?.sprite.destroy();
      this.entities.delete(sessionId);
      if (sessionId === this.room.sessionId) this.self = undefined;
    });

    callbacks.onAdd("npcs", (value, key) => {
      const state = value as Synced;
      const id = key as string;
      const npc = NPCS.find((n) => n.id === id);
      this.npcs.get(id)?.sprite.destroy();
      const sprite = new PlayerSprite(this, this.charTextures, state.x, state.y, state.name, state.look, {
        npc: true,
        // Stall keepers already have a sign over their counter.
        title: PROPS.some((p) => p.tag === `stall:${id}`) ? undefined : npc?.title,
        textRes: this.textRes,
      });
      sprite.dir = state.dir;
      this.npcs.set(id, { sprite, state, interp: new Interpolator(), lastTs: -1, npc });
    });

    callbacks.onRemove("npcs", (_value, key) => {
      this.npcs.get(key as string)?.sprite.destroy();
      this.npcs.delete(key as string);
    });

    this.net.onBubble = (sessionId, text) => this.entities.get(sessionId)?.sprite.say(text);
    this.net.onNpcSay = ({ id, text }) => this.npcs.get(id)?.sprite.say(text);
    this.net.onAnnounce.add(() => this.celebrate());
    this.net.onCorrect = ({ x, y }) => {
      if (!this.self) return;
      this.self.teleport(x, y);
      Object.assign(this.lastSent, { x, y });
    };
  }

  // ---------------------------------------------------------------- frame loop

  update(time: number, delta: number) {
    const dt = Math.min(delta, 100); // avoid huge jumps after a tab was hidden

    if (this.self) {
      this.updateSelf(time, dt);
      const me = this.entities.get(this.room.sessionId);
      if (me) this.self.setLook(me.state.look); // wardrobe changes come back via state
    }

    // Everyone else is drawn slightly in the past, blended between server snapshots.
    const now = performance.now();
    const renderT = this.clock.renderTime(now);
    let starved = false;
    const drive = (e: Entity) => {
      const s = e.state;
      if (s.ts !== e.lastTs) {
        e.lastTs = s.ts;
        e.interp.push({ t: s.ts, x: s.x, y: s.y, dir: s.dir, moving: s.moving });
        this.clock.observe(s.ts, now);
      }
      const p = e.interp.sample(renderT);
      if (!p) return;
      starved ||= p.starved;
      const sprite = e.sprite;
      const step = Math.hypot(p.x - sprite.x, p.y - sprite.y);
      if (step > 300) sprite.teleport(p.x, p.y);
      else sprite.setPosition(p.x, p.y);
      sprite.dir = p.dir;
      // Legs move while actually moving (>15 px/s), so stops look like stops.
      sprite.moving = step > (15 * dt) / 1000;
      sprite.setLook(s.look);
      sprite.animate();
    };
    for (const [id, e] of this.entities) if (id !== this.room.sessionId) drive(e);
    for (const e of this.npcs.values()) {
      drive(e);
      this.faceVisitor(e);
    }
    this.clock.update(dt, starved);

    this.updateFocus();
    this.streamChunks();
    this.fadeTallDecor(dt);

    if (time - this.hudAt > HUD_INTERVAL) {
      this.hudAt = time;
      const others: { x: number; y: number }[] = [];
      for (const [id, { sprite }] of this.entities) if (id !== this.room.sessionId) others.push(sprite);
      const state = this.room.state as { online?: number; siteOnline?: number };
      this.hud.update(this.self, others, state.online ?? this.entities.size, state.siteOnline ?? 0);
    }
  }

  /** Shopkeepers turn to look at you when you come close. */
  private faceVisitor(e: Entity) {
    if (!e.npc || e.npc.wander || !this.self) return;
    const dx = this.self.x - e.sprite.x;
    const dy = this.self.y - e.sprite.y;
    if (Math.hypot(dx, dy) > NPC_FACE_RANGE) {
      e.sprite.dir = e.npc.dir;
    } else {
      e.sprite.dir = Math.abs(dx) > Math.abs(dy) * 1.4 ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    }
    e.sprite.animate();
  }

  private updateSelf(time: number, dt: number) {
    const self = this.self!;
    let dx = 0;
    let dy = 0;

    if (!this.chat.isFocused()) {
      const k = this.keys;
      if (k.left.isDown || k.a.isDown) dx -= 1;
      if (k.right.isDown || k.d.isDown) dx += 1;
      if (k.up.isDown || k.w.isDown) dy -= 1;
      if (k.down.isDown || k.s.isDown) dy += 1;
    }

    // Hold mouse / finger to walk toward it (works on phones).
    const pointer = this.input.activePointer;
    if (dx === 0 && dy === 0 && pointer.isDown && !this.pointerUsed) {
      const wp = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const px = wp.x - self.x;
      const py = wp.y - (self.y - 20);
      if (px * px + py * py > 12 * 12) {
        dx = px;
        dy = py;
      }
    }

    const len = Math.hypot(dx, dy);
    let moving = false;
    if (len > 0) {
      const step = (PLAYER_SPEED * dt) / 1000;
      const next = this.world.move(self.x, self.y, (dx / len) * step, (dy / len) * step);
      moving = next.x !== self.x || next.y !== self.y;
      self.setPosition(next.x, next.y);
      // Face the dominant input direction even when blocked.
      self.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    }
    self.moving = moving;
    self.animate();

    const last = this.lastSent;
    const rx = Math.round(self.x);
    const ry = Math.round(self.y);
    const dirty = rx !== last.x || ry !== last.y || self.dir !== last.dir || moving !== last.moving;
    if (dirty && time - last.at >= SEND_INTERVAL) {
      const msg: MoveMessage = { x: self.x, y: self.y, dir: self.dir, moving };
      this.room.send("move", msg);
      this.lastSent = { x: rx, y: ry, dir: self.dir, moving, at: time };
    }
  }

  // ---------------------------------------------------------------- interaction

  /** NPCs (where they are right now) plus the town's fixed hotspots. */
  private hotspots(): Hotspot[] {
    const list: Hotspot[] = [...this.town.hotspots];
    for (const [id, e] of this.npcs) {
      const { x, y } = e.sprite;
      list.push({
        id: `npc:${id}`,
        target: `npc:${id}`,
        x,
        y,
        hit: new Phaser.Geom.Rectangle(x - 15, y - 56, 30, 60),
        label: `Talk to ${e.state.name}`,
      });
    }
    return list;
  }

  /** Shows "E · Talk to Rina" over the closest thing in reach. */
  private updateFocus() {
    const self = this.self;
    let best: Hotspot | undefined;
    if (self && !this.chat.isFocused()) {
      let bestD = TALK_RANGE;
      for (const h of this.hotspots()) {
        const d = Math.hypot(h.x - self.x, h.y - self.y);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    }
    this.focus = best && { target: best.target, x: best.x, y: best.y };

    if (best && !(this.dialog.isOpen && this.dialog.target === best.target)) {
      const touch = this.sys.game.device.input.touch && !this.sys.game.device.os.desktop;
      this.prompt
        .setText(`${touch ? "Tap" : "E"} · ${best.label}`)
        .setPosition(Math.round(best.hit.centerX), Math.round(best.hit.top - 4))
        .setVisible(true);
    } else {
      this.prompt.setVisible(false);
    }

    if (self && this.dialog.isOpen && Math.hypot(this.dialog.anchor.x - self.x, this.dialog.anchor.y - self.y) > DIALOG_LEAVE_RANGE) {
      this.dialog.close();
    }
  }

  /** Click/tap on an NPC, machine or table nearby opens it. */
  private tryUse(p: Phaser.Input.Pointer): boolean {
    const self = this.self;
    if (!self) return false;
    const wp = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    // NPCs first: they stand in front of things.
    const hits = this.hotspots()
      .filter((h) => h.hit.contains(wp.x, wp.y) && Math.hypot(h.x - self.x, h.y - self.y) < CLICK_RANGE)
      .sort((a, b) => Number(b.target.startsWith("npc:")) - Number(a.target.startsWith("npc:")) || b.y - a.y);
    const h = hits[0];
    if (!h) return false;
    this.dialog.open(h.target, { x: h.x, y: h.y });
    return true;
  }

  /** Fireworks over the fountain when someone pulls a hit on Gattchaa. */
  private celebrate() {
    const { x, y } = this.town.fountainPosition;
    const colors = [0xeb8224, 0xffd27a, 0xffffff, 0xff6b3d];
    for (let i = 0; i < 4; i++) {
      this.time.delayedCall(i * 350, () => {
        const bx = x + Phaser.Math.Between(-90, 90);
        const by = y - Phaser.Math.Between(70, 150);
        const burst = this.add
          .particles(bx, by, SPARK, {
            speed: { min: 40, max: 150 },
            lifespan: { min: 600, max: 1100 },
            scale: { start: 1, end: 0 },
            alpha: { start: 1, end: 0 },
            gravityY: 90,
            tint: colors,
            emitting: false,
          })
          .setDepth(1e6 - 1);
        burst.explode(36);
        this.time.delayedCall(1300, () => burst.destroy());
      });
    }
  }

  /** Trees and tall plants turn see-through while the local player is behind them. */
  private fadeTallDecor(dt: number) {
    const self = this.self;
    if (!self) return;
    const size = CHUNK_TILES * TILE_SIZE;
    const ccx = Math.floor(self.x / size);
    const ccy = Math.floor(self.y / size);
    for (let cy = ccy - 1; cy <= ccy + 1; cy++) {
      for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
        const chunk = this.chunks.get(`${cx},${cy}`);
        if (!chunk) continue;
        for (const d of chunk.decor) {
          if (!d.tall) continue;
          const img = d.image;
          const behind =
            self.y < img.y - 4 &&
            self.y > img.y - img.displayHeight + 20 &&
            Math.abs(self.x - img.x) < img.displayWidth * 0.4;
          // Ease toward the target so trees fade rather than pop.
          const target = behind ? 0.55 : 1;
          if (img.alpha !== target) {
            const next = img.alpha + (target - img.alpha) * Math.min(1, dt / 90);
            img.setAlpha(Math.abs(next - target) < 0.02 ? target : next);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- world streaming

  private streamChunks() {
    const view = this.cameras.main.worldView;
    const size = CHUNK_TILES * TILE_SIZE;
    const maxCx = Math.ceil(this.world.width / CHUNK_TILES) - 1;
    const maxCy = Math.ceil(this.world.height / CHUNK_TILES) - 1;
    // One chunk of margin; extra margin at the bottom because tall trees there reach up into view.
    const x0 = Math.max(0, Math.floor(view.x / size) - 1);
    const y0 = Math.max(0, Math.floor(view.y / size) - 1);
    const x1 = Math.min(maxCx, Math.floor(view.right / size) + 1);
    const y1 = Math.min(maxCy, Math.floor(view.bottom / size) + 1);

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        if (!this.chunks.has(key)) this.chunks.set(key, this.loadChunk(cx, cy));
      }
    }

    // Unload with one chunk of hysteresis so walking along a border doesn't thrash.
    for (const [key, chunk] of this.chunks) {
      const [cx, cy] = key.split(",").map(Number);
      if (cx < x0 - 1 || cx > x1 + 1 || cy < y0 - 1 || cy > y1 + 1) {
        chunk.map.destroy();
        for (const d of chunk.decor) {
          d.image.destroy();
          d.shadow?.destroy();
        }
        this.chunks.delete(key);
      }
    }
  }

  private loadChunk(cx: number, cy: number): Chunk {
    const { world, atlas } = this;
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    const w = Math.min(CHUNK_TILES, world.width - tx0);
    const h = Math.min(CHUNK_TILES, world.height - ty0);

    const ground: number[][] = [];
    const overlay: number[][] = [];
    const floor: number[][] = [];
    let hasOverlay = false;
    let hasFloor = false;
    const decor: DecorSprite[] = [];

    for (let y = 0; y < h; y++) {
      const gRow: number[] = [];
      const oRow: number[] = [];
      const fRow: number[] = [];
      for (let x = 0; x < w; x++) {
        const tx = tx0 + x;
        const ty = ty0 + y;
        const [g, o] = tileCells(world, tx, ty);
        gRow.push(atlas.terrain(g));
        oRow.push(o ? atlas.terrain(o) : -1);
        if (o) hasOverlay = true;
        const f = floorCell(world, tx, ty);
        fRow.push(f ? atlas.sheet(f) : -1);
        if (f) hasFloor = true;

        const d = world.decorAt(tx, ty);
        if (d) {
          const jitter = Math.round((hash2(tx, ty, world.seed + 11) - 0.5) * 8);
          const sprite = createDecor(
            this,
            d,
            tx * TILE_SIZE + TILE_SIZE / 2 + jitter,
            ty * TILE_SIZE + TILE_SIZE - 3,
            hash2(tx, ty, world.seed + 12),
          );
          if (sprite) decor.push(sprite);
        }
      }
      ground.push(gRow);
      overlay.push(oRow);
      floor.push(fRow);
    }

    const map = this.make.tilemap({ tileWidth: TILE_SIZE, tileHeight: TILE_SIZE, width: w, height: h });
    const tileset = map.addTilesetImage(ATLAS_KEY, ATLAS_KEY, TILE_SIZE, TILE_SIZE, ATLAS_MARGIN, ATLAS_SPACING)!;
    const px = tx0 * TILE_SIZE;
    const py = ty0 * TILE_SIZE;
    map.createBlankLayer("ground", tileset, px, py)!.putTilesAt(ground, 0, 0).setDepth(-3);
    if (hasOverlay) map.createBlankLayer("overlay", tileset, px, py)!.putTilesAt(overlay, 0, 0).setDepth(-2);
    if (hasFloor) map.createBlankLayer("floor", tileset, px, py)!.putTilesAt(floor, 0, 0).setDepth(-1);
    return { map, decor };
  }
}
