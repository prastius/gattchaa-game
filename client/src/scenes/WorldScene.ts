import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import { CHUNK_TILES, PLAYER_SPEED, TILE_SIZE, WORLD_PX_H, WORLD_PX_W, hash2, isWet, type World } from "../../../shared/world";
import {
  Dir,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  MONSTER_ID_PREFIX,
  NET_SEND_HZ,
  VIEW_RADIUS,
  type DropView,
  type FxEvent,
  type MonsterView,
  type MoveMessage,
  type PlayerView,
  type SitMessage,
  type TargetMessage,
} from "../../../shared/protocol";
import { CLASSES, JOB_LEVEL, aClass, isClassId, isMonsterId, reach } from "../../../shared/rpg";
import { SKILLS, type SkillId } from "../../../shared/skills";
import { ITEMS, PICKUP_RANGE, RARITY, appearanceKey, isItemId, parseCards } from "../../../shared/items";
import { NPCS, type NpcDef } from "../../../shared/npcs";
import { DOORS, INTERIOR_ZONE, PROPS, TOWN_AREA, inRect } from "../../../shared/town";
import { CharacterTextures, PlayerSprite } from "../PlayerSprite";
import { MonsterSprite } from "../MonsterSprite";
import { DropSprite } from "../DropSprite";
import { createMonsterAnims, levelColor, preloadMonsters } from "../world/monsterArt";
import { Fx, flightMs, type Missile, type NumberKind } from "../world/fx";
import { ATLAS_MARGIN, ATLAS_SPACING, FLOOR_TEX, buildTerrainAtlas, floorCell, structKey, tileCells, type TerrainAtlas } from "../world/terrainTiles";
import { WORLD_TEX, createDecor, registerDecorFrames, type DecorSprite } from "../world/decorSprites";
import { Town, preloadTown, type Hotspot } from "../world/town";
import { SELLER_BUBBLE_LIFT, Shops } from "../world/shops";
import { Interpolator, ServerClock } from "../interp";
import { Daylight } from "../world/daylight";
import { Critters } from "../world/ambience";
import { audio } from "../audio";
import type { ChatUI } from "../ui/chat";
import type { HUD } from "../ui/hud";
import type { StatusPanel } from "../ui/status";
import type { BagPanel } from "../ui/bag";
import type { SkillsUI } from "../ui/skills";
import type { Net } from "../net";
import type { Shop } from "../shop";
import type { TownDialog } from "../ui/dialog";
import type { Vending } from "../vending";

export interface WorldSceneData {
  world: World;
  room: Room;
  net: Net;
  chat: ChatUI;
  hud: HUD;
  shop: Shop;
  dialog: TownDialog;
  vending: Vending;
  status: StatusPanel;
  bag: BagPanel;
  skills: SkillsUI;
}

interface Chunk {
  map: Phaser.Tilemaps.Tilemap;
  decor: DecorSprite[];
  /** Animated touches: glints on the water. */
  fx: Phaser.GameObjects.Sprite[];
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

interface MobEntity {
  sprite: MonsterSprite;
  state: MonsterView;
  interp: Interpolator;
  lastTs: number;
}

interface DropEntity {
  sprite: DropSprite;
  state: DropView;
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
const DOOR_TIMEOUT_MS = 900;
const OUTDOOR_BG = "#1f5f7a";
const ZOOM_KEY = "my-world:zoom";
/** How many steps past the automatic zoom the player may zoom in. */
const ZOOM_IN_STEPS = 2;
/** Wheel delta per zoom step (one mouse notch is ~100; trackpads send many small deltas). */
const WHEEL_STEP = 100;
/** Matches the server's sit cooldown (250 ms) with room to spare. */
const SIT_TOGGLE_MS = 300;
const VENDING_HINT_MS = 4000;
/** Water glints (LPC Revised "Water Reflections"): 32 px frames, shimmer lines then small sparkles. */
const WATER_FX = "water-fx";
/** Share of open-water tiles with a glint. */
const GLINT_CHANCE = 0.045;
/** Space / the sword button picks the nearest monster within this many px. */
const TARGET_RANGE = 420;
/** A target further away than this is let go. */
const TARGET_DROP_RANGE = 700;
/** Chasing stops this far inside reach, so the server (which sees you a moment late) agrees. */
const CHASE_MARGIN = 8;
const NO_TARGET_HINT_MS = 3000;
/** Loot further than this (px) can't be clicked from where you stand. */
/** A skill pressed out of range is cast on arrival, if you get there this soon. */
const PENDING_SKILL_MS = 4000;
const SKILL_HINT_MS = 900;
/** A monster biting from further than this spits something (Snapper Flower seeds). */
const MONSTER_SPIT_PX = 90;
/** Double Shot: the second arrow leaves this long after the first. */
const DOUBLE_SHOT_GAP_MS = 110;
/** Arrow Rain's numbers show when the arrows land. */
const RAIN_LAND_MS = 260;
/** Flight time of a missile between two bodies (same as Fx.missile). */
const flightMsFor = (a: { x: number; mid: number }, t: { x: number; mid: number }) => flightMs(Math.hypot(t.x - a.x, t.mid - a.mid));
const LOOT_CLICK_RANGE = 420;
/** Ask again if the server hasn't answered a pick-up by then (it was a step ahead of us). */
const PICKUP_RETRY_MS = 500;

const dirTo = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down);
const isMonster = (id: string) => id.startsWith(MONSTER_ID_PREFIX);

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

/**
 * Integer zoom levels the player may pick on this screen. Zooming out stops
 * where the view would show further than the server syncs other players
 * (VIEW_RADIUS), so nobody pops in at the screen edge.
 */
export function zoomRange(width: number, height: number, dpr: number) {
  const auto = pickZoom(width, height, dpr);
  const min = Math.max(1, Math.ceil(width / (2 * VIEW_RADIUS)), Math.ceil(height / (1.5 * VIEW_RADIUS)));
  // Always keep at least ~8x5 tiles in view.
  const closest = Math.max(1, Math.floor(Math.min(width / (8 * TILE_SIZE), height / (5 * TILE_SIZE))));
  const max = Math.max(auto, Math.min(auto + ZOOM_IN_STEPS, closest));
  return { auto, min: Math.min(min, auto), max };
}

function loadZoomSteps(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

export class WorldScene extends Phaser.Scene {
  private world!: World;
  private room!: Room;
  private net!: Net;
  private chat!: ChatUI;
  private hud!: HUD;
  private shop!: Shop;
  private dialog!: TownDialog;
  private vending!: Vending;
  private status!: StatusPanel;
  private bag!: BagPanel;
  private skills!: SkillsUI;
  /** A skill pressed while the target was out of range: cast once we've walked close enough. */
  private pendingSkill?: { id: SkillId; at: number };
  private skillHintAt = 0;
  /** The last missile each attacker fired, so a Double Shot's arrows fly one after the other. */
  private lastShot = new Map<string, number>();

  private charTextures!: CharacterTextures;
  private atlas!: TerrainAtlas;
  private town!: Town;
  /** Player shops: rugs, signs, and the look-alikes of sellers who are away. */
  private playerShops!: Shops;
  /** Session ids of players minding their shop (their chat bubbles go above the sign). */
  private sellers = new Set<string>();
  private sitToggledAt = 0;
  private emotedAt = 0;
  private vendingHintAt = 0;
  private wasVending = false;
  private entities = new Map<string, Entity>();
  private npcs = new Map<string, Entity>();
  private monsters = new Map<string, MobEntity>();
  /** Items lying on the ground near you. */
  private drops = new Map<string, DropEntity>();
  /** The item you clicked: walk to it and pick it up. */
  private pickTarget?: string;
  private pickSentAt = 0;
  private pickTries = 0;
  /** Loot floats queue up so several pick-ups don't print over each other. */
  private nextLootFloat = 0;
  private potionHintAt = 0;
  private hoveredDrop?: string;
  private fx!: Fx;
  /** The monster you're attacking (auto-attacks while it's in reach). */
  private target?: string;
  /** Walking to the target by itself; any manual step stops it. */
  private chasing = false;
  private hovered?: string;
  private wasDead = false;
  private noTargetHintAt = 0;
  private sitTipShown = false;
  private clock = new ServerClock();
  private self?: PlayerSprite;
  private chunks = new Map<string, Chunk>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "e" | "x" | "v", Phaser.Input.Keyboard.Key>;
  private lastSent = { x: 0, y: 0, dir: Dir.Down as number, moving: false, at: 0 };
  private hudAt = 0;
  private zoom = 1;
  /** Player's zoom choice, in steps from the automatic zoom (+ = closer). */
  private zoomSteps = loadZoomSteps();
  private wheelDelta = 0;
  private prompt!: Phaser.GameObjects.Text;
  private focus?: { target: string; x: number; y: number };
  /** The current press opened something, so it must not also walk. */
  private pointerUsed = false;
  private daylight!: Daylight;
  /** Butterflies by day, fireflies at night. */
  private critters!: Critters;
  /** Inside the Gattchaa store (the interior zone)? */
  private indoors = false;
  private doorPendingUntil = 0;

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
    preloadMonsters(this);
    this.load.spritesheet(WATER_FX, `${import.meta.env.BASE_URL}assets/town/water-fx.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.setCORS("anonymous"); // product thumbnails come from the shop (needs CORS there)
  }

  create() {
    this.charTextures = new CharacterTextures(this);
    const black = this.add.graphics();
    black.fillStyle(0x000000, 1).fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    black.generateTexture(FLOOR_TEX.void, TILE_SIZE, TILE_SIZE);
    black.destroy();
    // Every stone-structure tile the town and the palace hall use, so the atlas can compose them up front.
    const structs: string[] = [];
    for (const area of [TOWN_AREA, INTERIOR_ZONE]) {
      for (let ty = area.y; ty < area.y + area.h; ty++) {
        for (let tx = area.x; tx < area.x + area.w; tx++) {
          const k = structKey(this.world, tx, ty);
          if (k) structs.push(k);
        }
      }
    }
    this.atlas = buildTerrainAtlas(this, WORLD_TEX.terrain, ATLAS_KEY, structs);
    registerDecorFrames(this);
    if (!this.anims.exists("glint-a")) {
      this.anims.create({ key: "glint-a", frames: this.anims.generateFrameNumbers(WATER_FX, { start: 0, end: 3 }), frameRate: 6, repeat: -1 });
      this.anims.create({ key: "glint-b", frames: this.anims.generateFrameNumbers(WATER_FX, { start: 4, end: 7 }), frameRate: 7, repeat: -1 });
    }
    this.critters = new Critters(this, this.world);
    createMonsterAnims(this);
    this.fx = new Fx(this, () => this.textRes);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_PX_W, WORLD_PX_H);
    cam.setBackgroundColor(OUTDOOR_BG);
    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.applyZoom());

    this.town = new Town(this, this.textRes);
    this.daylight = new Daylight(this, this.town.lights, this.town.nightWindows);
    this.shop.onChange((data) => this.town.update(data, this.shop.openRooms));

    this.playerShops = new Shops(this, this.charTextures, () => this.textRes);
    const syncShops = () => {
      this.playerShops.sync(this.vending);
      this.sellers.clear();
      const spots: { x: number; y: number }[] = [];
      this.vending.forEach((s) => {
        if (s.owner) this.sellers.add(s.owner);
        spots.push(s);
      });
      this.hud.setShops(spots);
    };
    this.vending.onChange.add(syncShops);
    syncShops();
    // The open-a-shop panel checks the spot you're standing on as you move.
    this.dialog.selfPosition = () => this.self && { x: this.self.x, y: this.self.y };

    const K = Phaser.Input.Keyboard.KeyCodes;
    // enableCapture=false so the browser still delivers these keys to the chat input.
    this.keys = this.input.keyboard!.addKeys(
      { up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D, e: K.E, x: K.X, v: K.V },
      false,
    ) as typeof this.keys;
    this.keys.e.on("down", () => {
      if (this.typing()) return;
      if (this.dialog.isOpen) this.dialog.close();
      else if (this.focus) this.use(this.focus.target, this.focus);
    });
    this.keys.x.on("down", () => {
      if (!this.typing()) this.toggleSit();
    });
    this.keys.v.on("down", () => {
      if (!this.typing()) this.openShopPanel();
    });
    this.hud.onSit(() => this.toggleSit());
    this.hud.onShop(() => this.openShopPanel());
    this.hud.onEmote((e) => this.emote(e));
    this.hud.onAttack(() => this.targetNearest());
    this.hud.onBag(() => this.bag.toggle());
    this.hud.onSkills(() => this.skills.toggle());
    this.skills.onUse = (id) => this.castSkill(id);
    this.skills.onPoints = (n) => this.hud.setSkillPoints(n);
    this.dialog.openSkills = () => {
      this.dialog.close();
      this.skills.open();
    };
    this.hud.onPotion(() => this.drinkPotion());
    this.bag.appearance = () => {
      const me = this.entities.get(this.room.sessionId)?.state;
      return me ? appearanceKey(me.look, me.gear) : "";
    };
    this.bag.health = () => {
      const me = this.entities.get(this.room.sessionId)?.state;
      return { hp: me?.hp ?? 0, mhp: me?.mhp ?? 0 };
    };
    const countPotions = () => {
      let n = 0;
      for (const s of this.net.bag?.bag ?? []) if (s && ITEMS[s.id].heal) n += s.n;
      this.hud.setPotions(n);
    };
    this.net.onBag.add(countPotions);
    countPotions();
    this.status.onReturn(() => this.room.send("revive"));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.chat.blur();
      // Clicking the world leaves any text box (a shop title…), so the game keys work again.
      if (this.typing()) (document.activeElement as HTMLElement | null)?.blur();
      // Only a left click or a tap uses things; right/middle click does nothing. Monsters first, then loot.
      this.pointerUsed = p.button === 0 && (this.tryTarget(p) || this.tryPickup(p) || this.tryUse(p));
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      // Collect small trackpad deltas into whole steps; reset when direction flips.
      if (Math.sign(dy) !== Math.sign(this.wheelDelta)) this.wheelDelta = 0;
      this.wheelDelta += dy;
      if (Math.abs(this.wheelDelta) < WHEEL_STEP) return;
      this.zoomBy(this.wheelDelta < 0 ? 1 : -1);
      this.wheelDelta = 0;
    });
    this.input.keyboard!.on("keydown", (e: KeyboardEvent) => {
      // Ctrl/Cmd +/- stays the browser's page zoom.
      if (this.typing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        // Not "press the button that has focus" (the last HUD button clicked).
        e.preventDefault();
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        if (!e.repeat) this.targetNearest();
      } else if (e.key === "Escape" && this.target && !this.dialog.isOpen) this.clearTarget();
      else if (e.key === "+" || e.key === "=") this.zoomBy(1);
      else if (e.key === "-" || e.key === "_") this.zoomBy(-1);
      else if (e.key === "i" || e.key === "I") this.bag.toggle();
      else if (e.key === "q" || e.key === "Q") this.drinkPotion();
      else if (e.key === "k" || e.key === "K") this.skills.toggle();
      // 1-6: your skills, in skill-bar order (emotes are on the emote button).
      else if (/^[1-6]$/.test(e.key) && !e.repeat) {
        const skill = this.skills.mine[Number(e.key) - 1];
        if (skill) this.castSkill(skill.id as SkillId);
      }
    });
    this.hud.onZoom((step) => this.zoomBy(step));
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
    const range = zoomRange(this.scale.width, this.scale.height, window.devicePixelRatio || 1);
    // Clamp the saved choice to what this screen allows, so it can't drift past the ends.
    this.zoomSteps = Phaser.Math.Clamp(this.zoomSteps, range.min - range.auto, range.max - range.auto);
    const zoom = range.auto + this.zoomSteps;
    this.hud.setZoomLimits(zoom > range.min, zoom < range.max);
    if (zoom === this.zoom && this.cameras.main.zoom === zoom) return;
    this.zoom = zoom;
    this.cameras.main.setZoom(zoom);
    this.refreshTextRes(this.children.list);
  }

  private zoomBy(step: number) {
    const before = this.zoomSteps;
    this.zoomSteps += step;
    this.applyZoom();
    if (this.zoomSteps === before) return;
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoomSteps));
    } catch {
      /* storage unavailable */
    }
  }

  /** Re-rasterise every text at the new zoom (names, signs, bubbles), or it goes blurry. */
  private refreshTextRes(objects: Phaser.GameObjects.GameObject[]) {
    for (const obj of objects) {
      if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(this.zoom);
      else if (obj instanceof Phaser.GameObjects.Container) this.refreshTextRes(obj.list);
    }
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
      const sprite = new PlayerSprite(this, this.charTextures, state.x, state.y, state.name, appearanceKey(state.look, state.gear), {
        isSelf,
        textRes: () => this.textRes,
      });
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
        textRes: () => this.textRes,
      });
      sprite.dir = state.dir;
      this.npcs.set(id, { sprite, state, interp: new Interpolator(), lastTs: -1, npc });
    });

    callbacks.onRemove("npcs", (_value, key) => {
      this.npcs.get(key as string)?.sprite.destroy();
      this.npcs.delete(key as string);
    });

    callbacks.onAdd("monsters", (value, key) => {
      const state = value as MonsterView;
      const id = key as string;
      if (!isMonsterId(state.kind)) return;
      this.monsters.get(id)?.sprite.destroy();
      const sprite = new MonsterSprite(this, state.kind, state.x, state.y, state.hp, () => this.textRes);
      sprite.dir = state.dir;
      this.monsters.set(id, { sprite, state, interp: new Interpolator(), lastTs: -1 });
    });

    // Out of view (a defeated one already went in a puff, see "down").
    callbacks.onRemove("monsters", (_value, key) => {
      const id = key as string;
      this.monsters.get(id)?.sprite.destroy();
      this.monsters.delete(id);
      if (this.target === id) this.clearTarget();
    });

    callbacks.onAdd("drops", (value, key) => {
      const state = value as DropView;
      const id = key as string;
      if (!isItemId(state.item)) return;
      this.drops.get(id)?.sprite.destroy();
      const stack = { id: state.item, n: state.n, cards: parseCards(state.item, state.cards ?? "") };
      const sprite = new DropSprite(this, stack, state.x, state.y, () => this.textRes);
      this.drops.set(id, { sprite, state });
    });

    // Picked up, gone stale, or out of view.
    callbacks.onRemove("drops", (_value, key) => {
      const id = key as string;
      this.drops.get(id)?.sprite.destroy();
      this.drops.delete(id);
      if (this.pickTarget === id) this.pickTarget = undefined;
      if (this.hoveredDrop === id) this.hoveredDrop = undefined;
    });

    this.net.onFx = (events) => {
      for (const ev of events) this.onFx(ev);
    };
    this.net.onBubble = (sessionId, text) => this.entities.get(sessionId)?.sprite.say(text);
    this.net.onNpcSay = ({ id, text }) => this.npcs.get(id)?.sprite.say(text);
    this.net.onEmote = (sessionId, e) => this.entities.get(sessionId)?.sprite.emote(EMOTES[e] ?? "❓");
    this.net.onAnnounce.add(() => this.celebrate());
    this.net.onCorrect = ({ x, y, dir }) => {
      if (!this.self) return;
      this.self.teleport(x, y);
      Object.assign(this.lastSent, { x, y });
      if (dir !== undefined) {
        // Came through a door.
        this.self.dir = dir;
        this.doorPendingUntil = 0;
        this.dialog.close();
        this.updateIndoors();
        this.fade(false, 220);
      }
    };
  }

  // ---------------------------------------------------------------- frame loop

  update(time: number, delta: number) {
    const dt = Math.min(delta, 100); // avoid huge jumps after a tab was hidden

    if (this.self) {
      const me = this.entities.get(this.room.sessionId);
      if (me) {
        this.self.setLook(appearanceKey(me.state.look, me.state.gear)); // wardrobe and gear changes come back via state
        this.updateHealth(me.state);
      }
      this.updateSelf(time, dt);
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
      // Sit once they've arrived (the sit flag can land a frame before the last step).
      sprite.sitting = Boolean(s.sit) && !sprite.moving;
      sprite.setLook(appearanceKey(s.look, s.gear));
      if (!e.npc) {
        sprite.dead = Boolean(s.dead);
        sprite.setHp(s.hp ?? 0, s.mhp ?? 0, (s.hp ?? 0) < (s.mhp ?? 0));
      }
      sprite.animate();
    };
    for (const [id, e] of this.entities) {
      if (id === this.room.sessionId) continue;
      drive(e);
      e.sprite.bubbleLift = this.sellers.has(id) ? SELLER_BUBBLE_LIFT : 0;
    }
    for (const e of this.npcs.values()) {
      drive(e);
      this.faceVisitor(e);
    }
    for (const m of this.monsters.values()) {
      const s = m.state;
      if (s.ts !== m.lastTs) {
        m.lastTs = s.ts;
        m.interp.push({ t: s.ts, x: s.x, y: s.y, dir: s.dir, moving: s.moving });
        this.clock.observe(s.ts, now);
      }
      const p = m.interp.sample(renderT);
      if (!p) continue;
      starved ||= p.starved;
      const sprite = m.sprite;
      const step = Math.hypot(p.x - sprite.x, p.y - sprite.y);
      if (step > 300) sprite.teleport(p.x, p.y);
      else sprite.setPosition(p.x, p.y);
      sprite.dir = p.dir;
      sprite.moving = step > (8 * dt) / 1000;
      sprite.setHp(s.hp);
      sprite.animate();
    }
    for (const d of this.drops.values()) d.sprite.locked = Boolean(d.state.owner) && d.state.owner !== this.room.sessionId;
    this.updateTarget();
    this.updatePendingSkill(now);
    this.clock.update(dt, starved);

    this.updateIndoors();
    this.daylight.update(time, this.indoors);
    this.critters.update(time, dt, this.cameras.main.worldView, this.daylight.night, this.indoors);
    audio.calm = this.indoors || this.daylight.night;
    if (this.doorPendingUntil && performance.now() > this.doorPendingUntil) {
      // The server said no (or lag): don't leave the screen black.
      this.doorPendingUntil = 0;
      this.fade(false, 150);
    }

    this.updateFocus();
    this.streamChunks();
    this.fadeTallDecor(dt);

    if (time - this.hudAt > HUD_INTERVAL) {
      this.hudAt = time;
      const others: { x: number; y: number }[] = [];
      for (const [id, { sprite }] of this.entities) if (id !== this.room.sessionId) others.push(sprite);
      const state = this.room.state as { online?: number; siteOnline?: number };
      this.hud.update(this.self, others, state.online ?? this.entities.size, state.siteOnline ?? 0);
      this.bag.tick();
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
    if (self.dead) {
      // Knocked out: lying there until you return to town.
      self.moving = false;
      self.animate();
      return;
    }

    if (!this.typing()) {
      const k = this.keys;
      if (k.left.isDown || k.a.isDown) dx -= 1;
      if (k.right.isDown || k.d.isDown) dx += 1;
      if (k.up.isDown || k.w.isDown) dy -= 1;
      if (k.down.isDown || k.s.isDown) dy += 1;
    }

    // Hold a finger on the screen to walk toward it (phones have no keys).
    // The mouse never moves you: on desktop it only clicks things.
    const pointer = this.input.activePointer;
    if (dx === 0 && dy === 0 && pointer.isDown && pointer.wasTouch && !this.pointerUsed) {
      const wp = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const px = wp.x - self.x;
      const py = wp.y - (self.y - 20);
      if (px * px + py * py > 12 * 12) {
        dx = px;
        dy = py;
      }
    }

    const vending = Boolean(this.vending.myShop);
    if (this.wasVending && !vending) self.sitting = false; // shop closed: stand up
    this.wasVending = vending;
    self.bubbleLift = vending ? SELLER_BUBBLE_LIFT : 0;
    if (vending) {
      // Minding your shop: seated on its rug, facing the street, until you close it.
      self.sitting = true;
      self.dir = Dir.Down;
      self.moving = false;
      self.animate();
      if ((dx || dy) && time - this.vendingHintAt > VENDING_HINT_MS) {
        this.vendingHintAt = time;
        this.chat.addSystem("You're minding your shop. Close it (My shop, or V) to walk around.");
      }
      return;
    }

    // Walk to the loot or monster you clicked until it's in reach; any manual step takes over.
    if (dx || dy) {
      this.chasing = false;
      this.pickTarget = undefined;
    } else if (this.pickTarget) {
      const d = this.drops.get(this.pickTarget);
      const ox = d ? d.state.x - self.x : 0;
      const oy = d ? d.state.y - self.y : 0;
      if (!d) this.pickTarget = undefined;
      else if (Math.hypot(ox, oy) > PICKUP_RANGE - CHASE_MARGIN) {
        dx = ox;
        dy = oy;
      } else if (time - this.pickSentAt > PICKUP_RETRY_MS) {
        // A couple of tries (the server sees us a moment late), then let it be: the bag may be full.
        this.pickSentAt = time;
        if (this.pickTries++ < 3) this.net.pickup(this.pickTarget);
        else this.pickTarget = undefined;
      }
    } else if (this.chasing && this.target) {
      const mob = this.monsters.get(this.target);
      if (mob) {
        const ox = mob.sprite.x - self.x;
        const oy = mob.sprite.y - self.y;
        if (Math.hypot(ox, oy) > this.myReach(mob) - CHASE_MARGIN) {
          dx = ox;
          dy = oy;
        }
      }
    }

    const len = Math.hypot(dx, dy);
    let moving = false;
    if (len > 0) {
      self.sitting = false; // walking gets you up (the server does the same)
      const step = (PLAYER_SPEED * dt) / 1000;
      const next = this.world.move(self.x, self.y, (dx / len) * step, (dy / len) * step);
      moving = next.x !== self.x || next.y !== self.y;
      self.setPosition(next.x, next.y);
      // Face the dominant input direction even when blocked.
      self.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    }
    self.moving = moving;
    self.animate();

    // Walking into a doorway (in the door's direction) goes through it.
    if (len > 0) {
      const wantDir = dy < 0 && Math.abs(dy) >= Math.abs(dx) ? Dir.Up : dy > 0 && Math.abs(dy) >= Math.abs(dx) ? Dir.Down : -1;
      for (const d of DOORS) {
        if (d.dir === wantDir && inRect(d.trigger, self.x, self.y)) this.useDoor(d.id);
      }
    }

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

  /** Typing in the chat or any other text box (a shop title…): game keys are off. */
  private typing(): boolean {
    const el = document.activeElement as HTMLElement | null;
    return this.chat.isFocused() || Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
  }

  // ---------------------------------------------------------------- fighting

  /** Your level, from your synced state. */
  private get myLevel(): number {
    return this.entities.get(this.room.sessionId)?.state.lv ?? 1;
  }

  /** How close (feet to feet) you must be to hit this monster: further with a bow or staff. */
  private myReach(mob: MobEntity): number {
    return reach(this.net.stats?.range ?? CLASSES.novice.range, mob.sprite.def);
  }

  /** How close you must be for a skill (its own range, or your weapon's reach). */
  private skillReach(id: SkillId, mob: MobEntity): number {
    const s = SKILLS[id];
    return s.range !== undefined ? s.range + mob.sprite.def.radius : this.myReach(mob);
  }

  /**
   * A skill key or button: self and burst skills go off at once; aimed ones
   * pick your target (or the nearest monster) and walk into range first.
   */
  private castSkill(id: SkillId) {
    const self = this.self;
    if (!self || self.dead) return;
    const why = this.skills.notReady(id);
    if (why === "cooldown") return;
    if (why) return this.skillHint(why);
    const s = SKILLS[id];
    if (s.kind === "self" || s.kind === "burst") {
      this.net.useSkill(id);
      return;
    }
    if (!this.target || !this.monsters.has(this.target)) this.targetNearest();
    const mob = this.target ? this.monsters.get(this.target) : undefined;
    if (!mob) return;
    if (Math.hypot(mob.sprite.x - self.x, mob.sprite.y - self.y) <= this.skillReach(id, mob) - CHASE_MARGIN) this.net.useSkill(id, this.target);
    else {
      this.pendingSkill = { id, at: performance.now() };
      this.chasing = true;
    }
  }

  /** Walking into range for a skill: cast it on arrival (or forget it after a few seconds). */
  private updatePendingSkill(now: number) {
    const p = this.pendingSkill;
    const self = this.self;
    if (!p || !self) return;
    const mob = this.target ? this.monsters.get(this.target) : undefined;
    if (!mob || self.dead || now - p.at > PENDING_SKILL_MS) {
      this.pendingSkill = undefined;
      return;
    }
    if (Math.hypot(mob.sprite.x - self.x, mob.sprite.y - self.y) > this.skillReach(p.id, mob) - CHASE_MARGIN) return;
    this.pendingSkill = undefined;
    if (!this.skills.notReady(p.id)) this.net.useSkill(p.id, this.target);
  }

  /** Why a skill didn't go off, floated over your head (not too often). */
  private skillHint(text: string) {
    const self = this.self;
    const now = performance.now();
    if (!self || now - this.skillHintAt < SKILL_HINT_MS) return;
    this.skillHintAt = now;
    this.fx.float(self.x, self.y - 84, text, "#ffb3a8");
  }

  /** What flies from an attacker to its target, if anything: arrows, bolts, fire or seeds. */
  private missileFor(ev: Extract<FxEvent, { k: "hit" | "miss" }>, a: { x: number; y: number; mob?: MonsterSprite }, t: { x: number; y: number }): Missile | undefined {
    if (ev.k === "hit" && ev.skill) {
      const fx = SKILLS[ev.skill].fx;
      return fx === "fire" ? "fire" : fx === "arrows" ? "arrow" : undefined;
    }
    if (a.mob) return Math.hypot(t.x - a.x, t.y - a.y) > MONSTER_SPIT_PX ? "seed" : undefined;
    // Players: by the weapon in their hand (the first part of their gear string).
    const weapon = this.entities.get(ev.a)?.state.gear?.split(".")[0];
    const kind = weapon && isItemId(weapon) ? ITEMS[weapon].weapon : undefined;
    return kind === "bow" ? "arrow" : kind === "staff" ? "bolt" : undefined;
  }

  /** Your own HP bar, the status panel, and fainting. */
  private updateHealth(state: Synced) {
    const self = this.self!;
    const hp = state.hp ?? 0;
    const mhp = state.mhp ?? 0;
    const dead = Boolean(state.dead);
    this.status.setHp(hp, mhp);
    self.setHp(hp, mhp, mhp > 0 && (hp < mhp || this.hud.inField));
    self.dead = dead;
    if (dead !== this.wasDead) {
      this.wasDead = dead;
      this.status.setKnockedOut(dead);
      if (dead) {
        this.clearTarget(false);
        this.dialog.close();
      }
    }
    if (!this.sitTipShown && !dead && mhp > 0 && hp < mhp * 0.4) {
      this.sitTipShown = true;
      this.chat.addSystem("Tip: sit down (X) to heal three times faster, or rest inside the town walls.");
    }
  }

  /** Space or the sword button: the nearest monster around you. */
  private targetNearest() {
    const self = this.self;
    if (!self || self.dead) return;
    let best: string | undefined;
    let bestD = TARGET_RANGE;
    for (const [id, m] of this.monsters) {
      const d = Math.hypot(m.sprite.x - self.x, m.sprite.y - self.y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best) this.setTarget(best);
    else if (performance.now() - this.noTargetHintAt > NO_TARGET_HINT_MS) {
      this.noTargetHintAt = performance.now();
      this.chat.addSystem("No monsters nearby. They live in the fields outside the town walls (try the South Meadow, out the south gate).");
    }
  }

  /** Click/tap on loot: walk over and pick it up. */
  private tryPickup(p: Phaser.Input.Pointer): boolean {
    const self = this.self;
    const id = this.dropAt(p);
    if (!id || !self || self.dead) return false;
    const d = this.drops.get(id)!;
    if (this.vending.myShop) this.chat.addSystem("You're minding your shop. Close it first to pick things up.");
    else if (d.state.owner && d.state.owner !== this.room.sessionId) this.chat.addSystem("That's someone else's loot for a few more seconds.");
    else {
      this.pickTarget = id;
      this.pickSentAt = 0;
      this.pickTries = 0;
      if (self.sitting) this.toggleSit();
    }
    return true;
  }

  /** The loot under the pointer, front-most first. */
  private dropAt(p: Phaser.Input.Pointer): string | undefined {
    const self = this.self;
    if (!self) return undefined;
    const wp = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    let best: string | undefined;
    let bestY = -Infinity;
    for (const [id, d] of this.drops) {
      const s = d.sprite;
      if (s.y > bestY && s.hitBox().contains(wp.x, wp.y) && Math.hypot(s.x - self.x, s.y - self.y) < LOOT_CLICK_RANGE) {
        bestY = s.y;
        best = id;
      }
    }
    return best;
  }

  /** Q or the potion button: the smallest potion that heals you fully, or else the biggest you have. */
  private drinkPotion() {
    const me = this.entities.get(this.room.sessionId)?.state;
    const bag = this.net.bag?.bag;
    if (!me || !bag || me.dead) return;
    const hint = (text: string) => {
      if (performance.now() - this.potionHintAt < NO_TARGET_HINT_MS) return;
      this.potionHintAt = performance.now();
      this.chat.addSystem(text);
    };
    const missing = (me.mhp ?? 0) - (me.hp ?? 0);
    if (missing <= 0) return hint("You're already at full health.");
    let best = -1;
    let bestHeal = 0;
    bag.forEach((s, i) => {
      const heal = s ? (ITEMS[s.id].heal ?? 0) : 0;
      if (!heal) return;
      const better = best < 0 || (bestHeal < missing ? heal > bestHeal : heal >= missing && heal < bestHeal);
      if (better) {
        best = i;
        bestHeal = heal;
      }
    });
    if (best < 0) return hint("You have no potions. Bram the Outfitter by the south gate sells them.");
    this.net.useItem(best);
  }

  /** Click/tap on a monster attacks it. */
  private tryTarget(p: Phaser.Input.Pointer): boolean {
    const id = this.monsterAt(p);
    if (!id) return false;
    this.setTarget(id);
    return true;
  }

  /** The monster under the pointer, front-most first. */
  private monsterAt(p: Phaser.Input.Pointer): string | undefined {
    const wp = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    let best: string | undefined;
    let bestY = -Infinity;
    for (const [id, m] of this.monsters) {
      if (m.sprite.y > bestY && m.sprite.hitBox().contains(wp.x, wp.y)) {
        bestY = m.sprite.y;
        best = id;
      }
    }
    return best;
  }

  private setTarget(id: string) {
    const self = this.self;
    if (!self || self.dead || !this.monsters.has(id)) return;
    if (this.vending.myShop) {
      this.chat.addSystem("You're minding your shop. Close it first to go fighting.");
      return;
    }
    if (this.target !== id) {
      const before = this.target ? this.monsters.get(this.target) : undefined;
      if (before) before.sprite.targeted = false;
      this.target = id;
      this.room.send("target", { id } satisfies TargetMessage);
    }
    this.monsters.get(id)!.sprite.targeted = true;
    this.chasing = true;
    if (self.sitting) this.toggleSit();
  }

  private clearTarget(send = true) {
    const mob = this.target ? this.monsters.get(this.target) : undefined;
    if (mob) mob.sprite.targeted = false;
    this.target = undefined;
    this.chasing = false;
    this.status.hideTarget();
    if (send) this.room.send("target", { id: "" } satisfies TargetMessage);
  }

  /** The target frame, names on hover, and letting go of targets you walked away from. */
  private updateTarget() {
    const self = this.self;
    const mob = this.target ? this.monsters.get(this.target) : undefined;
    if (this.target && (!mob || !self || Math.hypot(mob.sprite.x - self.x, mob.sprite.y - self.y) > TARGET_DROP_RANGE)) this.clearTarget();
    else if (mob) {
      const color = levelColor(this.myLevel, mob.sprite.kind);
      mob.sprite.setNameColor(color);
      this.status.showTarget(mob.sprite.def.name, mob.sprite.def.level, mob.state.hp, mob.sprite.def.hp, color);
    }

    // Desktop: point at a monster (or loot) to see its name.
    const pointer = this.input.activePointer;
    const hovered = pointer.wasTouch ? undefined : this.monsterAt(pointer);
    const hoveredDrop = pointer.wasTouch || hovered ? undefined : this.dropAt(pointer);
    if (hoveredDrop !== this.hoveredDrop) {
      const before = this.hoveredDrop ? this.drops.get(this.hoveredDrop) : undefined;
      if (before) before.sprite.hovered = false;
      const now = hoveredDrop ? this.drops.get(hoveredDrop) : undefined;
      if (now) now.sprite.hovered = true;
      this.hoveredDrop = hoveredDrop;
    }
    if (hovered !== this.hovered) {
      const before = this.hovered ? this.monsters.get(this.hovered) : undefined;
      if (before) before.sprite.hovered = false;
      this.hovered = hovered;
    }
    this.game.canvas.style.cursor = hovered || hoveredDrop ? "pointer" : "";
    const now = hovered ? this.monsters.get(hovered) : undefined;
    if (now) {
      now.sprite.setNameColor(levelColor(this.myLevel, now.sprite.kind));
      now.sprite.hovered = true;
    }
  }

  /** Where an id (player or monster) is: its feet, its middle (slashes) and just above its name (numbers). */
  private body(id: string): { x: number; y: number; mid: number; top: number; mob?: MonsterSprite; player?: PlayerSprite } | undefined {
    if (isMonster(id)) {
      const mob = this.monsters.get(id)?.sprite;
      return mob && { x: mob.x, y: mob.y, mid: mob.y - mob.art.h / 2, top: mob.head.y - 16, mob };
    }
    const player = id === this.room.sessionId ? this.self : this.entities.get(id)?.sprite;
    return player && { x: player.x, y: player.y, mid: player.y - 28, top: player.y - 68, player };
  }

  private onFx(ev: FxEvent) {
    const me = this.room.sessionId;
    switch (ev.k) {
      case "hit":
      case "miss": {
        const a = this.body(ev.a);
        const t = this.body(ev.t);
        if (ev.k === "hit" && ev.thorn) {
          // A card biting back: no swing, just the number on the monster.
          if (!t) return;
          t.mob?.flash();
          this.fx.number(t.x, t.top, String(ev.d), ev.a === me ? "thorn" : "other");
          return;
        }
        const missile = a && t ? this.missileFor(ev, a, t) : undefined;
        const skill = ev.k === "hit" && ev.skill ? SKILLS[ev.skill] : undefined;
        if (a && t) {
          if (a.mob) a.mob.attack(dirTo(t.x - a.x, t.y - a.y));
          // Swords swing; bows, staves and spells don't.
          else if (!missile && (!skill || skill.fx === "bash")) a.player?.lunge(t.x - a.x, t.y - a.y);
          if (ev.a === me && this.self) this.self.dir = dirTo(t.x - a.x, t.y - a.y);
        }
        if (!t) return;
        // Missiles land a moment later; the number shows when they do.
        let delay = 0;
        if (missile && a) {
          const now = performance.now();
          const stagger = now - (this.lastShot.get(ev.a) ?? 0) < 40 ? DOUBLE_SHOT_GAP_MS : 0;
          this.lastShot.set(ev.a, now + stagger);
          const fly = () => this.fx.missile(a.x, a.mid, t.x, t.mid, missile);
          if (stagger) this.time.delayedCall(stagger, fly);
          delay = stagger + (stagger ? flightMsFor(a, t) : fly());
          if (ev.a === me && !skill) audio.shoot(missile !== "arrow");
        } else if (skill?.fx === "rain") delay = RAIN_LAND_MS;
        const land = () => {
          const tb = this.body(ev.t) ?? t;
          if (ev.k === "miss") {
            this.fx.number(tb.x, tb.top, "Miss", "miss");
            if (ev.a === me && !missile) audio.swing();
            return;
          }
          tb.mob?.flash();
          tb.player?.flash();
          if (skill?.fx === "nova") this.fx.burst(tb.x, tb.mid, [0xffffff, 0xbfe9ff], 8);
          else if (!a?.mob && !missile && skill?.fx !== "rain") this.fx.slash(tb.x, tb.mid);
          const kind: NumberKind = ev.t === me ? "taken" : ev.a === me ? (ev.crit ? "crit" : "dealt") : "other";
          this.fx.number(tb.x, tb.top, ev.crit && kind !== "taken" ? `${ev.d}!` : String(ev.d), kind);
          if (ev.a === me) audio.hit(Boolean(ev.crit));
          else if (ev.t === me) audio.hurt();
        };
        if (delay > 0) this.time.delayedCall(delay, land);
        else land();
        return;
      }
      case "cast": {
        const a = this.body(ev.a);
        const s = SKILLS[ev.s];
        if (!a || !s) return;
        const t = ev.t ? this.body(ev.t) : undefined;
        if (ev.a === me) {
          this.skills.started(ev.s);
          audio.skill(s.fx);
        }
        if (t && a.player && ev.a === me && this.self) this.self.dir = dirTo(t.x - a.x, t.y - a.y);
        switch (s.fx) {
          case "whirl":
            this.fx.whirl(a.x, a.y, s.radius ?? 72);
            break;
          case "nova":
            this.fx.nova(a.x, a.y, s.radius ?? 100);
            break;
          case "rain":
            if (t) this.fx.rain(t.x, t.y, s.radius ?? 80);
            break;
          case "guard":
            this.fx.aura(a.x, a.y, 0xffd27a);
            break;
          case "eagle":
            this.fx.aura(a.x, a.y, 0x9fe8ff);
            break;
          case "heal":
            this.fx.aura(a.x, a.y, 0x7cf08a);
            break;
          case "bash":
            if (t) this.fx.burst(t.x, t.mid, [0xffffff, 0xffd27a], 12);
            break;
          default:
            break;
        }
        return;
      }
      case "freeze": {
        this.monsters.get(ev.t)?.sprite.freeze(ev.ms);
        return;
      }
      case "job": {
        const b = this.body(ev.t);
        if (!isClassId(ev.cls)) return;
        const cls = CLASSES[ev.cls];
        const tint = ev.cls === "knight" ? 0xff8a5c : ev.cls === "mage" ? 0xb98cff : 0x7ddb6e;
        if (b) this.fx.levelUp(b.x, b.y, `${cls.name.toUpperCase()}!`, tint);
        if (ev.t === me) {
          audio.levelUp();
          this.chat.addSystem(`You are now ${aClass(ev.cls)}! You have a skill point: open your skills (K) and learn one, then use it with key 1, 2 or 3.`);
        }
        return;
      }
      case "fail": {
        this.skillHint(ev.why);
        return;
      }
      case "down": {
        // A defeated monster goes in a puff; the removal that follows finds nothing left to do.
        const m = this.monsters.get(ev.t);
        if (!m) return;
        this.fx.poof(m.sprite.x, m.sprite.y);
        m.sprite.die();
        this.monsters.delete(ev.t);
        if (this.target === ev.t) {
          this.clearTarget(false);
          audio.defeat();
        }
        return;
      }
      case "lvup": {
        const b = this.body(ev.t);
        if (b) this.fx.levelUp(b.x, b.y);
        if (ev.t === me) {
          audio.levelUp();
          const cls = this.net.stats?.cls;
          const extra =
            cls === "novice" || !cls
              ? ev.lv === JOB_LEVEL
                ? " Visit Orin the Job Master, just inside the south gate, to become a Knight, Mage or Archer!"
                : ""
              : " +1 skill point (K).";
          this.chat.addSystem(`Level up! You are now level ${ev.lv}.${extra}`);
        }
        return;
      }
      case "gain": {
        const self = this.self;
        if (!self) return;
        // Above the name tag, one line each.
        if (ev.exp) this.fx.float(self.x, self.y - 84, `+${ev.exp} EXP`, "#ffe2a0", 250);
        if (ev.gold) this.fx.float(self.x, self.y - 70, `+${ev.gold} gold`, "#ffd27a", 450);
        return;
      }
      case "loot": {
        const self = this.self;
        if (!self || !isItemId(ev.item)) return;
        const it = ITEMS[ev.item];
        const now = performance.now();
        const delay = Math.max(0, this.nextLootFloat - now);
        this.nextLootFloat = now + delay + 260;
        this.fx.float(self.x, self.y - 84, `+ ${it.name}${ev.n > 1 ? ` ×${ev.n}` : ""}`, RARITY[it.rarity].color, delay);
        this.time.delayedCall(delay, () => (it.kind === "card" ? audio.card() : audio.pickup(it.rarity !== "common")));
        return;
      }
      case "card": {
        const b = this.body(ev.t);
        if (b) this.fx.card(b.x, b.y);
        if (ev.t === me) audio.card();
        return;
      }
      case "heal": {
        const b = this.body(ev.t);
        if (b) this.fx.number(b.x, b.top, `+${ev.d}`, "heal");
        if (ev.t === me) audio.potion();
        return;
      }
    }
  }

  /** Shows an emote over your head (the server allows one a second). */
  private emote(e: number) {
    const now = performance.now();
    if (!this.self || now - this.emotedAt < EMOTE_COOLDOWN_MS) return;
    this.emotedAt = now;
    this.net.sendEmote(e);
    audio.blip();
  }

  /** Sits down where you stand, or gets up. */
  private toggleSit() {
    const self = this.self;
    const now = performance.now();
    if (!self || self.dead || this.vending.myShop || now - this.sitToggledAt < SIT_TOGGLE_MS) return;
    this.sitToggledAt = now;
    self.sitting = !self.sitting;
    self.moving = false;
    self.animate();
    this.room.send("sit", { on: self.sitting } satisfies SitMessage);
  }

  /**
   * "Open shop" (V): your shop's panel if it's open, otherwise the form to open
   * one right here (or how to sign in, for guests).
   */
  private openShopPanel() {
    const self = this.self;
    if (!self) return;
    const mine = this.vending.myShop;
    const shop = mine && this.vending.shop(mine);
    if (shop) this.use(`shop:${mine}`, shop);
    else if (this.dialog.isOpen && this.dialog.target === "vend") this.dialog.close();
    else this.dialog.open("vend", { x: self.x, y: self.y });
  }

  /** NPCs (where they are right now) plus the town's fixed hotspots and the player shops. */
  private hotspots(): Hotspot[] {
    const list: Hotspot[] = [...this.town.hotspots, ...this.playerShops.hotspots];
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
    if (self && !this.typing()) {
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
    // Doors only from up close; a tap from further away walks you there instead.
    if (h.target.startsWith("door:") && Math.hypot(h.x - self.x, h.y - self.y) > TALK_RANGE) return false;
    this.use(h.target, { x: h.x, y: h.y });
    return true;
  }

  /** Talk / use / go through, depending on what it is. */
  private use(target: string, at: { x: number; y: number }) {
    if (target.startsWith("door:")) this.useDoor(target.slice(5));
    else this.dialog.open(target, at);
  }

  private useDoor(id: string) {
    if (this.doorPendingUntil) return;
    this.doorPendingUntil = performance.now() + DOOR_TIMEOUT_MS;
    this.room.send("door", { id });
    audio.door();
    this.fade(true, 120);
  }

  /** Forced, so a fade-in can interrupt a fade-out that's still running. */
  private fade(out: boolean, ms: number) {
    this.cameras.main.fadeEffect.start(out, ms, 0, 0, 0, true);
  }

  /** Inside the store only the interior is drawn, on black; outside it's hidden. */
  private updateIndoors() {
    const self = this.self;
    if (!self) return;
    const inside = inRect(INTERIOR_ZONE, self.x / TILE_SIZE, self.y / TILE_SIZE);
    if (inside === this.indoors) return;
    this.indoors = inside;
    const cam = this.cameras.main;
    if (inside) {
      const z = INTERIOR_ZONE;
      cam.setBounds(z.x * TILE_SIZE, z.y * TILE_SIZE, z.w * TILE_SIZE, z.h * TILE_SIZE);
      cam.setBackgroundColor("#000000");
    } else {
      cam.setBounds(0, 0, WORLD_PX_W, WORLD_PX_H);
      cam.setBackgroundColor(OUTDOOR_BG);
    }
    this.hud.setIndoors(inside);
    this.daylight.refresh();
    // Drop chunks from the other side; streamChunks loads the right ones.
    for (const [key, chunk] of this.chunks) {
      const [cx, cy] = key.split(",").map(Number);
      if (this.chunkAllowed(cx, cy)) continue;
      this.unloadChunk(chunk);
      this.chunks.delete(key);
    }
  }

  private chunkAllowed(cx: number, cy: number): boolean {
    const z = INTERIOR_ZONE;
    const inZone = cx * CHUNK_TILES >= z.x && cy * CHUNK_TILES >= z.y && (cx + 1) * CHUNK_TILES <= z.x + z.w && (cy + 1) * CHUNK_TILES <= z.y + z.h;
    return this.indoors === inZone;
  }

  private unloadChunk(chunk: Chunk) {
    chunk.map.destroy();
    for (const d of chunk.decor) {
      d.image.destroy();
      d.shadow?.destroy();
    }
    for (const s of chunk.fx) s.destroy();
  }

  /** Fireworks over the fountain when someone pulls a hit on Gattchaa. */
  private celebrate() {
    audio.fanfare();
    if (this.indoors) return; // the fireworks are over the plaza
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
        if (!this.chunks.has(key) && this.chunkAllowed(cx, cy)) this.chunks.set(key, this.loadChunk(cx, cy));
      }
    }

    // Unload with one chunk of hysteresis so walking along a border doesn't thrash.
    for (const [key, chunk] of this.chunks) {
      const [cx, cy] = key.split(",").map(Number);
      if (cx < x0 - 1 || cx > x1 + 1 || cy < y0 - 1 || cy > y1 + 1) {
        this.unloadChunk(chunk);
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
    const fx: Phaser.GameObjects.Sprite[] = [];

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
        const sk = structKey(world, tx, ty);
        const f = sk ? null : floorCell(world, tx, ty);
        fRow.push(sk ? atlas.struct(sk) : f ? atlas.sheet(f) : -1);
        if (sk || f) hasFloor = true;

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
        } else if (hash2(tx, ty, world.seed + 61) < GLINT_CHANCE && world.corners(tx, ty).every(isWet)) {
          // Sunlight glinting on open water, each at its own pace.
          const pick = hash2(tx, ty, world.seed + 62);
          const glint = this.add
            .sprite(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, WATER_FX)
            .setDepth(-1.5)
            .setAlpha(0.75)
            .play({ key: pick < 0.5 ? "glint-a" : "glint-b", delay: pick * 3000, repeatDelay: 1200 + pick * 2600 });
          fx.push(glint);
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
    return { map, decor, fx };
  }
}
