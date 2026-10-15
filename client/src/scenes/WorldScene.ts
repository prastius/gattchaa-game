import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  CHUNK_TILES,
  Decor,
  PLAYER_SPEED,
  TILE_SIZE,
  WORLD_PX_H,
  WORLD_PX_W,
  hash2,
  type World,
} from "../../../shared/world";
import { NET_SEND_HZ, type MoveMessage, type PlayerView } from "../../../shared/protocol";
import { PlayerSprite } from "../PlayerSprite";
import { TEX, TILE_COLORS, buildTextures } from "../textures";
import type { ChatUI } from "../ui/chat";
import type { HUD } from "../ui/hud";
import type { Net } from "../net";

export interface WorldSceneData {
  world: World;
  room: Room;
  net: Net;
  chat: ChatUI;
  hud: HUD;
}

interface Chunk {
  map: Phaser.Tilemaps.Tilemap;
  decor: Phaser.GameObjects.Image[];
}

interface Entity {
  sprite: PlayerSprite;
  state: PlayerView; // live schema instance, mutated in place by the SDK
}

const DECOR_STYLE: Record<number, { key: string; originY: number }> = {
  [Decor.Tree]: { key: TEX.tree, originY: 0.93 },
  [Decor.Pine]: { key: TEX.pine, originY: 0.93 },
  [Decor.Boulder]: { key: TEX.boulder, originY: 0.84 },
};

const SEND_INTERVAL = 1000 / NET_SEND_HZ;
const HUD_INTERVAL = 200;

export class WorldScene extends Phaser.Scene {
  private world!: World;
  private room!: Room;
  private net!: Net;
  private chat!: ChatUI;
  private hud!: HUD;

  private entities = new Map<string, Entity>();
  private self?: PlayerSprite;
  private chunks = new Map<string, Chunk>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private lastSent = { x: 0, y: 0, facing: 1, moving: false, at: 0 };
  private hudAt = 0;

  constructor() {
    super("world");
  }

  init(data: WorldSceneData) {
    Object.assign(this, data);
  }

  create() {
    buildTextures(this);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_PX_W, WORLD_PX_H);
    cam.setBackgroundColor(TILE_COLORS[0]);
    cam.setRoundPixels(true);

    const K = Phaser.Input.Keyboard.KeyCodes;
    // enableCapture=false so the browser still delivers these keys to the chat input.
    this.keys = this.input.keyboard!.addKeys(
      { up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D },
      false,
    ) as typeof this.keys;
    this.input.on("pointerdown", () => this.chat.blur());
    // Releasing keys while the chat input had focus never reaches Phaser; reset on blur.
    window.addEventListener("blur", () => this.input.keyboard?.resetKeys());

    this.bindRoom();
  }

  // ---------------------------------------------------------------- networking

  private bindRoom() {
    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("players", (value, key) => {
      const state = value as PlayerView;
      const sessionId = key as string;
      const isSelf = sessionId === this.room.sessionId;
      const sprite = new PlayerSprite(this, state.x, state.y, state.name, state.hue, isSelf);
      this.entities.set(sessionId, { sprite, state });
      if (isSelf) {
        this.self = sprite;
        this.lastSent = { x: state.x, y: state.y, facing: 1, moving: false, at: 0 };
        this.cameras.main.startFollow(sprite.container, true, 0.15, 0.15);
      }
    });

    callbacks.onRemove("players", (_value, key) => {
      this.entities.get(key as string)?.sprite.destroy();
      this.entities.delete(key as string);
    });

    this.net.onBubble = (sessionId, text) => this.entities.get(sessionId)?.sprite.say(text);
    this.net.onCorrect = ({ x, y }) => {
      this.self?.setPosition(x, y);
      Object.assign(this.lastSent, { x, y });
    };
  }

  // ---------------------------------------------------------------- frame loop

  update(time: number, delta: number) {
    const dt = Math.min(delta, 100); // avoid huge jumps after a tab was hidden

    if (this.self) this.updateSelf(time, dt);

    for (const [id, { sprite, state }] of this.entities) {
      if (id === this.room.sessionId) continue;
      sprite.targetX = state.x;
      sprite.targetY = state.y;
      sprite.moving = state.moving;
      sprite.facing = state.facing;
      sprite.interpolate(dt);
      sprite.animate(dt);
    }

    this.streamChunks();

    if (time - this.hudAt > HUD_INTERVAL) {
      this.hudAt = time;
      const others: { x: number; y: number }[] = [];
      for (const [id, { sprite }] of this.entities) if (id !== this.room.sessionId) others.push(sprite);
      this.hud.update(this.self, others, this.entities.size);
    }
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
    if (dx === 0 && dy === 0 && pointer.isDown) {
      const wp = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const px = wp.x - self.x;
      const py = wp.y - (self.y - 16);
      if (px * px + py * py > 14 * 14) {
        dx = px;
        dy = py;
      }
    }

    const len = Math.hypot(dx, dy);
    const moving = len > 0;
    if (moving) {
      const step = (PLAYER_SPEED * dt) / 1000;
      const next = this.world.move(self.x, self.y, (dx / len) * step, (dy / len) * step);
      self.setPosition(next.x, next.y);
      if (Math.abs(dx) > 0.01) self.facing = dx < 0 ? -1 : 1;
    }
    self.moving = moving;
    self.animate(dt);

    const last = this.lastSent;
    const dirty = self.x !== last.x || self.y !== last.y || self.facing !== last.facing || moving !== last.moving;
    if (dirty && time - last.at >= SEND_INTERVAL) {
      const msg: MoveMessage = { x: self.x, y: self.y, facing: self.facing, moving };
      this.room.send("move", msg);
      this.lastSent = { ...msg, at: time };
    }
  }

  // ---------------------------------------------------------------- world streaming

  private streamChunks() {
    const view = this.cameras.main.worldView;
    const size = CHUNK_TILES * TILE_SIZE;
    const maxCx = Math.ceil(this.world.width / CHUNK_TILES) - 1;
    const maxCy = Math.ceil(this.world.height / CHUNK_TILES) - 1;
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
        for (const img of chunk.decor) img.destroy();
        this.chunks.delete(key);
      }
    }
  }

  private loadChunk(cx: number, cy: number): Chunk {
    const { world } = this;
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    const w = Math.min(CHUNK_TILES, world.width - tx0);
    const h = Math.min(CHUNK_TILES, world.height - ty0);

    const data: number[][] = [];
    const decor: Phaser.GameObjects.Image[] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) {
        const tx = tx0 + x;
        const ty = ty0 + y;
        row.push(world.tileIndexAt(tx, ty));

        const d = world.decor[ty * world.width + tx];
        if (d) {
          const style = DECOR_STYLE[d];
          const jitter = (hash2(tx, ty, world.seed + 11) - 0.5) * 8;
          const px = tx * TILE_SIZE + TILE_SIZE / 2 + jitter;
          const py = ty * TILE_SIZE + TILE_SIZE - 2;
          decor.push(this.add.image(px, py, style.key).setOrigin(0.5, style.originY).setDepth(py));
        }
      }
      data.push(row);
    }

    const map = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage(TEX.tiles, TEX.tiles, TILE_SIZE, TILE_SIZE, 0, 0)!;
    map.createLayer(0, tileset, tx0 * TILE_SIZE, ty0 * TILE_SIZE)!.setDepth(-1);
    return { map, decor };
  }
}
